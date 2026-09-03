// Minimal Chrome DevTools Protocol client. Zero dependencies: Node 22 ships a global
// WebSocket, and CDP target management is available over plain HTTP.
//
// Why a browser at all: Marriott's GraphQL endpoint sits behind Akamai Bot Manager.
// An identical request succeeds from inside a page and returns 403 from curl.
// See research/05-access-and-blocking.md.
//
// ANTI-DETECTION NOTE — the reason this file exists instead of a Playwright dependency:
// `Runtime.enable` is the single most reliably detected automation signal. Calling it
// makes the browser emit a Runtime.consoleAPICalled event that page JS can observe in a
// few lines, and Akamai/Cloudflare/DataDome all watch for it. Stock Playwright and
// Puppeteer both call it during setup.
//
// We never call Runtime.enable. Instead we create an isolated world via
// Page.createIsolatedWorld and evaluate against its contextId. An isolated world shares
// the page's origin, cookies and DOM (so `fetch` is same-origin and fully authenticated)
// but runs in a separate JS context that page scripts cannot observe.
//
// This is the same technique rebrowser-patches and Patchright apply to Playwright. If
// Akamai ever tightens further, the escape hatch is `--attach <port>` against a real
// Chrome the user already runs.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const STATE_DIR = join(homedir(), '.marriott-mcp');
const PROFILE_DIR = join(STATE_DIR, 'chrome-profile');

function findChrome() {
  if (process.env.MARRIOTT_CHROME) return process.env.MARRIOTT_CHROME;
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) {
    throw new Error('Could not find Chrome. Set MARRIOTT_CHROME to the browser binary.');
  }
  return hit;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForEndpoint(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(150);
  }
  throw new Error(`Chrome DevTools endpoint never came up on ${port}: ${lastErr}`);
}

export class Browser {
  #proc = null;
  #ws = null;
  #nextId = 1;
  #pending = new Map();
  #ownsProcess = false;
  #contextId = null;
  #frameId = null;

  constructor({ headless = false, hidden = false, port = null, verbose = false } = {}) {
    this.headless = headless;
    this.hidden = hidden;
    this.port = port;
    this.verbose = verbose;
  }

  #log(...args) {
    if (this.verbose) console.error('[cdp]', ...args);
  }

  async start() {
    if (this.port) {
      await waitForEndpoint(this.port, 5000);
      this.#log('attached to existing Chrome on', this.port);
      return;
    }

    mkdirSync(PROFILE_DIR, { recursive: true });
    this.port = await freePort();
    const bin = findChrome();

    const args = [
      `--remote-debugging-port=${this.port}`,
      // A persistent profile is load-bearing: Akamai reputation is built up across runs,
      // and a fresh profile every time looks exactly like a bot farm.
      `--user-data-dir=${PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-features=Translate,MediaRouter',
      '--window-size=1512,900',
    ];
    // Headless is not merely "more detectable" here — measured, Akamai denies it
    // outright without even offering the challenge, on the same profile that works
    // headful seconds later. It fingerprints GPU/audio/WebRTC, all of which differ.
    if (this.headless) args.push('--headless=new');
    // --hidden is the usable middle ground: a REAL headful Chrome (real GPU, real
    // rendering, so the sensor sees a genuine browser) parked far off-screen so it
    // never appears on your desktop. Not the same thing as headless.
    else if (this.hidden) args.push('--window-position=-32000,-32000');

    this.#log('launching', bin, 'port', this.port, this.headless ? '(headless)' : '');
    this.#proc = spawn(bin, args, { stdio: 'ignore' });
    this.#ownsProcess = true;
    this.#proc.on('error', (e) => {
      throw new Error(`Failed to launch Chrome: ${e.message}`);
    });

    await waitForEndpoint(this.port);
  }

  async openPage(url) {
    // Open a blank tab, then navigate over CDP. Chrome versions disagree about whether
    // /json/new honours its ?url= argument (recent builds silently ignore it and leave
    // you on about:blank), so we never rely on it for navigation.
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new`, { method: 'PUT' });
    if (!res.ok) {
      throw new Error(`Could not open tab (${res.status}). ${await res.text()}`);
    }
    const target = await res.json();
    this.targetId = target.id;
    await this.#connect(target.webSocketDebuggerUrl);

    if (this.hidden) {
      // macOS can clamp --window-position back on-screen, so move it explicitly and
      // report where it actually landed rather than assuming.
      try {
        const { windowId } = await this.send('Browser.getWindowForTarget', {
          targetId: this.targetId,
        });
        await this.send('Browser.setWindowBounds', {
          windowId,
          bounds: { left: -32000, top: -32000, width: 1512, height: 900 },
        });
        const { bounds } = await this.send('Browser.getWindowBounds', { windowId });
        this.#log('window bounds', JSON.stringify(bounds));
        if (bounds.left > -1000 && bounds.top > -1000) {
          this.#log('WARNING: window may still be visible (OS clamped the position)');
        }
      } catch (e) {
        this.#log('could not reposition window:', e.message);
      }
    }

    // Deliberately NOT calling Runtime.enable. See header note.
    await this.navigate(url);
  }

  #connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.#ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', (e) =>
        reject(new Error(`CDP websocket error: ${e.message ?? 'unknown'}`)),
      );
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.#pending.get(msg.id);
          this.#pending.delete(msg.id);
          if (msg.error) rej(new Error(`CDP ${msg.error.message}`));
          else res(msg.result);
        }
      });
      ws.addEventListener('close', () => {
        for (const { reject: rej } of this.#pending.values()) {
          rej(new Error('CDP connection closed'));
        }
        this.#pending.clear();
      });
    });
  }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id);
          reject(new Error(`CDP timeout on ${method}`));
        }
      }, 90000);
    });
  }

  /** Lazily create an isolated world to evaluate in, avoiding Runtime.enable. */
  async #context() {
    if (this.#contextId !== null) return this.#contextId;
    const { frameTree } = await this.send('Page.getFrameTree');
    this.#frameId = frameTree.frame.id;
    const { executionContextId } = await this.send('Page.createIsolatedWorld', {
      frameId: this.#frameId,
      worldName: 'mi',
      // Note: the CDP spec really does misspell "Universal" here.
      grantUniveralAccess: true,
    });
    this.#contextId = executionContextId;
    return this.#contextId;
  }

  /**
   * Evaluate an expression in the page's isolated world. Top-level await is supported:
   * the expression is wrapped in an async IIFE, so write the value you want last.
   */
  async evaluate(expression) {
    const wrapped = `(async () => { return (${expression}); })()`;
    const run = async () => {
      const contextId = await this.#context();
      return this.send('Runtime.evaluate', {
        expression: wrapped,
        contextId,
        awaitPromise: true,
        returnByValue: true,
      });
    };

    let result;
    try {
      result = await run();
    } catch (err) {
      // A navigation destroys the isolated world; rebuild it once and retry.
      if (/context/i.test(err.message)) {
        this.#contextId = null;
        result = await run();
      } else {
        throw err;
      }
    }

    if (result.exceptionDetails) {
      const d = result.exceptionDetails;
      throw new Error(
        `Page evaluation failed: ${d.exception?.description ?? d.text ?? 'unknown'}`,
      );
    }
    return result.result.value;
  }

  async waitForReady(timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr;
    while (Date.now() < deadline) {
      try {
        if ((await this.evaluate('document.readyState')) === 'complete') return;
      } catch (err) {
        lastErr = err; // context churn during load is expected
        this.#contextId = null;
      }
      await sleep(250);
    }
    throw new Error(`Page did not finish loading. ${lastErr?.message ?? ''}`);
  }

  async navigate(url) {
    this.#contextId = null;
    const { errorText } = await this.send('Page.navigate', { url });
    if (errorText) throw new Error(`Navigation to ${url} failed: ${errorText}`);

    // readyState can read 'complete' against the *outgoing* document, so wait for the
    // location to actually commit before declaring the page ready.
    const want = new URL(url).origin;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      await sleep(250);
      try {
        const state = await this.evaluate(
          `({ href: location.href, ready: document.readyState })`,
        );
        if (state.href.startsWith(want) && state.ready === 'complete') return;
      } catch {
        this.#contextId = null; // context churn mid-navigation is expected
      }
    }
    throw new Error(`Timed out navigating to ${url}`);
  }

  async close() {
    try {
      if (this.targetId) {
        await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`).catch(
          () => {},
        );
      }
      this.#ws?.close();
    } catch {
      /* best effort */
    }
    if (this.#ownsProcess && this.#proc) this.#proc.kill();
  }
}

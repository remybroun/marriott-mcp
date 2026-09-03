// A long-lived Marriott session for the MCP server.
//
// The CLI starts Chrome, runs one query, and quits. That is wrong for an MCP server:
// every tool call would pay the Chrome launch plus the Akamai warm-up wait (5-45s).
// Here Chrome is started lazily on the first call that needs it, kept alive between
// calls, and shut down after an idle period so no stray window is left running.
//
// Everything is serialised. There is one page and one CDP connection, so two concurrent
// tool calls would interleave evaluate() round-trips on the same execution context.

import { Browser } from './cdp.js';
import { MarriottClient, openWarmed, isRealPage, WARMUP_URL } from './marriott.js';

const IDLE_MS = Number(process.env.MARRIOTT_IDLE_MS ?? 5 * 60 * 1000);

export class Session {
  #browser = null;
  #client = null;
  #starting = null;
  #queue = Promise.resolve();
  #idle = null;
  #opts;

  constructor(opts = {}) {
    this.#opts = opts;
  }

  get live() {
    return !!this.#client;
  }

  #log(...a) {
    // stdout is the JSON-RPC channel. Anything human-readable must go to stderr.
    if (this.#opts.verbose) console.error('[session]', ...a);
  }

  /** Run `fn(client)` with the browser up, serialised against every other call. */
  run(fn) {
    const task = this.#queue.then(async () => {
      this.#cancelIdle();
      const client = await this.#ensure();
      try {
        return await fn(client);
      } finally {
        this.#scheduleIdle();
      }
    });
    // Keep the chain alive even when a caller's task rejects, or one failed search
    // would poison every later tool call.
    this.#queue = task.then(
      () => {},
      () => {},
    );
    return task;
  }

  async #ensure() {
    if (this.#client) return this.#client;
    if (this.#starting) return this.#starting;

    this.#starting = (async () => {
      const browser = new Browser({
        headless: false,
        // Default to off-screen: an MCP server is background infrastructure and should
        // not throw a browser window over whatever the user is doing.
        hidden: this.#opts.hidden !== false,
        port: this.#opts.attach ?? null,
        verbose: !!this.#opts.verbose,
      });
      await browser.start();
      this.#log('chrome up');
      await openWarmed(browser, WARMUP_URL, { verbose: !!this.#opts.verbose });
      const client = new MarriottClient(browser, { verbose: !!this.#opts.verbose });
      await client.loadSignatures();
      this.#log(`warm · ${client.signatures.size} operations`);
      this.#browser = browser;
      this.#client = client;
      return client;
    })();

    try {
      return await this.#starting;
    } catch (err) {
      // A failed start must not leave a half-open Chrome behind, and the next call
      // should be free to try again from scratch.
      await this.#browser?.close().catch(() => {});
      this.#browser = null;
      this.#client = null;
      throw err;
    } finally {
      this.#starting = null;
    }
  }

  /** Is Marriott currently serving this profile a real page? */
  async status() {
    // Snapshot both handles up front. status() deliberately does not go through run(),
    // so it neither cancels the idle timer nor serialises against close(); the await
    // below yields, and a close() landing in that window nulls #client. Reading
    // this.#client.signatures afterwards then throws instead of reporting a dead
    // session, which is the one thing this method exists to do.
    const client = this.#client;
    const browser = this.#browser;
    // A start in flight is not "not running" — reporting that would send the caller
    // off diagnosing a session that is seconds away from being ready.
    if (!client) return { live: false, starting: !!this.#starting };
    const real = await isRealPage(browser).catch(() => false);
    return {
      live: true,
      real,
      operations: client.signatures.size,
      buildId: client.buildId ?? null,
    };
  }

  #scheduleIdle() {
    this.#cancelIdle();
    if (!Number.isFinite(IDLE_MS) || IDLE_MS <= 0) return;
    this.#idle = setTimeout(() => {
      this.#log(`idle ${IDLE_MS}ms — closing chrome`);
      this.close();
    }, IDLE_MS);
    // Never hold the process open just to run the shutdown timer.
    this.#idle.unref?.();
  }

  #cancelIdle() {
    if (this.#idle) clearTimeout(this.#idle);
    this.#idle = null;
  }

  async close() {
    this.#cancelIdle();
    const b = this.#browser;
    this.#browser = null;
    this.#client = null;
    await b?.close().catch(() => {});
  }
}

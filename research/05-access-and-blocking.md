# 05 — Access, Akamai, and What a CLI Actually Needs

**This is the blocker for the whole project.** The API contract is fully understood
(`01`–`03`), but a plain HTTP client cannot use it yet.

---

## The finding

The GraphQL call works perfectly **from inside a browser page** and fails from `curl`,
with identical headers and an identical body.

Verified both ways in the same session, minutes apart:

| Client | Result |
|---|---|
| `fetch()` from the marriott.com page context | **`200`**, 55,577 bytes of real rate data |
| `curl` with the exact same headers + body | **`403`** Akamai "Access Denied" |
| `curl` + realistic Chrome `User-Agent` | **`403`** |

The 403 body:

```html
<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>
<H1>Access Denied</H1>
You don't have permission to access
"http://www.marriott.com/mi/query/phoenixShopDatedSearchByGeoQuery" on this server.
Reference #18.b6843554.1787956974.152f5705
</BODY></HTML>
```

`errors.edgesuite.net` references = **Akamai Bot Manager**. The site also loads Akamai
mPulse (`s.go-mpulse.net/boomerang/PX364-MRMS3-WGVQP-J6U6B-ZWUBY`), which is part of the
same telemetry/fingerprinting stack.

### What this means

A correct User-Agent is **not** sufficient. Akamai is gating on the sensor cookies
(`_abck`, `bm_sz`, `ak_bmsc`) that its client-side JS computes from a browser
fingerprint, and very likely on TLS/HTTP2 fingerprint as well. The browser had those
cookies; `curl` did not.

---

## Blocking is inconsistent and path-scoped

Earlier in the same session, from the same IP (`62.175.189.251`, ES), **all**
`www.marriott.com` HTML documents returned `403` in both Chrome and `curl` — the site was
completely unusable. It then started working in Chrome without intervention. So the rule
is adaptive/reputation-based, not a static ban.

Even while documents were blocked, these were reachable:

| Request | Status |
|---|---|
| `GET /robots.txt` | 200 |
| `GET /favicon.ico` | 200 |
| `GET /mi-assets/…` (static) | 200 |
| `POST /mi/phoenix/graphql`, `/graphql`, `/api/graphql` (empty body) | 411 — reached origin |
| `GET /`, `/default.mi`, `/en-us/hotels/…`, `/search/default.mi` | 403 |

Practical consequence: **treat 403 as a transient, retryable state with backoff**, not a
permanent failure — but do not hammer it, since retry pressure is probably what
tightens the rule.

### The block demonstrably escalated during this research session

This was measured, not theorised. `GET https://www.marriott.com/robots.txt` from `curl`:

| When | Result |
|---|---|
| Early in the session | **200** |
| After ~1 hour of probing from the same IP | **403** |

Nothing about the request changed. `www.ritzcarlton.com` continued to return `200`
throughout, so this was not a network fault — Akamai specifically tightened against this
IP for non-browser clients, to the point of blocking even `robots.txt`, a file whose
entire purpose is to be fetched by robots.

**This is the single most important operational lesson in this research.** The reputation
system reacts to volume within an hour. Any client design that assumes a stable 200 from
`www.marriott.com` will degrade in production. Concretely:

- Budget for the block, don't treat it as an anomaly.
- A browser-driven client (option 1 below) is not just more robust to fingerprinting, it
  is more robust to *reputation decay*, because the browser keeps refreshing legitimate
  session state.
- Cache hard. Every avoided request is reputation preserved.
- Stop probing when you start seeing 403s. Continuing makes it worse, and it stayed worse.

---

## What the block actually is, and what does NOT fix it

### The IP is not the problem

Checked directly: `62.175.189.251` is `AS6739 Vodafone ONO`, a **static residential**
line in Barcelona. Not a datacenter range, not a VPN exit, not a known proxy pool.

Residential is the most trusted IP class there is. **So proxies cannot help here** — any
proxy would be a downgrade from what we already have. Every "buy residential proxies"
answer to an Akamai block is irrelevant to this project. The block was earned by request
*behaviour*, not by identity.

### The deny page decoded

Our error, `Reference #18.cd6c1402...`, is Akamai's `18.xx` class = `ERR_ACCESS_DENIED`:
the request was refused by a WAF / Bot Manager rule, typically a connection-volume
threshold. Community reports consistently describe these as **temporary**, clearing on
their own after roughly **1–2 hours** once volume drops back under the threshold.

So the recovery procedure is: stop, wait, and come back with lower volume. There is no
client-side trick that shortens it.

### Chrome 136+ closes the "just use the real profile" shortcut

Since Chrome 136, `--remote-debugging-port` is **ignored on the default user-data-dir**,
deliberately, to stop the debugging protocol exposing saved passwords and cookies. Remote
debugging now requires a non-default `--user-data-dir`.

Copying the real profile into a new directory does not get around it either: a
non-standard data dir uses a different encryption key, so the copied cookie store will not
decrypt.

Consequence for this project: **we can never drive the user's everyday Chrome profile over
CDP.** A dedicated profile is mandatory, which means that profile starts cold and must be
warmed by a human once. That is exactly what `marriott warmup` exists for — it is not a
workaround, it is the only clean path.

## SOLVED: the challenge resolves itself — waiting is the whole technique

This supersedes the pessimism above. Measured directly while building the CLI.

A cold Chrome profile's first request gets a **challenge shell**, not a block:

```
~3,193 bytes, empty <body>, four sensor scripts from p11.techlab-cdn.com
```

Those scripts compute the `_abck` sensor cookies. Left alone, **the page resolves itself
in about five seconds** and renders the real ~690 KB document.

| Client behaviour | Outcome |
|---|---|
| Reload at the challenge, 5× with 5s gaps | escalated to hard `Access Denied` (311 bytes), ~1h to clear |
| Load once, poll without reloading | real page in ~5s, reproducible |

**The reload loop was the entire problem.** It was a self-inflicted wound: an automated
retry against a system whose documented failure mode is punishing retries. Poll the DOM,
never re-navigate, and bail out immediately on `Access Denied` instead of retrying into a
deeper block.

Confirmed working from a cold profile with this fix: 61 signatures scraped, autocomplete,
and a full priced search with corporate rate codes applied.

## Headless is denied outright — measured

Controlled test, same warm profile, same IP, seconds apart:

| Chrome mode | Marriott's response |
|---|---|
| `--headless=new` | **`Access Denied` immediately** — no challenge shell offered at all |
| headful | challenge → resolves in ~5s → real page → search returns rates |
| headful at `--window-position=-32000,-32000` | identical to headful; works |

Headless does not get a *harder* challenge, it gets **no challenge**. Akamai's `sensor.js`
fingerprints GPU rendering, audio context and WebRTC before the first request completes;
headless Chrome has no real rendering stack, so it fails at the door.

The practical consequence: **a real rendering pipeline is non-negotiable.** Off-screen
positioning gives you invisibility without giving up the GPU, and is the correct way to
run this unattended on a desktop. On a headless server, expect to need a virtual display
(Xvfb) rather than `--headless`.

## Options for the MCP server

Ranked by robustness.

### 0. Browser extension in the user's real browser (best, biggest build)

The one thing that demonstrably worked all through this research was the user's **actual
everyday Chrome**, driven by an extension. It has real history, real reputation, a
human-solved challenge already banked, and no CDP fingerprint to leak — the entire
detection problem simply does not arise.

This is the architecture Playwright's own extension mode uses ("connects to your existing
browser tabs, reusing your logged-in sessions, cookies and installed extensions"), and it
is the natural end-state for an MCP server here. Cost: you have to build and install an
extension, and Chrome 136+ guarantees there is no CDP shortcut to the same place.

### 1. Drive a real browser (recommended for now)

Run the search through a real Chrome via CDP / Playwright and read the GraphQL response.
The page does the Akamai work for you. Slower and heavier, but it is the only approach
that is robust to Akamai changes.

A middle path that keeps most of the speed: launch a browser once, load a Marriott page
to establish the session, then issue the GraphQL calls **from inside the page context**
(`fetch()` on the same origin) — exactly what was done to verify this research. You get
JSON back without ever parsing HTML, and the browser handles all cookie/fingerprint
maintenance.

### 2. Seed cookies from a browser into an HTTP client

Extract `_abck` / `bm_sz` / `ak_bmsc` from a logged-in Chrome profile and replay them
with `curl`/`httpx`. Fragile: these cookies rotate, are validated against the session,
and on macOS Chrome's cookie store is Keychain-encrypted. Expect this to break often.

### 3. Use the SSR page instead of the API

`/search/findHotels.mi?...` renders results server-side and embeds everything in
`__NEXT_DATA__`. One GET, parse the JSON blob out of the HTML. Avoids the GraphQL layer
entirely — but it is still `www.marriott.com` behind the same Akamai rule, so it does not
solve the core problem, and the URL is `Disallow`ed in robots.txt.

---

## Capture recipe (for extending this research)

Paste into DevTools on any Marriott page to record GraphQL traffic with bodies:

```js
window.__cap = [];
const of = window.fetch;
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  const res = await of.apply(this, arguments);
  if (url?.includes('/mi/')) {
    const headers = {};
    try { new Headers(init?.headers || {}).forEach((v,k) => headers[k] = v); } catch {}
    window.__cap.push({ url, headers, body: String(init?.body), status: res.status,
                        resp: await res.clone().text() });
  }
  return res;
};
```

Note the search page also uses **XMLHttpRequest** for `/mi/phoenix-gateway/session`,
`/mi/cms-template/v1/book/getCMSTemplate` and `/mi/phoenix-common/v1/dataLayer`, so hook
`XMLHttpRequest.prototype.open/send` too if you need those.

Also note: the **initial** search results are server-rendered — no GraphQL call fires on
first paint. To capture a live search request you must change something (apply a filter,
change sort). Panning the map does **not** refetch.

---

## Legal / etiquette

Not legal advice, but the facts as observed:

- **robots.txt** explicitly disallows `/search/`, `/aries-search/`, and
  `/reservation/availabilitySearch.mi` for all user-agents, while allowing
  `/search/default.mi`. Marriott is signalling clearly that automated access to the
  search and availability surface is unwelcome.
- **Akamai Bot Manager** is actively enforcing that signal.
- Marriott's Terms of Use are the governing document, not robots.txt.

robots.txt binds crawlers rather than a person's own client, and a personal, low-volume
tool is a different thing from a scraper. But the combination of an explicit `Disallow`
on exactly these endpoints plus active bot management is unambiguous about intent, and
anything resembling systematic rate harvesting or redistribution would be over a line.

If you go ahead, the defensible posture is: concurrency 1, aggressive caching, honest
User-Agent, respect `Retry-After`, back off hard on 403/429, personal use only, no
redistribution of rate data. Consider whether Marriott's partner/affiliate API programme
would serve the goal better for anything beyond personal scale.

# marriott-mcp

<p align="center">
  <img src="https://img.shields.io/badge/MCP-server-1F1F1F?style=for-the-badge&logo=modelcontextprotocol&logoColor=white" alt="MCP server">
  <img src="https://img.shields.io/badge/CLI-terminal-1F1F1F?style=for-the-badge&logo=gnubash&logoColor=white" alt="CLI">
  <img src="https://img.shields.io/badge/dependencies-0-3FB950?style=for-the-badge" alt="Zero dependencies">
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/remybroun/marriott-mcp?color=blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022-5FA04E?logo=nodedotjs&logoColor=white" alt="Node >= 22">
  <img src="https://img.shields.io/badge/Chrome-required-4285F4?logo=googlechrome&logoColor=white" alt="Chrome required">
  <img src="https://img.shields.io/badge/GraphQL-Phoenix%20API-E10098?logo=graphql&logoColor=white" alt="GraphQL">
  <img src="https://img.shields.io/badge/Claude-Code-D97757?logo=claude&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/tests-9%20passing-3FB950?logo=nodedotjs&logoColor=white" alt="9 tests passing">
</p>

Hotel search from the terminal against Marriott's internal "Phoenix" GraphQL API.

Reverse-engineered from live traffic — see [`research/`](./research) for the full protocol
notes. There is **no official Marriott developer API**; the only sanctioned programme is
the Partnerize-run affiliate scheme, which is deep-link/commission oriented and exposes no
rates endpoint.

> **Status: working, verified end to end.** Live searches return real rates, and
> corporate rate codes apply real discounts (Barcelona: Le Méridien 399→351 EUR,
> W Barcelona 445→364 EUR). Read [Akamai](#akamai-the-one-thing-that-matters) before
> changing any retry logic.

---

## Install

**Requirements:** Node ≥ 22 and desktop Google Chrome. There are no npm dependencies, so
there is nothing to `npm install`.

```bash
git clone https://github.com/remybroun/marriott-mcp.git
cd marriott-mcp
node bin/marriott.js --help
```

Optionally put `marriott` and `marriott-mcp` on your `PATH`:

```bash
npm link                 # or: npm install -g .
marriott --help
```

Then warm the browser profile up once, before your first search:

```bash
marriott warmup          # or: node bin/marriott.js warmup
```

`warmup` opens a Chrome window on marriott.com using this tool's own profile
(`~/.marriott-mcp/chrome-profile`, not your everyday browser). Accept the cookie banner,
click around for a few seconds, then close it. That builds the Akamai reputation every
later run reuses. Read [Akamai](#akamai-the-one-thing-that-matters) before you skip it.

Everything the tool persists lives in `~/.marriott-mcp` (Chrome profile plus the cached
GraphQL operation safelist). To uninstall completely: `npm unlink -g marriott-mcp`, delete
the clone, and `rm -rf ~/.marriott-mcp`.

### Verify the install

```bash
npm test                                  # 9 unit tests, no browser, instant
marriott places "Barc"                    # first live call: 30-60s while Akamai settles
marriott search "Barcelona, Spain" --nights 1
```

---

## Quick start

```bash
node bin/marriott.js search "Barcelona, Spain" --in 2026-10-15 --nights 3 --adults 2
```

```
HOTEL                                      BRAND                  DIST     RATING  /NIGHT
────────────────────────────────────────── ────────────────────── ──────── ─────── ────────────
Le Méridien Barcelona                      Le Méridien            0.5km    4.3     246 EUR
Cotton House Hotel, Autograph Collection   Autograph Collection   0.5km    4.6     515 EUR
```

More:

```bash
marriott config set code <YOUR_CODE>            # your corporate/promo code, stored once
marriott search "Tokyo" --code work             # ... or a saved one, by name
marriott search "Lisbon" --rate points          # points redemption
marriott search "Paris" --amenities pool,spa --brands RZ,AK
marriott plan "Rome, Italy" --in 2026-11-01 --nights 5   # cheapest hotel-hopping path
marriott places "Barc"                          # autocomplete → Google Place IDs
marriott ops --grep DatedSearch                 # list safelisted GraphQL operations
marriott raw phoenixShopHotelAmenities --vars '{"...":"..."}'
```

Prefer to drive it from Claude instead of the terminal? See [MCP server](#mcp-server).

---

## MCP server

The same search, exposed as MCP tools so Claude Code (or any MCP client) can run it.

Claude Code:

```bash
claude mcp add marriott --scope user -- node /absolute/path/to/marriott-mcp/bin/marriott-mcp.js
claude mcp list          # marriott: ... - ✔ Connected
```

Any other MCP client (Claude Desktop, Cursor, Zed, ...), in its JSON config:

```json
{
  "mcpServers": {
    "marriott": {
      "command": "node",
      "args": ["/absolute/path/to/marriott-mcp/bin/marriott-mcp.js"]
    }
  }
}
```

The path must be absolute. If you ran `npm link`, `"command": "marriott-mcp"` with no
args works too. Run `marriott warmup` once before the first tool call, or the first
search will sit through the Akamai challenge.

Then just ask in plain language: *"cheapest Marriott in Istanbul on Nov 3"*.

| Tool | What it does |
| --- | --- |
| `search_hotels` | Priced search near a destination. Highlights cheapest / best value / best tier. |
| `scan_dates` | The same search across up to 14 consecutive check-in dates, to find the cheap day. |
| `plan_stay` | Cheapest hotel-hopping itinerary for a multi-night stay. See below. |
| `suggest_places` | Resolve free text to a Marriott destination. |
| `brand_tiers` | The brand ranking. Static — answers instantly, no browser. |
| `session_status` | Is Chrome up, and is Marriott serving real pages or a challenge? |
| `graphql_raw` | Call any safelisted operation directly. Escape hatch. |

### Design notes

**No dependencies, including no MCP SDK.** The stdio transport is newline-delimited
JSON-RPC 2.0, and a tools-only server needs four methods (`initialize`, `tools/list`,
`tools/call`, `ping`). Hand-rolling it keeps the server runnable straight from a clone,
with no `npm install` between the user and a working tool. `src/mcp.js` is the whole
protocol layer.

**The browser is persistent.** The CLI launches Chrome, runs one query, quits. An MCP
server doing that would pay the 30-60s Akamai warm-up on *every* tool call. `src/session.js`
starts Chrome lazily on the first call that needs it, keeps it warm, and closes it after
5 minutes idle (`MARRIOTT_IDLE_MS`). Only the first call is slow.

**Calls are serialised.** One page, one CDP connection, one execution context — two
concurrent tool calls would interleave their `evaluate()` round-trips. `Session.run()`
queues them.

**Chrome is parked off-screen.** A background server must not throw a window over whatever
you are doing. Pass `--show` (or `MARRIOTT_SHOW=1`) to watch it work.

**stdout is the protocol.** Every diagnostic in the MCP path goes to stderr. This is why
the MCP tools use `src/format.js` rather than `src/render.js`: the latter writes ANSI to
the terminal, which is noise in a JSON-RPC channel and literal garbage in a chat client.

Env: `MARRIOTT_IDLE_MS`, `MARRIOTT_SHOW`, `MARRIOTT_VERBOSE`, `MARRIOTT_ATTACH`.

---

## Hotel hopping (`plan` / `plan_stay`)

Hotel prices move night to night, and they move *independently per property*. So the
cheapest way to cover six nights in a city is often not one hotel for six nights — it is a
path through two or three, switching on the nights where somewhere else collapses in price.

```bash
marriott plan "Barcelona, Spain" --in 2026-11-01 --nights 6 --currency EUR
```

```
936 EUR total · 6 nights · 1 move

# | Check in   | Check out  | Nights | Hotel                              | Subtotal
1 | 2026-11-01 | 2026-11-02 |      1 | Labtwentytwo, Tribute Portfolio    | 125 EUR
2 | 2026-11-02 | 2026-11-07 |      5 | Four Points by Sheraton Airport    | 811 EUR

Staying put the whole time: 963 EUR — hopping saves 26.74 EUR (3%).
Chasing the cheapest room every night: 912 EUR with 5 moves. This plan pays
24.38 EUR more to avoid 4 of them.
```

That last line is the feature. Pure greedy — cheapest room every night — would drag you
across Barcelona **five times to save €24**. Nobody wants that.

### The stickiness rule

Switching carries a penalty, expressed the way a traveller actually thinks about it:

> Moving is only worth it if it saves more than `tolerance` of the new hotel's price.

At the default `tolerance = 0.1`, staying somewhere that costs up to 10% more than the
night's best alternative wins, and ties always resolve toward staying put. `--tolerance 0`
reproduces pure greedy; `--tolerance 0.3` makes you very reluctant to move.

### How it is solved

A Viterbi / shortest-path DP over `nights × hotels`: state is *which hotel on night i*,
emission cost is that night's all-in price, transition cost is the switch penalty. It is
optimal, not a heuristic — `test/itinerary.test.mjs` checks it against exhaustive search on
500 random instances, including nights where hotels sell out.

Sold-out nights are handled rather than ignored: the path routes around a hotel that is
unavailable mid-stay, and a night that *no* hotel can cover is reported instead of being
quietly dropped.

### Two prices, honestly separated

The plan is built from **one-night** prices, because that is the only way to see a hotel's
per-night curve. But two consecutive nights at one hotel are **one reservation**, and
Marriott does not always price a 2-night stay as the sum of its nights (length-of-stay
rates, minimum stays). So every multi-night block is then re-priced as the booking you
would actually make, and the table shows both under `As booked`. `--no-verify` skips it.

Cost: one search per night, plus one per multi-night block. A 6-night plan is ~8 queries.
Set `--currency` — the optimiser refuses to compare across currencies rather than pick a
nonsense path.

---

## How it works

Three verified stages:

1. `phoenixShopSuggestedPlacesQuery` — free text → **Google Place ID**
2. `phoenixShopSuggestedPlacesDetailsQuery` — Place ID → lat/long, city, state, country
3. `phoenixShopDatedSearchByGeoQuery` — priced, filtered, sorted results

All three are `POST https://www.marriott.com/mi/query/{operationName}` with a
`graphql-operation-signature` header. **The GraphQL document itself is not required** —
`{operationName, variables}` is the whole contract, because the server resolves the query
from a safelist by signature. Signatures are scraped from the search page's
`__NEXT_DATA__` and cached in `~/.marriott-mcp/signatures.json`; they rotate on frontend
deploys, so `--refresh-signatures` re-scrapes.

### Why it drives a browser

Marriott sits behind **Akamai Bot Manager**. An identical request — same headers, same
body — returns `200` from inside a page and `403` from `curl`. A realistic User-Agent does
not help; Akamai wants the `_abck`/`bm_sz` sensor cookies that its own JS computes.

Worse, the block is *adaptive*: during research, `robots.txt` returned `200` early in the
session and `403` an hour later from the same IP, with nothing changed. Reputation decays
under load. Full detail in [`research/05-access-and-blocking.md`](./research/05-access-and-blocking.md).

### Why raw CDP instead of Playwright

`Runtime.enable` is the single most reliably detected automation signal — it makes the
browser emit a `Runtime.consoleAPICalled` event that page JS can observe in a few lines,
and Akamai, Cloudflare and DataDome all watch for it. **Stock Playwright and Puppeteer
both call it**, which is why hardened forks (Patchright, rebrowser-patches) exist.

This tool needs exactly one browser capability: run a `fetch()` on marriott.com's origin.
No clicking, no selectors, no waiting on elements. So instead of taking a heavyweight
dependency and then patching its leaks back out, `src/cdp.js` speaks CDP directly in
~250 dependency-free lines and:

- **never calls `Runtime.enable`** — it creates an isolated world via
  `Page.createIsolatedWorld` and evaluates against that `contextId`. An isolated world
  shares the page's origin, cookies and DOM (so `fetch` is same-origin and fully
  authenticated) but is invisible to page scripts. This is the same technique the
  hardened forks apply.
- **defaults to headful**, because headless is more detectable.
- **keeps a persistent Chrome profile** at `~/.marriott-mcp/chrome-profile`, so Akamai
  reputation accumulates across runs instead of looking like a fresh bot every time.

Minimal CDP surface means minimal leak surface. The trade-off is that we own the
maintenance: if Akamai starts fingerprinting something Playwright's ecosystem already
handles, swapping `src/cdp.js` for [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)
is the fallback, and `--attach <port>` against a real Chrome is the escape hatch.

---

## Akamai: the one thing that matters

**Wait. Do not reload.** That single rule is the difference between this working and not.

First contact with a cold profile gets you a ~3 KB **challenge shell**: sensor scripts
from `p11.techlab-cdn.com`, empty body, no content. It looks like a block. It is not.
Those scripts compute the `_abck` sensor cookies and **the page resolves itself in about
five seconds**, then renders normally (~690 KB).

An earlier version of this tool reloaded when it saw the challenge, up to five times.
Measured result:

| Behaviour | Outcome |
|---|---|
| Reload at the challenge, 5× | challenge → hard `Access Denied` (311 bytes), ~1 hour to clear |
| Load once and wait ~5s | real page, every time |

Retry pressure is what escalates a challenge into a block. `openWarmed()` therefore polls
and **never reloads**, and bails immediately with a clear message if it sees `Access
Denied` rather than making it worse.

If you are ever blocked: stop, wait 1–2 hours. Nothing client-side shortens it. Your IP
is almost certainly fine — a residential line is the most trusted class there is, and a
VPN would be a downgrade to a datacenter ASN.

`marriott warmup` exists for the case where automatic warming is not enough: it opens the
profile so you can browse by hand for 30 seconds. In practice this has not been needed —
patience was sufficient.

`marriott debug --wait 30` shows exactly what Marriott is serving over time (challenge
shell, real page, or deny page). Use it before assuming a bug is in the client.

### Where the signatures come from

`/search/default.mi` is the robots-allowed landing page and is what the tool warms on, but
it does **not** embed `operationSignatures`. Only the results page
(`/search/findHotels.mi`) does. So the client warms on the landing page, and visits the
results page once to harvest the safelist, then caches it in
`~/.marriott-mcp/signatures.json`. A pinned last-known-good set in `KNOWN_SIGNATURES`
covers the handful of operations this CLI needs if a scrape ever fails.

### Verify

```bash
node bin/marriott.js places "Barcelona"     # ChIJ5TCOcRaYpBIRCmZHTz37sEQ  Barcelona, Spain
node bin/marriott.js search "Barcelona, Spain" --in 2026-10-15 --nights 3 --adults 2
node bin/marriott.js search "Barcelona, Spain" --in 2026-10-15 --nights 3 --code <CODE>
```

### Headless does not work — use `--hidden`

Tested directly, same profile and IP, seconds apart:

| Mode | Result |
|---|---|
| `--headless` (`--headless=new`) | **immediate `Access Denied`** — not even offered the challenge |
| headful (default) | works, returns rates |
| `--hidden` | **works** — real headful Chrome parked off-screen |

Akamai's `sensor.js` fingerprints GPU rendering, audio context and WebRTC. Headless
Chrome differs on all three, so it is denied outright rather than challenged. No flag
combination fixes this, because the tell is the absence of a real rendering stack.

`--hidden` is the answer if you don't want a window on your desktop: it launches a
**genuinely headful** Chrome — real GPU, real compositor, so the sensor sees a real
browser — and moves it to `left: -32000`. macOS clamps that to about `-3392`, which is
still fully off-screen on any normal display. Verify with `--hidden --verbose`; it logs
the actual bounds and warns if the OS clamped it somewhere visible.

```bash
node bin/marriott.js search "Barcelona, Spain" --in 2026-10-15 --nights 3 --hidden
```

For a long-running MCP server this matters less than it sounds: the browser launches
once and stays hot across tool calls, so it is one off-screen window for the session, not
a popup per query.

### Money is in minor units

Rates come back as `MonetaryAmount`: `{amount: 39933, currency: 'EUR', decimalPoint: 2}`
= €399.33. **Never hardcode 2** — `decimalPoint` is 0 for JPY and KRW. `money()` in
`src/marriott.js` handles it. `lowestAverageRate.amount` is the per-night average across
the stay; `totalAmount` is that plus taxes, still per night.

### If it fails

| Symptom | Likely cause | Fix |
|---|---|---|
| `Akamai did not release the page` | cold or stale profile | `marriott warmup`. Do **not** loop retries — that escalates it |
| `debug` shows `Access Denied` (311 bytes) | hard-blocked | Stop. Wait it out — hammering extends it |
| `debug` shows `techlab-cdn` scripts, empty body | challenge not yet solved | `marriott warmup`, headful |
| `HTTP 403` on a query after a good page load | reputation decayed mid-session | Back off, re-run `warmup` |
| `Could not read operationSignatures` | blocked, or frontend changed | Run `marriott debug` first to see which; then `--refresh-signatures` |
| `Unknown operation` | signatures rotated | `--refresh-signatures` |
| `Page evaluation failed` | isolated world torn down by a navigation | Retried automatically once; report if persistent |
| Chrome not found | non-standard install | `export MARRIOTT_CHROME=/path/to/Chrome` |

Because the isolated-world approach is the untested part, `--attach` is the diagnostic:
start Chrome yourself with `--remote-debugging-port=9222` and run
`marriott places "Barc" --attach 9222`. If that works and the managed launch doesn't, the
problem is the launch flags, not the CDP technique.

---

## Layout

```
bin/marriott.js       CLI entry point
bin/marriott-mcp.js   MCP server entry point
src/cdp.js            zero-dependency CDP client, isolated-world evaluation
src/marriott.js       GraphQL client, signature registry, search builder, row flattening
src/cli.js            argument parsing, commands, table output
src/mcp.js            MCP server: JSON-RPC over stdio, tool definitions
src/session.js        long-lived browser session shared across MCP tool calls
src/render.js         terminal UI (ANSI)
src/format.js         plain-text/markdown output for MCP results
src/itinerary.js      hotel-hopping optimiser (pure DP) + live pricing and verification
src/prefs.js          user preferences (~/.marriott-mcp/config.json), code resolution
src/brands.js         brand tier table
test/                 unit tests — `npm test`
research/             protocol documentation (start at research/00-README.md)
```

## Brand tiers

Every result carries a tier grade from `src/brands.js`, so you can see at a glance
whether a cheap rate is a bargain or just a budget brand.

Two axes, so nothing ties: a coarse `grade` and a **strict total order** `rank` (1–40,
no shared ranks).

Graded on a curve across the whole portfolio, so Courtyard sits mid-table rather than
near the top. Ladder runs `SS → F`, max 3 brands per tier.

```
 1 SS  Bulgari           15 A-  Sheraton *          29 C   Four Points
 2 SS  St. Regis         16 B+  Tribute *           30 C   Apartments by Bonvoy
 3 S+  Ritz-Carlton      17 B+  MGM Collection *    31 C-  Homes & Villas *
 4 S+  EDITION           18 B+  Delta Hotels        32 C-  Fairfield
 5 S   JW Marriott       19 B   Exec. Apartments    33 C-  TownePlace Suites
 6 S   Luxury Coll. *    20 B   Residence Inn       34 D+  Protea *
 7 S-  W Hotels *        21 B   AC Hotels           35 D+  Sonder *
 8 S-  Westin            22 B-  Courtyard           36 D   Series by Marriott *
 9 A+  Marriott Hotels   23 B-  citizenM            37 D   Outdoor Collection *
10 A+  Autograph *       24 B-  Vacation Club       38 D-  City Express
11 A   Le Méridien       25 C+  Element             39 D-  Four Points Flex
12 A   Renaissance       26 C+  SpringHill Suites   40 F   StudioRes
13 A-  Gaylord           27 C+  Aloft
14 A-  Design Hotels *   28 C   Moxy
```

`*` marks soft brands and collections where properties are independently operated and
quality varies enormously — the grade is a midpoint, not a promise. For those, the
property's own review score matters more than the tier.

The grades are **validated against six sources** (J.D. Power 2026, The Points Guy, STR
chain scale, Bonvoy award pricing, Forbes Travel Guide, SilverSky) — reasoning and
per-brand rationale in [`research/07-brand-grading.md`](./research/07-brand-grading.md).
They still encode a judgement about positioning; edit `src/brands.js` freely, nothing
else depends on the values.

```bash
node bin/marriott.js brands            # graded list, harvested live
node bin/marriott.js brands --why      # + one-line rationale per brand
node bin/marriott.js brands --json     # machine-readable
```

`brands` unions the `BRANDS` search facet across ten world regions (facets are computed
over the whole result set, so ~10 wide searches surface all 37 brands). It flags any code
missing from the table, which is how the table stays current as Marriott adds brands.

### Brand codes are not guessable — harvest them

Several codes are counterintuitive and were only caught by harvesting live:

| Code | Actually is | Easy to assume |
|---|---|---|
| `SH` | **SpringHill Suites** | Sheraton |
| `SI` | **Sheraton** | SpringHill |
| `MG` | **MGM Collection** | Marriott Executive Apartments |
| `ER` | Marriott Executive Apartments | — |
| `BA` | Apartments by Marriott Bonvoy | — |
| `XF` | Four Points **Flex** (budget) | Four Points |
| `XE` | City Express | — |
| `AR` | AC Hotels | — |

Note `XF`: name-matching "Four Points Flex by Sheraton" against "Sheraton" once gave it
an A− grade. `gradeFor()` therefore requires **exact** normalised name equality, and
unmatched codes surface as ungraded rather than silently inheriting a wrong tier.

## Your own rate codes (user preferences)

Corporate and promo cluster codes are not part of the API, they are yours. So none are
hard-coded anywhere in this repo: you store yours once and every later search picks it up.

Preferences live in `~/.marriott-mcp/config.json`, written `0600`, outside the repo and
outside git.

```bash
marriott config set code <YOUR_CODE>       # applied to every search from now on
marriott config                            # show what is set (codes masked)
marriott config --reveal                    # ... unmasked
marriott config unset code
```

Keep several and choose per search by name, so you never type the code itself again:

```bash
marriott config set codes.work <YOUR_CODE>
marriott config set codes.assoc <OTHER_CODE>

marriott search "Tokyo" --code work
marriott search "Tokyo" --code assoc
```

`--code` accepts either a saved name or a literal code, so nothing you already know how
to type stops working.

### Precedence

```
--code <CODE|name>        highest: what you typed on this run
MARRIOTT_CODE=<CODE>      environment, useful in scripts and CI
config.json  "code"       your stored default
(none)                    --rate family, default standard
```

Two deliberate rules:

- **An explicit `--rate` beats a stored code.** They are mutually exclusive, so
  `marriott search "Lisbon" --rate points` gives you points even with a default code set,
  rather than silently ignoring what you asked for. `--no-code` does the same for a plain
  standard search.
- **Codes are masked in output.** Result headers and `marriott config` print `A****3`, not
  the code, so a screenshot or a pasted terminal does not leak it. `--reveal` when you
  actually want it.

Every header states what it priced, so a stored default is never invisible:

```
Barcelona, Spain · 2026-10-15 → 2026-10-18 · 2 adult(s) · code A****3 (config)
```

### Other defaults

Anything you set stands in for the flag you did not type:

```bash
marriott config set currency EUR
marriott config set adults 2
marriott config keys                        # everything settable, with descriptions
marriott config path                        # where the file is
```

| Key | Stands in for |
| --- | --- |
| `code` | `--code`, on every search |
| `codes.<name>` | a name you can pass to `--code` |
| `currency` | `--currency` |
| `adults` / `rooms` | `--adults` / `--rooms` |
| `rate` | `--rate` |
| `tolerance` | `plan --tolerance` |

Unknown keys and malformed codes are rejected on write, so a typo is an error rather than
a setting that quietly does nothing.

### From an MCP client

The MCP tools read the same file, per call, so editing it takes effect without restarting
the server. Omit `code` and your default applies; pass `code: "work"` to use a saved name
without putting the code in the conversation; pass `no_code: true` to ignore the default.
`session_status` reports which default is active (masked) so it is never a surprise.

## Rate codes

| `--rate` / `--code` | Sent as |
|---|---|
| `standard` (default) | `[{"type":"STANDARD","value":""}]` |
| `aaa` | `[{"type":"AAA","value":"aaa"}]` |
| `gov` | `[{"type":"GOV","value":"gov"}]` |
| `senior` | `[{"type":"CLUSTER","value":"S9R"}]` |
| `--code <CODE>` | `[{"type":"CLUSTER","value":"<CODE>"}]` |
| `points` | `[{"type":"CLUSTER","value":"MRW"},{"type":"STANDARD","value":""},{"type":"CLUSTER","value":"P17"}]` |

`CLUSTER` is the generic carrier: any Marriott cluster/corporate code works via `--code`.
Points and a corporate code are mutually exclusive.

**No codes ship in this repo.** There is no built-in or default corporate code, by
design. `CLUSTER` is a mechanism, and the value is your own entitlement, so you supply it
once and it stays on your machine. See [Your own rate codes](#your-own-rate-codes-user-preferences).

## Please read before scaling this

`robots.txt` explicitly disallows `/search/` and `/reservation/availabilitySearch.mi`, and
Akamai actively enforces it. Marriott's Terms of Use govern, not robots.txt, and a
personal low-volume tool is a different thing from a scraper — but the intent signal is
unambiguous. This tool ships with concurrency 1 and a signature cache for that reason.
Cache aggressively, back off hard on 403, keep it personal, and don't redistribute rate
data.

## License

MIT, see [LICENSE](./LICENSE).

Not affiliated with, endorsed by, or connected to Marriott International. "Marriott",
"Bonvoy" and the brand names in `src/brands.js` are trademarks of their respective owners
and are used here only to describe what the tool queries. Rate data returned by this tool
belongs to Marriott: use it personally, do not redistribute it.

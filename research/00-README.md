# Marriott API Research

Reverse-engineering notes for the `marriott-mcp` project: how to run Marriott hotel
searches from a CLI / MCP server.

Research session: **2026-08-29**. Everything here was captured from **live network
traffic** on `www.marriott.com` in Chrome, not inferred from documentation.

## Files

| File | Contents |
|---|---|
| `01-graphql-protocol.md` | **Start here.** The endpoint, the required headers, and the query-safelisting scheme. |
| `02-search-operations.md` | **The important one.** How to pass dates, locations, rate codes, filters, sorting, paging. Full request/response shapes. |
| `03-operation-signatures.md` | All 61 operation names + safelist signatures. |
| `04-content-and-legacy-endpoints.md` | Property content services, AEM JSON, image CDN, legacy `.mi` URLs. |
| `05-access-and-blocking.md` | Akamai Bot Manager. **Why bare `curl` gets 403 and what a client must do about it.** |
| `06-content-service-probe.md` | Probe log for the `marriott-hws` services and AEM JSON — what exists and what doesn't. |
| `samples/geo-search-payload.json` | A ready-to-POST search body. |

## TL;DR for the MCP implementation

**The API.** One endpoint pattern, named persisted operations:

```
POST https://www.marriott.com/mi/query/{operationName}
```

**Auth.** No API key, no OAuth, no login. But requests are gated two ways:

1. **Query safelisting** — you send `operationName` + `variables` plus a
   `graphql-operation-signature` header (SHA-256 of the canonical query text). The full
   GraphQL query document is **not required** — verified. The signatures are published in
   every search page's `__NEXT_DATA__`, so they can be re-scraped when they rotate.
2. **Akamai Bot Manager** — bare `curl` gets `403` even with correct headers. The client
   needs valid Akamai cookies (`_abck`, `bm_sz`, `ak_bmsc`) from a real browser session.
   **This is the main architectural constraint.** See `05-access-and-blocking.md`.

**The search call.** `phoenixShopDatedSearchByGeoQuery` — lat/long + radius + dates +
occupancy + rate type, returns priced, ranked results with facets. Confirmed working end
to end, real EUR rates for Barcelona.

**Location input.** Destination autocomplete returns **Google Place IDs**
(`ChIJ5TCOcRaYpBIRCmZHTz37sEQ`), which resolve to the lat/long the search actually uses.

## Status

| Area | State |
|---|---|
| GraphQL endpoint + header protocol | **Confirmed** |
| Safelist signatures (all 61) | **Confirmed** |
| Geo search: dates, occupancy, radius, paging, sort | **Confirmed** |
| Filters / facets vocabulary | **Confirmed** (values observed for Barcelona) |
| Rate codes | **Confirmed** — all five UI options (`STANDARD`, `AAA`, `GOV`, `CLUSTER`) plus points mode, verified live |
| Sort fields | **Partially confirmed** — `DISTANCE`, `POINTS`, `CITY`, `BRAND`, `PROPERTY_NAME`; price/rating orderings not captured |
| Calling from outside a browser | **Blocked by Akamai** — needs cookie seeding, see `05` |
| Room-level rates & booking flow | **Not researched** |

# 01 — The GraphQL Protocol

## Endpoint

Marriott's frontend ("Phoenix", a Next.js + Apollo app) talks to a single GraphQL
gateway, but **the operation name is in the URL path**, not just the body:

```
POST https://www.marriott.com/mi/query/{operationName}
```

Examples captured live:

```
POST https://www.marriott.com/mi/query/phoenixShopSuggestedPlacesQuery
POST https://www.marriott.com/mi/query/phoenixShopDatedSearchByGeoQuery
POST https://www.marriott.com/mi/query/phoenixShopPropertiesMediaGalleryByIDS
```

There is no generic `/graphql` endpoint that accepts arbitrary queries. Paths like
`/mi/phoenix/graphql`, `/aries-search/graphql`, `/graphql`, `/api/graphql` are **not** the
API — they return `411`/`404`, which is just an origin server reacting to a bodyless POST.

## Required headers

Captured verbatim from a real `phoenixShopDatedSearchByGeoQuery` request:

```http
POST /mi/query/phoenixShopDatedSearchByGeoQuery HTTP/2
Host: www.marriott.com
content-type: application/json
accept: */*
accept-language: en-US
graphql-operation-name: phoenixShopDatedSearchByGeoQuery
graphql-operation-signature: 46b57113564cd372d3105f7f86be3efdb1549f31a86028977a9b46e251966acd
graphql-require-safelisting: true
apollographql-client-name: phoenix_shop
apollographql-client-version: v1
application-name: shop
x-request-id: /search/findHotels.mi~X~7B3D1FCC-6E5F-5FA4-8886-F171619BAF13
```

### Header notes

| Header | Required? | Notes |
|---|---|---|
| `graphql-operation-name` | yes | must match the URL path segment |
| `graphql-operation-signature` | yes | SHA-256 hex of the canonical query document — the safelist key |
| `graphql-require-safelisting` | yes | always `true` |
| `application-name` | yes | `shop` on search pages, `homepage` on the homepage |
| `apollographql-client-name` | apparently yes | `phoenix_shop` / `phoenix_homepage` |
| `apollographql-client-version` | apparently yes | `v1` |
| `accept-language` | recommended | drives response locale |
| `x-request-id` | **no** | client-generated trace id; omitting it worked fine |

`application-name` and `apollographql-client-name` vary by which page issues the call.
They appear to be paired — use `shop` / `phoenix_shop` for anything search-related.

## Request body

```json
{
  "operationName": "phoenixShopDatedSearchByGeoQuery",
  "variables": { "...": "..." }
}
```

### The query document is optional — verified

The browser sends a third field, `query`, containing the full GraphQL document (several
KB). **It is not required.** A request with only `operationName` + `variables`, plus the
signature header, returned an identical `200` and a byte-identical 55,577-byte response:

```js
// verified in-page against /mi/query/phoenixShopDatedSearchByGeoQuery
fetch('/mi/query/phoenixShopDatedSearchByGeoQuery', {
  method: 'POST',
  headers: { /* headers above, no `query` in body */ },
  body: JSON.stringify({ operationName, variables })
})
// => 200, 55577 bytes
```

This matters a lot for the CLI: **you never need to store or reproduce the GraphQL
documents.** An operation name + its signature + a variables object is the whole contract.
The server resolves the document from its safelist by signature.

The trade-off: you cannot choose your own selection set. Every operation returns a fixed
response shape decided by Marriott's frontend. If you need a field that
`phoenixShopDatedSearchByGeoQuery` does not select, you must find a different operation
that does — see `03-operation-signatures.md` for the full menu.

## Where the signatures come from

Every Phoenix page embeds the complete safelist in its Next.js payload:

```js
JSON.parse(document.getElementById('__NEXT_DATA__').textContent)
  .props.pageProps.operationSignatures
// => [{ operationName: "...", signature: "..." }, ...]  (61 entries on /search/findHotels.mi)
```

Signatures change when Marriott redeploys the frontend (the page also carries a
`buildId`, `ovoAI8iaz-thwv4jVWr40` at time of capture). **The MCP server should re-scrape
`operationSignatures` rather than hardcode it**, and treat a signature rejection as the
signal to refresh. A snapshot is in `03-operation-signatures.md`.

## Other `/mi/` services seen alongside GraphQL

Not GraphQL, but same host, captured in the same session:

```
XHR  https://www.marriott.com/mi/phoenix-gateway/session          # session bootstrap, ~10 KB
XHR  https://www.marriott.com/mi/cms-template/v1/book/getCMSTemplate
XHR  https://www.marriott.com/mi/phoenix-common/v1/dataLayer      # analytics context
```

`phoenix-gateway/session` is the interesting one — it is what mints the session the app
carries. Worth investigating as part of solving the Akamai problem in `05`.

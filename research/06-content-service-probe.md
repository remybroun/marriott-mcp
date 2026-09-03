# Marriott/Ritz-Carlton Content Service Probe

Read-only recon of public, unauthenticated Marriott AEM content endpoints, done with plain `curl` (no header spoofing, `--max-time 20`, sequential requests). Test property: `BCNRZ` (Hotel Arts Barcelona, Ritz-Carlton brand) unless noted. Date of probe: 2026-08-28/29 (per curl response `date` headers).

## Summary Table

| Endpoint | Host | Status | Returns |
|---|---|---|---|
| `/services/marriott-hws/roomCards?marsha=BCNRZ&locale=en-US&acrsEnabled=false` | www.ritzcarlton.com | 200 (301→ trailing slash, then 200) | JSON: room type catalog (GraphQL-shaped) |
| `/services/marriott-hws/offers?marsha=BCNRZ&locale=en-US` | www.ritzcarlton.com | 200 (301→ trailing slash, then 200) | JSON: marketing offers (GraphQL-shaped) |
| `/services/marriott-hws/{22 guessed names}` | www.ritzcarlton.com | 404 (all 22) | Nothing — see Dead Ends |
| `/services/marriott-hws/roomCards` / `offers` | www.marriott.com | 403 (Akamai "Access Denied") | Nothing |
| `/robots.txt` | www.marriott.com | 403 (Akamai "Access Denied") | Nothing |
| `/sitemap-index.xml` | www.marriott.com | 403 (Akamai "Access Denied") | Nothing |
| `.../photos/jcr:content.roomimages.json` | www.ritzcarlton.com | 200 | JSON: per-room-type image sets |
| `.../photos/jcr:content.json` (bare, depth 0) | www.ritzcarlton.com | 200 | JSON: page CMS metadata only, no children |
| `.../photos/jcr:content.1.json` / `.2.json` / `.3.json` | www.ritzcarlton.com | 404 (all) | Blocked — numeric depth selector disabled |
| `.../photos/jcr:content.infinity.json` | www.ritzcarlton.com | 404 | Blocked |
| Property root `.../bcnrz-hotel-arts-barcelona/jcr:content.json` | www.ritzcarlton.com | 200 | JSON: property config incl. `hws:*DataPath` pointers |
| Property root `.../bcnrz-hotel-arts-barcelona.json` (no jcr:content) | www.ritzcarlton.com | 200 | Tiny JSON, page-node metadata only (118 bytes) |
| `.../dining/jcr:content.json` | www.ritzcarlton.com | 200 | JSON: page CMS metadata (title/description) only |
| `.../overview/jcr:content.json` | www.ritzcarlton.com | 200 | JSON: page CMS metadata only |
| `.../amenities/jcr:content.json` | www.ritzcarlton.com | 404 | No such subpage at this slug |
| `.../data-page/amenities-data-page/jcr:content.json` | www.ritzcarlton.com | 200 | JSON: page metadata only, no amenity list (data lives in child nodes, unreachable — see Dead Ends) |
| `.../data-page/header/jcr:content.json` | www.ritzcarlton.com | 200 | JSON: page metadata only, same limitation |
| `/content/marriott-hws/language-masters/na/en-us/configurations/global/global-nav/jcr:content.json` | www.ritzcarlton.com | 404 | Not resolvable from this host |

## 1. `/services/marriott-hws/roomCards`

**URL tested:** `https://www.ritzcarlton.com/services/marriott-hws/roomCards?marsha=BCNRZ&locale=en-US&acrsEnabled=false`

Note: the bare URL 301-redirects to the same path with a trailing slash before the querystring (`/roomCards/?marsha=...`); `curl -L` follows this and gets 200. Content-length was 60,816 bytes.

**Top-level shape:**
```
{ "data": { "property": { "__typename": "Hotel", "roomTypes": { "__typename": "...", "edges": [ ... ] } } } }
```
This is a GraphQL-response shape (`data` → `property` → `roomTypes.edges[].node`), not a flat REST payload. 15 room-type edges were returned for BCNRZ.

**Representative record** (`data.property.roomTypes.edges[0].node`), fields trimmed:
```json
{
  "__typename": "PropertyRoomType",
  "id": "bcnrz.KING",
  "roomTypeCode": "KING",
  "name": "Landscape",
  "description": "Guest room, 1 King",
  "longDescription": "Landscape Room, 1 King, Whirlpool fits 1, Mini fridge, ...",
  "bedCounts": [1],
  "maxOccupancy": 2,
  "details": [
    {
      "__typename": "PropertyRoomTypeDescription",
      "availabilityInd": false,
      "descriptions": ["Landscape Room"],
      "type": { "code": "1", "description": "Room Overview", "enumCode": null, "label": null }
    }
    /* further entries for "Beds and Bedding" (code 3), "Room Features" (code 8),
       "Bath and Bathroom Features" (code 4), "Furniture and Furnishings" (code 5), etc. */
  ]
}
```
`details[].type.code` is a lookup code for a description category (bedding, bathroom, furniture, services...); each category holds a flat list of description strings. Sample `roomTypeCode` values seen: `KING`, `TWIN`, `GENR`, `DTWN`, `PDLX`.

## 2. `/services/marriott-hws/offers`

**URL tested:** `https://www.ritzcarlton.com/services/marriott-hws/offers?marsha=BCNRZ&locale=en-US`

Same trailing-slash 301→200 behavior. Content-length 14,730 bytes.

**Top-level shape:**
```
{ "data": { "marketing": { "offers": { "offersFromMbopLightning": { "offers": [ ... ] } } } } }
```
Also GraphQL-shaped, nested four levels before reaching the actual array (5 offers returned).

**Representative record** (`data.marketing.offers.offersFromMbopLightning.offers[0]`), trimmed:
```json
{
  "__typename": "OfferFromLightning",
  "id": "OFF-224376",
  "title": "Exceptional Stays",
  "descriptionTeaser": "Earn 10,000 points per stay at participating luxury hotels.",
  "description": "<html-formatted long copy...>",
  "url": "https://www.marriott.com/offers/earn-10000-bonus-points-off-224376",
  "urlTitle": "earn...",
  "bookingStartDate": "2026-06-01",
  "bookingEndDate": "2026-08-31",
  "stayStartDate": "2026-06-23",
  "stayEndDate": "2026-09-15",
  "memberLevel": ["M"],
  "numProperties": 1,
  "tags": ["Hotel", "Holiday", "Beach", "Weekend Trip", "New Members", "Advance Purchase"],
  "media": {
    "primaryImage": {
      "imageSrc": "/content/dam/marriott-digital/jw/.../jw-chqmj-spa-exterior-16831.jpg",
      "imageUrls": {
        "classicHorizontal": "/is/image/marriotts7prod/...:Classic-Hor",
        "featureHorizontal": "/is/image/marriotts7prod/...:Feature-Hor",
        "wideHorizontal": "/is/image/marriotts7prod/...:Wide-Hor",
        "square": "/is/image/marriotts7prod/...:Square"
        /* + Vertical variants, deviceSmall/flex sometimes null */
      }
    }
  }
}
```
Image URLs point at Scene7 (`/is/image/marriotts7prod/...`) — a separate, likely-public image CDN, not the AEM host itself.

## 3. Enumerating other `/services/marriott-hws/` names

Tried 22 plausible service names against `https://www.ritzcarlton.com/services/marriott-hws/{name}?marsha=BCNRZ&locale=en-US`:

`amenities, hotelInfo, propertyInfo, rates, availability, gallery, photos, reviews, restaurants, dining, meetings, events, spa, rooms, roomTypes, nearbyAttractions, transportation, faq, policies, seo, map, brandInfo`

**Result: all 22 returned 404** (plain "Not Found", 196-byte body, no redirect). None returned 200.

Interpretation (uncertain, not confirmed): the `/services/marriott-hws/` path may expose only a small, deliberately curated set of GraphQL-backed service names (`roomCards`, `offers` confirmed) rather than a broad REST surface per content type. It's possible other real service names exist under different casing or naming conventions than guessed (e.g. camelCase vs. hyphenated, or names tied to specific GraphQL resolvers not reflected in the URL), but none of the tried names hit.

## 4. Same endpoints on www.marriott.com

```
GET https://www.marriott.com/services/marriott-hws/roomCards?marsha=BCNMC&locale=en-US&acrsEnabled=false  -> 403
GET https://www.marriott.com/services/marriott-hws/offers?marsha=BCNMC&locale=en-US                        -> 403
GET https://www.marriott.com/robots.txt                                                                     -> 403
GET https://www.marriott.com/sitemap-index.xml                                                              -> 403
```
All four returned Akamai's generic "Access Denied" HTML page (`server: AkamaiGHost`-style block), not a Marriott-specific error. The fact that even `robots.txt` — normally always public — is blocked for a bare `curl` request indicates www.marriott.com is blocking on request fingerprint/User-Agent broadly, not on a per-path rule. This is consistent with the previously-established context that www.marriott.com's Akamai config is stricter than www.ritzcarlton.com's. No attempt was made to defeat this (per instructions); it is simply recorded as 403 across the board.

## 5. AEM `jcr:content` JSON selector trick

Base property path used: `/content/marriott-trc/hws/na/en/hotels/b/bcnrz-hotel-arts-barcelona`

Confirmed working grammar:
- `<pagePath>/jcr:content.<customSelector>.json` — works when `<customSelector>` names a real Sling model/servlet registered on that resource type. Confirmed: `photos/jcr:content.roomimages.json` → 200, 167,734 bytes, full per-room-type image manifest (keyed by short room codes like `king`, `dtwn`, `wplq`, `seas`, `clex`, `genr`, `default`, `pdlx`, `dwtv`, `suit`, `ovst`, `clbl`, `exec`, `twin`, `watr`; each value is a list of image objects with `imageAltText` and multiple responsive `*Ref{Mobile,Tablet,Desktop}` URLs pointing at `cache.marriott.com/is/image/marriotts7prod/...`).
- `<pagePath>/jcr:content.json` (bare, no selector = depth 0) — works, but returns **only the jcr:content node's own properties** (CMS metadata: `jcr:title`, `jcr:description`, `cq:template`, `cq:lastModified`, etc.), never child nodes/components. Confirmed on the property root, `/photos`, `/dining`, `/overview` subpages, and the `data-page/amenities-data-page` and `data-page/header` nodes — all 200, all metadata-only.
- `<pagePath>.json` (page-level, no `jcr:content` segment) — works but returns almost nothing (118 bytes: just `jcr:primaryType: cq:Page`, `jcr:createdBy`, `jcr:created`).

**Blocked / non-working:**
- Numeric depth selectors — `jcr:content.1.json`, `.2.json`, `.3.json`, and `<pagePath>.1.json` — all returned plain 404 (not 403), suggesting the AEM dispatcher has an explicit filter rule stripping/rejecting numeric depth selectors rather than an auth failure.
- `jcr:content.infinity.json` — 404, same as above. Standard AEM "dump the whole subtree" tricks are disabled.
- `/amenities/jcr:content.json` (guessed subpage slug) — 404, that page path doesn't exist (property nav apparently uses different slugs, e.g. `/overview`, `/dining` exist but `/amenities` doesn't as a direct child).
- `/content/marriott-hws/language-masters/na/en-us/configurations/global/global-nav/jcr:content.json` — 404 on the ritzcarlton.com host, even though the property root's own `jcr:content.json` cites this exact path via `hws:globalDataPath`. Likely resolvable only on www.marriott.com (unreachable per Section 4) or requires a different host/dispatcher mapping.

**Notable side-finding:** the property root's `jcr:content.json` exposes several `hws:*DataPath` properties that point at other content nodes:
```
hws:marsha = BCNRZ
hws:brand  = RZ
hws:amenitiesDataPath = /content/.../bcnrz-hotel-arts-barcelona/data-page/amenities-data-page
hws:headerDataPath    = /content/.../bcnrz-hotel-arts-barcelona/data-page/header
hws:footerDataPath    = /content/.../bcnrz-hotel-arts-barcelona/data-page/footer
hws:globalDataPath    = /content/marriott-hws/language-masters/na/en-us/configurations/global/global-nav
hws:appDataPagePath   = /content/marriott-hws/language-masters/na/en-us/configurations/global/marriott-bonvoy-app
```
These are legitimate internal CMS wiring (a form of self-documenting sitemap for the page's own data dependencies), but fetching them via `jcr:content.json` only returns metadata, not their actual payload — the real amenities/header/footer *content* apparently lives in child component nodes under those paths, which the dispatcher's depth-selector block prevents from being read directly. Whether a different (documented) selector similar to `roomimages` exists for amenities/header/footer was not discovered in this probe.

## 6. www.marriott.com sitemap-index.xml

`https://www.marriott.com/sitemap-index.xml` returned **403** (Akamai "Access Denied"), identical in shape to the robots.txt and services blocks in Section 4. No sitemap content, child sitemap URLs, or property-URL organization could be observed. This could not be tested via ritzcarlton.com as no equivalent sitemap path was in scope for this probe.

## Dead Ends

- 22 guessed `/services/marriott-hws/` names on ritzcarlton.com: `amenities`, `hotelInfo`, `propertyInfo`, `rates`, `availability`, `gallery`, `photos`, `reviews`, `restaurants`, `dining`, `meetings`, `events`, `spa`, `rooms`, `roomTypes`, `nearbyAttractions`, `transportation`, `faq`, `policies`, `seo`, `map`, `brandInfo` — all 404.
- Any `/services/marriott-hws/*` endpoint on www.marriott.com — 403 (Akamai blocks bare curl entirely on this host, including `robots.txt`).
- `www.marriott.com/robots.txt` and `www.marriott.com/sitemap-index.xml` — both 403, could not verify the robots.txt-advertised sitemap claim from this host with plain curl.
- Numeric AEM depth selectors (`.1.json`, `.2.json`, `.3.json`, `.infinity.json`) on any `jcr:content` node — all 404, dispatcher-blocked.
- `/amenities` as a direct hotel subpage slug — 404 (real slug, if any, is different or amenities content is served only via the data-page + service call, not a standalone page).
- `global-nav` config node — 404 when resolved against the ritzcarlton.com host, despite being referenced by `hws:globalDataPath` on that same host's property page.
- Amenities/header/footer "data-page" nodes resolve (200) but expose CMS metadata only — the actual amenity/header/footer content is in child nodes not reachable via any selector tried.

## Uncertainties

- Whether other, non-guessed `/services/marriott-hws/` service names exist (e.g. different casing, hyphenation, or GraphQL operation names) is unconfirmed — only 22 plausible names were tried and all missed.
- Whether www.marriott.com blocks are IP/fingerprint-based (would pass with a browser or different network egress) or blanket-deny curl's default UA specifically was not tested, per instructions not to spoof headers.
- Whether a working "dump amenities/header/footer content" selector exists (analogous to `roomimages`) was not found; it may use a different, undiscovered selector name.

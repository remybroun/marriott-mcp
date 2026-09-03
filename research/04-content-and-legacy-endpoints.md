# 04 — Content, Media and Legacy Endpoints

Non-GraphQL surfaces observed live. Useful for enriching search results without extra
GraphQL calls, and for understanding the legacy parameter vocabulary.

---

## Legacy `.mi` search URLs

These are the human-facing URLs. They are **Next.js pages, not JSON APIs** — the results
are server-rendered and the data is embedded in `__NEXT_DATA__`. Still worth documenting:
they are what the booking widgets submit to, and the parameter names show up throughout
Marriott's stack.

### Search results (captured after a real search)

```
https://www.marriott.com/search/findHotels.mi
  ?destinationAddress.destination=Barcelona,+Spain
  &destinationAddress.placeId=ChIJ5TCOcRaYpBIRCmZHTz37sEQ
  &fromDate=08/29/2026
  &toDate=08/30/2026
  &lengthOfStay=1
  &flexibleDateSearch=false
  &roomCount=1
  &numAdultsPerRoom=1
  &childrenCount=0
  &clusterCode=none
  &useRewardsPoints=false
  &searchType=InCity
  &recordsPerPage=20
  &deviceType=desktop-web
  &view=list                # or `map`
  &amenities=pool           # appended when a filter chip is selected
  &isSearch=true
  #/0/                      # hash increments per in-page state change
```

### The brand-site booking widget target

Ritz-Carlton's "Reserve Now" widget hands off to:

```
https://www.marriott.com/reservation/availabilitySearch.mi
  ?propertyCode=&isSearch=false
  &fromDate=08/29/2026&toDate=08/30/2026
  &roomCount=1&numAdultsPerRoom=1&childrenCount=0&childrenAges=
  &clusterCode=&corporateCode=&groupCode=
  &isRateCalendar=false&useRewardsPoints=false&flexibleDateSearch=false
  &program=marriott&pid=&scid=
```

### Legacy parameter reference

| Param | Notes |
|---|---|
| `fromDate` / `toDate` | **US `MM/DD/YYYY`** — note this differs from the GraphQL API's ISO dates |
| `destinationAddress.placeId` | Google Place ID, same as the autocomplete returns |
| `propertyCode` | MARSHA code (`BCNRZ`); empty for a destination search |
| `clusterCode` | rate cluster; `none` for standard |
| `corporateCode` / `groupCode` | negotiated / group rates |
| `useRewardsPoints` | points vs cash |
| `flexibleDateSearch` | ±3-day grid |
| `isRateCalendar` | month-view pricing |
| `childrenAges` | CSV, e.g. `5,8` |
| `searchType` | `InCity` observed |
| `view` | `list` \| `map` |
| `pid` / `scid` | campaign tracking, safe to omit |

**robots.txt disallows `/search/`, `/aries-search/` and `/reservation/availabilitySearch.mi`**
(`/search/default.mi` is explicitly allowed). See `05`.

---

## Hotel Website Services (`marriott-hws`)

Per-property content JSON, served from **every brand host**. Captured on
`www.ritzcarlton.com`, but the path segment is `marriott-hws`, so the same service is
expected under `www.marriott.com/services/marriott-hws/…`.

```
GET /services/marriott-hws/roomCards?marsha=BCNRZ&locale=en-US&acrsEnabled=false&_=<epoch_ms>
GET /services/marriott-hws/offers?marsha=BCNRZ&locale=en-US&_=<epoch_ms>
```

| Param | Notes |
|---|---|
| `marsha` | MARSHA property code — the universal Marriott property identifier |
| `locale` | `en-US`, `es-ES`, … |
| `acrsEnabled` | ACRS = Advanced Central Reservation System; picks the rate engine |
| `_` | jQuery cache-buster, optional |

Both return `200` (the no-slash form 301s to the trailing-slash form).

**They are not flat REST JSON — they return GraphQL-shaped payloads:**

```
roomCards → data.property.roomTypes.edges[].node
offers    → data.marketing.offers.offersFromMbopLightning.offers[]
```

So these are thin server-side wrappers over the same graph as `/mi/query/`, pre-baked for
the AEM page. Useful because they need no signature header and no Akamai session on the
brand hosts.

**The service family is only these two.** 22 other plausible names were probed
(`amenities`, `hotelInfo`, `propertyInfo`, `rates`, `availability`, `gallery`, `photos`,
`reviews`, `restaurants`, `dining`, `meetings`, `events`, `spa`, `rooms`, `roomTypes`,
`nearbyAttractions`, `transportation`, `faq`, `policies`, `seo`, `map`, `brandInfo`) and
**all returned 404**. Don't go looking for a broader REST API here — there isn't one.

See `06-content-service-probe.md` for the full probe log and response shapes.

---

## AEM content JSON

Marriott's marketing tier is Adobe Experience Manager, and AEM will emit JSON for any
page when you append a selector to `jcr:content`:

```
GET https://www.ritzcarlton.com/content/marriott-trc/hws/na/en/hotels/b/
      bcnrz-hotel-arts-barcelona/photos/jcr:content.roomimages.json
```

Path grammar:

```
/content/marriott-{brand}/hws/{region}/{lang}/hotels/{first-letter}/{marsha-slug}/{page}/jcr:content.{selector}.json
```

**Named selectors work; numeric depth selectors do not.** Probed:

| Form | Result |
|---|---|
| `jcr:content.roomimages.json` | **200** — full per-room-type image data |
| `jcr:content.json` | 200, but CMS metadata only (title, description, template), no children |
| `jcr:content.1.json` / `.2.json` / `.3.json` / `.infinity.json` | **404** — dispatcher-blocked |

So the classic AEM depth-traversal trick is closed off. You can only read selectors
Marriott has explicitly registered.

Side discovery: a property root's `jcr:content.json` exposes pointer properties —
`hws:amenitiesDataPath`, `hws:headerDataPath`, `hws:footerDataPath`,
`hws:globalDataPath` — naming other content nodes. Following them returns only metadata,
because the actual payload lives in child nodes that the depth-selector block prevents
reading. A dead end unless a registered selector for those paths is found.

---

## Image CDN (Adobe Scene7, no auth)

```
https://cache.marriott.com/is/image/marriotts7prod/{asset-id}:{crop}?wid={px}&fit=constrain
```

Real examples:

```
…/marriotts7prod/rz-bcnrz-hotel-tower-11556:Pano-Hor?wid=1600&fit=constrain
…/marriotts7prod/rz-bcnrz-culinary-excellence-12041:Classic-Hor?wid=524&fit=constrain
…/marriotts7prod/rz-bcnrz-matcha-cake-96930:Classic-Ver?wid=270&fit=constrain
```

- Asset id convention: `{brand}-{marsha}-{slug}-{numeric-id}`
- Crop presets seen: `Pano-Hor`, `Classic-Hor`, `Classic-Ver`
- Full Scene7 parameter set applies (`wid`, `hei`, `fit`, `qlt`, `fmt`)

Other CDN paths:

```
https://cache.marriott.com/content/dam/marriott-digital/{brand}/…      # logos, DAM assets
https://cache.marriott.com/aka-fonts/…                                 # fonts
https://www.marriott.com/mi-assets/mi-global/brand-framework/brand-config.{BRAND}.css
```

---

## Brand codes

Two-letter internal codes, consistent across facets, analytics (`c5=RZ`) and asset paths:

```
AR  AK (Autograph Collection)  EB  FP  MD  OX  BR (Bulgari)  RZ (Ritz-Carlton)  TX  WH (W Hotels)
```

Brand hostnames all 301 to `www.marriott.com`, except `www.ritzcarlton.com`, which serves
its own AEM site on the same platform:

```
www.marriottbonvoy.com, www.stregis.com, www.whotels.com,
www.sheraton.com, www.westin.com, www.autographhotels.com   →  301 www.marriott.com
www.marriott.co.uk    → 301 https://www.marriott.com/en-gb/
www.espanol.marriott.com → 301 https://www.marriott.com/es/
www.ritzcarlton.com   → 200, independent site
api.marriott.com      → no route
```

`www.ritzcarlton.com` is a useful fallback observation point: it runs the same
`mcom-hws` AEM codebase and was reachable during a window when `www.marriott.com`
documents were being blocked.

# 02 — Search Operations: dates, locations, rate codes, filters

This is the file that answers "how do I run a Marriott search from a terminal".

---

## Step 1 — Resolve a location string to a place

**Operation:** `phoenixShopSuggestedPlacesQuery`
**Signature:** `70b3555c91797ca8945e4f4b1bdda42c3e37fa1f08fa99feafb73195702c1d34`
**Client headers:** `application-name: homepage`, `apollographql-client-name: phoenix_homepage`

Fires on every keystroke in the destination box (debounced per character).

```json
{
  "operationName": "phoenixShopSuggestedPlacesQuery",
  "variables": { "query": "Barcelona, Spain" }
}
```

Response (real, trimmed):

```json
{"data":{"suggestedPlaces":{"edges":[
  {"node":{
     "placeId":"ChIJ5TCOcRaYpBIRCmZHTz37sEQ",
     "description":"Barcelona, Spain",
     "primaryDescription":"Barcelona",
     "secondaryDescription":"Spain"}},
  {"node":{
     "placeId":"ChIJeVQsv4yipBIR0...",
     "description":"Universitat de Barcelona, Gran Via de les Corts Catalanes, Barcelona, Spain",
     "primaryDescription":"Universitat de Barcelona",
     "secondaryDescription":"Gran Via de les Corts Catalanes, Barcelona, Spain"}}
], "total": ... }}}
```

**`placeId` is a Google Places ID.** Marriott is proxying Google Places Autocomplete.
The full query document (it is short, so recorded here for reference):

```graphql
query phoenixShopSuggestedPlacesQuery($query: String!) {
  suggestedPlaces(query: $query) {
    edges { node { placeId description primaryDescription secondaryDescription } }
    total
  }
}
```

To turn a `placeId` into coordinates, use `phoenixShopSuggestedPlacesDetailsQuery`
(signature `0b89c8ea...`, see `03`). Not captured live, but it is the obvious counterpart
and the search itself consumes lat/long.

---

## Step 2 — Run the priced search

**Operation:** `phoenixShopDatedSearchByGeoQuery`
**Signature:** `46b57113564cd372d3105f7f86be3efdb1549f31a86028977a9b46e251966acd`
**Client headers:** `application-name: shop`, `apollographql-client-name: phoenix_shop`

This is the one the map view uses, and the one to build the CLI on. Confirmed end to end:
returned 13 Barcelona properties with live EUR rates.

Full variables object, captured verbatim:

```json
{
  "search": {
    "latitude": 41.3874374,
    "longitude": 2.1686496,
    "distance": 80467.2,
    "sooOptions": {
      "weekType": "WEEKEND_ONLY",
      "rewardsLevel": "ANONYMOUS",
      "searchCity": "Barcelona",
      "searchState": "CT",
      "searchCountry": "ES",
      "deviceType": "DESKTOP_WEB",
      "searchDestinationType": "CITY",
      "sooModel": "OUT_OF_SCOPE"
    },
    "options": {
      "startDate": "2026-08-29",
      "endDate": "2026-08-30",
      "includeMandatoryFees": true,
      "numberInParty": 1,
      "rateRequestTypes": [{ "type": "STANDARD", "value": "" }],
      "quantity": 1,
      "includeTaxesAndFees": false,
      "includeUnavailableProperties": false,
      "customerId": ""
    },
    "facets": { "terms": [...], "ranges": [...] }
  },
  "limit": 40,
  "offset": 0,
  "sort": { "fields": [{ "field": "DISTANCE", "direction": "ASC" }] },
  "filter": [
    "HOTEL_MARKETING_CAPTION",
    "RESORT_FEE_DESCRIPTION",
    "DESTINATION_FEE_DESCRIPTION",
    "TOURISM_MARKETING_FEE_DESCRIPTION",
    "SURCHARGE_ORDINANCE_COST_DESCRIPTION"
  ]
}
```

A ready-to-POST version is at `samples/geo-search-payload.json`.

### Location

| Field | Notes |
|---|---|
| `latitude` / `longitude` | decimal degrees. Barcelona city centre = `41.3874374, 2.1686496` |
| `distance` | **metres.** `80467.2` = exactly 50 miles. The UI's distance buckets are `4830` (3 mi), `14520` (9 mi), `80470` (50 mi) |

The search is purely radial — there is no bounding box. Panning the map does not refetch;
the app re-queries on filter/sort changes using the same centre point.

### Dates — **ISO `YYYY-MM-DD`**

| Field | Notes |
|---|---|
| `options.startDate` | check-in, `2026-08-29` |
| `options.endDate` | check-out, `2026-08-30` |

Note the inconsistency to watch for: the **GraphQL API uses ISO dates**, while the
**legacy `.mi` page URLs use US `MM/DD/YYYY`** (see `04`). Do not mix them up.

### Occupancy

| Field | Meaning |
|---|---|
| `options.numberInParty` | total guests (adults) |
| `options.quantity` | number of rooms |

Children: the page URL carries `childrenCount` and `childrenAges`, but the captured geo
query had no children set, so the GraphQL field name for child ages is **unconfirmed**.

### Rate codes — `rateRequestTypes`

This is how special rates go in:

```json
"rateRequestTypes": [{ "type": "STANDARD", "value": "" }]
```

`type` selects the rate family; `value` carries the code where one is needed. Each UI
"Special Rates" option maps to its own `type` — it is **not** one generic type with a
varying value.

**All five UI options confirmed live:**

| UI label | `rateRequestTypes` value | Legacy URL equivalent |
|---|---|---|
| Lowest Regular Rate | `[{"type":"STANDARD","value":""}]` | `clusterCode=none` |
| AAA/CAA | `[{"type":"AAA","value":"aaa"}]` | `clusterCode=aaa&aaa=aaa` |
| Government & Military | `[{"type":"GOV","value":"gov"}]` | `clusterCode=gov&gov=gov` |
| Senior Discount | `[{"type":"CLUSTER","value":"S9R"}]` | — |
| Corp/Promo Code | `[{"type":"CLUSTER","value":"<CODE>"}]` | `clusterCode=corp&corporateCode=<CODE>&corp=corp` |

Three distinct types are in play — `STANDARD`, `AAA`, `GOV` — plus `CLUSTER`, which is the
generic carrier for an actual Marriott rate-cluster code. Senior Discount is not its own
type: it is just the well-known cluster code **`S9R`**. So `CLUSTER` is the general
mechanism, and any Marriott cluster/corporate code can be passed through it.

Note the asymmetry: `AAA` and `GOV` carry lowercase literals (`"aaa"`, `"gov"`) that are
just echoes of the UI selection, while `CLUSTER` carries a real code. Send `value` exactly
as the UI does rather than assuming it is meaningful.

### Corporate / promo codes work, and they move the price

Verified live with a real Marriott corporate cluster code on the same Barcelona search:

```json
"rateRequestTypes": [{ "type": "CLUSTER", "value": "<CODE>" }]
```

Nightly rates on the same 13 properties, same dates, dropped substantially:

| | lowest pins observed |
|---|---|
| `STANDARD` | 128 / 143 / 160 / 246 EUR |
| `CLUSTER` = a corporate code | 57 / 67 / 88 / 110 EUR |

So the rate-code path is fully functional through this API, not a cosmetic UI filter.

### Points redemption

Confirmed. Points mode is **not** a separate operation and **not** a boolean field — it is
signalled entirely through `rateRequestTypes`, which becomes a three-element array:

```json
"rateRequestTypes": [
  { "type": "CLUSTER",  "value": "MRW" },
  { "type": "STANDARD", "value": ""    },
  { "type": "CLUSTER",  "value": "P17" }
]
```

`MRW` = Marriott Rewards, `P17` = the points redemption cluster. `operationName` stays
`phoenixShopDatedSearchByGeoQuery`. The legacy URL adds `useRewardsPoints=true`.

Selecting points **clears any special rate selection** (`clusterCode` resets to `none`),
so points and a corporate code are mutually exclusive in the UI.

### Pricing behaviour

| Field | Effect |
|---|---|
| `includeMandatoryFees` | `true` → adds resort/destination fees into `amountPlusMandatoryFees` |
| `includeTaxesAndFees` | `false` in the UI default → returned rate is pre-tax |
| `includeUnavailableProperties` | `false` → sold-out hotels omitted |

### `sooOptions`

Marriott's "Search Optimization / Ordering" personalisation block. Mostly telemetry that
influences ranking. `rewardsLevel: "ANONYMOUS"` is what a logged-out client sends;
`sooModel: "OUT_OF_SCOPE"` disables the personalisation model. `searchState` is a
**region code, not a US state** (`CT` = Catalonia here). Safe to send as captured.

### Sorting

`sort` is **top-level in `variables`**, not inside `variables.search`. It takes an array,
so multi-key sorts are supported.

```json
"sort": { "fields": [{ "field": "DISTANCE", "direction": "ASC" }] }
```

| UI option | `sort.fields` | Status |
|---|---|---|
| Distance | `[{"field":"DISTANCE","direction":"ASC"}]` | **confirmed** |
| Rewards Points (High-to-Low) | `[{"field":"POINTS","direction":"DESC"}]` | **confirmed** |
| Rewards Points (Low-to-High) | `[{"field":"POINTS","direction":"ASC"}]` | **confirmed** |
| City | `[{"field":"CITY","direction":"ASC"},{"field":"BRAND","direction":"ASC"},{"field":"PROPERTY_NAME","direction":"ASC"}]` | **confirmed** |
| Brand | `BRAND` presumed | not captured |
| Guest Rating | ? | not captured |
| Number of Reviews | ? | not captured |

Known field names so far: `DISTANCE`, `POINTS`, `CITY`, `BRAND`, `PROPERTY_NAME`.

The menu is context-sensitive: the two "Rewards Points" entries were observed **with
points mode enabled**. In cash mode those slots are expected to be price orderings
(likely `field: "PRICE"`), but that was not verified.

### Paging

`limit` (40 in the map view, `recordsPerPage=20` in list view) and `offset`. The response
carries `total` and `pageInfo`.

---

## Filters — the `facets` block

Filters are expressed as facet *dimensions* inside `search.facets`. Requesting a facet
type with an empty `dimensions` array means "return the available buckets but don't
filter"; putting a code in it applies the filter. Selecting the "Pool" chip produced:

```json
{ "type": "AMENITIES", "dimensions": ["pool"] }
```

Full facet type list sent by the UI:

```
terms:  BRANDS, AMENITIES, PROPERTY_TYPES, ACTIVITIES, CITIES, STATES,
        COUNTRIES, HOTEL_SERVICE_TYPES, MEETINGS_EVENTS,
        TRANSPORTATION_TYPES, LEISURE_REGIONS
ranges: PRICE     endpoints ["0","100","200","overflow"]
        DISTANCE  endpoints ["0","4830","14520","80470"]
```

### Observed dimension codes (Barcelona result set)

```
brands              AR AK EB FP MD OX BR RZ TX WH
amenities           adult-only-pool business-center cabana ev-charging
                    fitness-center free-internet internet infinity-pool
                    marina onsite-bar pet-friendly plug-in-panel
                    plunge-pool pool            (20 total)
activities-on-site  beach family spa
transportation      airport-shuttle car-rental-desk parking
```

Brand codes are Marriott's two-letter internal codes (`RZ` Ritz-Carlton, `AK` Autograph
Collection, `WH` W Hotels, `BR` Bulgari…). These are the same codes that appear in
analytics payloads (`c5=RZ`) and brand asset URLs (`brand-config.RZP.css`).

The facet list is **result-set dependent** — it reflects what exists near that search, not
a global vocabulary. To enumerate all possible codes, run a wide search or use
`phoenixShopHotelAmenities` (signature `77ebd1ce...`).

### The top-level `filter` array

Separate from facets, this selects optional descriptive fields to include:

```
HOTEL_MARKETING_CAPTION, RESORT_FEE_DESCRIPTION, DESTINATION_FEE_DESCRIPTION,
TOURISM_MARKETING_FEE_DESCRIPTION, SURCHARGE_ORDINANCE_COST_DESCRIPTION
```

---

## Response shape

Root path:

```
data.search.lowestAvailableRates.searchByGeolocation
```

```json
{
  "edges": [ { "node": { "distance": 494.85672, "property": {...}, "rates": [...] } } ],
  "facets": [...],
  "pageInfo": {...},
  "recipeId": "...",
  "searchQueryId": "...",
  "status": {...},
  "total": 13
}
```

`node.property`:

```
id                        MARSHA code (e.g. BCNRZ)
seoNickname               URL slug
basicInformation          bookable, brand { id, name }, name, address, coordinates
media                     photo references
otherPropertyInformation
reviews                   rating + count
```

`node.rates[]`:

```json
{
  "lengthOfStay": 1,
  "membersOnly": false,
  "rateCategory": { "code": "StandardRates", "value": null },
  "rateModes": {
    "lowestAverageRate": {
      "amount": {...}, "amountPlusMandatoryFees": {...},
      "fees": {...}, "mandatoryFees": {...},
      "taxes": {...}, "totalAmount": {...}
    }
  },
  "sourceOfRate": "DSP",
  "status": { "code": "AvailableForSale" }
}
```

`distance` is in **metres** from the search centre. Amount objects carry value + currency
(the Barcelona search returned EUR, matching the UI's "246 EUR / Night").

---

## The other search operations

`phoenixShopDatedSearchByGeoQuery` is one of a family. Same shape, different location input:

| Suffix | Location input |
|---|---|
| `...ByGeoQuery` | lat/long + radius — **use this one** |
| `...ByDestinationQuery` | a destination/place reference |
| `...ByLocationSearchInputQuery` | a raw location search input object |
| `...ByKeywordQuery` | free-text keyword |

And per family, four variants:

| Variant | Purpose |
|---|---|
| *(plain)* | full results + rates |
| `...FilterQuery` | facet counts only, for the filter UI |
| `...GetIDS` / `...GetIDSQuery` | property IDs only — cheap, good for pagination or a two-phase fetch |
| `phoenixShopDatedSearchPropertiesInfoByIDs` | hydrate a set of IDs with full info |

There are also non-dated (`phoenixShopSearchPropertiesBy...`, `...NonDatedAllInfoByIDs`)
variants for browsing without availability, and `phoenixShopPropertiesMediaGalleryByIDS`
for photos (observed firing right after the search, 108 KB).

Full list with signatures: `03-operation-signatures.md`.

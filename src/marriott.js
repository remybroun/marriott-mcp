// Marriott Phoenix GraphQL client.
//
// Protocol (see research/01-graphql-protocol.md):
//   POST https://www.marriott.com/mi/query/{operationName}
//   body    {operationName, variables}      <- the GraphQL document is NOT required
//   headers graphql-operation-signature + graphql-require-safelisting
//
// Signatures are published in every search page's __NEXT_DATA__ and rotate on frontend
// deploys, so we scrape them rather than hardcoding.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './cdp.js';
import { gradeFor } from './brands.js';

const ORIGIN = 'https://www.marriott.com';
// /search/default.mi is the one search-surface path robots.txt explicitly Allows, and
// Akamai's challenge resolves there fine. It does NOT carry operationSignatures though.
export const WARMUP_URL = `${ORIGIN}/search/default.mi`;
// Only the results page embeds the safelist. Visited rarely: signatures are cached.
export const SIGNATURE_URL =
  `${ORIGIN}/search/findHotels.mi?searchType=InCity&destinationAddress.placeId=` +
  'ChIJ5TCOcRaYpBIRCmZHTz37sEQ&destinationAddress.destination=Barcelona,+Spain';
const SIG_CACHE = join(STATE_DIR, 'signatures.json');

/**
 * Last-known-good signatures (captured 2026-08-29, buildId ovoAI8iaz-thwv4jVWr40).
 * Only a fallback so a rotation degrades instead of hard-failing — the live scrape wins.
 */
export const KNOWN_SIGNATURES = {
  phoenixShopSuggestedPlacesQuery:
    '70b3555c91797ca8945e4f4b1bdda42c3e37fa1f08fa99feafb73195702c1d34',
  phoenixShopSuggestedPlacesDetailsQuery:
    '0b89c8ea7a6a6408eaee651983d6c7ee168670b727cc5beea980b2d2edfdbe2b',
  phoenixShopDatedSearchByGeoQuery:
    '46b57113564cd372d3105f7f86be3efdb1549f31a86028977a9b46e251966acd',
  phoenixShopDatedSearchByDestinationQuery:
    '19936acf228edb1a7c43b0b5e2102ef9cbe7e79c0f8fadd0d03bada15f4a6c25',
  phoenixShopPropertiesMediaGalleryByIDS:
    'b0700ec76e8e70b31592b1ce10b05451711924c1506e51547e2871ef6b77cde4',
  phoenixShopHotelAmenities:
    '77ebd1ceb8c4eafdb023fffbbc02524b7a4dc414152946846d30294d65115711',
};

/** Default radius Marriott uses for a city search: 50 miles, in metres. */
export const DEFAULT_RADIUS_M = 80467.2;

export const RATE_TYPES = {
  standard: [{ type: 'STANDARD', value: '' }],
  aaa: [{ type: 'AAA', value: 'aaa' }],
  gov: [{ type: 'GOV', value: 'gov' }],
  senior: [{ type: 'CLUSTER', value: 'S9R' }],
  points: [
    { type: 'CLUSTER', value: 'MRW' },
    { type: 'STANDARD', value: '' },
    { type: 'CLUSTER', value: 'P17' },
  ],
};

/** Any Marriott corporate/promo code rides on the generic CLUSTER type. */
export const clusterRate = (code) => [{ type: 'CLUSTER', value: code.toUpperCase() }];

const FACET_TERMS = [
  'BRANDS',
  'AMENITIES',
  'PROPERTY_TYPES',
  'ACTIVITIES',
  'CITIES',
  'STATES',
  'COUNTRIES',
  'HOTEL_SERVICE_TYPES',
  'MEETINGS_EVENTS',
  'TRANSPORTATION_TYPES',
  'LEISURE_REGIONS',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a Marriott page, tolerating Akamai's bot-challenge interstitial.
 *
 * A cold Chrome profile gets served a ~3KB challenge shell (scripts from
 * p11.techlab-cdn.com, empty body) instead of the real page. Those scripts compute the
 * _abck/bm_sz sensor cookies. We simply give them time to run and then reload — the
 * normal browser flow — until the real document shows up. Nothing is forged; the browser
 * solves the challenge itself.
 *
 * Reputation persists in the profile dir, so this cost is usually paid only on first run.
 */
export async function openWarmed(browser, url, { timeoutMs = 45000, verbose = false } = {}) {
  const log = (...a) => verbose && console.error('[warmup]', ...a);
  await browser.openPage(url);

  // CRITICAL: wait, do not reload. Measured behaviour — the challenge shell resolves
  // itself in ~5s once its sensor scripts have run. Reloading at it is what turns a
  // challenge into an "Access Denied" block. Patience is the entire technique.
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const state = await browser
      .evaluate(`(() => ({
        real: !!document.getElementById('__NEXT_DATA__'),
        denied: /Access Denied/i.test(document.title || ''),
        challenge: /techlab-cdn|_abck|bm-verify/.test(document.documentElement.outerHTML),
        bytes: document.documentElement.outerHTML.length,
      }))()`)
      .catch(() => null); // context churn while the challenge navigates is expected

    if (state) {
      last = state;
      if (state.real) {
        log('page released by Akamai');
        return;
      }
      if (state.denied) {
        throw new Error(
          'Akamai returned "Access Denied" — this profile/IP is currently blocked.\n' +
            '  Stop and wait 1-2 hours. Retrying now extends the block.\n' +
            '  See research/05-access-and-blocking.md.',
        );
      }
    }
    await sleep(2000);
  }

  throw new Error(
    `Akamai did not release the page within ${timeoutMs / 1000}s ` +
      `(last seen: ${last ? `${last.bytes} bytes, challenge=${last.challenge}` : 'no state'}).\n\n` +
      '  Try `marriott warmup` and browse by hand once.\n' +
      '  Do NOT loop retries — retry pressure escalates a challenge into a block.\n' +
      '  See research/05-access-and-blocking.md.',
  );
}

/** True if the current page is the real Next.js app rather than a challenge/deny page. */
export const isRealPage = (browser) =>
  browser.evaluate(`!!document.getElementById('__NEXT_DATA__')`);

export class MarriottClient {
  constructor(browser, { verbose = false } = {}) {
    this.browser = browser;
    this.verbose = verbose;
    this.signatures = new Map();
  }

  #log(...a) {
    if (this.verbose) console.error('[marriott]', ...a);
  }

  /** Load the operation safelist, from disk cache if warm, else from the live page. */
  async loadSignatures({ refresh = false } = {}) {
    if (!refresh) {
      try {
        const cached = JSON.parse(readFileSync(SIG_CACHE, 'utf8'));
        if (cached?.operations?.length) {
          this.signatures = new Map(cached.operations.map((o) => [o.operationName, o.signature]));
          this.buildId = cached.buildId;
          this.#log('signatures from cache:', this.signatures.size);
          return;
        }
      } catch {
        /* cold cache */
      }
    }

    const scrape = () =>
      this.browser.evaluate(`(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        const nd = JSON.parse(el.textContent);
        return { buildId: nd.buildId, operations: nd.props?.pageProps?.operationSignatures ?? [] };
      })()`);

    let data = await scrape();
    if (!data?.operations?.length) {
      // Only the search *results* page embeds the safelist; the landing page does not.
      this.#log('no signatures on this page — visiting the results page once');
      await this.browser.navigate(SIGNATURE_URL);
      await openWarmed(this.browser, SIGNATURE_URL, { verbose: this.verbose }).catch(() => {});
      data = await scrape();
    }

    if (!data?.operations?.length) {
      // Degrade rather than die: the handful of operations this CLI needs are pinned.
      this.#log('falling back to bundled signatures');
      this.signatures = new Map(Object.entries(KNOWN_SIGNATURES));
      this.usingFallback = true;
      return;
    }

    this.signatures = new Map(data.operations.map((o) => [o.operationName, o.signature]));
    this.buildId = data.buildId;
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(SIG_CACHE, JSON.stringify({ ...data, fetchedAt: new Date().toISOString() }, null, 2));
    this.#log('signatures scraped:', this.signatures.size, 'buildId', data.buildId);
  }

  /** Execute a safelisted operation from inside the page. */
  async call(operationName, variables, { app = 'shop' } = {}) {
    const signature = this.signatures.get(operationName);
    if (!signature) {
      throw new Error(
        `Unknown operation "${operationName}". Run \`marriott ops\` to list known ones, ` +
          'or --refresh-signatures if Marriott has redeployed.',
      );
    }

    const payload = {
      url: `/mi/query/${operationName}`,
      headers: {
        'content-type': 'application/json',
        accept: '*/*',
        'accept-language': 'en-US',
        'graphql-operation-name': operationName,
        'graphql-operation-signature': signature,
        'graphql-require-safelisting': 'true',
        'apollographql-client-name': `phoenix_${app}`,
        'apollographql-client-version': 'v1',
        'application-name': app,
      },
      body: JSON.stringify({ operationName, variables }),
    };

    const out = await this.browser.evaluate(`(async () => {
      const p = ${JSON.stringify(payload)};
      const res = await fetch(p.url, { method: 'POST', headers: p.headers, body: p.body });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status, json, snippet: json ? null : text.slice(0, 300) };
    })()`);

    if (out.status !== 200) {
      const detail =
        out.status === 403
          ? 'Akamai blocked the request — try --headful, or wait and retry with backoff.'
          : out.json?.errors?.map((e) => e.message).join('; ') ??
            JSON.stringify(out.json)?.slice(0, 400) ??
            out.snippet ??
            '';
      throw new Error(`${operationName} returned HTTP ${out.status}. ${detail}`);
    }
    if (out.json?.errors?.length) {
      throw new Error(`${operationName} GraphQL error: ${out.json.errors[0].message}`);
    }
    return out.json.data;
  }

  /**
   * FX rate via Marriott's own display converter, so converted prices agree with what the
   * site actually prints. `convertCurrency` is the operation behind the results-page
   * currency selector, and it returns a *retail* rate rather than the interbank one:
   * SAR->USD comes back as 0.266 here against 0.26667 from exchangeRateByCurrencyCodes.
   * On a 558.81 SAR room that is the difference between the site's 148 USD and a wrong 149.
   */
  async exchangeRate(from, to) {
    if (!from || !to || from === to) return 1;
    this._fx ??= new Map();
    const key = `${from}>${to}`;
    if (this._fx.has(key)) return this._fx.get(key);

    let rate;
    try {
      rate = await this.#displayRate(from, to);
    } catch (e) {
      // Still better than dropping the conversion, but the numbers will sit slightly
      // above what marriott.com shows.
      this.#log(`fx ${key} display rate failed (${e.message}), falling back to interbank`);
      rate = await this.#interbankRate(from, to);
    }
    this._fx.set(key, rate);
    this.#log(`fx ${key} = ${rate}`);
    return rate;
  }

  /** The rate marriott.com displays with. Takes no date; it stamps its own. */
  async #displayRate(from, to) {
    const data = await this.call('phoenixShopADFConvertCurrencyQuery', {
      // The amount is nominal, since only the rate is read back, but it still has to be a
      // valid MonetaryAmountInput: integer value plus its decimal point.
      input: { toCurrency: to, from: { currency: from, value: 100000, valueDecimalPoint: 2 } },
    });
    const r = data?.convertCurrency;
    if (!r?.exchangeRate) throw new Error(`no display rate for ${from}>${to}`);
    return r.exchangeRate / 10 ** (r.exchangeRateDecimalPoint ?? 0);
  }

  /** Interbank fallback. That API rejects future dates, so we ask for yesterday. */
  async #interbankRate(from, to) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    const data = await this.call('phoenixShopExchangeRateByCurrencyCodesQuery', {
      input: {
        inputCurrencyISOCode: from,
        outputCurrencyISOCode: to,
        date: d.toISOString().slice(0, 10),
      },
    });
    const r = data.exchangeRateByCurrencyCodes;
    // Same minor-unit convention as MonetaryAmount: integer + decimalPoint.
    return r.outputCurrencyExchangeRate / 10 ** (r.outputCurrencyDecimalPoint ?? 0);
  }

  /**
   * Put every row in one currency so prices are actually comparable.
   *
   * This matters more than it sounds: a Mexico City search returns City Express in MXN
   * and everything else in USD. Comparing the raw numbers ranks a 856 MXN room (~$46) as
   * dearer than a $53.78 one, which silently corrupts "cheapest" and every value metric.
   */
  async normaliseCurrencies(rows, target = null) {
    const present = [...new Set(rows.map((r) => r.currency).filter(Boolean))];
    if (!present.length) return { currency: '', converted: 0 };
    // Single currency and no explicit target: nothing to do. But an explicit --currency
    // must still convert, even when the results are already uniform.
    if (present.length === 1 && (!target || target === present[0])) {
      return { currency: present[0], converted: 0 };
    }

    // Default to the currency most rows already use, to minimise conversion.
    const counts = {};
    for (const r of rows) if (r.currency) counts[r.currency] = (counts[r.currency] ?? 0) + 1;
    const base = target ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

    let converted = 0;
    for (const r of rows) {
      if (!r.currency || r.currency === base) continue;
      let rate;
      try {
        rate = await this.exchangeRate(r.currency, base);
      } catch (e) {
        this.#log(`fx ${r.currency}->${base} failed: ${e.message}`);
        continue; // leave the row in its native currency rather than inventing a number
      }
      r.nativePrice = r.price;
      r.nativeTotal = r.totalPerNight;
      r.nativeCurrency = r.currency;
      if (r.price != null) r.price *= rate;
      if (r.totalPerNight != null) r.totalPerNight *= rate;
      if (r.taxes != null) r.taxes *= rate;
      r.currency = base;
      r.converted = true;
      converted++;
    }
    return { currency: base, converted, from: present.filter((x) => x !== base) };
  }

  /** Destination autocomplete. Returns Google Place IDs. */
  async suggestPlaces(query) {
    const data = await this.call('phoenixShopSuggestedPlacesQuery', { query }, { app: 'shop' });
    return (data.suggestedPlaces?.edges ?? []).map((e) => e.node);
  }

  /** Resolve a Place ID to coordinates + the city/state/country the search needs. */
  async placeDetails(placeId) {
    const data = await this.call('phoenixShopSuggestedPlacesDetailsQuery', { placeId });
    const d = data.suggestedPlaceDetails;
    if (!d) throw new Error(`No details for place ${placeId}`);
    return d;
  }

  /** Resolve a free-text destination all the way to coordinates. */
  async resolveDestination(query) {
    const places = await this.suggestPlaces(query);
    if (!places.length) throw new Error(`No destination matched "${query}"`);
    return { place: places[0], details: await this.placeDetails(places[0].placeId) };
  }

  /**
   * Priced geo search. `rateRequestTypes` comes from RATE_TYPES or clusterRate().
   * Dates are ISO YYYY-MM-DD (note: the legacy .mi URLs use MM/DD/YYYY instead).
   */
  async searchByGeo({
    latitude,
    longitude,
    distance = DEFAULT_RADIUS_M,
    startDate,
    endDate,
    adults = 1,
    rooms = 1,
    rateRequestTypes = RATE_TYPES.standard,
    amenities = [],
    brands = [],
    limit = 40,
    offset = 0,
    sort = [{ field: 'DISTANCE', direction: 'ASC' }],
    city = '',
    state = '',
    country = '',
    destinationType = 'CITY',
    includeUnavailable = false,
  }) {
    const variables = {
      search: {
        latitude,
        longitude,
        distance,
        sooOptions: {
          weekType: 'WEEKEND_ONLY',
          rewardsLevel: 'ANONYMOUS',
          searchCity: city,
          searchState: state,
          searchCountry: country,
          deviceType: 'DESKTOP_WEB',
          searchDestinationType: destinationType,
          sooModel: 'OUT_OF_SCOPE',
        },
        options: {
          startDate,
          endDate,
          includeMandatoryFees: true,
          numberInParty: adults,
          rateRequestTypes,
          quantity: rooms,
          includeTaxesAndFees: false,
          includeUnavailableProperties: includeUnavailable,
          customerId: '',
        },
        facets: {
          terms: FACET_TERMS.map((type) => ({
            type,
            dimensions:
              type === 'AMENITIES' ? amenities : type === 'BRANDS' ? brands : [],
          })),
          ranges: [
            { type: 'PRICE', dimensions: [], endpoints: ['0', '100', '200', 'overflow'] },
            {
              type: 'DISTANCE',
              dimensions: [],
              endpoints: ['0', '4830', '14520', '80470'],
            },
          ],
        },
      },
      limit,
      offset,
      sort: { fields: sort },
      filter: [
        'HOTEL_MARKETING_CAPTION',
        'RESORT_FEE_DESCRIPTION',
        'DESTINATION_FEE_DESCRIPTION',
        'TOURISM_MARKETING_FEE_DESCRIPTION',
        'SURCHARGE_ORDINANCE_COST_DESCRIPTION',
      ],
    };

    let data;
    try {
      data = await this.call('phoenixShopDatedSearchByGeoQuery', variables);
    } catch (err) {
      // Place details return destinationType "NA" for natural features (Lake Como,
      // national parks…), which the search enum rejects. The coordinates are perfectly
      // good, so retry with a type the enum accepts rather than failing the search.
      if (/searchDestinationType|DestinationType.*enum/i.test(err.message)) {
        this.#log(`destinationType "${destinationType}" rejected — retrying as CITY`);
        variables.search.sooOptions.searchDestinationType = 'CITY';
        data = await this.call('phoenixShopDatedSearchByGeoQuery', variables);
      } else {
        throw err;
      }
    }
    return data.search.lowestAvailableRates.searchByGeolocation;
  }
}

/**
 * Marriott returns money as MonetaryAmount: an integer in minor units plus an explicit
 * decimalPoint. `{amount: 39933, currency: 'EUR', decimalPoint: 2}` is 399.33 EUR.
 * Never assume 2 — the field exists precisely because zero-decimal currencies (JPY, KRW)
 * come back with decimalPoint: 0.
 */
export function money(m) {
  if (!m || typeof m.amount !== 'number') return null;
  return {
    value: m.amount / 10 ** (m.decimalPoint ?? 2),
    currency: m.currency ?? '',
  };
}

/**
 * Anchor points used to harvest the global brand list. Facets are computed over the
 * whole result set (not just the returned page), so a handful of wide searches across
 * continents surfaces nearly every brand Marriott operates.
 */
export const BRAND_ANCHORS = [
  { name: 'New York', latitude: 40.7549, longitude: -73.984 },
  { name: 'Los Angeles', latitude: 34.0522, longitude: -118.2437 },
  { name: 'London', latitude: 51.5072, longitude: -0.1276 },
  { name: 'Dubai', latitude: 25.2048, longitude: 55.2708 },
  { name: 'Bangkok', latitude: 13.7563, longitude: 100.5018 },
  { name: 'Shanghai', latitude: 31.2304, longitude: 121.4737 },
  { name: 'São Paulo', latitude: -23.5558, longitude: -46.6396 },
  { name: 'Johannesburg', latitude: -26.2041, longitude: 28.0473 },
  { name: 'Mexico City', latitude: 19.4326, longitude: -99.1332 },
  { name: 'Sydney', latitude: -33.8688, longitude: 151.2093 },
];

/** Flatten a search connection into plain rows for display. */
export function toRows(conn) {
  return (conn.edges ?? []).map(({ node }) => {
    const p = node.property ?? {};
    const b = p.basicInformation ?? {};
    const rate = node.rates?.[0];
    const mode = rate?.rateModes?.lowestAverageRate ?? {};
    // lowestAverageRate is per night, averaged over the stay.
    const nightly = money(mode.amount) ?? money(mode.amountPlusMandatoryFees);
    const total = money(mode.totalAmount);
    const taxes = money(mode.taxes);
    const brandCode = b.brand?.id ?? '';
    const brandName = b.brand?.name ?? brandCode;
    const g = gradeFor(brandCode, brandName);
    return {
      id: p.id,
      name: b.name ?? p.seoNickname ?? p.id,
      brand: brandName,
      brandCode,
      grade: g.grade,
      gradeVaries: !!g.variable,
      segment: g.segment,
      distanceKm: node.distance != null ? +(node.distance / 1000).toFixed(1) : null,
      rating: p.reviews?.stars?.count ?? null,
      reviews: p.reviews?.numberOfReviews?.count ?? null,
      price: nightly?.value ?? null,
      currency: nightly?.currency ?? '',
      totalPerNight: total?.value ?? null,
      taxes: taxes?.value ?? null,
      nights: rate?.lengthOfStay ?? null,
      rateCategory: rate?.rateCategory?.code ?? '',
      membersOnly: rate?.membersOnly ?? null,
      status: rate?.status?.code ?? '',
      bookable: b.bookable ?? null,
    };
  });
}

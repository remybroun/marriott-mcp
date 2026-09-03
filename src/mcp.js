// MCP server: Marriott hotel search as tools, over stdio.
//
// Hand-rolled JSON-RPC rather than the official SDK, to keep the project's zero-dependency
// property: the server runs straight from a git clone with no `npm install` step. The
// stdio transport is newline-delimited JSON-RPC 2.0 — no framing headers — and a
// tools-only server needs exactly four methods.
//
// stdout belongs to the protocol. Every diagnostic goes to stderr.

import { createInterface } from 'node:readline';
import { Session } from './session.js';
import { RATE_TYPES, clusterRate, toRows, DEFAULT_RADIUS_M } from './marriott.js';
import { loadPrefs, resolveCode, maskCode, CONFIG_PATH } from './prefs.js';
import { BRANDS, TIERS, tierRank } from './brands.js';
import { score, sortRows, resultsTable, scanTable } from './format.js';
import { planStay, planTable, collectNights, verifyBlocks } from './itinerary.js';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', PROTOCOL_VERSION]);

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function resolveDates({ check_in, check_out, nights }) {
  const start = check_in ?? addDays(iso(new Date()), 30);
  if (!isDate(start)) throw new Error(`check_in must be YYYY-MM-DD, got "${start}"`);
  const end = check_out ?? addDays(start, Number(nights ?? 1));
  if (!isDate(end)) throw new Error(`check_out must be YYYY-MM-DD, got "${end}"`);
  if (end <= start) throw new Error('check_out must be after check_in');
  return { startDate: start, endDate: end };
}

/**
 * The cluster code for one tool call: the `code` argument if given, otherwise
 * MARRIOTT_CODE, otherwise the user's config file. Prefs are read per call so editing
 * the config takes effect without restarting the server.
 *
 * A code argument may also be a name saved under `codes` in the config, which lets the
 * user say "use my work code" without ever putting the code itself in the chat.
 */
function activeCode(args = {}) {
  const prefs = loadPrefs();
  return resolveCode({
    code: args.code,
    noCode: args.no_code === true,
    explicitRate: args.rate !== undefined,
    prefs,
  }).code;
}

/** How a result header describes what was priced. Codes are masked. */
function rateLabelFor(args, code) {
  return code ? `code ${maskCode(code)}` : `rate ${args.rate ?? 'standard'}`;
}

function rateTypesFor(args) {
  const code = activeCode(args);
  if (code) return clusterRate(code);
  const kind = String(args.rate ?? 'standard').toLowerCase();
  if (!RATE_TYPES[kind]) {
    throw new Error(`rate must be one of: ${Object.keys(RATE_TYPES).join(', ')}`);
  }
  return RATE_TYPES[kind];
}

const list = (v) =>
  Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

/** Shared search arguments, resolved once so search and scan cannot drift apart. */
async function geoArgsFor(mi, args) {
  const { place, details } = await mi.resolveDestination(String(args.destination));
  return {
    place,
    geo: {
      latitude: details.location.latitude,
      longitude: details.location.longitude,
      distance: args.radius_km ? Number(args.radius_km) * 1000 : (details.distance ?? DEFAULT_RADIUS_M),
      adults: Number(args.adults ?? 1),
      rooms: Number(args.rooms ?? 1),
      rateRequestTypes: rateTypesFor(args),
      amenities: list(args.amenities),
      brands: list(args.brands),
      limit: Math.min(200, Number(args.limit ?? 40)),
      city: details.location.city ?? '',
      state: details.location.state ?? '',
      country: details.location.country ?? '',
      destinationType: (details.destinationType ?? 'City').toUpperCase(),
    },
  };
}

// ── shared schema fragments ───────────────────────────────────────────────────

const STAY_PROPS = {
  adults: { type: 'integer', minimum: 1, default: 1, description: 'Guests per room.' },
  rooms: { type: 'integer', minimum: 1, default: 1, description: 'Number of rooms.' },
  rate: {
    type: 'string',
    enum: Object.keys(RATE_TYPES),
    default: 'standard',
    description:
      'Rate family. "points" asks for award availability; "senior", "aaa", "gov" are the usual discounts.',
  },
  code: {
    type: 'string',
    description:
      'Corporate or promotional cluster code, or the name of one the user saved in their config (`marriott config set codes.<name> <CODE>`) — a name is preferred, ' +
      'since it keeps the code itself out of the conversation. Omit this and the user\'s configured default code, if any, applies automatically. ' +
      'Takes precedence over `rate`. Rates under a code are only bookable if you actually qualify for it. ' +
      'Where the code did not apply, the row is marked `!` and shows that property\'s standard rate instead. Read that as "code unavailable", not as a price.',
  },
  no_code: {
    type: 'boolean',
    description: 'Ignore the user\'s configured default code and price the plain rate family instead.',
  },
  amenities: {
    type: 'array',
    items: { type: 'string' },
    description: 'Amenity filters, e.g. ["pool","fitness-center","pet-friendly"].',
  },
  brands: {
    type: 'array',
    items: { type: 'string' },
    description: 'Brand codes to restrict to, e.g. ["RZ","XR","AK"]. See the brand_tiers tool.',
  },
  radius_km: { type: 'number', description: 'Search radius in km. Defaults to the destination\'s own radius (usually 80 km).' },
  currency: {
    type: 'string',
    description:
      'ISO code to normalise every price into, e.g. "USD". Set this whenever results may span currencies, or price comparisons are meaningless.',
  },
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 40 },
  format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
};

// ── tools ─────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_hotels',
    description:
      'Search bookable Marriott properties near a destination for a date range, with live prices. ' +
      'Returns a table ranked as asked, with the cheapest, best-value and highest-tier options called out. ' +
      'Prices are all-in per night (mandatory fees included) unless the property reports otherwise. ' +
      'On a stay longer than one night every per-night figure is the average across the whole stay, so a ' +
      'single expensive night raises all of them: check individual nights before calling a date range dear.',
    inputSchema: {
      type: 'object',
      required: ['destination'],
      properties: {
        destination: {
          type: 'string',
          description: 'Free text, e.g. "Istanbul, Turkey", "Lake Como", "Manhattan". Resolved through Marriott\'s own place suggester.',
        },
        check_in: { type: 'string', description: 'YYYY-MM-DD. Defaults to 30 days out.' },
        check_out: { type: 'string', description: 'YYYY-MM-DD. Defaults to check_in + nights.' },
        nights: { type: 'integer', minimum: 1, default: 1, description: 'Used when check_out is omitted.' },
        ...STAY_PROPS,
        offset: { type: 'integer', minimum: 0, default: 0, description: 'Pagination offset.' },
        sort: {
          type: 'string',
          enum: ['DISTANCE', 'POINTS', 'CITY', 'BRAND', 'PROPERTY_NAME'],
          default: 'DISTANCE',
          description: 'How Marriott sorts the underlying result set.',
        },
        descending: { type: 'boolean', default: false },
        order_by: {
          type: 'string',
          enum: ['price', 'value', 'tier', 'rating'],
          description:
            'How the returned table is ordered. "value" ranks by all-in price per brand-tier point — the best quality-for-money.',
        },
      },
    },
    handler: async (session, args) => {
      const { startDate, endDate } = resolveDates(args);
      return session.run(async (mi) => {
        const { place, geo } = await geoArgsFor(mi, args);
        const conn = await mi.searchByGeo({
          ...geo,
          startDate,
          endDate,
          offset: Number(args.offset ?? 0),
          sort: [
            {
              field: String(args.sort ?? 'DISTANCE').toUpperCase(),
              direction: args.descending ? 'DESC' : 'ASC',
            },
          ],
        });

        const rows = toRows(conn);
        // Must run before anything compares prices, or mixed-currency results rank wrong.
        const fx = await mi.normaliseCurrencies(
          rows,
          args.currency ? String(args.currency).toUpperCase() : null,
        );
        score(rows);
        sortRows(rows, args.order_by);

        if (args.format === 'json') {
          return JSON.stringify(
            { destination: place.description, startDate, endDate, total: conn.total, fx, rows },
            null,
            2,
          );
        }
        const label = [
          place.description,
          `${startDate} → ${endDate}`,
          `${args.adults ?? 1} adult(s)`,
          rateLabelFor(args, activeCode(args)),
        ].join(' · ');
        const table = resultsTable(rows, {
          total: conn.total,
          label,
          code: activeCode(args),
          nights: Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000),
        });
        return fx.converted
          ? `${table}\nConverted ${fx.converted} result(s) from ${fx.from.join(', ')} to ${fx.currency}.`
          : table;
      });
    },
  },

  {
    name: 'scan_dates',
    description:
      'Run the same search across consecutive check-in dates to find which day is cheapest. ' +
      'One row per date with that date\'s cheapest and best-value property. Dates with no availability are shown, not dropped.',
    inputSchema: {
      type: 'object',
      required: ['destination', 'start_date'],
      properties: {
        destination: { type: 'string' },
        start_date: { type: 'string', description: 'First check-in date, YYYY-MM-DD.' },
        days: { type: 'integer', minimum: 2, maximum: 14, default: 5, description: 'How many consecutive check-in dates to compare.' },
        nights: { type: 'integer', minimum: 1, default: 1, description: 'Stay length at each date.' },
        ...STAY_PROPS,
      },
    },
    handler: async (session, args) => {
      const start = String(args.start_date);
      if (!isDate(start)) throw new Error(`start_date must be YYYY-MM-DD, got "${start}"`);
      const n = Math.min(14, Math.max(2, Number(args.days ?? 5)));
      const nights = Number(args.nights ?? 1);
      const target = args.currency ? String(args.currency).toUpperCase() : null;

      return session.run(async (mi) => {
        const { place, geo } = await geoArgsFor(mi, args);
        const days = [];
        for (let i = 0; i < n; i++) {
          const s = addDays(start, i);
          const e = addDays(s, nights);
          const conn = await mi.searchByGeo({ ...geo, startDate: s, endDate: e });
          const rows = toRows(conn);
          await mi.normaliseCurrencies(rows, target);
          score(rows);
          days.push({
            date: s,
            weekday: new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
              weekday: 'short',
              timeZone: 'UTC',
            }),
            rows,
            total: conn.total,
          });
        }
        if (args.format === 'json') return JSON.stringify({ destination: place.description, days }, null, 2);
        return scanTable(days, {
          label: `${place.description} · ${nights} night(s) · ${rateLabelFor(args, activeCode(args))}`,
          code: activeCode(args),
          nights,
        });
      });
    },
  },

  {
    name: 'plan_stay',
    description:
      'Find the cheapest way to cover a multi-night stay in one city by moving between hotels on the nights ' +
      'where somewhere else is much cheaper. Returns the hotel-by-hotel itinerary with dates and a total. ' +
      'Prefers staying put: it only moves you when the saving beats `tolerance` (default 10%) of the night\'s price, ' +
      'so you get the price of hopping without moving every night. Also reports what one hotel for the whole stay would cost.',
    inputSchema: {
      type: 'object',
      required: ['destination', 'check_in', 'nights'],
      properties: {
        destination: { type: 'string' },
        check_in: { type: 'string', description: 'First night, YYYY-MM-DD.' },
        nights: { type: 'integer', minimum: 2, maximum: 21, description: 'Total nights to cover.' },
        tolerance: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          default: 0.1,
          description:
            'How much cheaper another hotel must be before moving is worth it, as a fraction of that night\'s price. ' +
            '0.1 means "stay put unless moving saves more than 10%". 0 chases the cheapest room every night.',
        },
        verify: {
          type: 'boolean',
          default: true,
          description:
            'Re-price each multi-night block as the booking you would actually make. The plan is built from one-night ' +
            'prices, and length-of-stay pricing means a 2-night rate is not always the sum of its nights.',
        },
        ...STAY_PROPS,
      },
    },
    handler: async (session, args) => {
      const start = String(args.check_in);
      if (!isDate(start)) throw new Error(`check_in must be YYYY-MM-DD, got "${start}"`);
      const nights = Number(args.nights);
      if (!(nights >= 2)) throw new Error('nights must be at least 2 — use search_hotels for one night');
      const currency = args.currency ? String(args.currency).toUpperCase() : null;
      const tolerance = args.tolerance != null ? Number(args.tolerance) : 0.1;

      return session.run(async (mi) => {
        const { place, geo } = await geoArgsFor(mi, args);
        const days = await collectNights(mi, geo, { startDate: start, nights, currency });
        const plan = planStay(days, { tolerance });

        if (plan.ok && args.verify !== false) {
          plan.verification = await verifyBlocks(mi, geo, plan.blocks, { currency });
        }
        if (args.format === 'json') {
          return JSON.stringify({ destination: place.description, ...plan }, null, 2);
        }
        return planTable(plan, {
          label: `${place.description} · ${nights} nights from ${start} · ` +
            rateLabelFor(args, activeCode(args)),
        });
      });
    },
  },

  {
    name: 'suggest_places',
    description:
      'Resolve free text to Marriott destinations. Use this when a destination is ambiguous, or to confirm which place a search actually landed on.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', description: 'Partial place name, e.g. "Como".' } },
    },
    handler: (session, args) =>
      session.run(async (mi) => {
        const places = await mi.suggestPlaces(String(args.query));
        if (!places.length) return `No destination matched "${args.query}".`;
        return places.map((p) => `- ${p.description}  \`${p.placeId}\``).join('\n');
      }),
  },

  {
    name: 'brand_tiers',
    description:
      "This tool's own quality ranking of every Marriott brand, on an SS-to-F ladder graded across the whole portfolio. " +
      'Static reference data — answers instantly and needs no browser. Use it to pick brand codes for a search, or to explain why a property is graded as it is. ' +
      "These grades are editorial, not Marriott's own classification.",
    inputSchema: {
      type: 'object',
      properties: {
        segment: {
          type: 'string',
          description: 'Filter by segment, e.g. "Luxury", "Premium", "Select", "Longer Stays", "Collection".',
        },
        query: { type: 'string', description: 'Substring match on brand name or code.' },
        why: { type: 'boolean', default: false, description: 'Include the one-line rationale for each grade.' },
      },
    },
    handler: async (_session, args) => {
      const seg = args.segment ? String(args.segment).toLowerCase() : null;
      const q = args.query ? String(args.query).toLowerCase() : null;
      const rows = Object.entries(BRANDS)
        .map(([code, b]) => ({ code, ...b }))
        .filter((b) => !seg || (b.segment ?? '').toLowerCase().includes(seg))
        .filter((b) => !q || b.name.toLowerCase().includes(q) || b.code.toLowerCase() === q)
        .sort((a, b) => a.rank - b.rank);
      if (!rows.length) return 'No brands matched.';

      const out = [`Ladder, best to worst: ${TIERS.join(' > ')}`, ''];
      out.push('| # | Grade | Code | Brand | Segment |' + (args.why ? ' Why |' : ''));
      out.push('|---:|---|---|---|---|' + (args.why ? '---|' : ''));
      for (const b of rows) {
        out.push(
          `| ${b.rank} | ${b.grade} | ${b.code} | ${b.name}${b.variable ? ' *' : ''} | ${b.segment} |` +
            (args.why ? ` ${b.why} |` : ''),
        );
      }
      out.push('', '`*` soft brand or collection — quality varies a lot between properties.');
      return out.join('\n');
    },
  },

  {
    name: 'session_status',
    description:
      'Report whether the Chrome session is up and whether Marriott is serving it real pages rather than an Akamai challenge. Use this to diagnose failing searches.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (session) => {
      // Preferences are reported here so it is obvious when a stored code is silently
      // being applied to every search. Masked: the code stays out of the transcript.
      const prefs = loadPrefs();
      const names = Object.keys(prefs.codes ?? {});
      const prefLines = [
        `Preferences: ${CONFIG_PATH}`,
        `  default code: ${prefs.code ? `${maskCode(prefs.code)} (applied unless a call overrides it)` : 'none'}`,
        `  saved code names: ${names.length ? names.join(', ') : 'none'}`,
      ];
      const s = await session.status();
      if (!s.live) {
        return [
          s.starting
            ? 'Chrome is starting and clearing the Akamai challenge. Give it up to a minute.'
            : 'Chrome is not running. It starts automatically on the first search, which costs 30-60s of Akamai warm-up.',
          '',
          ...prefLines,
        ].join('\n');
      }
      return [
        `Chrome: up`,
        `Marriott serving real pages: ${s.real ? 'yes' : 'NO — challenged or blocked'}`,
        `GraphQL operations known: ${s.operations}`,
        `buildId: ${s.buildId ?? 'unknown'}`,
        '',
        ...prefLines,
      ].join('\n');
    },
  },

  {
    name: 'graphql_raw',
    description:
      'Call any safelisted Marriott GraphQL operation directly and return the raw JSON. Escape hatch for operations the other tools do not cover. ' +
      'Operation names and their variable shapes are documented in research/02-search-operations.md and research/03-operation-signatures.md.',
    inputSchema: {
      type: 'object',
      required: ['operation'],
      properties: {
        operation: { type: 'string', description: 'e.g. phoenixShopDatedSearchByGeoQuery' },
        variables: { type: 'object', description: 'GraphQL variables.', default: {} },
        app: { type: 'string', enum: ['shop', 'phoenix'], default: 'shop' },
      },
    },
    handler: (session, args) =>
      session.run(async (mi) => {
        const data = await mi.call(String(args.operation), args.variables ?? {}, {
          app: String(args.app ?? 'shop'),
        });
        return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
      }),
  },
];

// ── JSON-RPC plumbing ─────────────────────────────────────────────────────────

const INSTRUCTIONS = `
Live Marriott hotel search, driven through a real Chrome session against Marriott's own
GraphQL API. Prices are live and move between runs.

- The first tool call starts Chrome and waits out Akamai's bot challenge; it can take
  30-60 seconds. Later calls reuse the session and are fast.
- Set \`currency\` whenever a search may span currencies. Without it, prices in different
  currencies are compared as bare numbers and the "cheapest" badge is meaningless.
- A multi-night search reports the average per night, not the price of each night. One
  spike night lifts the whole figure. Before concluding a week is expensive, price single
  nights across it: the average hides which nights actually carry the cost.
- A cluster code that does not apply comes back silently as the ordinary standard rate.
  Rows where that happened are marked \`!\`. That means "code unavailable here", not a
  price, and comparing it against other dates as if it were one is a mistake.
- \`order_by: "value"\` ranks by all-in price per brand-tier point, which is usually what
  someone means by "the best deal".
- Tier grades come from this tool's own editorial ranking, not from Marriott. Say so when
  presenting them.
- If searches fail, call session_status before retrying. Repeated retries against an
  Akamai challenge escalate it into a hard block.

Model tiering. These tools differ a lot in how much reasoning their output needs, so do
not spend a frontier model on all of them. Where you can pick a model or delegate to a
subagent:

- Smallest model: brand_tiers, suggest_places, session_status. Static reference data, a
  name lookup and a health check. No browser, no interpretation, the answer is the
  response.
- Small model is enough to run search_hotels or scan_dates and relay the table as-is.
  These already return a formatted, ranked result with the cheapest and best-value rows
  called out, so a plain "what is cheapest" question needs no more than that.
- Step up when the question is about *why* the numbers look the way they do: comparing
  runs, reconciling a rate code against the standard rate, spotting that a price is
  implausible, or reasoning across currencies. That is judgement, not retrieval.
- Largest model: plan_stay and graphql_raw. plan_stay emits a multi-hotel itinerary whose
  per-night prices come from single-night searches and do not always survive as a real
  booking, so its output has to be checked against a direct search before you present it.
  graphql_raw is an unguarded escape hatch against a live API.

The server cannot enforce any of this, it is advice to whoever is holding the tools.
`.trim();

export function serve(opts = {}) {
  const session = new Session(opts);
  const tools = new Map(TOOLS.map((t) => [t.name, t]));
  const log = (...a) => opts.verbose && console.error('[mcp]', ...a);

  const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

  async function dispatch(msg) {
    const { id, method, params } = msg;
    // Notifications carry no id and must never be answered.
    const isNotification = id === undefined || id === null;

    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        return reply(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'marriott', version: '0.1.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(
          id,
          { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
        );
      case 'tools/call': {
        const tool = tools.get(params?.name);
        if (!tool) return fail(id, -32602, `Unknown tool "${params?.name}"`);
        log(`call ${tool.name}`);
        try {
          const text = await tool.handler(session, params?.arguments ?? {});
          return reply(id, { content: [{ type: 'text', text: String(text) }] });
        } catch (err) {
          // Tool failures are results, not protocol errors: the model should see the
          // message (Akamai guidance in particular) and decide what to do about it.
          log(`call ${tool.name} failed: ${err.message}`);
          return reply(id, {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
          });
        }
      }
      default:
        if (isNotification) return;
        return fail(id, -32601, `Method not found: ${method}`);
    }
  }

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const raw = line.trim();
    if (!raw) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail(null, -32700, 'Parse error');
    }
    // A batch is a JSON array of requests; answer each one independently.
    const msgs = Array.isArray(msg) ? msg : [msg];
    for (const m of msgs) {
      dispatch(m).catch((err) => {
        log(`dispatch failed: ${err.stack ?? err.message}`);
        if (m?.id != null) fail(m.id, -32603, err.message);
      });
    }
  });

  const shutdown = async () => {
    await session.close();
    process.exit(0);
  };
  rl.on('close', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log('listening on stdio');
}

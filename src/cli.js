import { Browser } from './cdp.js';
import {
  MarriottClient,
  RATE_TYPES,
  clusterRate,
  toRows,
  openWarmed,
  isRealPage,
  WARMUP_URL,
  DEFAULT_RADIUS_M,
  BRAND_ANCHORS,
} from './marriott.js';
import {
  CONFIG_PATH,
  loadPrefs,
  savePrefs,
  setPref,
  unsetPref,
  describePrefs,
  resolveCode,
  maskCode,
  prefKeys,
} from './prefs.js';
import { gradeFor, tierRank, tierColour } from './brands.js';
import { renderResults, renderScan, tierScore } from './render.js';
import { planStay, planTable, collectNights, verifyBlocks } from './itinerary.js';

const USAGE = `
marriott — hotel search from the terminal, via Marriott's Phoenix GraphQL API

USAGE
  marriott warmup                        <- run this first, once
  marriott search <destination> [options]
  marriott plan <destination> --in <date> --nights <n>   <- cheapest hotel-hopping path
  marriott config [set|unset|keys|path] <- your own defaults, incl. corporate codes
  marriott places <query>
  marriott raw <operationName> --vars '<json>'
  marriott ops [--grep <substr>]
  marriott debug                         <- show what page Marriott is actually serving

SEARCH OPTIONS
  --in <YYYY-MM-DD>     check-in date        (default: today + 30)
  --out <YYYY-MM-DD>    check-out date       (default: check-in + 1)
  --nights <n>          instead of --out
  --adults <n>          guests               (default 1)
  --rooms <n>           rooms                (default 1)
  --rate <kind>         standard | aaa | gov | senior | points   (default standard)
  --code <CODE|name>    corporate/promo cluster code, or a name saved under
                        config codes.<name>             (implies CLUSTER rate)
  --no-code             ignore a code stored in config for this run
  --amenities <a,b>     e.g. pool,pet-friendly,fitness-center
  --brands <a,b>        brand codes, e.g. RZ,AK,WH
  --radius <km>         search radius        (default 80.5 km / 50 mi)
  --sort <field>        DISTANCE | POINTS | CITY | BRAND | PROPERTY_NAME
  --desc                sort descending
  --limit <n>           max results          (default 40)
  --offset <n>          pagination offset
  --by <how>            display order: price | value | tier | rating
  --scan <n>            compare n consecutive check-in dates from --in
  --currency <ISO>      normalise all prices to one currency, e.g. USD

PLAN OPTIONS  (marriott plan)
  --nights <n>          total nights to cover (required, >= 2)
  --tolerance <f>       how much cheaper a move must be to be worth it (default 0.1)
  --no-verify           skip re-pricing multi-night blocks as real bookings

GLOBAL OPTIONS
  --json                raw JSON output
  --reveal              print codes in full instead of masked
  --hidden              real Chrome, parked off-screen — use this to avoid the popup
  --headless            DOES NOT WORK: Akamai denies headless outright. Kept for testing
  --attach <port>       use a Chrome already running with --remote-debugging-port
  --refresh-signatures  re-scrape the GraphQL operation safelist
  --verbose             log what it is doing
  -h, --help

PREFERENCES  (~/.marriott-mcp/config.json — never in the repo)
  marriott config set code <CODE>          apply this code to every search
  marriott config set codes.work <CODE>    save it under a name instead
  marriott config set currency EUR         defaults for --currency/--adults/--rooms/...
  marriott config                          show what is set (codes masked)
  marriott config keys                     everything you can set
  Precedence: --code  >  MARRIOTT_CODE  >  config

EXAMPLES
  marriott search "Barcelona, Spain" --in 2026-10-15 --nights 3 --adults 2
  marriott search "Tokyo" --code work --sort DISTANCE
  marriott search "Lisbon" --rate points --amenities pool
  marriott places "Barc"
  marriott plan "Rome, Italy" --in 2026-11-01 --nights 5 --currency EUR
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      const isFlag =
        next === undefined ||
        (next.startsWith('--') &&
          // allow negative numbers, but treat --foo --bar as two flags
          Number.isNaN(Number(next)));
      if (isFlag) opts[key] = true;
      else {
        opts[key] = next;
        i++;
      }
    } else opts._.push(a);
  }
  return opts;
}

const iso = (d) => d.toISOString().slice(0, 10);

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

function resolveDates(opts) {
  const today = new Date();
  const start = opts.in ?? addDays(iso(today), 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error(`--in must be YYYY-MM-DD, got "${start}"`);
  }
  let end = opts.out;
  if (!end) end = addDays(start, opts.nights ? Number(opts.nights) : 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error(`--out must be YYYY-MM-DD, got "${end}"`);
  }
  if (end <= start) throw new Error('check-out must be after check-in');
  return { startDate: start, endDate: end };
}

function rateTypesFor(opts) {
  // opts.__code is resolved once in main(): --code, then MARRIOTT_CODE, then the
  // config file. Nothing here knows about any particular code.
  if (opts.__code) return clusterRate(opts.__code);
  const kind = String(opts.rate ?? 'standard').toLowerCase();
  if (!RATE_TYPES[kind]) {
    throw new Error(`--rate must be one of: ${Object.keys(RATE_TYPES).join(', ')}`);
  }
  return RATE_TYPES[kind];
}

/**
 * What every result header says it priced. A code is masked unless --reveal, so
 * pasting your terminal somewhere does not hand over your corporate code.
 */
function rateLabel(opts) {
  if (!opts.__code) return `rate ${opts.rate ?? 'standard'}`;
  const shown = opts.reveal ? opts.__code : maskCode(opts.__code);
  return `code ${shown}${opts.__codeSource === 'config' ? ' (config)' : ''}`;
}

/** Config-file values stand in for flags the user did not type. */
function applyPrefDefaults(opts, prefs) {
  for (const key of ['currency', 'adults', 'rooms', 'rate', 'tolerance']) {
    if (opts[key] === undefined && prefs[key] !== undefined) opts[key] = prefs[key];
  }
  return opts;
}

const csv = (v) =>
  typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

function renderTable(rows, meta) {
  if (!rows.length) {
    console.log('No available properties for those dates and filters.');
    return;
  }
  const fmt = (v, cur) =>
    v == null ? '—' : `${v.toFixed(v < 100 ? 2 : 0)} ${cur}`.trim();
  const cols = [
    ['TIER', (r) => (r.grade ?? '?') + (r.gradeVaries ? '*' : ''), 5],
    ['HOTEL', (r) => r.name, 38],
    ['BRAND', (r) => r.brand, 19],
    ['DIST', (r) => (r.distanceKm == null ? '—' : `${r.distanceKm}km`), 7],
    ['RATING', (r) => (r.rating == null ? '—' : `${r.rating}`), 6],
    ['/NIGHT', (r) => fmt(r.price, r.currency), 11],
    ['+TAX', (r) => fmt(r.totalPerNight, r.currency), 11],
  ];
  const clip = (s, w) => (s.length > w ? `${s.slice(0, w - 1)}…` : s.padEnd(w));
  console.log(cols.map(([h, , w]) => clip(h, w)).join(' '));
  console.log(cols.map(([, , w]) => '─'.repeat(w)).join(' '));
  for (const r of rows) {
    const paint = tierColour(r.grade);
    console.log(
      cols
        .map(([h, fn, w], i) => {
          const cell = clip(String(fn(r) ?? ''), w);
          return i === 0 ? paint(cell) : cell;
        })
        .join(' '),
    );
  }
  if (rows.some((r) => r.gradeVaries)) {
    console.log('\n* soft brand / collection — quality varies a lot by property');
  }
  console.log(
    `\n${rows.length} shown of ${meta.total ?? rows.length} · ${meta.label}`,
  );
}

/**
 * `marriott config …` — read and write ~/.marriott-mcp/config.json.
 *
 * This exists so a corporate/promo code never has to be typed on every search and is
 * never committed anywhere. The repo ships no codes; you bring your own.
 */
function configCommand(opts, prefs) {
  const sub = opts._[1] ?? 'list';

  if (sub === 'path') {
    console.log(CONFIG_PATH);
    return 0;
  }

  if (sub === 'keys') {
    const keys = prefKeys();
    const w = Math.max(...keys.map(([k]) => k.length));
    for (const [k, describe] of keys) console.log(`  ${k.padEnd(w)}  ${describe}`);
    return 0;
  }

  if (sub === 'list' || sub === 'get' || sub === 'show') {
    if (opts.json) {
      console.log(JSON.stringify(prefs, null, 2));
      return 0;
    }
    const lines = describePrefs(prefs, { reveal: !!opts.reveal });
    if (!lines.length) {
      console.log(`No preferences set yet (${CONFIG_PATH}).

Set a default corporate/promo code:
  marriott config set code <YOUR_CODE>

Or keep several under names and pick one per search:
  marriott config set codes.work <YOUR_CODE>
  marriott search "Tokyo" --code work

  marriott config keys      # everything you can set`);
      return 0;
    }
    console.log(CONFIG_PATH);
    const w = Math.max(...lines.map(([k]) => k.length));
    for (const [k, v] of lines) console.log(`  ${k.padEnd(w)}  ${v}`);
    if (!opts.reveal && lines.some(([k]) => k === 'code' || k.startsWith('codes.'))) {
      console.log('\nCodes are masked. Pass --reveal to print them in full.');
    }
    return 0;
  }

  if (sub === 'set') {
    const key = opts._[2];
    const value = opts._.slice(3).join(' ');
    if (!key || !value) {
      throw new Error('usage: marriott config set <key> <value>   (see `marriott config keys`)');
    }
    savePrefs(setPref(prefs, key, value));
    console.log(`${key} set in ${CONFIG_PATH}`);
    return 0;
  }

  if (sub === 'unset') {
    const key = opts._[2];
    if (!key) throw new Error('usage: marriott config unset <key>');
    savePrefs(unsetPref(prefs, key));
    console.log(`${key} removed from ${CONFIG_PATH}`);
    return 0;
  }

  throw new Error(`unknown config subcommand "${sub}". Try: list, set, unset, keys, path`);
}

export async function main(argv) {
  const opts = parseArgs(argv);
  const cmd = opts._[0];

  if (opts.help || !cmd) {
    console.log(USAGE.trim());
    return 0;
  }

  const prefs = loadPrefs();

  // `config` touches only the preferences file, so it runs before Chrome is involved.
  if (cmd === 'config') {
    return configCommand(opts, prefs);
  }

  // Resolve the cluster code once, here, so every command agrees on it. Note that an
  // explicitly typed --rate wins over a code that came from the config file: the two are
  // mutually exclusive, and what you asked for on the line should beat a stored default.
  const resolved = resolveCode({
    code: opts.code,
    noCode: !!opts['no-code'],
    explicitRate: opts.rate !== undefined,
    prefs,
  });
  opts.__code = resolved.code;
  opts.__codeSource = resolved.source;
  applyPrefDefaults(opts, prefs);

  const browser = new Browser({
    headless: !!opts.headless,
    hidden: !!opts.hidden,
    port: opts.attach ? Number(opts.attach) : null,
    verbose: !!opts.verbose,
  });

  try {
    await browser.start();

    // `warmup` is the human-in-the-loop escape from Akamai's first-contact challenge.
    // A cold profile gets challenged; a person browsing normally clears it in seconds,
    // and the cookies persist in the profile for every later run.
    if (cmd === 'warmup') {
      await browser.openPage('https://www.marriott.com/');
      console.log(`
A Chrome window is open on marriott.com using this tool's own profile
(~/.marriott-mcp/chrome-profile — not your everyday browser).

Please, in that window:
  1. Accept the cookie banner if one appears.
  2. Click around for ~30 seconds. Run one hotel search by hand.
  3. Make sure you can see real content, not "Access Denied".

That teaches Akamai this profile is a person. The cookies persist, so you
should only need to do this once (occasionally again if it goes stale).

Press Enter here when done…`);
      await new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.once('data', () => {
          process.stdin.pause();
          resolve();
        });
      });
      await browser.navigate(WARMUP_URL);
      const ok = await isRealPage(browser);
      console.log(
        ok
          ? '\n✓ Warm. Marriott is serving real pages to this profile — try `marriott search …`'
          : '\n✗ Still blocked. Wait a while before retrying; see research/05-access-and-blocking.md',
      );
      return ok ? 0 : 1;
    }

    if (cmd === 'debug') {
      await browser.openPage(WARMUP_URL);
      // Akamai's challenge shell runs sensor JS and may resolve itself. Watching costs
      // nothing extra; reloading at it is what escalates a challenge into a block.
      const waitS = opts.wait ? Number(opts.wait) : 0;
      if (waitS > 0) {
        console.error(`[debug] observing for ${waitS}s without reloading…`);
        for (let t = 0; t < waitS; t += 5) {
          await new Promise((r) => setTimeout(r, 5000));
          const s = await browser.evaluate(`(() => ({
            real: !!document.getElementById('__NEXT_DATA__'),
            bytes: document.documentElement.outerHTML.length,
            href: location.href,
          }))()`).catch(() => null);
          console.error(
            `[debug]  +${t + 5}s  ${s ? `${s.bytes} bytes  real=${s.real}` : 'context churn (navigating)'}`,
          );
          if (s?.real) break;
        }
      }
    }
    else await openWarmed(browser, WARMUP_URL, { verbose: !!opts.verbose });

    // `debug` runs before signature loading, since diagnosing a blocked or unexpected
    // page is exactly the case where signature loading is what failed.
    if (cmd === 'debug') {
      const info = await browser.evaluate(`(() => {
        const nd = document.getElementById('__NEXT_DATA__');
        let parsed = null;
        try { parsed = nd ? JSON.parse(nd.textContent) : null; } catch {}
        return {
          url: location.href,
          title: document.title,
          hasNextData: !!nd,
          nextDataBytes: nd ? nd.textContent.length : 0,
          page: parsed?.page ?? null,
          buildId: parsed?.buildId ?? null,
          operationSignatureCount: parsed?.props?.pageProps?.operationSignatures?.length ?? 0,
          pagePropsKeys: Object.keys(parsed?.props?.pageProps ?? {}).slice(0, 60),
          sigLikeKeys: Object.keys(parsed?.props?.pageProps ?? {}).filter((k) =>
            /sig|operation|graphql|query/i.test(k),
          ),
          scriptIds: [...document.querySelectorAll('script[id]')].map((s) => s.id),
          bodyStart: document.body ? document.body.innerText.slice(0, 400) : null,
          htmlBytes: document.documentElement?.outerHTML.length ?? 0,
          htmlStart: document.documentElement?.outerHTML.slice(0, 400) ?? null,
          readyState: document.readyState,
        };
      })()`);
      console.log(JSON.stringify(info, null, 2));
      return 0;
    }

    const mi = new MarriottClient(browser, { verbose: !!opts.verbose });
    await mi.loadSignatures({ refresh: !!opts['refresh-signatures'] });

    if (cmd === 'ops') {
      const needle = opts.grep ? String(opts.grep).toLowerCase() : null;
      const names = [...mi.signatures.entries()]
        .filter(([n]) => !needle || n.toLowerCase().includes(needle))
        .sort(([a], [b]) => a.localeCompare(b));
      if (opts.json) console.log(JSON.stringify(Object.fromEntries(names), null, 2));
      else {
        for (const [n, s] of names) console.log(`${n}\n  ${s}`);
        console.log(`\n${names.length} operations · buildId ${mi.buildId ?? '?'}`);
      }
      return 0;
    }

    if (cmd === 'brands') {
      // Facets are computed over the entire result set, so a few wide searches across
      // continents surface nearly every brand without paging through properties.
      const start = addDays(iso(new Date()), 30);
      const found = new Map();
      for (const a of BRAND_ANCHORS) {
        try {
          const conn = await mi.searchByGeo({
            latitude: a.latitude,
            longitude: a.longitude,
            distance: 200000,
            startDate: start,
            endDate: addDays(start, 1),
            limit: 1,
            includeUnavailable: true,
          });
          const facet = (conn.facets ?? []).find((f) => f.type?.code === 'brands');
          for (const b of facet?.buckets ?? []) {
            const prev = found.get(b.code);
            found.set(b.code, {
              code: b.code,
              label: b.label,
              count: (prev?.count ?? 0) + (b.count ?? 0),
            });
          }
          if (opts.verbose) {
            console.error(`[brands] ${a.name}: ${found.size} distinct so far`);
          }
        } catch (e) {
          console.error(`[brands] ${a.name} failed: ${e.message}`);
        }
      }

      const rows = [...found.values()]
        .map((b) => ({ ...b, ...gradeFor(b.code, b.label) }))
        .sort((x, y) => (x.rank ?? 999) - (y.rank ?? 999));

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        console.log(' #   GRADE  CODE  BRAND                                  SEGMENT');
        console.log('───  ─────  ────  ─────────────────────────────────────  ────────────');
        for (const r of rows) {
          const paint = tierColour(r.grade);
          console.log(
            String(r.rank ?? '?').padStart(3),
            ' ' + paint((r.grade ?? '?').padEnd(5)),
            ' ' + r.code.padEnd(4),
            // Show Marriott's OWN label, not our table's name. Printing our name here
            // once masked BR/BG being swapped (BR is Renaissance, BG is Bvlgari).
            ' ' + (r.label ?? r.name ?? '').slice(0, 37).padEnd(37),
            (r.segment ?? '—') + (r.variable ? ' *' : ''),
          );
        }
        const mismatched = rows.filter(
          (r) =>
            r.grade &&
            r.label &&
            r.name &&
            r.label.toLowerCase().replace(/[^a-z]/g, '') !==
              r.name.toLowerCase().replace(/[^a-z]/g, ''),
        );
        if (mismatched.length) {
          console.log('\n⚠ name mismatch vs src/brands.js (check the code mapping):');
          for (const r of mismatched) {
            console.log(`   ${r.code}: Marriott says "${r.label}", table says "${r.name}"`);
          }
        }
        if (opts.why) {
          console.log('\nRATIONALE');
          for (const r of rows.filter((x) => x.why)) {
            console.log(`\n${r.rank}. ${r.name} (${r.grade})\n   ${r.why}`);
          }
        }
        const ungraded = rows.filter((r) => !r.grade);
        console.log(`\n${rows.length} brands seen across ${BRAND_ANCHORS.length} regions`);
        if (ungraded.length) {
          console.log(
            `⚠ ungraded (add to src/brands.js): ${ungraded.map((r) => `${r.code}=${r.label}`).join(', ')}`,
          );
        }
      }
      return 0;
    }

    if (cmd === 'places') {
      const q = opts._.slice(1).join(' ');
      if (!q) throw new Error('places needs a query, e.g. marriott places "Barc"');
      const places = await mi.suggestPlaces(q);
      if (opts.json) console.log(JSON.stringify(places, null, 2));
      else
        for (const p of places) console.log(`${p.placeId}  ${p.description}`);
      return 0;
    }

    if (cmd === 'raw') {
      const op = opts._[1];
      if (!op) throw new Error('raw needs an operation name');
      const vars = opts.vars ? JSON.parse(String(opts.vars)) : {};
      const data = await mi.call(op, vars, { app: opts.app ? String(opts.app) : 'shop' });
      console.log(JSON.stringify(data, null, 2));
      return 0;
    }

    if (cmd === 'plan') {
      const destination = opts._.slice(1).join(' ');
      if (!destination) throw new Error('plan needs a destination');
      const nights = Number(opts.nights);
      if (!(nights >= 2)) throw new Error('plan needs --nights >= 2');
      const start = opts.in ?? addDays(iso(new Date()), 30);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        throw new Error(`--in must be YYYY-MM-DD, got "${start}"`);
      }
      const currency = opts.currency ? String(opts.currency).toUpperCase() : null;
      const tolerance = opts.tolerance != null && opts.tolerance !== true
        ? Number(opts.tolerance)
        : 0.1;

      const { place, details } = await mi.resolveDestination(destination);
      const geo = {
        latitude: details.location.latitude,
        longitude: details.location.longitude,
        distance: opts.radius ? Number(opts.radius) * 1000 : (details.distance ?? DEFAULT_RADIUS_M),
        adults: Number(opts.adults ?? 1),
        rooms: Number(opts.rooms ?? 1),
        rateRequestTypes: rateTypesFor(opts),
        amenities: csv(opts.amenities),
        brands: csv(opts.brands),
        limit: Number(opts.limit ?? 60),
        city: details.location.city ?? '',
        state: details.location.state ?? '',
        country: details.location.country ?? '',
        destinationType: (details.destinationType ?? 'City').toUpperCase(),
      };

      const days = await collectNights(mi, geo, {
        startDate: start,
        nights,
        currency,
        onNight: (d, n) => opts.verbose && console.error(`[plan] ${d}: ${n} priced`),
      });
      const plan = planStay(days, { tolerance });
      if (plan.ok && !opts['no-verify']) {
        plan.verification = await verifyBlocks(mi, geo, plan.blocks, { currency });
      }

      if (opts.json) {
        console.log(JSON.stringify({ destination: place.description, ...plan }, null, 2));
      } else {
        console.log(
          planTable(plan, {
            label: `${place.description} · ${nights} nights from ${start} · ` +
              rateLabel(opts),
          }),
        );
      }
      return plan.ok ? 0 : 1;
    }

    if (cmd === 'search') {
      const destination = opts._.slice(1).join(' ');
      if (!destination) throw new Error('search needs a destination');

      const { startDate, endDate } = resolveDates(opts);
      const rateRequestTypes = rateTypesFor(opts);

      const { place, details } = await mi.resolveDestination(destination);
      const geoArgs = {
        latitude: details.location.latitude,
        longitude: details.location.longitude,
        distance: opts.radius ? Number(opts.radius) * 1000 : (details.distance ?? DEFAULT_RADIUS_M),
        adults: Number(opts.adults ?? 1),
        rooms: Number(opts.rooms ?? 1),
        rateRequestTypes,
        amenities: csv(opts.amenities),
        brands: csv(opts.brands),
        limit: Number(opts.limit ?? 40),
        city: details.location.city ?? '',
        state: details.location.state ?? '',
        country: details.location.country ?? '',
        destinationType: (details.destinationType ?? 'City').toUpperCase(),
      };
      const target = opts.currency ? String(opts.currency).toUpperCase() : null;
      const prep = async (conn) => {
        const rs = toRows(conn);
        await mi.normaliseCurrencies(rs, target);
        for (const r of rs) {
          r.tierScore = tierScore(r.grade);
          r.eurPerTier =
            r.totalPerNight != null && r.tierScore > 0 ? r.totalPerNight / r.tierScore : null;
        }
        return rs;
      };

      // --scan N: same search across N consecutive check-in dates, one browser session.
      if (opts.scan) {
        const n = Math.min(14, Math.max(2, Number(opts.scan) || 5));
        const nights = Number(opts.nights ?? 1);
        const days = [];
        for (let i = 0; i < n; i++) {
          const s = addDays(startDate, i);
          const e = addDays(s, nights);
          if (opts.verbose) console.error(`[scan] ${s} → ${e}`);
          const conn = await mi.searchByGeo({ ...geoArgs, startDate: s, endDate: e });
          days.push({
            date: s,
            weekday: new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
              weekday: 'short',
              timeZone: 'UTC',
            }),
            rows: await prep(conn),
            total: conn.total,
          });
        }
        if (opts.json) {
          console.log(JSON.stringify(days, null, 2));
        } else {
          renderScan(days, {
            label: `${place.description} · ${nights} night · ${rateLabel(opts)}`,
          });
        }
        return 0;
      }

      if (opts.verbose) {
        console.error(`[marriott] resolved "${destination}" -> ${place.description}`);
      }

      const conn = await mi.searchByGeo({
        latitude: details.location.latitude,
        longitude: details.location.longitude,
        distance: opts.radius ? Number(opts.radius) * 1000 : (details.distance ?? DEFAULT_RADIUS_M),
        startDate,
        endDate,
        adults: Number(opts.adults ?? 1),
        rooms: Number(opts.rooms ?? 1),
        rateRequestTypes,
        amenities: csv(opts.amenities),
        brands: csv(opts.brands),
        limit: Number(opts.limit ?? 40),
        offset: Number(opts.offset ?? 0),
        sort: [
          {
            field: String(opts.sort ?? 'DISTANCE').toUpperCase(),
            direction: opts.desc ? 'DESC' : 'ASC',
          },
        ],
        city: details.location.city ?? '',
        state: details.location.state ?? '',
        country: details.location.country ?? '',
        destinationType: (details.destinationType ?? 'City').toUpperCase(),
      });

      if (opts.json) {
        console.log(JSON.stringify(conn, null, 2));
      } else {
        const rows = toRows(conn);
        // Must happen BEFORE any price comparison, or mixed-currency results rank wrong.
        const fx = await mi.normaliseCurrencies(
          rows,
          opts.currency ? String(opts.currency).toUpperCase() : null,
        );
        if (fx.converted) {
          console.error(
            `[marriott] converted ${fx.converted} result(s) from ${fx.from.join(', ')} to ${fx.currency}`,
          );
        }
        for (const r of rows) {
          r.tierScore = tierScore(r.grade);
          r.eurPerTier =
            r.totalPerNight != null && r.tierScore > 0
              ? r.totalPerNight / r.tierScore
              : null;
        }
        const by = String(opts.by ?? '').toLowerCase();
        if (by === 'price') rows.sort((a, b) => (a.totalPerNight ?? 1e9) - (b.totalPerNight ?? 1e9));
        else if (by === 'value') rows.sort((a, b) => (a.eurPerTier ?? 1e9) - (b.eurPerTier ?? 1e9));
        else if (by === 'tier') rows.sort((a, b) => b.tierScore - a.tierScore || (a.totalPerNight ?? 1e9) - (b.totalPerNight ?? 1e9));
        else if (by === 'rating') rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

        const label = [
          place.description,
          `${startDate} → ${endDate}`,
          `${opts.adults ?? 1} adult(s)`,
          rateLabel(opts),
        ].join(' · ');
        renderResults(rows, { total: conn.total, label });
      }
      return 0;
    }

    throw new Error(`Unknown command "${cmd}". Try --help.`);
  } finally {
    await browser.close();
  }
}

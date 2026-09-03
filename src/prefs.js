// User preferences: ~/.marriott-mcp/config.json
//
// The point of this file is that nothing rate-code shaped is ever hard-coded in the
// repo. A corporate/promo cluster code is the user's own entitlement, not a constant of
// the API, so it lives in their config and is read at run time. Ship no codes, store no
// codes in git, and let each user bring their own.
//
// The file is written 0600 and lives outside the repo. Codes are masked whenever they
// are printed, so a shared terminal or a pasted screenshot does not leak them.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './cdp.js';

export const CONFIG_PATH = join(STATE_DIR, 'config.json');

/**
 * Everything a user may persist. `set`/`unset` refuse anything not listed here, so a
 * typo becomes an error instead of a silently ignored key.
 */
const SCHEMA = {
  code: {
    kind: 'code',
    describe: 'default corporate/promo cluster code applied when no --code is passed',
  },
  codes: {
    kind: 'map',
    describe: 'named codes, e.g. codes.work — use the name anywhere a code is expected',
  },
  currency: { kind: 'currency', describe: 'default --currency, e.g. EUR' },
  adults: { kind: 'int', min: 1, max: 8, describe: 'default --adults' },
  rooms: { kind: 'int', min: 1, max: 8, describe: 'default --rooms' },
  rate: { kind: 'rate', describe: 'default --rate family (standard, aaa, gov, senior, points)' },
  tolerance: { kind: 'float', min: 0, max: 1, describe: 'default plan --tolerance' },
};

export const RATE_KINDS = ['standard', 'aaa', 'gov', 'senior', 'points'];

export function prefKeys() {
  return Object.entries(SCHEMA).map(([k, v]) => [k, v.describe]);
}

/** Reads the config. A missing file is not an error; a corrupt one warns and is ignored. */
export function loadPrefs() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    process.stderr.write(`marriott: ignoring unreadable ${CONFIG_PATH} (${err.message})\n`);
    return {};
  }
}

export function savePrefs(prefs) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(prefs, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(CONFIG_PATH, 0o600); // an existing file keeps its old mode otherwise
  } catch {
    /* best effort: some filesystems do not support it */
  }
  return CONFIG_PATH;
}

const CODE_RE = /^[A-Z0-9]{2,12}$/;

function validateCode(raw) {
  const code = String(raw).trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    throw new Error(`"${raw}" does not look like a cluster code (2-12 letters/digits)`);
  }
  return code;
}

/** Applies one `config set <key> <value>`, validating against SCHEMA. Returns new prefs. */
export function setPref(prefs, key, value) {
  const [head, ...rest] = String(key).split('.');
  const spec = SCHEMA[head];
  if (!spec) {
    throw new Error(`unknown preference "${head}". Known: ${Object.keys(SCHEMA).join(', ')}`);
  }
  const next = { ...prefs };

  if (spec.kind === 'map') {
    const name = rest.join('.');
    if (!name) throw new Error(`${head} needs a name, e.g. ${head}.work <CODE>`);
    if (!/^[a-z0-9_-]+$/i.test(name)) {
      throw new Error(`"${name}" is not a valid name (letters, digits, - and _)`);
    }
    next[head] = { ...(prefs[head] ?? {}), [name.toLowerCase()]: validateCode(value) };
    return next;
  }
  if (rest.length) throw new Error(`"${head}" is not a nested preference`);

  if (spec.kind === 'code') next[head] = validateCode(value);
  else if (spec.kind === 'currency') {
    const cur = String(value).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new Error(`"${value}" is not a 3-letter ISO currency`);
    next[head] = cur;
  } else if (spec.kind === 'rate') {
    const kind = String(value).trim().toLowerCase();
    if (!RATE_KINDS.includes(kind)) {
      throw new Error(`rate must be one of: ${RATE_KINDS.join(', ')}`);
    }
    next[head] = kind;
  } else if (spec.kind === 'int' || spec.kind === 'float') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`"${value}" is not a number`);
    if (spec.kind === 'int' && !Number.isInteger(n)) throw new Error(`${head} must be a whole number`);
    if (n < spec.min || n > spec.max) {
      throw new Error(`${head} must be between ${spec.min} and ${spec.max}`);
    }
    next[head] = n;
  }
  return next;
}

export function unsetPref(prefs, key) {
  const [head, ...rest] = String(key).split('.');
  if (!SCHEMA[head]) {
    throw new Error(`unknown preference "${head}". Known: ${Object.keys(SCHEMA).join(', ')}`);
  }
  const next = { ...prefs };
  if (rest.length) {
    const name = rest.join('.').toLowerCase();
    const map = { ...(prefs[head] ?? {}) };
    if (!(name in map)) throw new Error(`${head}.${name} is not set`);
    delete map[name];
    if (Object.keys(map).length) next[head] = map;
    else delete next[head];
    return next;
  }
  delete next[head];
  return next;
}

/** `ABCD12` -> `A****2`. Enough to recognise your own code, not enough to reuse it. */
export function maskCode(code) {
  const s = String(code);
  if (s.length <= 2) return '*'.repeat(s.length);
  return `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`;
}

/**
 * Turns whatever the user typed into an actual cluster code.
 *
 * A value is looked up in `codes` first, so `--code work` works, and falls back to being
 * treated as a literal code. Precedence, highest first:
 *   1. an explicit --code / `code` argument
 *   2. MARRIOTT_CODE in the environment
 *   3. `code` in the config file
 * `noCode` (--no-code) suppresses 2 and 3 for one run, and an explicitly chosen rate
 * family wins over a merely-default code, since the two are mutually exclusive.
 *
 * Returns { code, source } with code null when the search should use a rate family.
 */
export function resolveCode({ code, noCode = false, explicitRate = false, prefs = loadPrefs(), env = process.env } = {}) {
  const named = (v) => {
    const key = String(v).trim().toLowerCase();
    const hit = prefs.codes?.[key];
    return hit ? validateCode(hit) : validateCode(v);
  };
  if (code !== undefined && code !== null && code !== '' && code !== true) {
    return { code: named(code), source: 'argument' };
  }
  if (code === true) throw new Error('--code needs a value, e.g. --code work');
  if (noCode || explicitRate) return { code: null, source: null };
  if (env.MARRIOTT_CODE) return { code: named(env.MARRIOTT_CODE), source: 'MARRIOTT_CODE' };
  if (prefs.code) return { code: named(prefs.code), source: 'config' };
  return { code: null, source: null };
}

/** Human-readable dump for `marriott config`. Codes are masked unless reveal is set. */
export function describePrefs(prefs, { reveal = false } = {}) {
  const show = (c) => (reveal ? String(c).toUpperCase() : maskCode(c));
  const lines = [];
  for (const [key, spec] of Object.entries(SCHEMA)) {
    const val = prefs[key];
    if (val === undefined) continue;
    if (spec.kind === 'map') {
      for (const [name, c] of Object.entries(val)) lines.push([`${key}.${name}`, show(c)]);
    } else if (spec.kind === 'code') lines.push([key, show(val)]);
    else lines.push([key, String(val)]);
  }
  return lines;
}

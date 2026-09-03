// Plain-text rendering for MCP tool results.
//
// src/render.js paints with ANSI escapes for a real terminal. MCP results are read by a
// model and rendered as markdown by the client, where escape codes are literal noise.
// Same information, different channel: markers become words, colour becomes a column.

import { tierScore } from './render.js';

const fmt = (v, cur) =>
  v == null ? '—' : `${v < 100 ? v.toFixed(2) : Math.round(v)} ${cur}`.trim();

/** Attach the derived fields the ranking and highlighting depend on. */
export function score(rows) {
  for (const r of rows) {
    r.tierScore = tierScore(r.grade);
    r.eurPerTier =
      r.totalPerNight != null && r.tierScore > 0 ? r.totalPerNight / r.tierScore : null;
  }
  return rows;
}

export function sortRows(rows, by) {
  const how = String(by ?? '').toLowerCase();
  if (how === 'price') rows.sort((a, b) => (a.totalPerNight ?? 1e9) - (b.totalPerNight ?? 1e9));
  else if (how === 'value') rows.sort((a, b) => (a.eurPerTier ?? 1e9) - (b.eurPerTier ?? 1e9));
  else if (how === 'tier')
    rows.sort(
      (a, b) => b.tierScore - a.tierScore || (a.totalPerNight ?? 1e9) - (b.totalPerNight ?? 1e9),
    );
  else if (how === 'rating') rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  return rows;
}

/** The three properties worth calling out, keyed by property id. */
export function highlights(rows) {
  const priced = rows.filter((r) => r.totalPerNight != null);
  if (!priced.length) return {};
  const cheapest = priced.reduce((a, b) => (b.totalPerNight < a.totalPerNight ? b : a));
  const valued = priced.filter((r) => r.eurPerTier != null);
  const value = valued.length
    ? valued.reduce((a, b) => (b.eurPerTier < a.eurPerTier ? b : a))
    : null;
  const quality = priced.reduce((a, b) => {
    if (b.tierScore !== a.tierScore) return b.tierScore > a.tierScore ? b : a;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) > (a.rating ?? 0) ? b : a;
    return b.totalPerNight < a.totalPerNight ? b : a;
  });
  return { cheapest, value, quality };
}

const escapePipes = (s) => String(s ?? '').replace(/\|/g, '\\|');

export function resultsTable(rows, meta = {}) {
  if (!rows.length) return 'No available properties for those dates and filters.';

  const picks = highlights(rows);
  const markFor = (r) => {
    const m = [];
    if (picks.cheapest?.id === r.id) m.push('CHEAPEST');
    if (picks.value?.id === r.id) m.push('BEST VALUE');
    if (picks.quality?.id === r.id) m.push('BEST TIER');
    return m.join(' + ');
  };

  // A cluster/promo code that did not apply comes back as an ordinary StandardRates row
  // at the standard price. Marriott flags this nowhere, so without surfacing it a caller
  // reads the fallback as "the code's price on this date" and concludes the date is
  // expensive rather than the code inapplicable.
  const codeMissed = (r) => !!meta.code && r.rateCategory === 'StandardRates';

  const out = [];
  if (meta.label) out.push(`**${meta.label}**`, '');

  for (const [key, title] of [
    ['cheapest', 'Cheapest'],
    ['value', 'Best value'],
    ['quality', 'Best tier'],
  ]) {
    const r = picks[key];
    if (!r) continue;
    const extra =
      key === 'value' && r.eurPerTier != null ? ` · ${r.eurPerTier.toFixed(1)} per tier point` : '';
    out.push(
      `- **${title}:** ${r.name} — ${r.grade ?? '?'}${r.gradeVaries ? '*' : ''} · ` +
        `${fmt(r.totalPerNight, r.currency)} all-in${extra}`,
    );
  }
  out.push('');

  out.push('| Tier | Hotel | Brand | Dist | Rating | /night | All-in | /tier-pt | |');
  out.push('|---|---|---|---|---:|---:|---:|---:|---|');
  for (const r of rows) {
    out.push(
      '| ' +
        [
          (r.grade ?? '?') + (r.gradeVaries ? '*' : ''),
          escapePipes(r.name),
          escapePipes(r.brand),
          r.distanceKm == null ? '—' : `${r.distanceKm} km`,
          r.rating == null ? '—' : r.rating.toFixed(1),
          fmt(r.price, r.currency),
          fmt(r.totalPerNight, r.currency) + (r.converted ? '~' : '') + (codeMissed(r) ? '!' : ''),
          r.eurPerTier == null ? '—' : r.eurPerTier.toFixed(1),
          markFor(r),
        ].join(' | ') +
        ' |',
    );
  }

  const ratios = rows
    .map((r) => r.eurPerTier)
    .filter((v) => v != null)
    .sort((a, b) => a - b);
  const median = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;

  out.push('');
  out.push(
    `${rows.length} shown of ${meta.total ?? rows.length}` +
      (median ? ` · median ${median.toFixed(1)} per tier point` : ''),
  );
  if (rows.some((r) => r.gradeVaries)) {
    out.push('`*` soft brand or collection — quality varies a lot between properties.');
  }
  if (rows.some((r) => r.converted)) {
    out.push("`~` converted at Marriott's own display rate, the one the site shows.");
  }
  if (rows.some(codeMissed)) {
    out.push(
      `\`!\` code ${meta.code} did not apply here. This is the property's standard rate, ` +
        'not a rate under that code.',
    );
  }
  if (meta.nights > 1) {
    out.push(
      `Per-night figures are averaged across all ${meta.nights} nights, so one costly night ` +
        'lifts every night shown. A high average is not necessarily a uniformly dear stay. ' +
        'Use scan_dates with nights=1 to see which individual nights carry it.',
    );
  }
  out.push('Tier grades are this tool\'s own ranking (see research/07-brand-grading.md), not Marriott\'s.');
  return out.join('\n');
}

export function scanTable(days, meta = {}) {
  const withData = days.filter((d) => d.rows.some((r) => r.totalPerNight != null));
  if (!withData.length) return 'No availability on any of those dates.';

  for (const d of withData) {
    const priced = d.rows.filter((r) => r.totalPerNight != null);
    d.cheapest = priced.reduce((a, b) => (b.totalPerNight < a.totalPerNight ? b : a));
    const valued = priced.filter((r) => r.eurPerTier != null);
    d.best = valued.length ? valued.reduce((a, b) => (b.eurPerTier < a.eurPerTier ? b : a)) : null;
    d.available = priced.length;
  }

  const lows = withData.map((d) => d.cheapest.totalPerNight);
  const min = Math.min(...lows);
  const max = Math.max(...lows);
  const cur = withData[0].cheapest.currency;

  const codeMissed = (r) => !!meta.code && r?.rateCategory === 'StandardRates';

  const out = [];
  if (meta.label) out.push(`**${meta.label}**`, '');
  out.push('| Date | Day | Avail | Cheapest | Hotel | Best value | |');
  out.push('|---|---|---:|---:|---|---|---|');
  for (const d of days) {
    // A sold-out date is a real signal, not a row to drop silently.
    if (!withData.includes(d)) {
      out.push(`| ${d.date} | ${d.weekday} | 0 | — | no availability | — | |`);
      continue;
    }
    const bv = d.best;
    out.push(
      '| ' +
        [
          d.date,
          d.weekday,
          d.available,
          fmt(d.cheapest.totalPerNight, d.cheapest.currency) + (codeMissed(d.cheapest) ? '!' : ''),
          escapePipes(d.cheapest.name),
          bv ? `${bv.grade ?? '?'} ${escapePipes(bv.name)} ${fmt(bv.totalPerNight, bv.currency)}` : '—',
          d.cheapest.totalPerNight === min ? 'CHEAPEST DAY' : '',
        ].join(' | ') +
        ' |',
    );
  }

  const best = withData.find((d) => d.cheapest.totalPerNight === min);
  const worst = withData.find((d) => d.cheapest.totalPerNight === max);
  out.push('');
  out.push(
    `Cheapest night: **${best.date}** (${best.weekday}) at ${fmt(min, cur)} · ` +
      `dearest ${worst.date} at ${fmt(max, cur)} · ` +
      `spread ${Math.round(((max - min) / min) * 100)}%`,
  );
  if (withData.some((d) => codeMissed(d.cheapest))) {
    out.push(
      `\`!\` code ${meta.code} did not apply on that date. The price shown is a standard rate, ` +
        'so the spread above is not a like-for-like comparison.',
    );
  }
  if (meta.nights > 1) {
    out.push(
      `Each row prices a ${meta.nights}-night stay from that date, and its per-night figure is ` +
        'the average over those nights. Neighbouring rows therefore overlap and are not ' +
        'independent; nights=1 gives the actual per-night curve.',
    );
  }
  return out.join('\n');
}

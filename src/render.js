// Terminal UI for search results: three recommendation cards plus a highlighted table.
//
// Google-Flights convention: the cheapest fare is called out in green. We do the same,
// and additionally mark the best value (price per tier point) and the best quality.

import { TIERS, tierColour } from './brands.js';

const useColour =
  !process.env.NO_COLOR && (process.stdout.isTTY || process.env.FORCE_COLOR);

const esc = (code) => (s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = {
  bold: esc('1'),
  dim: esc('2;37'),
  green: esc('1;32'),
  greenBg: esc('1;30;42'),
  yellow: esc('1;33'),
  cyan: esc('1;36'),
  magenta: esc('1;35'),
  red: esc('0;31'),
  grey: esc('0;90'),
};

/** Visible length, ignoring ANSI escapes — needed for padding coloured cells. */
const visLen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '').length;
const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - visLen(s)));
const padStart = (s, w) => ' '.repeat(Math.max(0, w - visLen(s))) + s;
const clip = (s, w) => {
  const str = String(s ?? '');
  return str.length > w ? `${str.slice(0, w - 1)}…` : str;
};

/** Tier → numeric points, SS highest. */
export const tierScore = (grade) =>
  grade ? TIERS.length - TIERS.indexOf(grade) : 0;

const colourRating = (r) => {
  if (r == null) return c.grey('—');
  if (r >= 4.7) return c.green(r.toFixed(1));
  if (r >= 4.3) return c.yellow(r.toFixed(1));
  return c.grey(r.toFixed(1));
};

const fmtMoney = (v, cur) =>
  v == null ? '—' : `${v < 100 ? v.toFixed(2) : Math.round(v)} ${cur}`.trim();

/** Pick the three properties worth calling out. */
export function pickHighlights(rows) {
  const priced = rows.filter((r) => r.totalPerNight != null);
  if (!priced.length) return {};

  const cheapest = priced.reduce((a, b) => (b.totalPerNight < a.totalPerNight ? b : a));

  const withValue = priced.filter((r) => r.tierScore > 0);
  const bestValue = withValue.length
    ? withValue.reduce((a, b) => (b.eurPerTier < a.eurPerTier ? b : a))
    : null;

  const bestQuality = priced.reduce((a, b) => {
    if (b.tierScore !== a.tierScore) return b.tierScore > a.tierScore ? b : a;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) > (a.rating ?? 0) ? b : a;
    return b.totalPerNight < a.totalPerNight ? b : a;
  });

  return { cheapest, bestValue, bestQuality };
}

function card(icon, title, subtitle, r, accent, width) {
  const inner = width - 2;
  const top = `╭${'─'.repeat(inner)}╮`;
  const bot = `╰${'─'.repeat(inner)}╯`;
  const line = (s) => `│${padEnd(s, inner)}│`;
  const price = `${fmtMoney(r.totalPerNight, r.currency)} all-in`;
  return [
    accent(top),
    accent(line(` ${icon} ${c.bold(title)}`)),
    accent(line(` ${c.dim(subtitle)}`)),
    accent(line('')),
    accent(line(` ${clip(r.name, inner - 3)}`)),
    accent(
      line(
        ` ${tierColour(r.grade)(r.grade ?? '?')}${r.gradeVaries ? '*' : ''}` +
          `  ${colourRating(r.rating)}★  ${c.dim(clip(r.brand, 22))}`,
      ),
    ),
    accent(line(` ${c.green(c.bold(price))}   ${c.dim(`${r.distanceKm ?? '?'}km`)}`)),
    accent(bot),
  ];
}

/** Print three side-by-side (or stacked) recommendation cards. */
function renderCards(picks, termWidth) {
  const entries = [
    ['💰', 'CHEAPEST', 'lowest all-in price', picks.cheapest, c.green],
    ['⚖', 'BEST VALUE', 'best tier per euro', picks.bestValue, c.cyan],
    ['👑', 'BEST QUALITY', 'highest tier available', picks.bestQuality, c.magenta],
  ].filter(([, , , r]) => r);

  const cardW = Math.min(44, Math.floor((termWidth - 4) / entries.length));
  const stack = cardW < 30;
  const blocks = entries.map(([i, t, s, r, a]) => card(i, t, s, r, a, stack ? Math.min(termWidth, 60) : cardW));

  if (stack) {
    for (const b of blocks) console.log(b.join('\n'));
    return;
  }
  const height = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < height; i++) {
    console.log(blocks.map((b) => b[i] ?? '').join('  '));
  }
}

/**
 * Date-scan view: one row per check-in date, so you can see which day is cheap.
 * `days` = [{ date, weekday, rows, total }]
 */
export function renderScan(days, meta = {}) {
  const withData = days.filter((d) => d.rows.some((r) => r.totalPerNight != null));
  if (!withData.length) {
    console.log('No availability on any of those dates.');
    return;
  }

  for (const d of withData) {
    const priced = d.rows.filter((r) => r.totalPerNight != null);
    d.cheapest = priced.reduce((a, b) => (b.totalPerNight < a.totalPerNight ? b : a));
    const valued = priced.filter((r) => r.eurPerTier != null);
    d.bestValue = valued.length
      ? valued.reduce((a, b) => (b.eurPerTier < a.eurPerTier ? b : a))
      : null;
    d.available = priced.length;
  }

  const minCheap = Math.min(...withData.map((d) => d.cheapest.totalPerNight));
  const maxCheap = Math.max(...withData.map((d) => d.cheapest.totalPerNight));
  const span = maxCheap - minCheap || 1;
  const cur = withData[0].cheapest.currency;

  console.log('');
  console.log(c.bold('  DATE          AVAIL   CHEAPEST            BEST VALUE'));
  console.log(c.dim('─'.repeat(92)));

  for (const d of days) {
    // A date with no availability is a real signal (sold out / not bookable), so show
    // it rather than dropping it silently.
    if (!withData.includes(d)) {
      console.log(
        '  ' + padEnd(c.bold(d.date), 12) + padEnd(c.dim(d.weekday), 5) +
          padStart(c.red('0'), 4) + '   ' + c.red('no availability'),
      );
      console.log('');
      continue;
    }
    const isBest = d.cheapest.totalPerNight === minCheap;
    const bar = '█'.repeat(Math.max(1, Math.round(((d.cheapest.totalPerNight - minCheap) / span) * 18)));
    const priceTxt = fmtMoney(d.cheapest.totalPerNight, d.cheapest.currency);
    const priceCell = isBest ? c.greenBg(` ${priceTxt} `) : priceTxt;
    const bv = d.bestValue;
    console.log(
      `${isBest ? c.green('▶') : ' '} ` +
        padEnd(c.bold(d.date), 12) +
        padEnd(c.dim(d.weekday), 5) +
        padStart(String(d.available), 4) +
        '   ' + padStart(priceCell, 13) +
        ' ' + c.dim(padEnd(clip(d.cheapest.name, 18), 18)) +
        ' ' + (bv ? `${tierColour(bv.grade)(padEnd(bv.grade, 3))} ${padStart(fmtMoney(bv.totalPerNight, bv.currency), 10)} ${c.dim(clip(bv.name, 22))}` : ''),
    );
    console.log('  ' + c.dim(bar));
  }

  const best = withData.find((d) => d.cheapest.totalPerNight === minCheap);
  const worst = withData.find((d) => d.cheapest.totalPerNight === maxCheap);
  console.log('');
  console.log(
    c.green(`▶ cheapest night: ${best.date} (${best.weekday}) at ${fmtMoney(minCheap, cur)}`) +
      c.dim(`  ·  dearest: ${worst.date} at ${fmtMoney(maxCheap, cur)}`) +
      c.dim(`  ·  spread ${Math.round(((maxCheap - minCheap) / minCheap) * 100)}%`),
  );
  if (meta.label) console.log(c.dim(meta.label));
}

/**
 * Full results view: cards + highlighted table.
 * `rows` come from toRows(); this function computes tierScore/eurPerTier.
 */
export function renderResults(rows, meta = {}) {
  if (!rows.length) {
    console.log('No available properties for those dates and filters.');
    return;
  }

  for (const r of rows) {
    r.tierScore = tierScore(r.grade);
    r.eurPerTier =
      r.totalPerNight != null && r.tierScore > 0 ? r.totalPerNight / r.tierScore : null;
  }

  const termWidth = process.stdout.columns || 120;
  const picks = pickHighlights(rows);

  console.log('');
  renderCards(picks, termWidth);
  console.log('');

  const isCheapest = (r) => picks.cheapest && r.id === picks.cheapest.id;
  const isValue = (r) => picks.bestValue && r.id === picks.bestValue.id;
  const isQuality = (r) => picks.bestQuality && r.id === picks.bestQuality.id;

  const W = { mark: 3, tier: 4, hotel: 38, brand: 17, dist: 6, rtg: 4, night: 11, total: 12, pt: 6 };
  const head =
    padEnd('', W.mark) +
    ' ' + padEnd('TIER', W.tier) +
    ' ' + padEnd('HOTEL', W.hotel) +
    ' ' + padEnd('BRAND', W.brand) +
    ' ' + padStart('DIST', W.dist) +
    ' ' + padStart('RTG', W.rtg) +
    ' ' + padStart('/NIGHT', W.night) +
    ' ' + padStart('ALL-IN', W.total) +
    ' ' + padStart('/PT', W.pt);
  console.log(c.bold(head));
  console.log(
    c.dim(
      '─'.repeat(
        W.mark + W.tier + W.hotel + W.brand + W.dist + W.rtg + W.night + W.total + W.pt + 8,
      ),
    ),
  );

  for (const r of rows) {
    // Emoji occupy two terminal columns but count as one "character" to padEnd, so
    // build a fixed 3-column cell by hand rather than padding it.
    let mark = '   ';
    if (isCheapest(r)) mark = `${c.green('💰')} `;
    else if (isValue(r)) mark = `${c.cyan('⚖')}  `;
    else if (isQuality(r)) mark = `${c.magenta('👑')} `;

    const tier = tierColour(r.grade)((r.grade ?? '?') + (r.gradeVaries ? '*' : ''));
    const total = fmtMoney(r.totalPerNight, r.currency) + (r.converted ? '~' : '');
    const totalCell = isCheapest(r) ? c.greenBg(` ${total} `) : total;
    const ptCell =
      r.eurPerTier == null ? c.grey('—') : isValue(r)
        ? c.green(c.bold(r.eurPerTier.toFixed(1)))
        : r.eurPerTier.toFixed(1);

    console.log(
      mark +
        ' ' + padEnd(tier, W.tier) +
        ' ' + padEnd(clip(r.name, W.hotel), W.hotel) +
        ' ' + c.dim(padEnd(clip(r.brand, W.brand), W.brand)) +
        ' ' + padStart(r.distanceKm == null ? '—' : `${r.distanceKm}km`, W.dist) +
        ' ' + padStart(colourRating(r.rating), W.rtg) +
        ' ' + padStart(fmtMoney(r.price, r.currency), W.night) +
        ' ' + padStart(totalCell, W.total) +
        ' ' + padStart(ptCell, W.pt),
    );
  }

  const priced = rows.filter((r) => r.eurPerTier != null).map((r) => r.eurPerTier).sort((a, b) => a - b);
  const median = priced.length ? priced[Math.floor(priced.length / 2)] : null;

  console.log('');
  console.log(
    c.dim(
      `${rows.length} shown of ${meta.total ?? rows.length}` +
        (median ? ` · median ${median.toFixed(1)}/tier-pt` : '') +
        ` · ${meta.label ?? ''}`,
    ),
  );
  console.log(
    c.dim(
      '💰 cheapest   ⚖️ best value (€ per tier point)   👑 best quality' +
        (rows.some((r) => r.gradeVaries) ? '   * soft brand, varies by property' : ''),
    ),
  );
}

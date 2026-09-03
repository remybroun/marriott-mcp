// Cheapest hotel-hopping itinerary for a multi-night stay.
//
// Hotel pricing is per-night and moves independently per property, so the cheapest way
// to cover N nights in a city is often not one hotel for N nights: it is a *path* through
// several, switching on the nights where somewhere else is dramatically cheaper.
//
// Naive "take the cheapest hotel every night" is wrong in practice — it will move you
// across town to save four euros. So switching carries a penalty, and the penalty is
// expressed the way a traveller actually thinks about it:
//
//   Moving is only worth it if it saves more than `tolerance` of the new hotel's price.
//
// With tolerance = 0.10, staying somewhere that costs up to 10% more than the night's
// best alternative wins. Ties always resolve toward staying put.
//
// This is a plain Viterbi / shortest-path DP: state is "which hotel on night i", the
// emission cost is that night's all-in price, and the transition cost is the penalty.
// Optimal, not a heuristic. O(nights × hotels).

const INF = Infinity;

/**
 * @param days  [{ date, rows }] — one entry per night, rows from toRows(), already
 *              currency-normalised. Rows without a price are ignored.
 * @param tolerance  fraction of a night's price that a move must save to be worth it.
 */
export function planStay(days, { tolerance = 0.1 } = {}) {
  const n = days.length;
  if (!n) throw new Error('planStay needs at least one night');

  // Night -> (propertyId -> row). Only priced, bookable rows can be part of a path.
  const avail = days.map((d) => {
    const m = new Map();
    for (const r of d.rows ?? []) if (r.totalPerNight != null) m.set(r.id, r);
    return m;
  });

  const empty = days.filter((_, i) => avail[i].size === 0).map((d) => d.date);
  if (empty.length) {
    return { ok: false, reason: 'no-availability', dates: empty };
  }

  const currencies = new Set();
  for (const m of avail) for (const r of m.values()) currencies.add(r.currency);
  // Comparing bare numbers across currencies would silently produce a nonsense path.
  if (currencies.size > 1) {
    return { ok: false, reason: 'mixed-currency', currencies: [...currencies] };
  }
  const currency = [...currencies][0] ?? '';

  // ── forward pass ────────────────────────────────────────────────────────────
  let dp = new Map(); // propertyId -> effective cost of the best path ending here
  for (const [id, r] of avail[0]) dp.set(id, r.totalPerNight);
  const back = [new Map()]; // back[i].get(id) = the hotel occupied on night i-1

  for (let i = 1; i < n; i++) {
    // min over g !== h needs only the best and second-best predecessor.
    let best = null;
    let second = null;
    for (const [id, cost] of dp) {
      if (!best || cost < best.cost) {
        second = best;
        best = { id, cost };
      } else if (!second || cost < second.cost) {
        second = { id, cost };
      }
    }

    const next = new Map();
    const bk = new Map();
    for (const [id, r] of avail[i]) {
      const stay = dp.has(id) ? dp.get(id) : INF;
      const other = best && best.id !== id ? best : second;
      const move = other ? other.cost + tolerance * r.totalPerNight : INF;
      if (stay === INF && move === INF) continue; // unreachable
      // `<=` keeps you where you are on a tie, which is the whole point of the penalty.
      const staying = stay <= move;
      next.set(id, (staying ? stay : move) + r.totalPerNight);
      bk.set(id, staying ? id : other.id);
    }
    if (!next.size) return { ok: false, reason: 'no-path', date: days[i].date };
    dp = next;
    back.push(bk);
  }

  // ── backtrack ───────────────────────────────────────────────────────────────
  let endId = null;
  let endCost = INF;
  for (const [id, cost] of dp) {
    if (cost < endCost) {
      endCost = cost;
      endId = id;
    }
  }
  const path = new Array(n);
  path[n - 1] = endId;
  for (let i = n - 1; i > 0; i--) path[i - 1] = back[i].get(path[i]);

  // ── group consecutive nights into bookable blocks ───────────────────────────
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const row = avail[i].get(path[i]);
    const last = blocks[blocks.length - 1];
    if (last && last.id === path[i]) {
      last.nights.push({ date: days[i].date, price: row.totalPerNight });
    } else {
      blocks.push({
        id: path[i],
        name: row.name,
        brand: row.brand,
        grade: row.grade,
        gradeVaries: row.gradeVaries,
        rating: row.rating,
        distanceKm: row.distanceKm,
        nights: [{ date: days[i].date, price: row.totalPerNight }],
      });
    }
  }
  for (const b of blocks) {
    b.checkIn = b.nights[0].date;
    b.checkOut = addDays(b.nights[b.nights.length - 1].date, 1);
    b.subtotal = b.nights.reduce((s, x) => s + x.price, 0);
  }
  const total = blocks.reduce((s, b) => s + b.subtotal, 0);

  return {
    ok: true,
    currency,
    total,
    moves: blocks.length - 1,
    blocks,
    baselines: baselines(days, avail, total),
    tolerance,
  };
}

/**
 * What the plan is actually worth, against the two things a person would otherwise do:
 * book one hotel for the whole stay, or chase the cheapest room every single night.
 */
function baselines(days, avail, planTotal) {
  const n = days.length;

  // Cheapest single hotel available every night — the no-hassle option.
  let single = null;
  for (const [id, r] of avail[0]) {
    let sum = 0;
    let ok = true;
    for (let i = 0; i < n; i++) {
      const row = avail[i].get(id);
      if (!row) {
        ok = false;
        break;
      }
      sum += row.totalPerNight;
    }
    if (ok && (!single || sum < single.total)) {
      single = { id, name: r.name, grade: r.grade, total: sum };
    }
  }

  // Cheapest room each night regardless of hassle — the floor, and the move count
  // the tolerance is protecting you from.
  let floor = 0;
  let prevId = null;
  let greedyMoves = 0;
  for (let i = 0; i < n; i++) {
    let bestRow = null;
    for (const r of avail[i].values()) {
      if (!bestRow || r.totalPerNight < bestRow.totalPerNight) bestRow = r;
    }
    floor += bestRow.totalPerNight;
    if (prevId !== null && bestRow.id !== prevId) greedyMoves++;
    prevId = bestRow.id;
  }

  return {
    singleHotel: single,
    savingsVsSingle: single ? single.total - planTotal : null,
    greedyFloor: floor,
    greedyMoves,
    // What the stickiness rule cost you in cash to avoid those extra moves.
    premiumOverFloor: planTotal - floor,
  };
}

function addDays(dateStr, k) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

/** Render a plan as markdown. */
export function planTable(plan, meta = {}) {
  if (!plan.ok) {
    if (plan.reason === 'no-availability') {
      return `No availability at all on: ${plan.dates.join(', ')}. No itinerary covers the stay.`;
    }
    if (plan.reason === 'mixed-currency') {
      return `Results span ${plan.currencies.join(', ')}. Set \`currency\` so prices are comparable.`;
    }
    return `Could not build an itinerary (${plan.reason}${plan.date ? ` at ${plan.date}` : ''}).`;
  }

  const money = (v) => `${v < 100 ? v.toFixed(2) : Math.round(v)} ${plan.currency}`;
  const out = [];
  if (meta.label) out.push(`**${meta.label}**`, '');

  out.push(
    `**${money(plan.total)} total** · ${plan.blocks.reduce((s, b) => s + b.nights.length, 0)} nights · ` +
      `${plan.moves} ${plan.moves === 1 ? 'move' : 'moves'}`,
  );
  out.push('');

  const verified = plan.blocks.some((b) => b.verified != null || b.verifyNote);
  out.push(
    '| # | Check in | Check out | Nights | Hotel | Tier | Nightly | Subtotal |' +
      (verified ? ' As booked |' : ''),
  );
  out.push('|---:|---|---|---:|---|---|---|---:|' + (verified ? '---:|' : ''));
  plan.blocks.forEach((b, i) => {
    const asBooked = b.verified != null ? money(b.verified) : (b.verifyNote ?? '—');
    out.push(
      `| ${i + 1} | ${b.checkIn} | ${b.checkOut} | ${b.nights.length} | ` +
        `${b.name.replace(/\|/g, '\\|')} | ${b.grade ?? '?'}${b.gradeVaries ? '*' : ''} | ` +
        `${b.nights.map((x) => money(x.price)).join(', ')} | ${money(b.subtotal)} |` +
        (verified ? ` ${asBooked} |` : ''),
    );
  });

  const bl = plan.baselines;
  out.push('');
  if (plan.verification) {
    const v = plan.verification;
    const drift = v.total - plan.total;
    out.push(
      Math.abs(drift) < 0.5
        ? `Re-checked each multi-night block as a real booking: total holds at ${money(v.total)}.`
        : `Re-checked as real bookings: **${money(v.total)}** ` +
            `(${drift > 0 ? '+' : ''}${money(Math.abs(drift))} vs the per-night estimate — ` +
            `length-of-stay pricing).`,
    );
    if (v.unresolved) {
      out.push(`${v.unresolved} block(s) could not be re-checked; their per-night estimate stands.`);
    }
    out.push('');
  }
  if (bl.singleHotel) {
    const s = bl.savingsVsSingle;
    out.push(
      s > 0.5
        ? `Staying put at ${bl.singleHotel.name} the whole time: ${money(bl.singleHotel.total)} — ` +
            `**hopping saves ${money(s)}** (${Math.round((s / bl.singleHotel.total) * 100)}%).`
        : `Cheapest single hotel for the whole stay is ${bl.singleHotel.name} at ${money(bl.singleHotel.total)}, ` +
            `so hopping is not worth it here.`,
    );
  } else {
    out.push('No single hotel is available for every night, so at least one move is forced.');
  }
  const dodged = bl.greedyMoves - plan.moves;
  if (bl.premiumOverFloor < 0.5 && dodged <= 0) {
    out.push('This is also the outright cheapest combination — the stickiness rule cost nothing.');
  } else {
    out.push(
      `Chasing the cheapest room every night: ${money(bl.greedyFloor)} with ${bl.greedyMoves} moves. ` +
        `This plan pays ${money(bl.premiumOverFloor)} more to avoid ${dodged} of them ` +
        `(${Math.round(plan.tolerance * 100)}% stickiness — lower \`tolerance\` to hop harder).`,
    );
  }
  return out.join('\n');
}

// ── live data ─────────────────────────────────────────────────────────────────

/**
 * Price every night of the stay independently. One search per night: the whole point is
 * that a hotel's price moves night to night, so a single multi-night search — which
 * returns an *average* — cannot answer this question.
 */
export async function collectNights(mi, geo, { startDate, nights, currency, onNight }) {
  const { toRows } = await import('./marriott.js');
  const days = [];
  for (let i = 0; i < nights; i++) {
    const s = addDays(startDate, i);
    const conn = await mi.searchByGeo({ ...geo, startDate: s, endDate: addDays(s, 1) });
    const rows = toRows(conn);
    // Must happen before the DP: comparing bare numbers across currencies picks nonsense.
    await mi.normaliseCurrencies(rows, currency);
    days.push({ date: s, rows, total: conn.total });
    onNight?.(s, rows.length);
  }
  return days;
}

/**
 * Re-price each multi-night block as the booking you would actually make.
 *
 * The plan is built from one-night prices, but two consecutive nights at one hotel are
 * one reservation, and Marriott does not always price a 2-night stay as the sum of its
 * nights (length-of-stay pricing, minimum-stay rates). Without this the total is an
 * estimate presented as a fact.
 */
export async function verifyBlocks(mi, geo, blocks, { currency } = {}) {
  const { toRows } = await import('./marriott.js');
  for (const b of blocks) {
    if (b.nights.length < 2) {
      b.verified = b.subtotal;
      continue;
    }
    try {
      const conn = await mi.searchByGeo({
        ...geo,
        startDate: b.checkIn,
        endDate: b.checkOut,
        // The property must be in the page for us to find it; widen rather than assume.
        limit: Math.max(geo.limit ?? 40, 200),
      });
      const rows = toRows(conn);
      await mi.normaliseCurrencies(rows, currency);
      const row = rows.find((r) => r.id === b.id);
      if (!row || row.totalPerNight == null) {
        b.verifyNote = 'not offered as a multi-night stay';
        continue;
      }
      b.verified = row.totalPerNight * b.nights.length;
    } catch (err) {
      b.verifyNote = `check failed: ${err.message}`;
    }
  }
  const known = blocks.filter((b) => b.verified != null);
  return {
    checked: known.length,
    unresolved: blocks.length - known.length,
    total: blocks.reduce((s, b) => s + (b.verified ?? b.subtotal), 0),
  };
}

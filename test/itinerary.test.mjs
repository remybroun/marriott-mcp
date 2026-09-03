// Correctness checks for the itinerary DP. Run: node test/itinerary.test.mjs
import assert from 'node:assert/strict';
import { planStay } from '../src/itinerary.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
};

// Real ISO dates: the planner computes check-out as check-in + 1 day.
const D = (i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10);

const day = (date, prices) => ({
  date,
  rows: Object.entries(prices).map(([id, p]) => ({
    id, name: id, brand: id, grade: 'B', rating: 4, distanceKm: 1,
    totalPerNight: p, currency: 'EUR',
  })),
});

/** Effective cost of a path under the same objective the DP minimises. */
function effective(days, path, tol) {
  let c = 0;
  for (let i = 0; i < path.length; i++) {
    const p = days[i].rows.find((r) => r.id === path[i]).totalPerNight;
    c += p + (i > 0 && path[i] !== path[i - 1] ? tol * p : 0);
  }
  return c;
}

function pathOf(plan) {
  return plan.blocks.flatMap((b) => b.nights.map(() => b.id));
}

// ── the rule the user actually asked for ─────────────────────────────────────

test('stays put when the gap is inside the tolerance (10%)', () => {
  const days = [day('2026-11-01', { A: 100, B: 200 }), day('2026-11-02', { A: 110, B: 100 })];
  const plan = planStay(days, { tolerance: 0.1 });
  assert.equal(plan.moves, 0, 'should not move to save exactly 10%');
  assert.deepEqual(pathOf(plan), ['A', 'A']);
  assert.equal(plan.total, 210);
});

test('moves when the gap clearly exceeds the tolerance', () => {
  const days = [day('2026-11-01', { A: 100, B: 200 }), day('2026-11-02', { A: 130, B: 100 })];
  const plan = planStay(days, { tolerance: 0.1 });
  assert.equal(plan.moves, 1);
  assert.deepEqual(pathOf(plan), ['A', 'B']);
  assert.equal(plan.total, 200);
});

test('a one-night dip is not worth moving for, but a sustained one is', () => {
  const cheapDip = [
    day(D(0), { A: 100, B: 300 }), day(D(1), { A: 100, B: 88 }), day(D(2), { A: 100, B: 300 }),
  ];
  assert.equal(planStay(cheapDip, { tolerance: 0.1 }).moves, 0);

  const sustained = [
    day(D(0), { A: 100, B: 300 }), day(D(1), { A: 100, B: 60 }), day(D(2), { A: 100, B: 60 }),
  ];
  assert.equal(planStay(sustained, { tolerance: 0.1 }).moves, 1);
});

test('groups consecutive nights into one bookable block with the right dates', () => {
  const days = [
    day('2026-11-01', { A: 100, B: 400 }), day('2026-11-02', { A: 100, B: 400 }),
    day('2026-11-03', { A: 400, B: 100 }), day('2026-11-04', { A: 400, B: 100 }),
  ];
  const plan = planStay(days, { tolerance: 0.1 });
  assert.equal(plan.blocks.length, 2);
  assert.deepEqual(
    plan.blocks.map((b) => [b.id, b.checkIn, b.checkOut, b.nights.length]),
    [['A', '2026-11-01', '2026-11-03', 2], ['B', '2026-11-03', '2026-11-05', 2]],
  );
  assert.equal(plan.total, 400);
});

test('routes around a hotel that sells out mid-stay', () => {
  const days = [day(D(0), { A: 100 }), day(D(1), { B: 500 }), day(D(2), { A: 100 })];
  const plan = planStay(days, { tolerance: 0.1 });
  assert.deepEqual(pathOf(plan), ['A', 'B', 'A']);
  assert.equal(plan.moves, 2);
});

test('reports a night nobody can cover instead of inventing a path', () => {
  const days = [day(D(0), { A: 100 }), { date: D(1), rows: [] }];
  const plan = planStay(days, { tolerance: 0.1 });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.dates, [D(1)]);
});

test('refuses to compare across currencies', () => {
  const days = [day(D(0), { A: 100 }), day(D(1), { B: 100 })];
  days[1].rows[0].currency = 'USD';
  assert.equal(planStay(days, { tolerance: 0.1 }).reason, 'mixed-currency');
});

test('tolerance 0 reproduces greedy cheapest-per-night', () => {
  const days = [day(D(0), { A: 100, B: 101 }), day(D(1), { A: 101, B: 100 })];
  const plan = planStay(days, { tolerance: 0 });
  assert.equal(plan.total, 200);
  assert.equal(plan.moves, 1);
});

// ── optimality, against exhaustive search ────────────────────────────────────

test('matches brute force on 500 random instances', () => {
  // Deterministic LCG so a failure is reproducible.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let trial = 0; trial < 500; trial++) {
    const nHotels = 2 + Math.floor(rnd() * 4);
    const nNights = 2 + Math.floor(rnd() * 5);
    const tol = [0, 0.05, 0.1, 0.25][Math.floor(rnd() * 4)];
    const ids = Array.from({ length: nHotels }, (_, i) => `H${i}`);

    const days = [];
    for (let i = 0; i < nNights; i++) {
      const prices = {};
      for (const id of ids) {
        // Leave gaps, so sold-out nights are exercised too.
        if (rnd() < 0.25) continue;
        prices[id] = 50 + Math.floor(rnd() * 300);
      }
      if (!Object.keys(prices).length) prices[ids[0]] = 100;
      days.push(day(D(i), prices));
    }

    const plan = planStay(days, { tolerance: tol });
    assert.ok(plan.ok, `trial ${trial}: expected a plan`);

    // Exhaustive search over every assignment of an available hotel per night.
    const options = days.map((d) => d.rows.map((r) => r.id));
    let bestCost = Infinity;
    const walk = (i, acc) => {
      if (i === nNights) {
        bestCost = Math.min(bestCost, effective(days, acc, tol));
        return;
      }
      for (const id of options[i]) walk(i + 1, [...acc, id]);
    };
    walk(0, []);

    const got = effective(days, pathOf(plan), tol);
    assert.ok(
      Math.abs(got - bestCost) < 1e-9,
      `trial ${trial}: DP got ${got}, brute force found ${bestCost} (tol=${tol})`,
    );
  }
});

console.log(`\n${passed} passed`);

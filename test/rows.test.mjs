// Flattening a search connection into rows: which of a hotel's rates each row prices.
// Run: node test/rows.test.mjs
import assert from 'node:assert/strict';
import { toRows, pickRates } from '../src/marriott.js';
import { resultsTable } from '../src/format.js';

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

// The three rates a `--rate points` search gets back for each hotel, as Las Vegas
// gave them for 3 nights from 2026-12-10, in each reservation system's order.
const money = (amount) => ({ amount, currency: 'USD', decimalPoint: 2 });
const points = (n) => ({ lengthOfStay: 3, rateCategory: { code: 'Special', value: 'MRW' }, rateModes: { pointsPerUnit: { points: n } }, status: { code: 'AvailableForSale' } });
const p17 = { lengthOfStay: 3, rateCategory: { code: 'Special', value: 'P17' }, rateModes: null, status: { code: 'NotAvailable' } };
const cash = (night, total) => ({ lengthOfStay: 3, membersOnly: false, rateCategory: { code: 'StandardRates', value: null }, rateModes: { lowestAverageRate: { amount: money(night), totalAmount: money(total) } }, status: { code: 'AvailableForSale' } });
const hotel = (id, rates) => ({ node: { property: { id, basicInformation: { name: id } }, rates } });

test('a points search prices every hotel, whatever order its rates come in', () => {
  const rows = toRows({
    edges: [
      hotel('LASBL', [points(390000), p17, cash(56640, 70454)]), // MARSHA: points first
      hotel('LASVW', [p17, points(156000), cash(28531, 36317)]), // DSP: unavailable P17 first
      hotel('LASFI', [cash(23197, 26300), points(125000)]), // ACRS: cash first
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.id, r.price, r.totalPerNight, r.status, r.rateCategory, r.points, r.pointsPerNight]),
    [
      ['LASBL', 566.4, 704.54, 'AvailableForSale', 'StandardRates', 390000, 130000],
      ['LASVW', 285.31, 363.17, 'AvailableForSale', 'StandardRates', 156000, 52000],
      ['LASFI', 231.97, 263, 'AvailableForSale', 'StandardRates', 125000, 41667],
    ],
  );
});

test('a standard search has no points', () => {
  const [r] = toRows({ edges: [hotel('LASFI', [cash(23197, 26300)])] });
  assert.equal(r.totalPerNight, 263);
  assert.equal(r.points, null);
  assert.equal(r.pointsPerNight, null);
});

test('a hotel with only an award rate keeps it, and its status', () => {
  const { rate, pointsRate } = pickRates([p17, points(99000)]);
  assert.equal(rate, pointsRate);
  const [r] = toRows({ edges: [hotel('LASEX', [p17, points(99000)])] });
  assert.equal(r.status, 'AvailableForSale');
  assert.equal(r.totalPerNight, null);
  assert.equal(r.pointsPerNight, 33000);
});

test('the results table shows points per night only when there are some', () => {
  const withPoints = toRows({ edges: [hotel('LASBL', [points(390000), p17, cash(56640, 70454)])] });
  assert.match(resultsTable(withPoints), /Points\/night/);
  assert.match(resultsTable(withPoints), /\| 130,000 \|/);
  const without = toRows({ edges: [hotel('LASFI', [cash(23197, 26300)])] });
  assert.doesNotMatch(resultsTable(without), /Points\/night/);
});

console.log(`\n${passed} passed`);

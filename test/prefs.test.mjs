// Preference resolution: which cluster code a search actually uses, and why.
// Run: node test/prefs.test.mjs
import assert from 'node:assert/strict';
import { setPref, unsetPref, resolveCode, maskCode, describePrefs } from '../src/prefs.js';

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

const prefs = { code: 'CFG111', codes: { work: 'WRK222', side: 'SDE333' } };
const noEnv = {};

test('an explicit code wins over env and config', () => {
  const r = resolveCode({ code: 'ARG444', prefs, env: { MARRIOTT_CODE: 'ENV555' } });
  assert.equal(r.code, 'ARG444');
  assert.equal(r.source, 'argument');
});

test('a code argument is upper-cased', () => {
  assert.equal(resolveCode({ code: 'arg444', prefs, env: noEnv }).code, 'ARG444');
});

test('a saved name resolves to its code', () => {
  assert.equal(resolveCode({ code: 'work', prefs, env: noEnv }).code, 'WRK222');
  assert.equal(resolveCode({ code: 'WORK', prefs, env: noEnv }).code, 'WRK222');
});

test('env beats config', () => {
  const r = resolveCode({ prefs, env: { MARRIOTT_CODE: 'ENV555' } });
  assert.equal(r.code, 'ENV555');
  assert.equal(r.source, 'MARRIOTT_CODE');
});

test('config supplies the default when nothing else does', () => {
  const r = resolveCode({ prefs, env: noEnv });
  assert.equal(r.code, 'CFG111');
  assert.equal(r.source, 'config');
});

test('no config and no argument means no code', () => {
  assert.equal(resolveCode({ prefs: {}, env: noEnv }).code, null);
});

test('noCode suppresses env and config', () => {
  assert.equal(resolveCode({ noCode: true, prefs, env: { MARRIOTT_CODE: 'ENV555' } }).code, null);
});

test('an explicitly chosen rate family suppresses a default code', () => {
  assert.equal(resolveCode({ explicitRate: true, prefs, env: noEnv }).code, null);
  // but never suppresses a code the caller asked for by hand
  assert.equal(resolveCode({ code: 'work', explicitRate: true, prefs, env: noEnv }).code, 'WRK222');
});

test('--code with no value is an error, not a silent standard search', () => {
  assert.throws(() => resolveCode({ code: true, prefs, env: noEnv }), /needs a value/);
});

test('a nonsense code is rejected before it reaches the API', () => {
  assert.throws(() => resolveCode({ code: 'no spaces', prefs, env: noEnv }), /cluster code/);
  assert.throws(() => resolveCode({ code: 'x', prefs, env: noEnv }), /cluster code/);
});

test('set validates and normalises', () => {
  assert.deepEqual(setPref({}, 'code', 'abc12'), { code: 'ABC12' });
  assert.deepEqual(setPref({}, 'codes.Work', 'abc12'), { codes: { work: 'ABC12' } });
  assert.deepEqual(setPref({}, 'currency', 'eur'), { currency: 'EUR' });
  assert.deepEqual(setPref({}, 'adults', '2'), { adults: 2 });
  assert.throws(() => setPref({}, 'nope', 'x'), /unknown preference/);
  assert.throws(() => setPref({}, 'currency', 'euro'), /ISO currency/);
  assert.throws(() => setPref({}, 'adults', '99'), /between/);
  assert.throws(() => setPref({}, 'rate', 'cheap'), /rate must be one of/);
  assert.throws(() => setPref({}, 'codes', 'abc12'), /needs a name/);
});

test('unset removes a key and prunes an empty codes map', () => {
  assert.deepEqual(unsetPref({ code: 'A1', currency: 'EUR' }, 'code'), { currency: 'EUR' });
  assert.deepEqual(unsetPref({ codes: { work: 'A1' } }, 'codes.work'), {});
  assert.deepEqual(unsetPref({ codes: { work: 'A1', side: 'B2' } }, 'codes.work'), {
    codes: { side: 'B2' },
  });
  assert.throws(() => unsetPref({}, 'codes.missing'), /is not set/);
});

test('masking keeps the shape but not the code', () => {
  assert.equal(maskCode('ABC123'), 'A****3');
  assert.equal(maskCode('AB'), '**');
  assert.ok(!maskCode('SECRET1').includes('ECRE'));
});

test('describePrefs masks codes by default and never masks plain settings', () => {
  const lines = describePrefs({ code: 'ABC123', currency: 'EUR' });
  assert.deepEqual(lines, [['code', 'A****3'], ['currency', 'EUR']]);
  assert.deepEqual(describePrefs({ code: 'ABC123' }, { reveal: true }), [['code', 'ABC123']]);
});

console.log(`\n${passed} passed`);

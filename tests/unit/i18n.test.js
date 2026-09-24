import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMessage, parse } from '../../public/app/i18n/format.js';

test('plain text and arguments', () => {
  assert.equal(formatMessage('Salut, {name}!', { name: 'Ana' }), 'Salut, Ana!');
  assert.equal(formatMessage('{missing}', {}), '');
});

test('Romanian plurals: one / few / other', () => {
  const m = '{n, plural, one {# sesiune} few {# sesiuni} other {# de sesiuni}}';
  assert.equal(formatMessage(m, { n: 1 }, 'ro-RO'), '1 sesiune');
  assert.equal(formatMessage(m, { n: 3 }, 'ro-RO'), '3 sesiuni');
  assert.equal(formatMessage(m, { n: 0 }, 'ro-RO'), '0 sesiuni');
  assert.equal(formatMessage(m, { n: 20 }, 'ro-RO'), '20 de sesiuni');
  assert.equal(formatMessage(m, { n: 101 }, 'ro-RO'), '101 sesiuni');
});

test('English plurals and exact matches', () => {
  const m = '{n, plural, =0 {none} one {# item} other {# items}}';
  assert.equal(formatMessage(m, { n: 0 }, 'en-GB'), 'none');
  assert.equal(formatMessage(m, { n: 1 }, 'en-GB'), '1 item');
  assert.equal(formatMessage(m, { n: 1200 }, 'en-GB'), '1,200 items');
});

test('select and nesting', () => {
  const m = '{type, select, event {Eveniment} blocked {Blocare {n, plural, one {#} other {# ore}}} other {Altul}}';
  assert.equal(formatMessage(m, { type: 'event' }), 'Eveniment');
  assert.equal(formatMessage(m, { type: 'blocked', n: 2 }, 'en-GB'), 'Blocare 2 ore');
  assert.equal(formatMessage(m, { type: 'x' }), 'Altul');
});

test('number format', () => {
  assert.equal(formatMessage('{n, number}', { n: 12345.5 }, 'ro-RO'), '12.345,5');
});

test('malformed messages throw', () => {
  assert.throws(() => parse('{n, plural, one {x}'));
  assert.throws(() => parse('oops }'));
  assert.throws(() => parse('{a b}'));
});

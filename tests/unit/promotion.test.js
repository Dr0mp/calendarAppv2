import '../setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, promoSlot } from '../../shared/rules/promotion.js';

const TEMPLATE = ['🚀 {title}', 'Susținut de {owner}', '📅 {date}, {time} · {space}', '🎟️ {price}', '🔗 Înscrieri: {enroll_url}', '', '{description}'].join('\n');

test('fills placeholders and drops lines with an empty one', () => {
  const out = fillTemplate(TEMPLATE, { title: 'Atelier', owner: 'Ana', date: 'joi, 1 oct.', time: '18:00', space: 'Sala Mare', price: '75 RON', enroll_url: '', description: null });
  assert.equal(out, '🚀 Atelier\nSusținut de Ana\n📅 joi, 1 oct., 18:00 · Sala Mare\n🎟️ 75 RON');
});

test('unknown placeholders count as empty; blank runs collapse', () => {
  assert.equal(fillTemplate('A {nope}\nB\n\n\n\nC {title}', { title: 'x' }), 'B\n\nC x');
  assert.equal(fillTemplate('Line\r\n{title}', { title: '  spaced  ' }), 'Line\nspaced');
});

test('promotion date: 7 days before at 10:00, else the next full hour', () => {
  const tz = 'Europe/Bucharest';
  const at = Date.parse('2026-09-24T07:00:00Z'); // 10:00 in Bucharest
  assert.deepEqual(promoSlot('2026-10-10', tz, at), { date: '2026-10-03', time: '10:00' });
  assert.deepEqual(promoSlot('2026-09-28', tz, at), { date: '2026-09-24', time: '11:00' });
  assert.deepEqual(promoSlot('2026-10-01', tz, at + 30 * 60_000), { date: '2026-09-24', time: '11:00' });
});

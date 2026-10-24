import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSlots, zonedWallTimeToUtc, weekdayMondayZero, type AvailabilityRule } from '../src/domain/slots';

const TZ = 'Europe/Paris';

test('weekdayMondayZero: 2026-01-19 est un lundi (0)', () => {
  assert.equal(weekdayMondayZero('2026-01-19'), 0);
  assert.equal(weekdayMondayZero('2026-01-18'), 6); // dimanche
});

test('DST: 09:00 Paris = 08:00 UTC en hiver, 07:00 UTC en été', () => {
  const winter = zonedWallTimeToUtc(2026, 1, 19, 9, 0, TZ);  // CET (+1)
  assert.equal(winter.toISOString(), '2026-01-19T08:00:00.000Z');
  const summer = zonedWallTimeToUtc(2026, 7, 13, 9, 0, TZ);  // CEST (+2)
  assert.equal(summer.toISOString(), '2026-07-13T07:00:00.000Z');
});

function monRule(): AvailabilityRule {
  return { weekday: 0, startMinute: 540, endMinute: 660, timezone: TZ, active: true }; // 09:00–11:00
}
const PAST = new Date('2000-01-01T00:00:00Z');

test('computeSlots: 09:00–11:00 / 30 min → 4 créneaux', () => {
  const slots = computeSlots({ dateISO: '2026-01-19', rules: [monRule()], blocked: [], existing: [], durationMinutes: 30, nowUtc: PAST });
  assert.deepEqual(slots.map(s => s.toISOString()), [
    '2026-01-19T08:00:00.000Z', '2026-01-19T08:30:00.000Z',
    '2026-01-19T09:00:00.000Z', '2026-01-19T09:30:00.000Z',
  ]);
});

test('computeSlots: période bloquée 10:00–10:30 retire un créneau', () => {
  const blocked = [{ startUtc: new Date('2026-01-19T09:00:00Z'), endUtc: new Date('2026-01-19T09:30:00Z') }]; // = 10:00–10:30 Paris
  const slots = computeSlots({ dateISO: '2026-01-19', rules: [monRule()], blocked, existing: [], durationMinutes: 30, nowUtc: PAST });
  assert.equal(slots.length, 3);
  assert.ok(!slots.some(s => s.toISOString() === '2026-01-19T09:00:00.000Z'));
});

test('computeSlots: RDV existant 09:30 retire le créneau en conflit', () => {
  const existing = [{ startUtc: new Date('2026-01-19T08:30:00Z'), endUtc: new Date('2026-01-19T09:00:00Z') }]; // 09:30 Paris
  const slots = computeSlots({ dateISO: '2026-01-19', rules: [monRule()], blocked: [], existing, durationMinutes: 30, nowUtc: PAST });
  assert.ok(!slots.some(s => s.toISOString() === '2026-01-19T08:30:00.000Z'));
  assert.equal(slots.length, 3);
});

test('computeSlots: le passé est exclu', () => {
  const now = new Date('2026-01-19T08:45:00Z'); // après 09:00 et 09:30 Paris
  const slots = computeSlots({ dateISO: '2026-01-19', rules: [monRule()], blocked: [], existing: [], durationMinutes: 30, nowUtc: now });
  assert.deepEqual(slots.map(s => s.toISOString()), ['2026-01-19T09:00:00.000Z', '2026-01-19T09:30:00.000Z']);
});

test('computeSlots: mauvais jour → aucun créneau', () => {
  const slots = computeSlots({ dateISO: '2026-01-20', rules: [monRule()], blocked: [], existing: [], durationMinutes: 30, nowUtc: PAST }); // mardi
  assert.equal(slots.length, 0);
});

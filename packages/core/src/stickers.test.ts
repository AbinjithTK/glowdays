/**
 * Sticker vocabulary and confounder summarising.
 *
 * The rules under test are the two that decide whether a verdict can be trusted:
 * an observation about your skin is never treated as an explanation for a change,
 * and a confounder is counted in days rather than in taps.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_STICKERS_PER_ENTRY,
  STICKERS,
  stickersFrom,
  stickersOfKind,
  summariseConfounders,
  sticker,
} from './stickers.js';

test('observations are never confounders', () => {
  // "My skin stung" is part of what needs explaining, not an explanation. If it
  // counted, the app could dismiss its own finding using the symptom it tracks.
  for (const s of stickersOfKind('observation')) {
    assert.equal(s.confounder, false, `${s.id} must not be a confounder`);
  }
});

test('lifestyle and routine stickers are confounders', () => {
  for (const s of [...stickersOfKind('lifestyle'), ...stickersOfKind('routine')]) {
    assert.equal(s.confounder, true, `${s.id} must be a confounder`);
  }
});

test('ids are unique and every sticker carries a written label', () => {
  const ids = new Set(STICKERS.map((s) => s.id));
  assert.equal(ids.size, STICKERS.length);
  for (const s of STICKERS) {
    // Emoji alone is not a label: it is unreadable to a screen reader and renders
    // differently on every platform.
    assert.ok(s.label.length > 1, `${s.id} needs a label`);
    assert.ok(s.because.length > 10, `${s.id} needs a reason it matters`);
  }
});

test('unrecognised tags are dropped rather than guessed at', () => {
  // Tags are free text at the API boundary, so anything may arrive here.
  assert.deepEqual(stickersFrom(['not_a_sticker']), []);
  assert.equal(stickersFrom(['poor_sleep']).length, 1);
  assert.equal(sticker('nope'), null);
});

test('confounders are counted in days, not in taps', () => {
  // Two poor-sleep tags on one date is one bad night. Counting tags would turn a
  // single day into an apparent pattern.
  const summary = summariseConfounders(
    [
      { noteOn: '2026-08-01', tags: ['poor_sleep'] },
      { noteOn: '2026-08-01', tags: ['poor_sleep', 'alcohol'] },
      { noteOn: '2026-08-02', tags: ['poor_sleep'] },
    ],
    14,
  );

  const sleep = summary.counted.find((c) => c.sticker.id === 'poor_sleep');
  assert.equal(sleep?.days, 2);
  const drink = summary.counted.find((c) => c.sticker.id === 'alcohol');
  assert.equal(drink?.days, 1);
  assert.equal(summary.daysAffected, 2);
  assert.equal(summary.totalDays, 14);
});

test('a window of observations alone reports no confounders', () => {
  const summary = summariseConfounders(
    [
      { noteOn: '2026-08-01', tags: ['calm'] },
      { noteOn: '2026-08-02', tags: ['breakout', 'tight'] },
    ],
    7,
  );
  assert.deepEqual(summary.counted, []);
  assert.equal(summary.daysAffected, 0);
});

test('the per-entry cap matches what the API will accept', () => {
  // The notes endpoint rejects more than eight tags, so the picker must stop there
  // rather than letting someone compose an entry the server will refuse.
  assert.equal(MAX_STICKERS_PER_ENTRY, 8);
});

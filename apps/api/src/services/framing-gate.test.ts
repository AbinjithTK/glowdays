/**
 * The framing admission rule.
 *
 * Regression cover for a bug that made the deployed app unusable on a phone. The
 * pre-flight check enforced the provider's 60% face-width minimum against
 * `faceRatio` unconditionally, but that value can only be measured where the
 * browser exposes a face detector - a flagged Chromium feature, absent from iOS
 * Safari. Everywhere else the client sends 0 as a placeholder, 0 is below the
 * minimum, and every check-in was refused with "Move a little closer": a cause
 * that was never observed and a remedy that cannot change the number.
 *
 * The invariant these tests hold down is narrow and worth stating plainly: a
 * capture is never refused on the strength of a signal nothing measured.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enforcesFraming } from './analysis.js';

test('framing is judged when the client says it measured framing', () => {
  assert.equal(enforcesFraming({ source: 'declared', measured: ['lighting', 'framing'] }), true);
});

test('framing is not judged when the client says it did not measure framing', () => {
  // The case that was broken. Lighting is measurable from pixels alone; framing
  // is not, so this is what an ordinary phone browser reports.
  assert.equal(enforcesFraming({ source: 'declared', measured: ['lighting'] }), false);
});

test('an empty measured list is a positive statement, not a missing one', () => {
  // Distinct from `undefined`: the client measured nothing and said so, which
  // must not fall through to the source-based guess.
  assert.equal(enforcesFraming({ source: 'camerakit', measured: [] }), false);
});

test('framing is judged when every group was measured and no list is sent', () => {
  // Older clients and the seed and smoke scripts, which report camerakit with a
  // genuine face ratio.
  assert.equal(enforcesFraming({ source: 'camerakit' }), true);
});

test('framing is not judged when nothing was measured and no list is sent', () => {
  assert.equal(enforcesFraming({ source: 'declared' }), false);
});

test('a measured list overrides the source it disagrees with', () => {
  // Precision matters here: `source` only reports camerakit when all three groups
  // were measured, so a browser that can measure framing but not pose reports
  // declared. Gating on source alone would throw away a real measurement.
  assert.equal(enforcesFraming({ source: 'declared', measured: ['framing'] }), true);
  assert.equal(enforcesFraming({ source: 'camerakit', measured: ['lighting', 'pose'] }), false);
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assessComparison,
  BANDS,
  DAYS_APART,
  daysBetween,
  labelText,
  rationale,
  type CaptureQuality,
  type ComparisonVerdict,
  type ScanForComparison,
} from './confidence.js';

const BASE: CaptureQuality = {
  tier: 'hd',
  lightingLevel: 0.72,
  lightingUneven: 0.06,
  faceRatio: 0.68,
  yaw: 1,
  pitch: -2,
  roll: 0,
  // Fully measured, so the existing band tests keep grading framing and pose.
  // The declared case has its own tests at the end of this file.
  source: 'camerakit',
};

function scan(
  id: string,
  daysFromBaseline: number,
  quality: Partial<CaptureQuality> = {},
): ScanForComparison {
  const capturedAt = new Date(Date.UTC(2026, 6, 6) + daysFromBaseline * 86_400_000);
  return { id, capturedAt, quality: { ...BASE, ...quality } };
}

/** Narrows to the labelled case, failing the test if the verdict was a refusal. */
function labelled(v: ComparisonVerdict) {
  assert.equal(v.kind, 'labelled', `expected a label, got ${v.kind}`);
  if (v.kind !== 'labelled') throw new Error('unreachable');
  return v;
}

const baseline = scan('a', 0);

describe('hard gates', () => {
  it('refuses to compare HD against SD', () => {
    const v = assessComparison(baseline, scan('b', 14, { tier: 'sd' }));
    assert.equal(v.kind, 'refused');
    if (v.kind === 'refused') assert.equal(v.reason, 'tier_mismatch');
  });

  it('refuses in both directions', () => {
    const sdFirst = scan('a', 0, { tier: 'sd' });
    assert.equal(assessComparison(sdFirst, scan('b', 14, { tier: 'hd' })).kind, 'refused');
  });

  it('reports not enough evidence with fewer than two scans', () => {
    assert.equal(assessComparison(baseline, null).kind, 'insufficient');
    assert.equal(assessComparison(null, null).kind, 'insufficient');
  });

  it('will not compare a scan with itself', () => {
    assert.equal(assessComparison(baseline, baseline).kind, 'insufficient');
  });

  it('checks tier before conditions, even when conditions are terrible', () => {
    const awful = scan('b', 400, { tier: 'sd', lightingLevel: 0.1, faceRatio: 1, yaw: 40 });
    assert.equal(assessComparison(baseline, awful).kind, 'refused');
  });
});

describe('labelling', () => {
  it('identical conditions 14 days apart are comparable', () => {
    const v = labelled(assessComparison(baseline, scan('b', 14)));
    assert.equal(v.label, 'comparable_capture');
    assert.equal(v.weakest, null);
    assert.equal(v.daysApart, 14);
  });

  it('one loose signal gives a directional check', () => {
    const v = labelled(
      assessComparison(baseline, scan('b', 14, { lightingLevel: BASE.lightingLevel + 0.15 })),
    );
    assert.equal(v.label, 'directional_check');
    assert.equal(v.weakest?.id, 'lightingLevel');
  });

  it('two loose signals fall back to treat with care', () => {
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, {
          lightingLevel: BASE.lightingLevel + 0.15,
          faceRatio: BASE.faceRatio + 0.08,
        }),
      ),
    );
    assert.equal(v.label, 'treat_with_care');
  });

  it('a single bad signal is treat with care regardless of the rest', () => {
    const v = labelled(assessComparison(baseline, scan('b', 14, { yaw: BASE.yaw + 20 })));
    assert.equal(v.label, 'treat_with_care');
    assert.equal(v.weakest?.id, 'headAngle');
  });

  it('always marks the verdict provisional', () => {
    assert.equal(labelled(assessComparison(baseline, scan('b', 14))).provisional, true);
  });
});

describe('band boundaries', () => {
  it('exactly on the ok edge stays ok', () => {
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, { lightingLevel: BASE.lightingLevel + BANDS.lightingLevel.ok }),
      ),
    );
    assert.equal(v.label, 'comparable_capture');
  });

  it('a hair over the ok edge becomes directional', () => {
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, { lightingLevel: BASE.lightingLevel + BANDS.lightingLevel.ok + 0.001 }),
      ),
    );
    assert.equal(v.label, 'directional_check');
  });

  it('exactly on the loose edge is still directional', () => {
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, { lightingLevel: BASE.lightingLevel + BANDS.lightingLevel.loose }),
      ),
    );
    assert.equal(v.label, 'directional_check');
  });

  it('past the loose edge is treat with care', () => {
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, { lightingLevel: BASE.lightingLevel + BANDS.lightingLevel.loose + 0.001 }),
      ),
    );
    assert.equal(v.label, 'treat_with_care');
  });

  it('head angle takes the largest single axis, not the sum', () => {
    // Each axis 2 degrees off. Individually inside the 3 degree band.
    const v = labelled(
      assessComparison(
        baseline,
        scan('b', 14, { yaw: BASE.yaw + 2, pitch: BASE.pitch + 2, roll: BASE.roll + 2 }),
      ),
    );
    assert.equal(v.label, 'comparable_capture');
  });

  it('direction of the difference does not matter', () => {
    const up = labelled(
      assessComparison(baseline, scan('b', 14, { faceRatio: BASE.faceRatio + 0.08 })),
    );
    const down = labelled(
      assessComparison(baseline, scan('b', 14, { faceRatio: BASE.faceRatio - 0.08 })),
    );
    assert.equal(up.label, down.label);
  });
});

describe('time between check-ins', () => {
  it('same day is outside even the loose band', () => {
    const v = labelled(assessComparison(baseline, scan('b', 0)));
    assert.equal(v.label, 'treat_with_care');
    assert.equal(v.weakest?.id, 'daysApart');
  });

  it('a daily check-in is refused as a comparison', () => {
    assert.equal(labelled(assessComparison(baseline, scan('b', 1))).label, 'treat_with_care');
  });

  it('three days apart is directional, not comparable', () => {
    const v = labelled(assessComparison(baseline, scan('b', DAYS_APART.loose.min)));
    assert.equal(v.label, 'directional_check');
  });

  it('seven days apart is comparable', () => {
    const v = labelled(assessComparison(baseline, scan('b', DAYS_APART.ok.min)));
    assert.equal(v.label, 'comparable_capture');
  });

  it('beyond the loose maximum is treat with care', () => {
    const v = labelled(assessComparison(baseline, scan('b', DAYS_APART.loose.max + 1)));
    assert.equal(v.label, 'treat_with_care');
  });

  it('counts days regardless of argument order', () => {
    const a = new Date(Date.UTC(2026, 6, 6));
    const b = new Date(Date.UTC(2026, 6, 20));
    assert.equal(daysBetween(a, b), 14);
    assert.equal(daysBetween(b, a), 14);
  });
});

describe('copy', () => {
  it('names every label', () => {
    assert.equal(labelText('comparable_capture'), 'Comparable capture');
    assert.equal(labelText('directional_check'), 'Use as a directional check');
    assert.equal(labelText('treat_with_care'), 'Treat with care');
    assert.equal(labelText('not_enough_evidence'), 'Not enough evidence');
  });

  it('explains a refusal without blaming the photo', () => {
    const text = rationale(assessComparison(baseline, scan('b', 14, { tier: 'sd' })));
    assert.match(text, /different instruments/i);
    assert.doesNotMatch(text, /fail|bad|wrong/i);
  });

  it('gives one sentence, never a list', () => {
    const text = rationale(assessComparison(baseline, scan('b', 14, { yaw: BASE.yaw + 20 })));
    const sentences = text.split('.').filter((s) => s.trim().length > 0);
    assert.equal(sentences.length, 1);
  });

  it('distinguishes too close together from too far apart', () => {
    assert.match(rationale(assessComparison(baseline, scan('b', 0))), /too close/i);
    assert.match(rationale(assessComparison(baseline, scan('b', 300))), /long gap/i);
  });
});

/**
 * Unmeasured capture conditions.
 *
 * These guard the rule that makes "measured confidence" mean anything. A capture
 * path without face detection still has to put a number in faceRatio, yaw, pitch
 * and roll. If those are graded, two zeroes look like a perfectly square-on head
 * at identical distance, and the app awards its strongest label on the strength
 * of data nobody collected.
 */
describe('declared capture conditions', () => {
  it('never reaches comparable capture, even under otherwise perfect conditions', () => {
    // Identical lighting, ideal spacing. The only thing missing is measurement.
    const verdict = labelled(
      assessComparison(
        scan('a', 0, { source: 'declared' }),
        scan('b', 21, { source: 'declared' }),
      ),
    );
    assert.equal(verdict.label, 'directional_check');
  });

  it('reaches comparable capture once both captures are measured', () => {
    // The same two scans with provenance as the only difference, proving the cap
    // comes from the missing measurement and not from some other signal.
    const verdict = labelled(assessComparison(scan('a', 0), scan('b', 21)));
    assert.equal(verdict.label, 'comparable_capture');
  });

  it('marks framing and pose unmeasured rather than passing them as ideal', () => {
    const verdict = labelled(
      assessComparison(
        scan('a', 0, { source: 'declared' }),
        scan('b', 21, { source: 'declared' }),
      ),
    );
    const byId = new Map(verdict.signals.map((s) => [s.id, s.status]));
    assert.equal(byId.get('faceRatio'), 'unmeasured');
    assert.equal(byId.get('headAngle'), 'unmeasured');
    // Lighting is computable from pixels, so it is still graded.
    assert.equal(byId.get('lightingLevel'), 'ok');
    assert.equal(byId.get('lightingUneven'), 'ok');
  });

  it('is enough for one side to be unmeasured', () => {
    // The delta needs both. One measured capture cannot rescue the pair.
    const verdict = labelled(
      assessComparison(scan('a', 0, { source: 'declared' }), scan('b', 21)),
    );
    assert.equal(verdict.label, 'directional_check');
  });

  it('says the condition was not checked, rather than that it was poor', () => {
    const verdict = assessComparison(
      scan('a', 0, { source: 'declared' }),
      scan('b', 21, { source: 'declared' }),
    );
    const text = rationale(verdict);
    assert.match(text, /could not measure/);
    // Must not imply the user did something wrong with framing or angle.
    assert.doesNotMatch(text, /turned further|closer to the camera/);
  });

  it('still lets a genuinely bad measured signal outrank an unmeasured one', () => {
    // A condition that definitely broke is more useful to report than one that
    // was never observed, so the rationale should name the light.
    const verdict = labelled(
      assessComparison(
        scan('a', 0, { source: 'declared', lightingLevel: 0.2 }),
        scan('b', 21, { source: 'declared', lightingLevel: 0.9 }),
      ),
    );
    assert.equal(verdict.label, 'treat_with_care');
    assert.equal(verdict.weakest?.id, 'lightingLevel');
  });

  it('refuses a tier mismatch before provenance is even considered', () => {
    const verdict = assessComparison(
      scan('a', 0, { source: 'camerakit' }),
      scan('b', 21, { source: 'declared', tier: 'sd' }),
    );
    assert.equal(verdict.kind, 'refused');
  });
});

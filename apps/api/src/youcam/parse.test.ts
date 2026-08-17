/**
 * Parser tests.
 *
 * The first test is the one that matters. The prototype design showed a single
 * pore score when the provider returns four, and that mistake was invisible
 * because nothing asserted the count. So this asserts it: every region the
 * registry declares for a tier must come back from a parse, or the test fails.
 *
 * The rest cover the two plausible nesting shapes, because the documentation
 * specifies the flat one precisely and leaves the regional one open.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { METRICS, regionsFor, type Tier } from '@glowdays/core';

import { fixtureAnalysis } from './fixtures.js';
import { parseAnalysis } from './parse.js';

function readingFor(
  parsed: ReturnType<typeof parseAnalysis>,
  metric: string,
  region: string,
) {
  return parsed.metrics.find((m) => m.metric === metric && m.region === region);
}

test('every declared region survives a parse of the fixture', () => {
  for (const tier of ['hd', 'sd'] as Tier[]) {
    const parsed = parseAnalysis(fixtureAnalysis('task-regions', tier), tier);
    assert.equal(parsed.unmapped.length, 0, `unmapped nodes for ${tier}: ${parsed.unmapped}`);

    for (const def of METRICS) {
      const regions = regionsFor(def.id, tier) ?? ['whole'];
      for (const region of regions) {
        const hit = readingFor(parsed, def.id, region);
        assert.ok(hit, `${tier}: missing ${def.id} / ${region}`);
        if (def.kind === 'score') {
          assert.equal(typeof hit.rawScore, 'number', `${tier}: ${def.id}/${region} has no score`);
        } else {
          assert.equal(
            typeof hit.categoryValue,
            'string',
            `${tier}: ${def.id}/${region} has no category`,
          );
        }
      }
    }
  }
});

test('pore returns four regions in HD and one in SD', () => {
  const hd = parseAnalysis(fixtureAnalysis('task-pore', 'hd'), 'hd');
  const hdPore = hd.metrics.filter((m) => m.metric === 'pore');
  assert.equal(hdPore.length, 4);
  assert.deepEqual(
    hdPore.map((m) => m.region).sort(),
    ['cheek', 'forehead', 'nose', 'whole'],
  );

  const sd = parseAnalysis(fixtureAnalysis('task-pore', 'sd'), 'sd');
  const sdPore = sd.metrics.filter((m) => m.metric === 'pore');
  assert.equal(sdPore.length, 1);
  assert.equal(sdPore[0]?.region, 'whole');
});

test('wrinkles returns seven regions in HD', () => {
  const parsed = parseAnalysis(fixtureAnalysis('task-wrinkle', 'hd'), 'hd');
  const rows = parsed.metrics.filter((m) => m.metric === 'wrinkles');
  assert.equal(rows.length, 7);
});

test('the whole region is not the mean of its parts', () => {
  // The provider computes whole independently. If a future refactor started
  // averaging the parts, comparisons would drift without anything failing.
  const parsed = parseAnalysis(fixtureAnalysis('task-mean', 'hd'), 'hd');
  const pore = parsed.metrics.filter((m) => m.metric === 'pore');
  const whole = pore.find((m) => m.region === 'whole')?.rawScore;
  const parts = pore.filter((m) => m.region !== 'whole').map((m) => m.rawScore ?? 0);
  const mean = parts.reduce((a, b) => a + b, 0) / parts.length;
  assert.ok(typeof whole === 'number');
  assert.notEqual(Math.round(whole * 100), Math.round(mean * 100));
});

test('ui_score never lands in rawScore', () => {
  const payload = {
    results: { output: [{ type: 'hd_moisture', raw_score: 51.25, ui_score: 62 }] },
  };
  const parsed = parseAnalysis(payload, 'hd');
  const hit = readingFor(parsed, 'hydration', 'whole');
  assert.equal(hit?.rawScore, 51.25);
  assert.equal(hit?.uiScore, 62);
});

test('the suffixed shape resolves to the same metric and region', () => {
  // hd_pore_forehead rather than hd_pore -> subcategories -> forehead.
  const payload = {
    results: {
      output: [
        { type: 'hd_pore_forehead', raw_score: 44.5 },
        { type: 'hd_pore_output_nose', raw_score: 39.25 },
        { type: 'hd_pore_all', raw_score: 47.0 },
      ],
    },
  };
  const parsed = parseAnalysis(payload, 'hd');
  assert.equal(readingFor(parsed, 'pore', 'forehead')?.rawScore, 44.5);
  assert.equal(readingFor(parsed, 'pore', 'nose')?.rawScore, 39.25);
  // `all` is the provider's name for the whole-face variant in mask filenames.
  assert.equal(readingFor(parsed, 'pore', 'whole')?.rawScore, 47.0);
});

test('the object-keyed shape resolves too', () => {
  const payload = {
    data: {
      hd_wrinkle: {
        whole: { raw_score: 60 },
        crowfeet: { raw_score: 55.5 },
        forehead: { raw_score: 62.25 },
      },
    },
  };
  const parsed = parseAnalysis(payload, 'hd');
  assert.equal(readingFor(parsed, 'wrinkles', 'crowfeet')?.rawScore, 55.5);
  assert.equal(readingFor(parsed, 'wrinkles', 'forehead')?.rawScore, 62.25);
  assert.equal(readingFor(parsed, 'wrinkles', 'whole')?.rawScore, 60);
});

test('HD action names are not read as SD ones', () => {
  // dark_circle is hd_dark_circle in HD but dark_circle_v2 in SD. Treating the
  // two as a prefix swap is the mistake this guards.
  const hdPayload = { results: { output: [{ type: 'hd_dark_circle', raw_score: 53 }] } };
  assert.equal(readingFor(parseAnalysis(hdPayload, 'hd'), 'darkCircle', 'whole')?.rawScore, 53);

  const sdPayload = { results: { output: [{ type: 'dark_circle_v2', raw_score: 49 }] } };
  assert.equal(readingFor(parseAnalysis(sdPayload, 'sd'), 'darkCircle', 'whole')?.rawScore, 49);

  // An HD name in an SD parse must not silently resolve.
  const crossed = parseAnalysis({ results: { output: [{ type: 'hd_dark_circle', raw_score: 53 }] } }, 'sd');
  assert.equal(readingFor(crossed, 'darkCircle', 'whole'), undefined);
  assert.equal(crossed.unmapped.length, 1);
});

test('unknown scored nodes are reported rather than dropped', () => {
  const payload = {
    results: {
      output: [
        { type: 'hd_moisture', raw_score: 50 },
        { type: 'hd_brand_new_metric', raw_score: 70 },
      ],
    },
  };
  const parsed = parseAnalysis(payload, 'hd');
  assert.equal(parsed.metrics.length, 1);
  assert.equal(parsed.unmapped.length, 1);
  assert.match(parsed.unmapped[0] ?? '', /hd_brand_new_metric/);
});

test('overall score and skin age are read, and overall is not a metric', () => {
  const parsed = parseAnalysis(fixtureAnalysis('task-overall', 'hd'), 'hd');
  assert.equal(typeof parsed.overallScore, 'number');
  assert.equal(typeof parsed.skinAge, 'number');
  assert.ok(!parsed.metrics.some((m) => m.region === 'all'));
});

test('mask urls are captured per region', () => {
  const parsed = parseAnalysis(fixtureAnalysis('task-masks', 'hd'), 'hd');
  const pore = parsed.metrics.filter((m) => m.metric === 'pore');
  assert.equal(pore.length, 4);
  for (const row of pore) {
    assert.match(row.maskUrl ?? '', /fixture-mask/);
  }
  // Each region gets its own overlay, not the parent's.
  const urls = new Set(pore.map((r) => r.maskUrl));
  assert.equal(urls.size, 4);
});

test('the same task id always parses to the same numbers', () => {
  const a = parseAnalysis(fixtureAnalysis('stable', 'hd'), 'hd');
  const b = parseAnalysis(fixtureAnalysis('stable', 'hd'), 'hd');
  assert.deepEqual(a.metrics, b.metrics);
  assert.equal(a.overallScore, b.overallScore);
});

test('empty and malformed payloads produce nothing rather than throwing', () => {
  for (const payload of [null, undefined, {}, [], 'nope', 42, { data: null }]) {
    const parsed = parseAnalysis(payload, 'hd');
    assert.equal(parsed.metrics.length, 0);
    assert.equal(parsed.unmapped.length, 0);
  }
});

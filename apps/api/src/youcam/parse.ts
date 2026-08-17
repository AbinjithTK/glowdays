/**
 * Turns a provider response into metric rows.
 *
 * Why this walks the tree instead of reading fixed paths:
 *
 * The documentation specifies the flat shape precisely - `output[]` entries
 * with `type`, `raw_score`, `ui_score`, `mask_urls[]` - but it does not specify
 * how the subcategorised metrics nest. `hd_pore` has four regions and
 * `hd_wrinkle` has seven, and the reference notes both a suffixed filename
 * convention (`hd_pore_output_forehead.png`) and a subcategory concept without
 * pinning the JSON layout for either.
 *
 * Reading fixed paths against an unverified shape means silently dropping the
 * three pore regions we already caught the design dropping once. So instead we
 * collect every node that carries a score, and resolve which metric and region
 * it belongs to from the key path. Anything that cannot be resolved is returned
 * in `unmapped` rather than discarded, so a shape surprise shows up as a
 * logged warning instead of missing data.
 */

import { METRICS, type MetricDef, type MetricId, type Tier } from '@glowdays/core';

export interface ParsedMetric {
  readonly metric: MetricId;
  readonly region: string;
  readonly rawScore: number | null;
  readonly uiScore: number | null;
  readonly categoryValue: string | null;
  /** Provider mask URL. Valid for two hours, so it must be copied promptly. */
  readonly maskUrl: string | null;
}

export interface ParsedAnalysis {
  readonly metrics: readonly ParsedMetric[];
  /** `all.score`, the provider's overall figure. Stored, never compared. */
  readonly overallScore: number | null;
  readonly skinAge: number | null;
  /** Key paths carrying a score that no metric claimed. Should be empty. */
  readonly unmapped: readonly string[];
}

// ------------------------------------------------------------- action index

interface ActionEntry {
  readonly def: MetricDef;
  readonly regions: readonly string[];
}

function actionIndex(tier: Tier): Map<string, ActionEntry> {
  const index = new Map<string, ActionEntry>();
  for (const def of METRICS) {
    index.set(def.action[tier], { def, regions: def.regions[tier] ?? ['whole'] });
  }
  return index;
}

// ------------------------------------------------------------ tree walking

interface Candidate {
  /** Key path from the response root, deepest last. */
  readonly path: readonly string[];
  readonly rawScore: number | null;
  readonly uiScore: number | null;
  readonly categoryValue: string | null;
  readonly maskUrl: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function firstMaskUrl(node: Record<string, unknown>): string | null {
  const single = node['mask_url'] ?? node['output_mask_url'] ?? node['url'];
  if (typeof single === 'string' && single.startsWith('http')) return single;
  const list = node['mask_urls'] ?? node['masks'];
  if (Array.isArray(list)) {
    for (const item of list) {
      if (typeof item === 'string' && item.startsWith('http')) return item;
      const rec = asRecord(item);
      const nested = rec?.['url'];
      if (typeof nested === 'string' && nested.startsWith('http')) return nested;
    }
  }
  return null;
}

/**
 * The categorical value for skin type. Kept narrow deliberately: matching any
 * string field would swallow mask filenames and status strings.
 */
function categoryValue(node: Record<string, unknown>): string | null {
  for (const key of ['skin_type', 'category', 'class', 'label', 'value', 'result']) {
    const v = node[key];
    if (typeof v === 'string' && v.trim() !== '' && !v.startsWith('http') && !v.includes('.png')) {
      return v.trim();
    }
  }
  return null;
}

const SCORE_KEYS = ['raw_score', 'ui_score', 'score'] as const;

function hasScore(node: Record<string, unknown>): boolean {
  return SCORE_KEYS.some((k) => num(node[k]) !== null);
}

/**
 * Depth-first walk. Where an array element names itself with `type`, that name
 * is used as the path segment instead of the numeric index, which is what makes
 * `output: [{ type: 'hd_pore', ... }]` resolvable.
 */
function collect(node: unknown, path: readonly string[], out: Candidate[], depth = 0): void {
  if (depth > 12) return;

  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      const rec = asRecord(item);
      const named = rec?.['type'] ?? rec?.['name'] ?? rec?.['action'];
      const segment = typeof named === 'string' && named ? named : String(i);
      collect(item, [...path, segment], out, depth + 1);
    }
    return;
  }

  const rec = asRecord(node);
  if (!rec) return;

  const cat = categoryValue(rec);
  if (hasScore(rec) || cat !== null) {
    const raw = num(rec['raw_score']);
    out.push({
      path,
      // `score` alone (as on `all`) is treated as raw, never as a UI figure.
      rawScore: raw ?? num(rec['score']),
      uiScore: num(rec['ui_score']),
      categoryValue: cat,
      maskUrl: firstMaskUrl(rec),
    });
  }

  for (const [key, value] of Object.entries(rec)) {
    if (SCORE_KEYS.includes(key as (typeof SCORE_KEYS)[number])) continue;
    if (key === 'mask_urls' || key === 'masks') continue;
    collect(value, [...path, key], out, depth + 1);
  }
}

// ---------------------------------------------------------------- resolving

interface Resolved {
  readonly metric: MetricId;
  readonly region: string;
}

/**
 * Work backwards along the path looking for something that names an action.
 * Both `['output','hd_pore','forehead']` and `['output','hd_pore_forehead']`
 * resolve to the same metric and region.
 */
function resolve(path: readonly string[], index: Map<string, ActionEntry>): Resolved | null {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const segment = path[i];
    if (!segment) continue;
    const token = segment.toLowerCase();

    const exact = index.get(token);
    if (exact) {
      return { metric: exact.def.id, region: regionFrom(path.slice(i + 1), exact) };
    }

    // Suffixed form: the action name with a region glued on.
    for (const [action, entry] of index) {
      if (!token.startsWith(action)) continue;
      const rest = normaliseRegionToken(token.slice(action.length));
      if (rest === '') return { metric: entry.def.id, region: regionFrom(path.slice(i + 1), entry) };
      const region = matchRegion(rest, entry);
      if (region) return { metric: entry.def.id, region };
    }
  }
  return null;
}

function regionFrom(tail: readonly string[], entry: ActionEntry): string {
  for (const segment of tail) {
    const region = matchRegion(segment.toLowerCase(), entry);
    if (region) return region;
  }
  return 'whole';
}

/**
 * Strip the noise around a region name.
 *
 * The provider's mask filenames put `output` between the action and the region
 * (`hd_pore_output_forehead`) as well as at the end (`hd_texture_output`), and
 * file extensions come along too. Splitting on the separator and dropping those
 * segments handles every position, which a suffix-only trim did not.
 */
function normaliseRegionToken(token: string): string {
  return token
    .replace(/\.(png|jpg|jpeg)$/, '')
    .split(/[_-]+/)
    .filter((part) => part !== '' && part !== 'output')
    .join('_');
}

function matchRegion(token: string, entry: ActionEntry): string | null {
  const cleaned = normaliseRegionToken(token);
  // The provider uses `all` in mask filenames for the whole-face variant.
  if (cleaned === 'all' || cleaned === '') return 'whole';
  for (const region of entry.regions) {
    if (cleaned === region) return region;
  }
  return null;
}

// ------------------------------------------------------------------ public

export function parseAnalysis(payload: unknown, tier: Tier): ParsedAnalysis {
  const index = actionIndex(tier);
  const candidates: Candidate[] = [];
  collect(payload, [], candidates);

  const byKey = new Map<string, ParsedMetric>();
  const unmapped: string[] = [];
  let overallScore: number | null = null;
  let skinAge: number | null = null;

  for (const candidate of candidates) {
    const last = candidate.path[candidate.path.length - 1]?.toLowerCase();

    if (last === 'all') {
      overallScore ??= candidate.rawScore;
      continue;
    }

    const hit = resolve(candidate.path, index);
    if (!hit) {
      if (candidate.rawScore !== null || candidate.uiScore !== null) {
        unmapped.push(candidate.path.join('.') || '(root)');
      }
      continue;
    }

    const key = `${hit.metric}:${hit.region}`;
    const existing = byKey.get(key);
    // First writer wins on each field. A deeper regional node should not be
    // overwritten by a shallower parent that happens to repeat a score.
    byKey.set(key, {
      metric: hit.metric,
      region: hit.region,
      rawScore: existing?.rawScore ?? candidate.rawScore,
      uiScore: existing?.uiScore ?? candidate.uiScore,
      categoryValue: existing?.categoryValue ?? candidate.categoryValue,
      maskUrl: existing?.maskUrl ?? candidate.maskUrl,
    });
  }

  const root = asRecord(payload);
  const data = asRecord(root?.['data']) ?? root;
  skinAge = num(data?.['skin_age']) ?? num(root?.['skin_age']);
  if (overallScore === null) {
    const all = asRecord(data?.['all']);
    overallScore = num(all?.['score']) ?? null;
  }

  return {
    metrics: [...byKey.values()],
    overallScore,
    skinAge,
    unmapped,
  };
}

/**
 * Probe the diary: sticker tags, date windows, edits and deletes.
 *
 * The stickers are stored as note tags, which the API validates at 24 characters
 * and 8 per entry. Emoji are multi-byte and Zod counts UTF-16 code units, so it is
 * worth proving that a sticker id survives the round trip rather than assuming it -
 * and that the windowed fetch a trial verdict depends on actually filters.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const BASE = readFileSync('deployed-url.txt', 'utf8').trim().replace(/\/+$/, '');
const CODE = readFileSync('access-code.txt', 'utf8').trim();

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

const token = (
  await (
    await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `diary+${Date.now()}@example.com`, code: CODE }),
    })
  ).json()
).token;

const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  log(`${method} ${path} -> ${res.status}  ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

// A sticker-only entry, which is the common case the composer is built around.
const first = await call('POST', '/v1/notes', {
  body: 'Slept badly, Drank',
  tags: ['poor_sleep', 'alcohol'],
  noteOn: day(2),
});

// A full eight, the API's cap, to confirm the picker's limit matches the server's.
await call('POST', '/v1/notes', {
  body: 'Everything at once',
  tags: ['poor_sleep', 'stress', 'sun', 'heat', 'travel', 'cycle', 'new_product', 'exfoliated'],
  noteOn: day(1),
});

// Nine must be refused, otherwise the client cap is decoration.
await call('POST', '/v1/notes', {
  body: 'One too many',
  tags: ['poor_sleep', 'stress', 'sun', 'heat', 'travel', 'cycle', 'new_product', 'exfoliated', 'calm'],
});

// Observations only, which must summarise as zero confounders.
await call('POST', '/v1/notes', { body: 'Skin felt fine', tags: ['calm'], noteOn: day(0) });

log('--- windowed fetch, as a trial verdict does it ---');
const windowed = await call('GET', `/v1/notes?from=${day(2)}&to=${day(1)}`);
log(`entries in the two-day window: ${windowed?.notes?.length ?? 0} (expect 2)`);

log('--- tags survive the round trip ---');
const all = await call('GET', '/v1/notes');
const tags = (all?.notes ?? []).flatMap((n) => n.tags);
log(`distinct tags stored: ${[...new Set(tags)].sort().join(', ')}`);

log('--- edit and delete, which had no client until now ---');
if (first?.note?.id) {
  await call('PATCH', `/v1/notes/${first.note.id}`, { tags: ['poor_sleep'] });
  await call('DELETE', `/v1/notes/${first.note.id}`);
}

writeFileSync('probe-diary.txt', out.join('\n'));

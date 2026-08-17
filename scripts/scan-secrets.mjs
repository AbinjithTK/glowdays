/**
 * Scan the entire git history for credentials.
 *
 * Written because the pre-commit check that ran before publishing this repository
 * tested filenames and not file contents. It correctly excluded .env,
 * access-code.txt, signing-secret.txt and the editor MCP config - and then
 * committed a deploy script with a live Neon connection string hardcoded inside it,
 * which Neon's own scanner found within the hour.
 *
 * The lesson is the obvious one: a filename allowlist cannot tell you what is in a
 * file. This reads content, and it reads every commit rather than just the working
 * tree, because a secret removed in a later commit is still served by GitHub at the
 * blob URL of the earlier one.
 *
 * Values are masked in the output. There is no reason to reprint a live credential
 * into a terminal, a log file, or a transcript in order to report that it leaked.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const PATTERNS = [
  // Neon and any other Postgres URL carrying a password.
  { name: 'postgres connection string', re: /postgres(?:ql)?:\/\/[^\s"'`;)]+/gi },
  // Neon role passwords are prefixed.
  { name: 'neon password', re: /\bnpg_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'aws secret access key', re: /\baws_secret_access_key\s*=\s*\S+/gi },
  // Perfect Corp / OpenAI style.
  { name: 'sk- api key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'bearer token', re: /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'x-amz-signature', re: /X-Amz-Signature=[0-9a-f]{32,}/gi },
];

/** Show enough to identify which credential, never enough to use it. */
function mask(value) {
  const flat = value.replace(/\s+/g, ' ');
  if (flat.length <= 12) return `${flat.slice(0, 3)}***`;
  return `${flat.slice(0, 10)}…***…${flat.slice(-4)} (${flat.length} chars)`;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 });
}

const out = [];
const log = (l) => {
  out.push(l);
  console.log(l);
};

// -------------------------------------------------- every commit, every diff

// -U0 keeps only changed lines, so context lines cannot produce phantom hits.
const history = git(['log', '-p', '-U0', '--all', '--no-color']);

let commit = '(unknown)';
let file = '(unknown)';
const findings = new Map();

for (const line of history.split('\n')) {
  if (line.startsWith('commit ')) {
    commit = line.slice(7, 14);
    continue;
  }
  if (line.startsWith('+++ b/')) {
    file = line.slice(6);
    continue;
  }
  // Only added lines. A '-' line means it was removed, which still matters, but it
  // was added by some earlier commit and will be caught there.
  if (!line.startsWith('+') || line.startsWith('+++')) continue;

  for (const { name, re } of PATTERNS) {
    for (const match of line.matchAll(re)) {
      const key = `${name}::${file}`;
      const entry = findings.get(key) ?? { name, file, commits: new Set(), sample: match[0] };
      entry.commits.add(commit);
      findings.set(key, entry);
    }
  }
}

log('=== SECRETS FOUND IN GIT HISTORY ===');
if (findings.size === 0) {
  log('none');
} else {
  for (const entry of findings.values()) {
    log(`[${entry.name}]`);
    log(`  file:    ${entry.file}`);
    log(`  commits: ${[...entry.commits].join(', ')}`);
    log(`  value:   ${mask(entry.sample)}`);
  }
}

// ------------------------------------------------- and the working tree now

log('');
log('=== STILL PRESENT IN THE WORKING TREE (tracked files) ===');
const tracked = git(['ls-files']).split('\n').filter(Boolean);
let liveHits = 0;
for (const path of tracked) {
  let text;
  try {
    text = git(['show', `HEAD:${path}`]);
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      liveHits += 1;
      log(`${path}  [${name}]  ${mask(match[0])}`);
    }
  }
}
if (liveHits === 0) log('none');

writeFileSync('secret-scan.txt', out.join('\n'));

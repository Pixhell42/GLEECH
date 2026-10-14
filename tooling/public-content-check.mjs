import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ownPath = 'tooling/public-content-check.mjs';
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--history'))
  throw new Error('Usage: public-content-check.mjs [--history]');

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

// Inspect tracked files even when ignored; also inspect publishable new files.
const paths = [
  ...new Set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')),
].filter((path) => path && existsSync(new URL(path, new URL('../', import.meta.url))));
const privatePath =
  /(?:^|\/)(?:private-references|source-references|reference-materials|shader-ideas|set2-review)(?:\/|$)|^assets\/branding\/options\/|^assets\/[^/]+-generated\.png$|(?:^|\/)(?:PROMPTS|REFERENCE_EFFECT_COLLECTION|FILTER_FEATURE_AUDIT|GLEECH_v0\.1_Product_Technical_Design)\.md$|-thumbnail-prompt\.txt$|(?:^|\/)shader\d+(?:-\d+)?\.(?:mp4|jpg)$|(?:^|\/)(?:\.env(?!\.example$)(?:\..*)?|[^/]+\.(?:pem|p12|pfx))$/i;
const privateText = [
  { pattern: /^#{1,6}\s*(?:image\s+)?generation\s+prompt\b/i, label: 'generation prompt section' },
  {
    pattern: /(?:[A-Z]:[\\/]Users[\\/][^\r\n`]*[\\/]Desktop[\\/])(?:set2|shader ideas)\b/i,
    label: 'private source folder',
  },
  { pattern: /\bshader\d+\.mp4\b/i, label: 'numbered source video' },
  { pattern: /REFERENCE_EFFECT_COLLECTION\.md/i, label: 'removed source-review document' },
  {
    pattern: /(?:reference|video)\s+\d{1,2}(?:'s|’s|\s+(?:and|is|was|shows|combines))\b/i,
    label: 'source-to-effect mapping',
  },
];
const problems = [];
for (const path of paths) {
  if (path === ownPath) continue;
  if (privatePath.test(path)) problems.push(`${path}: private reference material`);
  if (!/\.(?:md|txt|json|[cm]?js|tsx?|ya?ml|html|py|kernel)$/i.test(path)) continue;
  const lines = readFileSync(new URL(path, new URL('../', import.meta.url)), 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { pattern, label } of privateText) {
      if (pattern.test(lines[i])) problems.push(`${path}:${i + 1}: ${label}`);
    }
  }
}

// Optional publication gate: deletion alone does not clean old branches/tags.
// This checks historical filenames; it does not replace a full content/secrets audit.
if (args.includes('--history')) {
  const historical = new Set(
    git('log', '--all', '--format=', '--name-only', '--diff-filter=A').split(/\r?\n/),
  );
  for (const path of historical) {
    if (privatePath.test(path)) problems.push(`history: ${path}: private reference material`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(
    'Keep source references outside the repository. Publish only the reviewed clean starting point.',
  );
  process.exitCode = 1;
} else {
  console.log(
    `Public content check passed (${paths.length} current files${args.includes('--history') ? ', history filenames checked' : ''}).`,
  );
}

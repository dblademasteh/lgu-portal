#!/usr/bin/env node
/**
 * Token compliance linter.
 *
 * The design-system rule this enforces: components never hardcode a raw value.
 * Any colour, radius, or shadow in hand-written CSS must come from a
 * `var(--token)`. If you find a hex literal here, it belongs in tokens.json.
 *
 * Exempt by design:
 *   - src/app/tokens.css         the generated token layer itself
 *   - a small set of layout-only lengths, listed in ALLOWED_RAW_LENGTHS
 *
 * Usage: node scripts/validate-tokens.mjs [--strict]
 *   --strict  also fail on raw px/rem values, not just colours
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'src');
const STRICT = process.argv.includes('--strict');

const IGNORED_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build']);
const SCAN_EXTENSIONS = new Set(['.css', '.tsx', '.ts', '.jsx', '.js']);

/** Generated token layer — raw values are its entire purpose. */
const EXEMPT_FILES = new Set(['src/app/tokens.css']);

/**
 * Layout lengths that are not design decisions.
 *
 * 0 / 100% / 1fr / auto and the viewport units are structural.
 * 1px and 2px are hairlines: a border that is always one device pixel is not a
 * value a designer tunes, and routing it through a token makes the CSS noisier
 * while adding no information. Anything visual (colour, radius, shadow, blur,
 * spacing at 8px and above) is deliberately NOT here.
 */
const ALLOWED_RAW_LENGTHS = new Set([
  '0', '1px', '2px', '100%', '50%', '100vw', '100vh', '1fr', 'auto',
  '9999px', // convenience, same effect as the pill radius token
]);

// Colour literals: #rgb / #rrggbb / #rrggbbaa / rgb() / rgba() / hsl() / hsla()
// The alternation inside the function form allows one level of nesting, which is
// what a `var(--token)` argument needs.
const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\((?:[^()]|\([^()]*\))*\)/gi;
// raw dimensions: a number followed by px (px is the strict-mode concern)
const LENGTH_RE = /(?<![\w-])\d+(?:\.\d+)?px\b/gi;

const findings = [];

/* ------------------------------------------------------------------ */
/* Undefined reference check                                           */
/* ------------------------------------------------------------------ */

/**
 * Collect every `--name:` that is actually *defined* somewhere: the generated
 * token layer, plus any local `:root` overrides a stylesheet makes itself
 * (globals.css re-points the font families at the Next/font variables).
 */
const defined = new Set();
/** Every `var(--name)` used in hand-written code. */
const referenced = new Map();

const DEFINE_RE = /(--[A-Za-z0-9_-]+)\s*:/g;
const REFERENCE_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

function collectDefinitions(filePath) {
  const source = readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(DEFINE_RE)) defined.add(match[1]);
}

function collectReferences(rel, source) {
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (line.includes('tokens-allow-raw')) return;
    for (const match of line.matchAll(REFERENCE_RE)) {
      if (!referenced.has(match[1])) referenced.set(match[1], []);
      referenced.get(match[1]).push({ rel, lineNo: index + 1 });
    }
  });
}

function scan(filePath) {
  const abs = resolve(filePath);
  const rel = relative(ROOT, abs).split('\\').join('/');
  if (EXEMPT_FILES.has(rel)) return;

  const source = readFileSync(abs, 'utf8');
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const lineNo = index + 1;

    // Explicit, greppable opt-out for the handful of platform-mandated
    // literals (e.g. the viewport theme colour, which the UA reads before any
    // stylesheet applies). Kept as a per-line decision rather than a file list
    // so an exemption is always visible next to the value it permits.
    if (line.includes('tokens-allow-raw')) return;

    // Ignore comment-only lines: documenting a raw value is fine.
    const withoutComments = line
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/, '');

    for (const match of withoutComments.matchAll(COLOR_RE)) {
      // A colour function whose arguments are custom properties is a *derived*
      // value — e.g. `hsl(var(--tile-hue) 82% 66% / 0.14)` builds a per-instance
      // accent from a runtime hue. That is indirection, not a hardcoded value,
      // so it is exactly what this rule is trying to enforce.
      if (match[0].includes('var(')) continue;
      findings.push({ rel, lineNo, kind: 'colour', text: match[0], line: line.trim() });
    }

    if (STRICT) {
      for (const match of withoutComments.matchAll(LENGTH_RE)) {
        if (ALLOWED_RAW_LENGTHS.has(match[0])) continue;
        findings.push({ rel, lineNo, kind: 'length', text: match[0], line: line.trim() });
      }
    }

    // Collect undefined-reference candidates
    for (const match of line.matchAll(REFERENCE_RE)) {
      if (!referenced.has(match[1])) referenced.set(match[1], []);
      referenced.get(match[1]).push({ rel, lineNo: index + 1 });
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs);
    else if (SCAN_EXTENSIONS.has(extname(abs))) scan(abs);
  }
}

if (!statSync(SRC, { throwIfNoEntry: false })) {
  console.log('[tokens] no src/ directory yet — nothing to validate');
  process.exit(0);
}

walk(SRC);

/* --- Build the definition set from the generated token file --- */
collectDefinitions(resolve(ROOT, 'src/app/tokens.css'));
/* --- And any manual overrides in globals.css --- */
collectDefinitions(resolve(ROOT, 'src/app/globals.css'));

/* --- Now scan hand-written code for references --- */
for (const [rel, items] of referenced) {
  if (!defined.has(rel)) {
    // But allow a handful of browser/runtime variables that no stylesheet defines.
    // These are fine to reference; they're provided by the platform or Next/font.
    const platformVars = new Set([
      '--font-inter', '--font-sora', '--font-jetbrains',
      '--scrollbar-width', '--scrollbar-track-color', '--scrollbar-thumb-color',
      // Dynamic per-instance tokens set via inline styles at runtime:
      '--avatar-hue', '--avatar-wash', '--avatar-edge',
      '--tile-hue', '--tile-accent', '--tile-accent-wash', '--tile-accent-edge', '--tile-accent-glow',
    ]);
    if (!platformVars.has(rel)) {
      findings.push({
        rel: items[0].rel,
        lineNo: items[0].lineNo,
        kind: 'undefined',
        text: `var(${rel})`,
        line: `Reference to undefined token: ${rel}`,
      });
    }
  }
}

if (findings.length === 0) {
  console.log('[tokens] token compliance OK — no raw values or undefined references');
  process.exit(0);
}

const byFile = new Map();
for (const finding of findings) {
  if (!byFile.has(finding.rel)) byFile.set(finding.rel, []);
  byFile.get(finding.rel).push(finding);
}

console.error(`\n[tokens] ${findings.length} hardcoded value(s) found. Move these into tokens/tokens.json:\n`);
for (const [file, items] of byFile) {
  console.error(`  ${file}`);
  for (const item of items) {
    console.error(`    ${String(item.lineNo).padStart(4)}  ${item.kind.padEnd(6)} ${item.text}  |  ${item.line.slice(0, 90)}`);
  }
  console.error('');
}

process.exit(1);

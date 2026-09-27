#!/usr/bin/env node
/**
 * Design token compiler.
 *
 * Reads tokens/tokens.json (W3C DTCG-flavoured) and emits src/app/tokens.css.
 *
 * Project-local, dependency-free copy of the design-system skill's
 * `generate-tokens.cjs`, with two fixes that matter for this codebase:
 *
 *   1. Composite references resolve. The skill version only resolves a value
 *      when the *entire* string is `{a.b.c}`, so `0 6px 20px -6px {semantic.color.glow}`
 *      and `linear-gradient(90deg, {a}, {b})` leaked raw `{...}` into the CSS.
 *      Here, references embedded in a larger string are substituted in place.
 *   2. Keys containing dots work. Dotted numeric scale steps like `2.5` are
 *      ambiguous with the reference path separator, so they are read as
 *      `{primitive.space.2.5}` -> key `2.5` directly, with a dotted-path
 *      fallback.
 *
 * Usage:
 *   node scripts/generate-tokens.mjs
 *   node scripts/generate-tokens.mjs --watch
 *   node scripts/generate-tokens.mjs --config tokens/tokens.json -o src/app/tokens.css
 */

import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `--flag value` / `--flag=value` / `--flag` */
function parseArgs(argv) {
  const out = { config: 'tokens/tokens.json', output: 'src/app/tokens.css', watch: false };
  for (let i = 0; i < argv.length; i++) {
    const [rawKey, inlineValue] = argv[i].split('=');
    const key = rawKey.replace(/^--/, '');
    if (key === 'watch') out.watch = true;
    else if (key === 'config' || key === 'c') out.config = inlineValue ?? argv[++i];
    else if (key === 'output' || key === 'o') out.output = inlineValue ?? argv[++i];
    else if (key === 'help' || key === 'h') {
      console.log('Usage: node scripts/generate-tokens.mjs [--config <f>] [--output <f>] [--watch]');
      process.exit(0);
    }
  }
  return out;
}

/** True when a node in the DTCG tree is a token leaf rather than a group. */
function isToken(node) {
  return Boolean(node) && typeof node === 'object' && !Array.isArray(node) && '$value' in node;
}

/**
 * Walk a token group, resolving each token's value.
 * `path` is the already-joined-prefix list used to name the CSS variable.
 */
function flatten(group, tokens, path, out, seen) {
  if (!group || typeof group !== 'object') return out;

  for (const [key, node] of Object.entries(group)) {
    if (key.startsWith('$')) continue;
    const nextPath = [...path, key];

    if (isToken(node)) {
      out.set(nextPath.join('-').replace(/\./g, '-'), resolveValue(node.$value, tokens, seen));
    } else if (typeof node === 'object') {
      flatten(node, tokens, nextPath, out, seen);
    }
  }
  return out;
}

/**
 * Resolve `{path.to.token}` references inside a value.
 *
 * Every reference in a single value resolves against the *pristine* token tree
 * (`tokens`), never against partially-resolved output, so a token can never
 * inherit another token's mutations. Cycle detection is per-resolution-chain.
 */
function resolveValue(value, tokens, chain = new Set()) {
  if (typeof value !== 'string') return value;

  // No references: return untouched (fast path for literals).
  if (!value.includes('{')) return value;

  return value.replace(/\{([^}]+)\}/g, (match, dottedPath) => {
    const steps = dottedPath.trim().split('.');

    // A dotted numeric key (e.g. `space.2.5`) is ambiguous. Try to consume the
    // longest matching key at each level before falling back to a single step.
    let cursor = tokens;
    const consumed = [];
    let ok = true;

    while (consumed.length < steps.length) {
      const remaining = steps.slice(consumed.length);
      const candidateKey = remaining.join('.');
      if (cursor && typeof cursor === 'object' && candidateKey in cursor) {
        cursor = cursor[candidateKey];
        consumed.push(candidateKey);
      } else if (remaining.length > 1) {
        // Too many trailing steps: let the tail resolve as a nested path.
        consumed.push(remaining[0]);
        cursor = cursor?.[remaining[0]];
      } else {
        ok = false;
        break;
      }
    }

    const chainKey = dottedPath;
    if (!ok || !cursor) {
      throw new Error(`Unresolved token reference: ${match}`);
    }
    if (chain.has(chainKey)) {
      throw new Error(`Circular token reference: ${chainKey} (chain: ${[...chain, chainKey].join(' -> ')})`);
    }
    if (isToken(cursor)) {
      return resolveValue(cursor.$value, tokens, new Set([...chain, chainKey]));
    }
    // Reference points at a group, not a leaf.
    throw new Error(`Token reference ${match} resolves to a group, not a single token`);
  });
}

function emitBlock(title, map) {
  if (map.size === 0) return '';
  const body = [...map.entries()].map(([name, value]) => `  --${name}: ${value};`).join('\n');
  return `\n/* === ${title} === */\n:root {\n${body}\n}\n`;
}

function generate(tokens) {
  const header =
    `/* -------------------------------------------------------------------\n` +
    ` * Design tokens — GENERATED FILE. Do not edit.\n` +
    ` * Source: tokens/tokens.json   Regenerate: npm run tokens:build\n` +
    ` * -------------------------------------------------------------------\n` +
    ` * Layers: primitive (raw values) -> semantic (purpose) -> component (override)\n` +
    ` */\n`;

  // Every layer is emitted under its own prefix: --primitive-*, --semantic-*,
  // --component-*. The prefix is what keeps the layers from colliding — several
  // layers legitimately define `color.background` — and it is the name the
  // hand-written CSS in src/ consumes. Emitting the semantic layer unprefixed
  // compiled to a stylesheet whose every `var(--semantic-*)` reference resolved
  // to nothing, which browsers fail silently: the page rendered unstyled.
  const primitives = flatten(tokens.primitive, tokens, ['primitive'], new Map(), new Set());
  const semantic = flatten(tokens.semantic, tokens, ['semantic'], new Map(), new Set());
  const component = flatten(tokens.component, tokens, ['component'], new Map(), new Set());
  const dark = flatten(tokens.dark?.semantic, tokens, ['semantic'], new Map(), new Set());

  let css = header;
  css += emitBlock('PRIMITIVE', primitives);
  css += emitBlock('SEMANTIC', semantic);
  css += emitBlock('COMPONENT', component);
  if (dark.size) {
    const body = [...dark.entries()].map(([n, v]) => `  --${n}: ${v};`).join('\n');
    css += `\n/* === DARK THEME OVERRIDE === */\n.dark {\n${body}\n}\n`;
  }
  return css;
}

function build(opts) {
  const configPath = resolve(ROOT, opts.config);
  const outputPath = resolve(ROOT, opts.output);

  let tokens;
  try {
    tokens = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`[tokens] cannot read ${configPath}: ${error.message}`);
    process.exit(1);
  }

  let css;
  try {
    css = generate(tokens);
  } catch (error) {
    console.error(`[tokens] ${error.message}`);
    process.exit(1);
  }

  // Guard: never emit unresolved references — that is silently invalid CSS.
  const leaked = css.match(/\{[a-z][\w.]*\}/g);
  if (leaked) {
    console.error(`[tokens] refusing to write, unresolved references: ${[...new Set(leaked)].join(', ')}`);
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, css, 'utf8');

  const count = (css.match(/^\s+--/gm) ?? []).length;
  console.log(`[tokens] ${outputPath} — ${count} custom properties`);
}

const opts = parseArgs(process.argv.slice(2));
build(opts);

if (opts.watch) {
  let queued = false;
  console.log(`[tokens] watching ${opts.config}`);
  watch(resolve(ROOT, opts.config), () => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      build(opts);
    }, 40);
  });
}

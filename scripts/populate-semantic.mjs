#!/usr/bin/env node
/**
 * Populate the semantic layer in tokens.json with all missing tokens.
 * This script reads the validator's missing references and adds them
 * with sensible primitive fallbacks.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_PATH = resolve(ROOT, 'tokens/tokens.json');

const tokens = JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));

/* ------------------------------------------------------------------ */
/* Helper: make a $value/$type token entry                             */
/* ------------------------------------------------------------------ */
function ref(primitivePath) {
  return { $value: `{${primitivePath}}`, $type: 'dimension' };
}
function colorRef(primitivePath) {
  return { $value: `{${primitivePath}}`, $type: 'color' };
}
function token(value, type = 'dimension') {
  return { $value: value, $type: type };
}

/* ------------------------------------------------------------------ */
/* Missing semantic tokens from validator output                      */
/* ------------------------------------------------------------------ */

// === semantic.color ===
tokens.semantic.color = {
  background: colorRef('primitive.color.neutral.1000'),        // #070A14
  'background-accent': colorRef('primitive.color.indigo.500'),  // indigo tint
  surface: colorRef('primitive.color.neutral.900'),
  'surface-raised': colorRef('primitive.color.neutral.850'),
  'surface-sunken': colorRef('primitive.color.neutral.950'),
  'surface-hover': colorRef('primitive.color.neutral.800'),
  overlay: colorRef('primitive.color.neutral.1000'),
  foreground: colorRef('primitive.color.neutral.50'),
  'muted-foreground': colorRef('primitive.color.neutral.400'),
  'subtle-foreground': colorRef('primitive.color.neutral.500'),
  primary: colorRef('primitive.color.indigo.400'),
  'primary-hover': colorRef('primitive.color.indigo.300'),
  'primary-active': colorRef('primitive.color.indigo.500'),
  'primary-foreground': colorRef('primitive.color.neutral.1000'),
  accent: colorRef('primitive.color.cyan.400'),
  'accent-foreground': colorRef('primitive.color.neutral.1000'),
  secondary: colorRef('primitive.color.neutral.800'),
  'secondary-foreground': colorRef('primitive.color.neutral.100'),
  border: token('hsl(226 40% 70% / 0.14)', 'color'),
  'border-strong': token('hsl(226 40% 70% / 0.28)', 'color'),
  'border-subtle': token('hsl(226 40% 70% / 0.08)', 'color'),
  ring: colorRef('primitive.color.indigo.400'),
  success: colorRef('primitive.color.emerald.400'),
  'success-foreground': colorRef('primitive.color.emerald.300'),
  warning: colorRef('primitive.color.amber.400'),
  'warning-foreground': colorRef('primitive.color.amber.300'),
  danger: colorRef('primitive.color.rose.400'),
  'danger-foreground': colorRef('primitive.color.rose.300'),
  info: colorRef('primitive.color.sky.400'),
  'info-foreground': colorRef('primitive.color.sky.300'),
  'glow-primary': token('hsl(239 84% 67% / 0.34)', 'color'),
  'glow-accent': token('hsl(188 86% 53% / 0.28)', 'color'),
  'glass-fill': token('hsl(228 40% 16% / 0.55)', 'color'),
  'glass-fill-strong': token('hsl(228 40% 18% / 0.78)', 'color'),
  'glass-border': token('hsl(226 60% 80% / 0.16)', 'color'),
  'glass-highlight': token('hsl(0 0% 100% / 0.1)', 'color'),
  'aurora-1': token('hsl(239 84% 58% / 0.5)', 'color'),
  'aurora-2': token('hsl(188 86% 52% / 0.38)', 'color'),
  'aurora-3': token('hsl(262 84% 62% / 0.4)', 'color'),
};

// === semantic.glass ===
tokens.semantic.glass = {
  blur: ref('primitive.blur.lg'),
  'blur-strong': ref('primitive.blur.xl'),
  'blur-subtle': ref('primitive.blur.md'),
  saturate: token('180%'),
};

// === semantic.font ===
tokens.semantic.font = {
  family: token("'Inter var', 'Inter', ui-sans-serif, system-ui", 'fontFamily'),
  'family-display': token("'Sora', 'Inter var', ui-sans-serif, system-ui", 'fontFamily'),
  'family-mono': token("'JetBrains Mono', ui-monospace, 'SFMono-Regular'", 'fontFamily'),
};

// === semantic.text ===
tokens.semantic.text = {
  'size-xs': ref('primitive.fontSize.xs'),
  'size-sm': ref('primitive.fontSize.sm'),
  'size-base': ref('primitive.fontSize.base'),
  'size-md': ref('primitive.fontSize.md'),
  'size-lg': ref('primitive.fontSize.lg'),
  'size-xl': ref('primitive.fontSize.xl'),
  'size-2xl': ref('primitive.fontSize.2xl'),
  'size-3xl': ref('primitive.fontSize.3xl'),
  'size-4xl': ref('primitive.fontSize.4xl'),
  'size-5xl': ref('primitive.fontSize.5xl'),
  'leading-tight': ref('primitive.lineHeight.tight'),
  'leading-snug': ref('primitive.lineHeight.snug'),
  'leading-normal': ref('primitive.lineHeight.normal'),
  'leading-relaxed': ref('primitive.lineHeight.relaxed'),
  'weight-light': ref('primitive.fontWeight.light'),
  'weight-regular': ref('primitive.fontWeight.regular'),
  'weight-medium': ref('primitive.fontWeight.medium'),
  'weight-semibold': ref('primitive.fontWeight.semibold'),
  'weight-bold': ref('primitive.fontWeight.bold'),
  'spacing-tight': ref('primitive.letterSpacing.tight'),
  'spacing-normal': ref('primitive.letterSpacing.normal'),
  'spacing-wide': ref('primitive.letterSpacing.wide'),
  // Aliases for components that use `tracking-*` naming
  'tracking-tight': ref('primitive.letterSpacing.tight'),
  'tracking-normal': ref('primitive.letterSpacing.normal'),
  'tracking-wide': ref('primitive.letterSpacing.wide'),
  'tracking-wider': token('0.1em'),
  'tracking-widest': token('0.15em'),
};

// === semantic.space ===
tokens.semantic.space = {
  '0': ref('primitive.space.0'),
  '1': ref('primitive.space.1'),
  '2': ref('primitive.space.2'),
  '3': ref('primitive.space.3'),
  '4': ref('primitive.space.4'),
  '5': ref('primitive.space.5'),
  '6': ref('primitive.space.6'),
  '7': ref('primitive.space.7'),
  '8': ref('primitive.space.8'),
  '9': ref('primitive.space.9'),
  '10': ref('primitive.space.10'),
  '11': ref('primitive.space.11'),
  '12': ref('primitive.space.12'),
  '14': ref('primitive.space.14'),
  '16': ref('primitive.space.16'),
  '20': ref('primitive.space.20'),
  '24': ref('primitive.space.24'),
  '32': ref('primitive.space.32'),
  px: ref('primitive.space.px'),
  '0-5': ref('primitive.space.0-5'),
  '1-5': ref('primitive.space.1-5'),
  '2-5': ref('primitive.space.2-5'),
  '3-5': ref('primitive.space.3-5'),
  gap: ref('primitive.space.4'),
  'gap-sm': ref('primitive.space.2'),
  'gap-md': ref('primitive.space.4'),
  'gap-lg': ref('primitive.space.6'),
  'gap-xl': ref('primitive.space.8'),
  section: token('2.5rem'),
  'page-gutter': token('1.5rem'),
  '3xl': token('4rem'),  // was missing, needed by login.css
  inline: ref('primitive.space.4'),
};

// === semantic.radius ===
tokens.semantic.radius = {
  xs: ref('primitive.radius.xs'),
  sm: ref('primitive.radius.sm'),
  md: ref('primitive.radius.md'),
  lg: ref('primitive.radius.lg'),
  xl: ref('primitive.radius.xl'),
  '2xl': ref('primitive.radius.2xl'),
  pill: ref('primitive.radius.pill'),
  full: ref('primitive.radius.full'),
};

// === semantic.elevation ===
tokens.semantic.elevation = {
  none: ref('primitive.shadow.none'),
  sm: ref('primitive.shadow.sm'),
  md: ref('primitive.shadow.md'),
  lg: ref('primitive.shadow.lg'),
  xl: ref('primitive.shadow.xl'),
  'inner-top': ref('primitive.shadow.inner-top'),
};

// === semantic.motion ===
tokens.semantic.motion = {
  'duration-instant': ref('primitive.duration.instant'),
  'duration-fast': ref('primitive.duration.fast'),
  'duration-normal': ref('primitive.duration.normal'),
  'duration-slow': ref('primitive.duration.slow'),
  'duration-slower': ref('primitive.duration.slower'),
  'ease-standard': ref('primitive.easing.standard'),
  'ease-entrance': ref('primitive.easing.entrance'),
  'ease-exit': ref('primitive.easing.exit'),
};

// === semantic.focus ===
tokens.semantic.focus = {
  'ring-width': token('2px'),
  'ring-offset-width': token('2px'),
  'ring-color': colorRef('primitive.color.indigo.400'),
};

// === semantic.layout ===
tokens.semantic.layout = {
  'scrollbar-width': token('8px'),
  'underline-offset': token('2px'),
  'grid-cell': token('minmax(0, 1fr)'),
  'motion-rise-distance': token('8px'),
};

// === semantic.z ===
tokens.semantic.z = {
  base: token('0'),
  dropdown: token('100'),
  sticky: token('200'),
  modal: token('300'),
  popover: token('400'),
  tooltip: token('500'),
  toast: token('600'),
  top: token('9999'),
};

/* ------------------------------------------------------------------ */
/* Component-level semantic tokens (component.x uses these)           */
/* ------------------------------------------------------------------ */

// Auth card specific
tokens.semantic.authCard = {
  padding: token('1.5rem'),
  radius: ref('primitive.radius.lg'),
  bg: token('hsl(228 40% 16% / 0.55)', 'color'),
  border: token('hsl(226 60% 80% / 0.16)', 'color'),
  shadow: token('0 24px 48px -12px hsl(230 50% 4% / 0.5)', 'color'),
  blur: ref('primitive.blur.lg'),
  'max-width': token('28rem'),
};

// Badge accent
tokens.semantic.badge = {
  accent: {
    border: token('hsl(188 86% 53% / 0.4)', 'color'),
    bg: token('hsl(188 86% 53% / 0.12)', 'color'),
    fg: colorRef('primitive.color.cyan.300'),
  },
  info: {
    bg: token('hsl(199 89% 48% / 0.12)', 'color'),
    border: token('hsl(199 89% 48% / 0.3)', 'color'),
    fg: colorRef('primitive.color.sky.300'),
  },
  success: {
    bg: token('hsl(152 69% 42% / 0.12)', 'color'),
    border: token('hsl(152 69% 42% / 0.3)', 'color'),
    fg: colorRef('primitive.color.emerald.300'),
  },
  warning: {
    bg: token('hsl(38 92% 50% / 0.12)', 'color'),
    border: token('hsl(38 92% 50% / 0.3)', 'color'),
    fg: colorRef('primitive.color.amber.300'),
  },
  danger: {
    bg: token('hsl(359 85% 58% / 0.12)', 'color'),
    border: token('hsl(359 85% 58% / 0.3)', 'color'),
    fg: colorRef('primitive.color.rose.300'),
  },
  gap: ref('primitive.space.2'),
  'padding-y': ref('primitive.space.1'),
  'padding-x': ref('primitive.space.2'),
  radius: ref('primitive.radius.md'),
  bg: colorRef('primitive.color.neutral.800'),
  fg: colorRef('primitive.color.neutral.100'),
  'font-size': ref('primitive.fontSize.sm'),
  'font-weight': ref('primitive.fontWeight.medium'),
  'success-fg': colorRef('primitive.color.emerald.300'),
};

// Input
tokens.semantic.input = {
  label: {
    size: ref('primitive.fontSize.sm'),
    spacing: ref('primitive.letterSpacing.wide'),
    color: colorRef('primitive.color.neutral.400'),
    weight: ref('primitive.fontWeight.semibold'),
  },
  height: token('2.5rem'),
  'padding-y': ref('primitive.space.2'),
  'padding-x': ref('primitive.space.3'),
  bg: colorRef('primitive.color.neutral.900'),
  border: token('hsl(226 40% 70% / 0.14)', 'color'),
  radius: ref('primitive.radius.md'),
  fg: colorRef('primitive.color.neutral.50'),
  'font-size': ref('primitive.fontSize.base'),
  placeholder: colorRef('primitive.color.neutral.600'),
  'border-hover': token('hsl(226 40% 70% / 0.28)', 'color'),
  'border-focus': colorRef('primitive.color.indigo.400'),
  'shadow-focus': token('0 0 0 3px hsl(239 84% 67% / 0.25)', 'color'),
  'disabled-bg': colorRef('primitive.color.neutral.950'),
  'disabled-fg': colorRef('primitive.color.neutral.600'),
  'error-color': colorRef('primitive.color.rose.400'),
};

// Alert
tokens.semantic.alert = {
  gap: ref('primitive.space.2'),
  padding: token('0.875rem 1rem'),
  border: token('hsl(226 40% 70% / 0.14)', 'color'),
  radius: ref('primitive.radius.md'),
  bg: token('hsl(228 34% 20% / 0.6)', 'color'),
  fg: colorRef('primitive.color.neutral.100'),
  'font-size': ref('primitive.fontSize.sm'),
};

// Divider
tokens.semantic.divider = {
  thickness: token('1px'),
  color: token('hsl(226 40% 70% / 0.14)', 'color'),
};

// Nav
tokens.semantic.nav = {
  bg: token('hsl(230 50% 4% / 0.8)', 'color'),
  border: token('hsl(226 40% 70% / 0.08)', 'color'),
  blur: ref('primitive.blur.lg'),
  height: token('4rem'),
  brand: {
    size: token('1.25rem'),
  },
  link: {
    'padding-y': ref('primitive.space.2'),
    'padding-x': ref('primitive.space.3'),
    radius: ref('primitive.radius.md'),
    size: ref('primitive.fontSize.sm'),
    fg: colorRef('primitive.color.neutral.300'),
    'hover-bg': token('hsl(228 34% 20% / 0.6)', 'color'),
    'hover-fg': colorRef('primitive.color.neutral.50'),
    'active-bg': token('hsl(239 84% 67% / 0.15)', 'color'),
    'active-fg': colorRef('primitive.color.indigo.300'),
  },
};

// Avatar
tokens.semantic.avatar = {
  size: token('2.5rem'),
  radius: ref('primitive.radius.full'),
  'font-size': ref('primitive.fontSize.lg'),
  'font-weight': ref('primitive.fontWeight.semibold'),
  'size-sm': token('1.75rem'),
  'size-lg': token('3.5rem'),
};

// Tile
tokens.semantic.tile = {
  padding: token('1.25rem'),
  'min-height': token('7rem'),
  bg: colorRef('primitive.color.neutral.900'),
  border: token('hsl(226 40% 70% / 0.14)', 'color'),
  radius: ref('primitive.radius.lg'),
  shadow: token('0 4px 12px -2px hsl(230 50% 4% / 0.3)', 'color'),
  blur: ref('primitive.blur.md'),
  'accent-bar-width': token('3px'),
  'hover-translate-y': token('-2px'),
  'hover-bg': token('hsl(228 34% 20% / 0.6)', 'color'),
  'hover-border': token('hsl(226 40% 70% / 0.28)', 'color'),
  'hover-shadow': token('0 12px 24px -4px hsl(230 50% 4% / 0.4)', 'color'),
  'disabled-bg': colorRef('primitive.color.neutral.950'),
  'accent-size': token('2.5rem'),
  'accent-hover-spread': token('12px'),
  'title-size': ref('primitive.fontSize.lg'),
  'meta-size': ref('primitive.fontSize.sm'),
};

// Meter
tokens.semantic.meter = {
  height: token('0.5rem'),
  radius: ref('primitive.radius.full'),
  'track-bg': colorRef('primitive.color.neutral.800'),
  'fill-bg': colorRef('primitive.color.indigo.400'),
};

// Card
tokens.semantic.card = {
  padding: token('1.5rem'),
  radius: ref('primitive.radius.lg'),
  shadow: ref('primitive.shadow.lg'),
  blur: ref('primitive.blur.md'),
};

// Table
tokens.semantic.table = {
  header: {
    size: ref('primitive.fontSize.xs'),
    spacing: ref('primitive.letterSpacing.wide'),
    fg: colorRef('primitive.color.neutral.500'),
  },
  cell: {
    size: ref('primitive.fontSize.sm'),
    fg: colorRef('primitive.color.neutral.300'),
  },
  'row-border': token('hsl(226 40% 70% / 0.08)', 'color'),
  'row-hover-bg': token('hsl(228 34% 20% / 0.6)', 'color'),
};

// === Additional flat semantic tokens referenced directly ===
// These are referenced without a sub-group in the CSS
tokens.semantic['nav-brand-size'] = token('1.25rem');
tokens.semantic['space-3xl'] = token('4rem');

/* ------------------------------------------------------------------ */
/* Primitive fontFamily additions needed by globals.css               */
/* ------------------------------------------------------------------ */
tokens.primitive.fontFamily = tokens.primitive.fontFamily || {};
tokens.primitive.fontFamily.sans = { $value: "'Inter var', 'Inter', ui-sans-serif, system-ui", $type: 'fontFamily' };
tokens.primitive.fontFamily.display = { $value: "'Sora', 'Inter var', ui-sans-serif, system-ui", $type: 'fontFamily' };
tokens.primitive.fontFamily.mono = { $value: "'JetBrains Mono', ui-monospace, 'SFMono-Regular'", $type: 'fontFamily' };
tokens.semantic.badge.border = token('hsl(226 40% 70% / 0.14)', 'color');
tokens.semantic.space['section-lg'] = token('3rem');
tokens.semantic.space['gap-2xl'] = token('2rem');
tokens.semantic.authCard['max-width'] = token('28rem');

/* ------------------------------------------------------------------ */
/* Component layer: tile runtime tokens                             */
/* ------------------------------------------------------------------ */
tokens.component.tile = {
  accent: { $value: '{semantic.color.accent}', $type: 'color' },
  'accent-wash': { $value: '{semantic.color.glass-fill}', $type: 'color' },
  'accent-edge': { $value: '{semantic.color.glass-border}', $type: 'color' },
};

/* ------------------------------------------------------------------ */
/* Write back                                                          */
/* ------------------------------------------------------------------ */
writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2) + '\n');
console.log('[populate-semantic] tokens.json updated with semantic layer');
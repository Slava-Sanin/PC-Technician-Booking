/**
 * WCAG AA contrast check (4.5:1) for theme token pairs.
 * Run: node scripts/check-theme-contrast.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const registryPath = join(root, 'src/themes/registry.ts');
const raw = readFileSync(registryPath, 'utf8');
const jsonMatch = raw.match(/export const THEMES: ThemeDefinition\[\] = (\[[\s\S]*?\]);/);
if (!jsonMatch) {
  console.error('Could not parse THEMES from registry.ts');
  process.exit(1);
}
const themes = JSON.parse(jsonMatch[1]);

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const PAIRS = [
  ['tx', 'card'],
  ['tx', 'bg'],
  ['hdt', 'hd'],
  ['on', 'ac'],
  ['mu', 'card'],
];

const THRESHOLD = 4.5;
const failures = [];

for (const theme of themes) {
  for (const [fgKey, bgKey] of PAIRS) {
    const fg = theme.colors[fgKey];
    const bg = theme.colors[bgKey];
    const ratio = contrastRatio(fg, bg);
    if (ratio < THRESHOLD) {
      failures.push({
        theme: theme.name,
        id: theme.id,
        pair: `${fgKey}/${bgKey}`,
        ratio: ratio.toFixed(2),
        fg,
        bg,
      });
    }
  }
}

console.log(`Checked ${themes.length} themes, ${PAIRS.length} pairs each.`);
if (failures.length === 0) {
  console.log('All pairs pass WCAG AA (>= 4.5:1).');
} else {
  console.log(`\n${failures.length} failing pair(s):\n`);
  for (const f of failures) {
    console.log(`- ${f.theme} (${f.id}): ${f.pair} = ${f.ratio}:1`);
    console.log(`  fg=${f.fg} bg=${f.bg}`);
  }
}

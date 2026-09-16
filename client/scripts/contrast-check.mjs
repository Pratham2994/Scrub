// The palette gate: every text token and control border in every theme,
// checked against the WCAG floors in docs/DESIGN.md and the Tube spec.
// Plain Node so it runs before any build.

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function lum(hex) {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = 4.5; // WCAG 1.4.3 AA
const BORDER = 3; // WCAG 1.4.11 AA

const palettes = {
  light: {
    paper: '#eaecf5',
    surface: '#ffffff',
    line: '#cfd4de',
    lineStrong: '#8e949e',
    ink: '#14161a',
    muted: '#5e646e',
    well: '#0e1013',
    accent: '#3a4fe0',
    onAccent: '#ffffff',
    signal: '#e8a33d',
    tokens: {
      binary: '#e7e9ec',
      flag: '#8aa0ff',
      value: '#e8a33d',
      path: '#7fd1a8',
      transport: '#757d89',
    },
  },
  dark: {
    paper: '#252833',
    surface: '#2e3240',
    line: '#3a3f4f',
    lineStrong: '#7b8296',
    ink: '#e9ebf3',
    muted: '#a2a9bb',
    well: '#0b0d11',
    accent: '#8695ff',
    onAccent: '#0b0d11',
    signal: '#e8a33d',
    tokens: {
      binary: '#e7e9ec',
      flag: '#8aa0ff',
      value: '#e8a33d',
      path: '#7fd1a8',
      transport: '#757d89',
    },
  },
  phosphor: {
    paper: '#071008',
    surface: '#0d1810',
    line: '#1d3324',
    lineStrong: '#3a7a52',
    ink: '#33d964',
    muted: '#5f9d74',
    well: '#030604',
    accent: '#eafff2',
    onAccent: '#04301a',
    signal: '#ffb454',
    tokens: {
      binary: '#d9f5de',
      flag: '#33d964',
      value: '#ffb454',
      path: '#9af0ae',
      transport: '#5c8066',
    },
  },
};

/** Pairs and their floor. Hairlines have no WCAG floor and are printed only. */
const checks = (p) => [
  ['ink / paper', p.ink, p.paper, TEXT],
  ['muted / paper', p.muted, p.paper, TEXT],
  ['muted / surface', p.muted, p.surface, TEXT],
  ['line-strong / surface', p.lineStrong, p.surface, BORDER],
  ['on-accent / accent', p.onAccent, p.accent, TEXT],
  // Amber is the progress fill, never text on paper, so the real text pair is
  // the label riding on it: well-coloured text on the amber fill.
  ['well / signal', p.well, p.signal, TEXT],
  ['transport / well', p.tokens.transport, p.well, TEXT],
];

let failed = false;
for (const [name, p] of Object.entries(palettes)) {
  console.log(`\n${name}`);
  for (const [label, fg, bg, floor] of checks(p)) {
    const r = ratio(fg, bg);
    const ok = r >= floor;
    failed ||= !ok;
    console.log(`  ${label.padEnd(26)} ${r.toFixed(2)}:1  (floor ${floor}:1)${ok ? '' : '  FAIL'}`);
  }
  console.log(
    `  line / paper            ${ratio(p.line, p.paper).toFixed(2)}:1  (hairline, informational)`,
  );
  console.log(
    `  signal / paper          ${ratio(p.signal, p.paper).toFixed(2)}:1  (fill on the page, informational)`,
  );
}

if (failed) {
  console.error('\nContrast floors broken. Fix the token above before shipping.');
  process.exit(1);
}
console.log('\nAll contrast floors clear.');

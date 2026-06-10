import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');
const match = html.match(/<script type="application\/json" id="results">(.*?)<\/script>/s);
if (!match) throw new Error('results JSON not found in dist/index.html');
const results = JSON.parse(match[1]);

// Expected outputs under trailingSlash: 'never' — no trailing slash, ever.
const expected = {
  "getRelativeLocaleUrl('pl')": '/pl',
  "getRelativeLocaleUrl('pl', '')": '/pl',
  "getRelativeLocaleUrl('pl', '/')": '/pl',
  "getRelativeLocaleUrl('pl', 'about')": '/pl/about',
  "getAbsoluteLocaleUrl('pl', '')": 'https://example.com/pl',
};

let failed = 0;
for (const [call, want] of Object.entries(expected)) {
  const got = results[call];
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${call} → got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}
process.exit(failed > 0 ? 1 : 0);

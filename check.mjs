import { spawn } from 'node:child_process';

const PORT = 43210;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['./dist/server/entry.mjs'], {
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(PORT) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server did not start');
}

let failed = 0;
function check(ok, label, detail) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`);
}

try {
  await waitForServer();

  // 1. URL generation under trailingSlash: 'never' — expected: no trailing slash, ever.
  const html = await (await fetch(`${BASE}/`)).text();
  const match = html.match(/<script type="application\/json" id="results">(.*?)<\/script>/s);
  if (!match) throw new Error('results JSON not found in rendered page');
  const results = JSON.parse(match[1]);

  const expected = {
    "getRelativeLocaleUrl('pl')": '/pl',
    "getRelativeLocaleUrl('pl', '')": '/pl',
    "getRelativeLocaleUrl('pl', '/')": '/pl',
    "getRelativeLocaleUrl('pl', 'docs/setup')": '/pl/docs/setup',
    "getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' })": '/blog/pl/docs/setup',
    "getAbsoluteLocaleUrl('pl', '')": 'https://example.com/pl',
    "getAbsoluteLocaleUrlList('')": ['https://example.com', 'https://example.com/pl'],
  };

  console.log("— URL generation (astro:i18n) under trailingSlash: 'never' —");
  for (const [call, want] of Object.entries(expected)) {
    const got = results[call];
    check(
      JSON.stringify(got) === JSON.stringify(want),
      call,
      `got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
    );
  }

  // 2. Server enforcement of the same config. These assertions SHOULD pass —
  // every URL the helpers ought to return is a real page (200), while the
  // URLs they actually return are redirected away (301).
  console.log('\n— Server enforcement of the same config —');
  for (const [from, to] of [
    ['/pl/', '/pl'],
    ['/blog/pl/docs/setup/', '/blog/pl/docs/setup'],
  ]) {
    const res = await fetch(`${BASE}${from}`, { redirect: 'manual' });
    check(
      res.status === 301 && res.headers.get('location') === to,
      `GET ${from}`,
      `got ${res.status} (location: ${res.headers.get('location')}), expected 301 (location: ${to})`,
    );
  }
  for (const path of ['/pl', '/pl/docs/setup', '/blog/pl/docs/setup']) {
    const res = await fetch(`${BASE}${path}`);
    check(res.status === 200, `GET ${path}`, `got ${res.status}, expected 200`);
  }
} finally {
  server.kill();
}

console.log(
  failed > 0
    ? `\n${failed} assertion(s) failed: astro:i18n generates URLs that the same config redirects away from.`
    : '\nAll assertions passed.',
);
process.exit(failed > 0 ? 1 : 0);

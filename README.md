# astro:i18n × `trailingSlash: 'never'` — trailing slash repro

`getRelativeLocaleUrl()` / `getAbsoluteLocaleUrl()` return URLs **with a trailing
slash** for a non-default locale with an empty (`''`) or root (`'/'`) path, even
though the project sets `trailingSlash: 'never'`.

```js
// astro.config.mjs: trailingSlash: 'never', i18n: { defaultLocale: 'en', locales: ['en', 'pl'] }
getRelativeLocaleUrl('pl');         // '/pl'  ✅
getRelativeLocaleUrl('pl', '');     // '/pl/' ❌ expected '/pl'
getRelativeLocaleUrl('pl', '/');    // '/pl/' ❌ expected '/pl'
getAbsoluteLocaleUrl('pl', '');     // 'https://example.com/pl/' ❌ expected 'https://example.com/pl'
```

## Steps to reproduce

```bash
npm install
npm test        # astro build + assertions against dist/index.html
```

`npm test` prints PASS/FAIL for each call and exits non-zero because of the three
failing cases. Alternatively `npm run dev` and open `http://localhost:4321/` —
the rendered list shows the same outputs, and clicking the “Polski” language
link navigates to `/pl/`, which the same `trailingSlash: 'never'` config rejects:

- **dev**: `GET /pl/` → **404** with the notice *“Your site is configured with
  `trailingSlash` set to `never`. Do you want to go to `/pl` instead?”*
  (`GET /pl` → 200)
- **on-demand rendering (SSR)**: `GET /pl/` → **301** redirect to `/pl`
  (308 for non-GET) — see `TrailingSlashHandler` in
  `astro/src/core/routing/trailing-slash-handler.ts`

So the URLs produced by `astro:i18n` are URLs that Astro itself refuses to serve
under the very same configuration.

<!--
══════════════════════════════════════════════════════════════════════
DRAFT — not posted. This HTML comment is invisible when rendered on
GitHub, but you may delete it before submitting.

Title:
getRelativeLocaleUrl() / getAbsoluteLocaleUrl() return a trailing slash for an empty/root path, violating `trailingSlash: 'never'` (re-file of #14140)

Before posting:
1. Push this repro to a public GitHub repo (or import to StackBlitz)
   and replace REPLACE_WITH_REPRO_URL below.
2. Optionally tick the Participation checkbox.

Submit with:
  gh issue create --repo withastro/astro \
    --title "getRelativeLocaleUrl() / getAbsoluteLocaleUrl() return a trailing slash for an empty/root path, violating \`trailingSlash: 'never'\` (re-file of #14140)" \
    --body-file ISSUE_DRAFT.md
or open the form prefilled in the browser by appending --web.
══════════════════════════════════════════════════════════════════════
-->

### Astro Info

```
Astro                    v6.4.5
Vite                     v7.3.5
Node                     v24.16.0
System                   Linux (x64)
Package Manager          npm
Output                   static
Adapter                  none
Integrations             none
```

### If this issue only occurs in one browser, which browser is a problem?

No response

### Describe the Bug

With `trailingSlash: 'never'`, `getRelativeLocaleUrl()` and `getAbsoluteLocaleUrl()` from `astro:i18n` return URLs **with** a trailing slash whenever the `path` argument is empty (`''`) or root (`'/'`) and the URL has a locale prefix:

```js
// astro.config.mjs: trailingSlash: 'never',
// i18n: { defaultLocale: 'en', locales: ['en', 'pl'] }, site: 'https://example.com'

getRelativeLocaleUrl('pl');          // '/pl'                      ✅
getRelativeLocaleUrl('pl', '');      // '/pl/'                     ❌ expected '/pl'
getRelativeLocaleUrl('pl', '/');     // '/pl/'                     ❌ expected '/pl'
getRelativeLocaleUrl('pl', 'about'); // '/pl/about'                ✅
getAbsoluteLocaleUrl('pl', '');      // 'https://example.com/pl/'  ❌ expected 'https://example.com/pl'
```

Note the inconsistency in the first two lines: omitting `path` and passing `''` produce different URLs. No `trailingSlash` semantics can explain `undefined` ≠ `''`.

This is a re-file of #14140 (same title, closed as stale on no activity), where @matthewp wrote:

> If you're still experiencing this in Astro 6, please open a new issue and we'll take a fresh look.

It reproduces on Astro 6.4.5. Previously reported in #9919, #11630, #13032 and #14140; #13045 fixed only the case where the join collapses to `""` (default locale, no base), not the locale-prefixed one.

#### Astro itself rejects the URLs it generates

The same config that produces these links refuses to serve them — verified in this reproduction:

- **dev**: `GET /pl/` → **404** with the notice *“Your site is configured with `trailingSlash` set to `never`. Do you want to go to `/pl` instead?”* (`GET /pl` → 200)
- **on-demand rendering**: `GET /pl/` → **301** redirect to `/pl` (308 for non-GET) via `TrailingSlashHandler` (`packages/astro/src/core/routing/trailing-slash-handler.ts`)

So the canonical use case from the docs — a language switcher pointing at a locale’s home page — produces a link that 404s in dev and costs a redirect on every click in production.

#### Root cause

`getLocaleRelativeUrl` (`packages/astro/src/i18n/index.ts`) keeps the empty path as a join segment, and the `trailingSlash: 'never'` branch only *refrains from appending* a slash — it never strips one:

```js
const pathsToJoin = [base, prependWith];
// …pushes normalizedLocale for non-default locales…
pathsToJoin.push(path);                          // path === '' is kept
let relativePath;
if (shouldAppendForwardSlash(trailingSlash, format)) {
  relativePath = appendForwardSlash(joinPaths(...pathsToJoin));
} else {
  relativePath = joinPaths(...pathsToJoin);      // ← no stripping here
}
```

`joinPaths` (`@astrojs/internal-helpers`) filters only non-strings, so `''` survives and `['', 'pl', ''].join('/')` ends with `/`:

```js
function joinPaths(...paths) {
  return paths.filter(isString).map(/* trim slashes */).join('/');
}
```

`getLocaleAbsoluteUrl` has the same append-only logic in its `else` branch.

#### The documentation contradicts this behavior

The [`astro:i18n` reference](https://docs.astro.build/en/reference/modules/astro-i18n/) says:

> When creating routes with these functions, be sure to take into account your individual settings for: `base`, `trailingSlash`, `build.format`, `site`

and the [`trailingSlash: 'never'` reference](https://docs.astro.build/en/reference/configuration-reference/#trailingslash):

> Only match URLs that do not include a trailing slash (e.g: “/about”). In production, requests for on-demand rendered URLs with a trailing slash will be redirected to the correct URL for your convenience.

Meanwhile the docs examples show:

```js
getRelativeLocaleUrl("fr");     // returns /fr
getRelativeLocaleUrl("fr", ""); // returns /fr/
```

No implementation that honors a single `trailingSlash` setting can produce both lines — only one that treats `undefined` and `''` differently, i.e. the bug. (Under the **default** config, `'ignore'` + `build.format: 'directory'`, the actual output of `getRelativeLocaleUrl("fr")` is `/fr/`, so the first example doesn’t match defaults either.) These outputs were edited into the docs in withastro/docs#10797 to mirror the implementation, which codified the buggy output instead of the contract.

#### “Just call the function without the second argument”

In #13032 @ematipico suggested omitting the argument instead of passing `''`. That doesn’t resolve this, because:

- `'/'` is an unambiguously valid root path and is equally affected;
- the official docs example itself passes `""`;
- in real code `path` is computed, not literal — e.g. a language switcher deriving the equivalent page from `Astro.url.pathname` naturally yields `''` on the home page, so the API silently degrades on the single most-linked page of the site.

#### Suggested fix

In the `else` branch of both `getLocaleRelativeUrl` and `getLocaleAbsoluteUrl`:

```js
relativePath = removeTrailingForwardSlash(joinPaths(...pathsToJoin));
```

The existing `if (relativePath === "") return "/";` guard (from #13045) keeps the root case correct, and this also normalizes caller input like `'about/'`. A narrower alternative is dropping empty segments in `joinPaths` (`filter((p) => isString(p) && p !== '')`).

### What's the expected result?

With `trailingSlash: 'never'`, no URL generated by `astro:i18n` ends with a trailing slash — the same invariant `TrailingSlashHandler` enforces for incoming requests:

```js
getRelativeLocaleUrl('pl');          // '/pl'
getRelativeLocaleUrl('pl', '');      // '/pl'
getRelativeLocaleUrl('pl', '/');     // '/pl'
getAbsoluteLocaleUrl('pl', '');      // 'https://example.com/pl'
```

…and `getRelativeLocaleUrl(locale)` ≡ `getRelativeLocaleUrl(locale, '')` regardless of configuration.

### Link to Minimal Reproducible Example

REPLACE_WITH_REPRO_URL

Two files of substance: `astro.config.mjs` (`trailingSlash: 'never'`, two locales) and a page calling the five functions above. `npm install && npm test` builds and asserts the outputs — three assertions fail on 6.4.5. `npm run dev` shows the language-switcher link navigating to `/pl/` → 404 notice page.

### Participation

- [ ] I am willing to submit a pull request for this issue.

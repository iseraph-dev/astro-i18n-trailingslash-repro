<!--
══════════════════════════════════════════════════════════════════════
DRAFT — not posted. This HTML comment is invisible when rendered on
GitHub, but you may delete it before submitting.

Title:
astro:i18n URL helpers return trailing slashes that violate `trailingSlash: 'never'` — Astro 301-redirects its own generated URLs (re-file of #14140)

Before posting:
1. Push this repro to a public GitHub repo (or import to StackBlitz)
   and replace REPLACE_WITH_REPRO_URL below.
2. Optionally tick the Participation checkbox.

Submit with:
  gh issue create --repo withastro/astro \
    --title "astro:i18n URL helpers return trailing slashes that violate \`trailingSlash: 'never'\` — Astro 301-redirects its own generated URLs (re-file of #14140)" \
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
Output                   server
Adapter                  @astrojs/node (v10.1.4)
Integrations             none
```

### If this issue only occurs in one browser, which browser is a problem?

No response

### Describe the Bug

With `trailingSlash: 'never'`, the `astro:i18n` URL helpers return URLs **with** a trailing slash in three situations:

```js
// astro.config.mjs: trailingSlash: 'never',
// i18n: { defaultLocale: 'en', locales: ['en', 'pl'] }, site: 'https://example.com'

getRelativeLocaleUrl('pl');                                  // '/pl'                  ✅
getRelativeLocaleUrl('pl', '');                              // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', '/');                             // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', 'docs/setup');                    // '/pl/docs/setup'       ✅ (nested paths are fine)
getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' });
                                                             // '/blog/pl/docs/setup/' ❌ expected '/blog/pl/docs/setup'
getAbsoluteLocaleUrl('pl', '');                              // 'https://example.com/pl/' ❌
getAbsoluteLocaleUrlList('');                                // ['https://example.com', 'https://example.com/pl/'] ❌
```

Note two inconsistencies that no `trailingSlash` semantics can explain:

- omitting `path` vs passing `''` produce different URLs (`/pl` vs `/pl/`);
- `getAbsoluteLocaleUrlList('')` — the documented hreflang use case — is inconsistent **within a single call**: the default locale gets no slash, every other locale gets one.

This is a re-file of #14140 (same bug, closed as stale on no activity), where @matthewp wrote:

> If you're still experiencing this in Astro 6, please open a new issue and we'll take a fresh look.

It reproduces on Astro 6.4.5. Previously reported in #9919, #11630, #13032 and #14140; #13045 fixed only the case where the join collapses to `""` (default locale, no base), not the locale-prefixed one.

Why projects end up here: with `'always'` or the default `'ignore'` + `build.format: 'directory'`, these helpers append a slash to *every* URL, so an on-demand-rendered site that wants slash-less URLs has exactly one option — `trailingSlash: 'never'` — and then hits this bug on its language switcher and hreflang alternates.

#### Astro itself rejects the URLs it generates

The same config that produces these links refuses to serve them — both asserted live in the reproduction:

- **dev**: `GET /pl/` → **404** with the notice *“Your site is configured with `trailingSlash` set to `never`. Do you want to go to `/pl` instead?”* (`GET /pl` → 200)
- **on-demand rendering** (`@astrojs/node`): `GET /pl/` → **301** redirect to `/pl` (308 for non-GET) via `TrailingSlashHandler` (`packages/astro/src/core/routing/trailing-slash-handler.ts`)

Practical impact: a language switcher pointing at a locale’s home page 404s in dev and costs a redirect on every click in production, and hreflang/canonical alternates built from `getAbsoluteLocaleUrlList()` send search engines to URLs that 301.

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
  return paths.filter(isString).map((path, i) => {
    if (i === 0) return removeTrailingForwardSlash(path);
    else if (i === paths.length - 1) return removeLeadingForwardSlash(path);
    else return trimSlashes(path);
  }).join('/');
}
```

The `prependWith` case is a second mechanism in the same function: `i === paths.length - 1` compares the **filtered** index against the **unfiltered** rest-parameter length. When `prependWith` is `undefined` the last-element branch never fires and `trimSlashes` accidentally cleans trailing slashes from the input path; when `prependWith` is a string, the branch fires and a trailing slash in `path` survives into the output.

`getLocaleAbsoluteUrl` and the `*List` variants delegate to the same logic, so they inherit all of the above.

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
- in real code `path` is computed, not literal — e.g. a language switcher or an hreflang loop deriving the equivalent page from `Astro.url.pathname` naturally yields `''` on the home page, so the API silently degrades on the single most-linked page of the site;
- omitting the argument is not even possible for `getAbsoluteLocaleUrlList(path)`, whose whole purpose is mapping one path across all locales.

#### Suggested fix

In the `else` branch of both `getLocaleRelativeUrl` and `getLocaleAbsoluteUrl`:

```js
relativePath = removeTrailingForwardSlash(joinPaths(...pathsToJoin));
```

The existing `if (relativePath === "") return "/";` guard (from #13045) keeps the root case correct. This one-liner fixes every case above, including the `prependWith` one and the `*List` variants (they delegate). A narrower alternative — dropping empty segments in `joinPaths` (`filter((p) => isString(p) && p !== '')`) — would fix only the empty/root-path class, not the `prependWith` trailing-slash class.

### What's the expected result?

With `trailingSlash: 'never'`, no URL generated by `astro:i18n` ends with a trailing slash — the same invariant `TrailingSlashHandler` enforces for incoming requests:

```js
getRelativeLocaleUrl('pl');                                          // '/pl'
getRelativeLocaleUrl('pl', '');                                      // '/pl'
getRelativeLocaleUrl('pl', '/');                                     // '/pl'
getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' });  // '/blog/pl/docs/setup'
getAbsoluteLocaleUrl('pl', '');                                      // 'https://example.com/pl'
getAbsoluteLocaleUrlList('');  // ['https://example.com', 'https://example.com/pl']
```

…and `getRelativeLocaleUrl(locale)` ≡ `getRelativeLocaleUrl(locale, '')` regardless of configuration.

### Link to Minimal Reproducible Example

REPLACE_WITH_REPRO_URL

`output: 'server'` with `@astrojs/node` (standalone), `trailingSlash: 'never'`, two locales. `npm install && npm test` builds the site, starts the built server, and asserts over HTTP in two sections: **URL generation** (the seven calls above — five fail) and **server enforcement** (these pass: `GET /pl/` → 301 to `/pl`, `GET /pl` → 200), demonstrating that Astro redirects away from the URLs its own helpers generate. `npm run dev` shows the same via the language-switcher link → 404 notice page.

### Participation

- [ ] I am willing to submit a pull request for this issue.

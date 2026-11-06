# Contributing

This file is the reference for how work is done on this repository: the design rules, the conventions, the checks and the work rules. It binds anyone who works here.

## Design rules

These four rules settle every design choice. They are not negotiable, and only the owner can change one.

1. **Everything local.** The extension makes no request to anyone on its own initiative, downloads no list and sends nothing to anyone. Accepted consequence: the provider lists are embedded and change only with a new version of the extension. One exception, which Firefox imposes: to read the canonical name of a host that neither its IP nor its HTTP signals tie to a provider, the extension asks Firefox's own resolver, through `dns.resolve`, for a name the page has just resolved. Firefox keeps the page's answer in its DNS cache under the site's partition key and the extension's request under an empty one, so the request misses the cache and the resolver sees the same name once more, about once a minute ([bug 2051290](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290)). The resolver learns nothing it did not already know, so the step stays.
2. **No URL kept.** Only aggregated counts are kept: site, method, request type, provider, level.
3. **Never claim more than what is observed.** When the extension cannot know, the display says so, and a doubt is never resolved on the reassuring side.
4. **Never slow down browsing.** No blocking listener: the extension receives the event, returns at once and does its work afterwards.

## User data the extension receives

Firefox hands the extension the values of the `Cookie` and `Authorization` request headers together with their names, and there is no way to ask for the names alone. The classification needs only the names and the presence of `Authorization`.

- The `requestBody` option is never requested. Whether a request carries a body is inferred from its method.
- Cookie and `Authorization` values are never kept: never written to any storage or log, and never passed beyond the function that reads the names.
- The public listing of the extension states both points.
- The request URL comes with its query. The classification reads only the names of the query parameters, never their values, and keeps nothing of the URL.

## One fact, one place

Each fact (a value, a rule, a decision, a behaviour) has a single home. Anywhere else, a reference points to that home and asserts nothing of its own, because two copies become two different facts as soon as one of them changes. The same holds in code: a default value, a computation or a user-facing string has one source and everything else derives from it.

When two texts disagree, the declared home wins. Otherwise a dated decision of the owner wins, and otherwise the most recently committed text wins. The losing text is not corrected in place but replaced by a reference.

Life cycle of documents:

- A reference document (this file, the README) is read by section and grows. A text that describes a behaviour changes in the commit that changes the behaviour.
- Nothing is removed before it exists at its new place.
- A rule describes what is real today, never what is wished.

## Languages

| Content | Language |
| --- | --- |
| Code, identifiers, comments | English |
| Commit messages | English |
| README, CONTRIBUTING | English |
| User-facing strings | Through `_locales`, English as the source in `_locales/en`, French translation in `_locales/fr` |

Every string shown to the user goes through `_locales` from the moment it is written, never as a literal in the code.

## Vocabulary

- **Provider**: a third-party service that a site places between its visitors and its own server, such as Cloudflare, Akamai or Imperva, sold as a reverse proxy, a CDN or a WAF.
- **Edge**: the provider's server that the browser actually connects to.
- **Origin**: the site's own server, behind the provider.
- **Leak level**: what a provider learns from a request. The levels are cumulative.
  1. **Passage**: that the user contacted the site, and when: the user's IP address, the site name, the time.
  2. **Usage**: which public resource is loaded, and from which site.
  3. **Reading**: which pages the user reads.
  4. **Personal data**: what the user sends, and what concerns them: cookies, forms, request bodies, pages of a logged-in area.
- **Proven decryption**: the response carries an HTTP signal of the provider (a header or a cookie it sets), or the request went over HTTP without TLS. The provider read the traffic in clear.
- **Unproven decryption**: the request reached the provider, for instance by its IP address, but nothing in the response proves it read the traffic. An absent signal proves nothing.

## Layout

- `src/core/`: the pure core, with no browser API. It runs and is tested in Node, without Firefox.
- `src/background.ts`: the background entry point of the extension, which only adds the listeners.
- The other files of `src/`: the thin adapters between Firefox and the core (requests, tabs, toolbar icon, DNS, permissions). They hold no classification logic.
- `data/providers/`: one folder per provider (see "Provider data").
- `data/consent-cookies.json`: the cookies of known consent and audience-measurement tools (see "Provider data").
- `scripts/`: the build and the maintenance scripts, which run in Node on the development machine only.
- `tests/`: the tests, run by the Node test runner.
- `manifest.json`, `_locales/`, `icons/`: copied into the extension as they are. The icons are the toolbar states of the validated mock-up, drawn as SVG.

The build compiles `src/` with the WebExtension types only, and `scripts/` and `tests/` with the Node types only. The core compiles in both, so a Node API or a browser API in the core fails the build.

Every source file starts with the licence and copyright header:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara
```

## Minimum Firefox version

The extension requires Firefox 142 or later, set by `strict_min_version` in `manifest.json`, and is offered on desktop only, since the manifest has no `gecko_android` key. addons.mozilla.org requires the `data_collection_permissions` key, which exists from Firefox 140 on desktop and 142 on Android, and `web-ext lint` checks Android support against `strict_min_version` even for a desktop-only extension. 142 loses no Firefox version Mozilla still maintained on 2026-11-05 (159 and ESR 153).

## Provider data

Adding or updating a provider is a change of data, never of code. A provider is a folder `data/providers/<id>/`, where the id is made of lowercase letters, digits and hyphens. The folder holds only these files:

- `provider.json` (required): who the provider is and how to recognise it.
- `ranges.txt` (optional): the IP ranges of its edges.
- `logo.svg` (optional): its logo, with its source.

`provider.json`:

| Field | Required | Content |
| --- | --- | --- |
| `name` | Yes | The provider's name |
| `country` | Yes | ISO 3166-1 alpha-2 code, in capitals, of the country whose law the service is subject to, which is not only the law of the entity that signs the contract |
| `parent` | No | Parent company, as `{ "name": ..., "country": ... }` |
| `signatures.headers` | No | Response headers: `name`, optional `value`, `source` |
| `signatures.cookies` | No | Cookies the provider sets or uses itself: `name`, `source` |
| `signatures.server` | No | Values of the `server` header: `value`, `source` |
| `signatures.cname` | No | CNAME suffixes, as a lowercase domain name: `suffix`, `source` |
| `signatures.challengeHosts` | No | Hosts that serve the provider's anti-bot challenge, as a lowercase host pattern: `host`, `source` |
| `signatures.challengePaths` | No | Path prefixes of the challenge, compared to the path of the request URL: `prefix`, `source` |
| `signatures.challengeHeaders` | No | Response headers of the challenge, such as its verification page: `name`, optional `value`, `source` |
| `signatures.challengeQueryNames` | No | Names of the URL query parameters the challenge adds, compared to each parameter name of the request URL, never to a value: `name`, `source` |

Every signature has a `source`: the URL of the provider's documentation, or where and when it was observed. A signature that is only observed says so, with the date and the site.

A request that matches any challenge signature of its provider (host, path prefix, response header or query parameter name) is a request of the challenge. A challenge header is written as in `signatures.headers`, and it is not a signal of the provider: a header that is both goes in both lists.

Header names, cookie names, header values, `server` values, challenge hosts and challenge query parameter names are patterns: `*` matches any run of characters, the empty run included, and every other character is literal. They are never regular expressions, and they are all compared without regard to case. A pattern made only of `*`, or holding `**`, is refused, and so are two entries of a list that differ only by case. The `server` header goes in `signatures.server`, always with a value, because its name alone is on every site.

A CNAME suffix holds no `*` and matches on a label boundary, without regard to case: `cdn.cloudflare.net` matches `www.example.com.cdn.cloudflare.net`, not `xcdn.cloudflare.net`. It is compared to the last name of the CNAME chain, the only one Firefox gives, so a provider's suffixes cover the names its chains end with, not only the first hop: Akamai needs `akamai.net` for a chain that goes through `edgesuite.net` and ends at `a1352.dscb.akamai.net`.

A challenge path prefix starts with `/` and holds no space, `*`, `?` or `#`. It is compared to the path of the URL as a plain prefix, with regard to case.

`ranges.txt` holds one CIDR range per line. Its header gives the published list it comes from and the date it was fetched, and other `#` lines are comments:

```text
# Source: https://www.cloudflare.com/ips-v4
# Fetched: 2026-11-05
173.245.48.0/20
```

A published list is either a text list, one range per line, or a JSON list in the shape of AWS's `ip-ranges.json`, which mixes all of AWS's services. For a JSON list, the `# Source:` line names after the URL the service whose IPv4 and IPv6 ranges are kept, so that it still says by itself where the ranges come from and how they were chosen:

```text
# Source: https://ip-ranges.amazonaws.com/ip-ranges.json, service CLOUDFRONT
```

A list enters `ranges.txt` only if it covers the edge addresses browsers connect to, and a comment says why it is trusted. A list of the addresses a provider uses to reach origin servers is not enough by itself: Akamai's misses edges. When a provider publishes no list of its edges, `ranges.txt` keeps its header, with a `# Source:` that says so and the date of the check in `# Fetched:`, a comment says why, and it holds no range. The file records the check, so that the wrong list is not added later, and the provider is then recognised by its HTTP signatures and CNAME suffixes.

`data/consent-cookies.json` lists the cookie name patterns of known consent and audience-measurement tools, each with its source: the tool's own documentation or code, where the name is written. Each pattern is the narrowest its source allows: the exact name when the name is fixed, otherwise the documented prefix with its separator, such as `_pk_id.*` rather than `_pk_*`. A cookie of the site that only resembles a tool's name then never passes for consent or audience measurement.

```json
{
  "cookies": [
    { "name": "tarteaucitron", "source": "https://github.com/AmauriC/tarteaucitron.js" }
  ]
}
```

`npm run build` reads every provider folder and `data/consent-cookies.json`, checks them and writes the table the extension loads, `dist/providers.js`, whose default export is `{ providers, consentCookies }`. Invalid data fails the build with the file, the place and the reason: the line in `ranges.txt`, the field path in a JSON file (such as `signatures.headers[2].name` or `cookies[3].name`), or the parser message when a JSON file is not valid JSON.

`npm run refresh-ranges` downloads again every list named by a `# Source:` HTTPS URL, checks each range and rewrites `ranges.txt` with the new date, keeping its comments. It runs on the development machine only, and the new ranges reach users with the next version. A `ranges.txt` with any other source is left for a person to update, and an HTTPS source written in neither form fails its refresh.

## Tests

- Tests drive the code: the test is written first, and the code follows.
- A test checks a contract, so it covers failure as much as success: error cases, invalid input and limits.
- Every fix comes with the test that fails without it, in the core as well as in the adapters around it.
- A passing suite on a mock does not prove the real thing. The owner tries the extension in Firefox at each milestone.
- A test is never disabled, and a lint rule never turned off, without saying so.

## Checks

`npm run check` runs everything required before a commit: the tests, Biome (formatting and lint), the build with its data checks, `web-ext lint` on the built extension, both held at zero warnings, and `npm audit` for known vulnerabilities in the dependencies. `npm run format` applies the formatting.

`npm audit` runs with `--audit-level=moderate`, so a low-severity finding does not fail the check. The only finding is GHSA-gcqx-w48m-w2h4 (low) in `deepmerge`, pulled by `addons-linter` inside `web-ext`. It sits in a development tool that is never shipped in the package, no fixed version of `deepmerge` exists, and the only fix npm offers downgrades `web-ext` to 3.2.1. As soon as a `web-ext` release no longer depends on a vulnerable `deepmerge`, the threshold returns to the default.

The build is reproducible: the same sources and lockfile give the same files inside the package, which addons.mozilla.org requires to check a version against its sources. The `.xpi` files themselves differ byte for byte from one build to the next, because `web-ext build` writes the build time and a varying file order into the archive, so two builds are compared by their content.

## Work rules

- The owner decides, and tries the extension in Firefox at each milestone.
- A branch is committed and merged into `main` as soon as `npm run check` passes, without an instruction for each commit. A branch that changes a design rule, a decision of the owner, a permission of the extension or the minimum Firefox version is committed and merged only with the owner's explicit agreement.
- The git hooks enforce the commit format.
- A commit whose content is mostly produced with assistance carries the trailer `Assisted-by: LLM`, before `Signed-off-by` and in the same trailer block. A commit where assistance only asked questions or proofread carries none. Since the hook adds `Signed-off-by` itself, write it as `git commit -s -m "<subject>" -m "Assisted-by: LLM"`, which keeps both trailers in one block.
- Dependencies: the standard tools of the ecosystem are approved by default. Any other dependency needs the owner's approval before it is added. Before adding one, check whether Node or the browser already does the job.
- Visual design (icon, colours, map, layout, logos) goes first through a mock-up, an image or a demo, which the owner validates before it is integrated.

## Branches

Work happens on branches, never directly on `main`. The commit hook refuses commits on `main` in a clone where `git config mogh.branch.protected 1` is set. A branch is merged into `main` with `--no-ff`, when the work rules allow it.

The protection also refuses the merge commit on `main`, so the merge lifts it for that single command:

```sh
git switch main
git -c mogh.branch.protected=0 merge --no-ff <branch>
```

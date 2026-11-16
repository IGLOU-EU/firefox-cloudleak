# Contributing

This file is the reference for anyone who works on this repository: how to set it up, how to make a change, and the rules a change must respect.

- To get to work: [Getting started](#getting-started), [Making a change](#making-a-change), [Tests](#tests), [Checks](#checks).
- To find your way: [Layout](#layout), [Vocabulary](#vocabulary), [Languages](#languages).
- The rules that bind every change: [Design rules](#design-rules), [User data the extension receives](#user-data-the-extension-receives), [One fact, one place](#one-fact-one-place).
- To add or update a provider: [Provider data](#provider-data).

## Getting started

You need Node.js 22 or later, and Firefox or LibreWolf 153 or later to try the extension. Install the dependencies with `npm ci`.

| Command | What it does |
| --- | --- |
| `npm test` | Compiles and runs the tests, in Node, without a browser |
| `npm run build` | Builds the extension into `dist/` and packages it under `web-ext-artifacts/` |
| `npm start` | Starts Firefox with a temporary profile and the built extension |
| `npm run check` | Runs everything required before a commit (see [Checks](#checks)) |
| `npm run format` | Applies the formatting |
| `npm run refresh-ranges` | Downloads the published IP ranges again (see [Provider data](#provider-data)) |
| `npm run measure-map` | Times the view of the map (see [Checks](#checks)) |

The README explains how to load the extension in LibreWolf, where `npm start` cannot connect to the browser.

## Making a change

1. Work on a branch, never directly on `main`.
2. Write the test first, then the code (see [Tests](#tests)).
3. Run `npm run check` until it passes.
4. Commit, following the format below.

A branch is merged into `main` with `--no-ff`.

**Commit format.** A subject is an emoji, a type and a short description in lowercase English, such as `✨ feat: name the flag of the map`. The types in use are `✨ feat`, `🐛 fix`, `⚡️ perf`, `♻️ refactor`, `💄 style`, `📝 docs` and `🔀 merge`. Every commit is signed off (`git commit -s`). A commit whose content is mostly produced with assistance carries the trailer `Assisted-by: LLM`, before `Signed-off-by` and in the same trailer block. A commit where assistance only asked questions or proofread carries none.

**What needs the owner's agreement first.**

- A change to a design rule, to a permission of the extension or to the minimum Firefox version.
- A new dependency, unless it is a standard tool of the ecosystem. Before adding one, check whether Node or the browser already does the job.
- A visual change (icon, colours, map, layout, logos): it goes first through a mock-up, an image or a demo, which the owner validates before it is integrated.

## Design rules

These four rules settle every design choice. They are not negotiable, and only the owner can change one.

1. **Everything local.** The extension makes no request to anyone on its own initiative, downloads no list and sends nothing to anyone. Accepted consequence: the provider lists are embedded and change only with a new version of the extension. One exception, which Firefox imposes: to read the canonical name of a host that neither its IP nor its HTTP signals tie to a provider, the extension asks Firefox's own resolver, through `dns.resolve`, for a name the page has just resolved. Firefox keeps the page's answer in its DNS cache under the site's partition key and the extension's request under an empty one, so the request misses the cache and the resolver sees the same name once more, about once a minute ([bug 2051290](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290)). The resolver learns nothing it did not already know, so the step stays.
2. **No address kept, unless the user turns on the recording.** Only aggregated counts are kept: site, method, request type, provider, level. A provider is one of the data or, while the user turns on the dynamic detection, off by default, a domain read from the DNS (see [Canonical name of a host](#canonical-name-of-a-host)). No address is kept, unless the user turns on the recording of addresses in the preferences, which is off by default, and then only the reduced address of the requests of the chosen levels, outside private windows, up to the limit, purged with the counts of its site and when the recording is turned off (see [User data the extension receives](#user-data-the-extension-receives)).
3. **Never claim more than what is observed.** When the extension cannot know, the display says so, and a doubt is never resolved on the reassuring side.
4. **Never slow down browsing.** No blocking listener: the extension receives the event, returns at once and does its work afterwards.

## User data the extension receives

Firefox hands the extension more than it needs. This section says, for each piece of user data, what is read, what is kept and where. A change that reads or keeps anything more changes design rule 2.

### Request headers

Firefox hands the extension the values of the `Cookie` and `Authorization` request headers together with their names, and there is no way to ask for the names alone. The classification needs only the names and the presence of `Authorization`.

- Cookie and `Authorization` values are never kept: never written to any storage or log, and never passed beyond the function that reads the names.
- The `requestBody` option is never requested. Whether a request carries a body is inferred from its method.
- The public listing of the extension states both points.

### Request URL

The request URL comes with its query. The classification reads only its host, its path and the names of the query parameters, never their values.

**Reduction.** Outside a private window, the URL is reduced at once, in a single function, `addressOf` in `src/core/addresses.ts`, beyond which the full URL never goes. The reduced address holds:

- the scheme, the host, the port when it is not the default one of the scheme, and the path,
- the names of the query parameters, as the URL writes them, each value replaced by `…`, a parameter without value kept as its name and an empty value kept empty,
- never the fragment, a user name or a password.

For example `https://cdn.example.net/assets/app.css?v=…&token=…`.

**Recording.** Nothing of the URL is kept, unless the user turns on the recording of addresses in the preferences, which is off by default.

- The reduced address is dropped as soon as the event page knows the recording is off.
- Otherwise it is dropped once the level of the request is known, unless that level is one the user chose to record: level 4 alone or levels 3 and 4, never level 2.
- A request of a private window records nothing, whatever the settings.

**Storage.** A request whose document has not committed yet holds its reduced address in its tab's record, in `storage.session`, in memory, until the commit gives its site. Only then is the address kept, in `storage.local`, never in `storage.sync`, under a key of its own for each site, apart from its counts. For each provider, category, method and request type, the extension keeps the distinct addresses, the most recently seen first, without any count or time, which would tell when the user was on the site. It keeps them up to the limit the user sets, any whole number of addresses from 1 up, with no maximum, 100 by default, the oldest dropped.

**Purge.**

- The addresses of a site go with its counts, in the same writes, when the user clears the site, purges every count or ignores the site.
- Turning the recording off empties every kept address in the same write as the settings.
- Narrowing the levels drops at once the addresses of the level left out.
- Lowering the limit trims every kept list at once.

**Display.** The map shows the kept addresses of a site only in the panel of that site, which asks the event page for them when it opens, never in a private window, and copies one to the clipboard only when the user clicks it.

### Canonical name of a host

To find the provider of a request that neither its IP nor its HTTP signals name, the extension reads the canonical name of its host, the last name of its CNAME chain (design rule 1). That name is compared to the CNAME suffixes of the providers and is never kept.

**Dynamic detection.** Unless the user turns on the dynamic detection in the preferences, which is off by default, nothing more is done with the name. While it is on, a name that no provider claims and that leaves the domain of the host names a supposed provider (see [Vocabulary](#vocabulary)), with no further DNS request.

- Of the name, only a domain goes further, reduced at once in a single function, `supposedOf` in `src/core/supposed.ts`: its registrable domain by Firefox's `publicSuffix` API, or its known suffix itself when that suffix has several labels under a generic top-level domain, where such suffixes are those hosting providers register (`customer.b-cdn.net` gives `b-cdn.net`). The rest of the name, which may hold the name of a customer, is never kept.
- That domain is kept as the id of the provider, wherever the id of a known provider is: in the record of the tab, in `storage.session`, and in the kept counts and the recorded addresses, in `storage.local`.
- Turning the detection off drops at once everything kept under a supposed provider, counts and addresses, in the same write as the settings. A tab already open keeps what its icon shows until its next navigation.

### URL of a document

The `webNavigation` events give the URL of every document a tab shows, whatever the access to its site. Of that URL, three things are read:

- the scheme, which tells the pages of the browser (a new tab, the settings, reader view, `view-source:`, a local file, an extension page) from websites,
- for an `about:` page, its name: what comes before `?` or `#`, never what follows, which holds the address of the article in reader view. The name tells reader view, which loads the images of the article from the web, from the other pages of the browser,
- for a website, its host.

The scheme and the name are never kept: never written to any storage or log, and never passed beyond the function that reads them.

The host is reduced at once, in that same function, to its registrable domain through Firefox's `publicSuffix` API (`www.legifrance.gouv.fr` gives `legifrance.gouv.fr`). That domain, the site of the document, is the only thing of the URL the extension keeps:

- in the record of the document, in `storage.session`,
- as the key of the kept counts and of their start once the site is cleared, in `storage.local`,
- in the list of ignored sites, in `storage.local`.

Only a website has a site: a page of the browser, reader view included, has none, and its requests enter no kept count. A document is known by its `documentId`, a random id that says nothing of its URL.

### URL of a tab the extension did not see navigate

For a tab whose navigation the extension did not see, such as a tab open before it started, the URL of the page the tab shows comes from `webNavigation.getFrame`, which gives it whatever the access to the site, as the `webNavigation` events do. It is read and reduced in the same function, as the URL of a committed document is: the same three things are read, the site alone goes further, and nothing else of it is kept.

### Text that names a site to ignore

A request to ignore a site names it by a text: a host, a host and its port, or the address of a page. Of that text, two things are read:

- its scheme, so that a text that names no website names no site,
- its host, reduced at once, in that same function, to its registrable domain through Firefox's `publicSuffix` API, as the host of a committed document is.

That domain is the only thing of the text the extension keeps, in the list of ignored sites in `storage.local`, never in `storage.sync`, which Firefox sends to Mozilla's servers. The rest of the text is never written to any storage or log, and never passed beyond the function that reads it.

On the preferences page, where the text is typed, the same function reduces it while it is typed, to show the site it gives before anything is sent. A text that names no site is the one exception: the page shows it back, trimmed, in the line under the field that refuses it, and nowhere else.

Ignoring a site erases its kept counts, their start, its recorded addresses and its counts of the private session, and from then on no request of a document of that site is classified or counted.

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
| README | French as the source in `README.md`, English translation in `README.en.md`, both changed in the same commit |
| CONTRIBUTING | English |
| User-facing strings | Through `_locales`, English as the source in `_locales/en`, French translation in `_locales/fr` |

Every string shown to the user goes through `_locales` from the moment it is written, never as a literal in the code.

## Vocabulary

- **Provider**: a third-party service that a site places between its visitors and its own server, such as Cloudflare, Akamai or Imperva, sold as a reverse proxy, a CDN or a WAF.
- **Supposed provider**: a third party the dynamic detection names from the canonical name of a host alone, by a domain such as `b-cdn.net`. It may be a mere hosting company, it has no signature, so its decryption is never proven under TLS, and its country is unknown: the display shows ❓ in place of a flag.
- **Edge**: the provider's server that the browser actually connects to.
- **Origin**: the site's own server, behind the provider.
- **Leak level**: what a provider learns from a request. The levels are cumulative.
  1. **Passage**: that the user contacted the site, and when: the user's IP address, the site name, the time.
  2. **Usage**: which public resource is loaded, and from which site.
  3. **Reading**: which pages the user reads.
  4. **Personal data**: what the user sends, and what concerns them: cookies, forms, request bodies, pages of a logged-in area.
- **Proven decryption**: the response carries an HTTP signal of the provider (a header, or a cookie only its own servers set, see [Provider data](#provider-data)), or the request went over HTTP without TLS. The provider read the traffic in clear.
- **Unproven decryption**: the request reached the provider, for instance by its IP address, but nothing in the response proves it read the traffic. An absent signal proves nothing.

## Layout

| Path | Content |
| --- | --- |
| `src/core/` | The pure core, with no browser API. It runs and is tested in Node, without Firefox |
| `src/background.ts` | The background entry point of the extension, which only adds the listeners |
| The other files of `src/` | The thin adapters between Firefox and the core. They hold no classification logic |
| `data/providers/` | One folder per provider (see [Provider data](#provider-data)) |
| `data/consent-cookies.json` | The cookies of known consent and audience-measurement tools (see [Provider data](#provider-data)) |
| `scripts/` | The build and the maintenance scripts, which run in Node on the development machine only |
| `tests/` | The tests, run by the Node test runner |
| `manifest.json`, `_locales/`, `icons/`, `popup/`, `options/`, `map/` | Copied into the extension as they are |

The adapters cover the requests, the tabs and their documents, the site of a document, the kept counts, the ignored sites, the settings and the recorded addresses, the answers to the pages of the extension, the popup page, the preferences page, the map and what the pages share, the toolbar icon, DNS and the permissions.

The folders copied as they are:

- `icons/`: the toolbar states of the validated mock-up, drawn as SVG.
- `popup/`: the page and the style of the window the toolbar button opens, whose script is `src/popup.ts`.
- `options/`: the page and the style of the preferences, which Firefox shows in the tab of the extension in the add-ons manager, whose script is `src/options.ts`.
- `map/`: the page and the style of the map, which the window opens in a tab, whose script is `src/map.ts` and whose view is `src/core/map-view.ts`.

The build compiles `src/` with the WebExtension types only, and `scripts/` and `tests/` with the Node types only. The core compiles in both, so a Node API or a browser API in the core fails the build.

Every source file starts with the licence and copyright header:

```ts
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara
```

## Minimum Firefox version

The extension requires Firefox 153 or later, set by `strict_min_version` in `manifest.json`, and is offered on desktop only, since the manifest has no `gecko_android` key.

- Firefox 153 is the first version whose `webNavigation` events give the `documentId` of a document (browser-compat-data, `webextensions.api.webNavigation.onCommitted.documentId`), which lets a page that Back or Forward brings back from the back-forward cache, without any request, show its own state again.
- addons.mozilla.org requires the `data_collection_permissions` key, which exists from Firefox 140 on desktop and 142 on Android, and `web-ext lint` checks Android support against `strict_min_version` even for a desktop-only extension, both below 153.
- 153 loses no Firefox version Mozilla still maintained on 2026-11-06 (159 and ESR 153).

## Tests

- Tests drive the code: the test is written first, and the code follows.
- A test checks a contract, so it covers failure as much as success: error cases, invalid input and limits.
- Every fix comes with the test that fails without it, in the core as well as in the adapters around it.
- The adapters are tested on the compiled extension: `npm test` also compiles `src/` into `build/extension/`, and `tests/adapters.test.ts` drives it with a stand-in for Firefox's `browser` object and mocked timers.
- A passing suite on a mock does not prove the real thing: try the change in Firefox.
- A test is never disabled, and a lint rule never turned off, without saying so.

## Checks

`npm run check` runs everything required before a commit:

- the tests,
- Biome (formatting and lint), held at zero warnings,
- the build with its data checks,
- `web-ext lint` on the built extension, held at zero warnings,
- `npm audit` for known vulnerabilities in the dependencies.

**The audit threshold.** `npm audit` runs with `--audit-level=moderate`, so a low-severity finding does not fail the check. The only finding is GHSA-gcqx-w48m-w2h4 (low) in `deepmerge`, pulled by `addons-linter` inside `web-ext`. It sits in a development tool that is never shipped in the package, no fixed version of `deepmerge` exists, and the only fix npm offers downgrades `web-ext` to 3.2.1. As soon as a `web-ext` release no longer depends on a vulnerable `deepmerge`, the threshold returns to the default.

**The speed of the map.** `npm run measure-map` times the view of the map on the 900 sites of its validated mock-up, at each keystroke of the search and for each answer of the event page. It prints the times and judges none, since they depend on the machine: a keystroke of the whole page, drawing included, stays under 100 ms.

**Reproducible build.** The same sources and lockfile give the same files inside the package, which addons.mozilla.org requires to check a version against its sources. The `.xpi` files themselves differ byte for byte from one build to the next, because `web-ext build` writes the build time and a varying file order into the archive, so two builds are compared by their content.

## Provider data

Adding or updating a provider is a change of data, never of code. A provider is a folder `data/providers/<id>/`, where the id is made of lowercase letters, digits and hyphens. The folder holds only these files:

- `provider.json` (required): who the provider is and how to recognise it.
- `ranges.txt` (optional): the IP ranges of its edges.
- `logo.svg` (optional): its logo, with its source.

`npm run build` checks the data and fails on anything invalid, with the file, the place and the reason (see [What the build does with the data](#what-the-build-does-with-the-data)).

### `provider.json`

| Field | Required | Content |
| --- | --- | --- |
| `name` | Yes | The provider's name |
| `country` | Yes | ISO 3166-1 alpha-2 code, in capitals, of the country whose law the service is subject to, which is not only the law of the entity that signs the contract |
| `parent` | No | Parent company, as `{ "name": ..., "country": ... }` |
| `signatures.headers` | No | Response headers: `name`, optional `value`, `source` |
| `signatures.cookies` | No | Cookies the provider sets or uses itself: `name`, `source` |
| `signatures.siteConnectorCookies` | No | Cookies of a provider's product that a connector installed at the site can also set, without the provider being in the network path: `name`, `source` |
| `signatures.server` | No | Values of the `server` header: `value`, `source` |
| `signatures.cname` | No | CNAME suffixes, as a lowercase domain name: `suffix`, `source` |
| `signatures.challengeHosts` | No | Hosts that serve the provider's anti-bot challenge, as a lowercase host pattern: `host`, `source` |
| `signatures.challengePaths` | No | Path prefixes of the challenge, compared to the path of the request URL: `prefix`, `source` |
| `signatures.challengeHeaders` | No | Response headers of the challenge, such as its verification page: `name`, optional `value`, `source` |
| `signatures.challengeQueryNames` | No | Names of the URL query parameters the challenge adds, compared to each parameter name of the request URL, never to a value: `name`, `source` |

**Sources.** Every signature has a `source`: the URL of the provider's documentation, or where and when it was observed. A signature that is only observed says so, with the date and the site.

**Country.** The map names a country by the name the browser gives its code, and shows its flag from the code itself. Its tooltips also need the forms of the country a sentence puts around it, "subject to the law of the United States" and "in the United States", which change from one country to another. A country new to the data, as `country` or as the country of a `parent`, comes with its two messages, `mapLawOf<code>` and `mapIn<code>`, in every locale, which a test checks.

### How a signature matches

**Patterns.** Header names, cookie names, header values, `server` values, challenge hosts and challenge query parameter names are patterns: `*` matches any run of characters, the empty run included, and every other character is literal. They are never regular expressions, and they are all compared without regard to case. A pattern made only of `*`, or holding `**`, is refused, and so are two entries of a list that differ only by case.

**The `server` header** goes in `signatures.server`, always with a value, because its name alone is on every site.

**CNAME suffixes.** A CNAME suffix holds no `*` and matches on a label boundary, without regard to case: `cdn.cloudflare.net` matches `www.example.com.cdn.cloudflare.net`, not `xcdn.cloudflare.net`. It is compared to the last name of the CNAME chain, the only one Firefox gives, so a provider's suffixes cover the names its chains end with, not only the first hop: Akamai needs `akamai.net` for a chain that goes through `edgesuite.net` and ends at `a1352.dscb.akamai.net`.

**Challenge.** A request that matches any challenge signature of its provider (host, path prefix, response header or query parameter name) is a request of the challenge. A challenge header is written as in `signatures.headers`, and it is not a signal of the provider: a header that is both goes in both lists. A challenge path prefix starts with `/` and holds no space, `*`, `?` or `#`. It is compared to the path of the URL as a plain prefix, with regard to case.

**Cookies of a site connector.** A cookie goes in `signatures.siteConnectorCookies`, not in `signatures.cookies`, when its source shows that a connector at the site can set it, as Radware's Bot Manager does from the site's gateway.

- A cookie in `signatures.cookies` proves that the provider's servers relayed the response, and one in `signatures.siteConnectorCookies` only that its product saw the request.
- A response that sets a connector cookie names the provider at the same step as the other HTTP signals, after any provider whose own signal the response carries, but never proves the decryption: the proof still needs another HTTP signal of that provider, or plain HTTP.
- When the browser sends one, it raises the level like any cookie of the site.

### `ranges.txt`

`ranges.txt` holds one CIDR range per line. Its header gives the published list it comes from and the date it was fetched, and other `#` lines are comments:

```text
# Source: https://www.cloudflare.com/ips-v4
# Fetched: 2026-11-05
173.245.48.0/20
```

**Which list is trusted.** A list enters `ranges.txt` only if it covers the edge addresses browsers connect to, and a comment says why it is trusted. A list of the addresses a provider uses to reach origin servers is not enough by itself: Akamai's misses edges.

**A provider without a list.** When a provider publishes no list of its edges, `ranges.txt` keeps its header, with a `# Source:` that says so and the date of the check in `# Fetched:`, a comment says why, and it holds no range. The file records the check, so that the wrong list is not added later, and the provider is then recognised by its HTTP signatures and CNAME suffixes.

**Accepted formats.** A published list is one of:

- a text list, one range per line,
- a JSON list of all the provider's ranges in the shape of Fastly's `public-ip-list` (the arrays `addresses` and `ipv6_addresses`),
- a JSON list in the shape of AWS's `ip-ranges.json`, which mixes all of AWS's services.

A body that starts with `{` is read as JSON. For a list in the shape of AWS's, the `# Source:` line names after the URL the service whose IPv4 and IPv6 ranges are kept, so that it still says by itself where the ranges come from and how they were chosen:

```text
# Source: https://ip-ranges.amazonaws.com/ip-ranges.json, service CLOUDFRONT
```

**Refreshing.** `npm run refresh-ranges` downloads again every list named by a `# Source:` HTTPS URL, checks each range and rewrites `ranges.txt` with the new date, keeping its comments. It runs on the development machine only, and the new ranges reach users with the next version. A `ranges.txt` with any other source is left for a person to update, and an HTTPS source written in neither form fails its refresh.

### `data/consent-cookies.json`

The file lists the cookie name patterns of known consent and audience-measurement tools, each with its source: the tool's own documentation or code, where the name is written. Each pattern is the narrowest its source allows: the exact name when the name is fixed, otherwise the documented prefix with its separator, such as `_pk_id.*` rather than `_pk_*`. A cookie of the site that only resembles a tool's name then never passes for consent or audience measurement.

```json
{
  "cookies": [
    { "name": "tarteaucitron", "source": "https://github.com/AmauriC/tarteaucitron.js" }
  ]
}
```

### What the build does with the data

`npm run build` reads every provider folder and `data/consent-cookies.json`, checks them and writes the table the extension loads, `dist/providers.js`, whose default export is `{ providers, consentCookies }`. The table holds the ranges already parsed, each IPv4 range as its network and its mask in 32-bit numbers and each IPv6 range with its network as a BigInt, so that no wake-up of the event page parses a range again.

Invalid data fails the build with the file, the place and the reason: the line in `ranges.txt`, the field path in a JSON file (such as `signatures.headers[2].name` or `cookies[3].name`), or the parser message when a JSON file is not valid JSON.

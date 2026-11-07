# Cloud Leak

`firefox-cloudleak` is the code name of the repository.

When you browse, part of what you send and read goes through intermediaries such as Cloudflare, Akamai or Imperva, which decrypt the traffic, and nothing in the browser tells you. This Firefox extension shows it while you browse: when your data goes through one of them, what it can learn from it, and, on a map, which providers and which countries the sites you use depend on.

## Promises

1. **Everything stays on your computer.** The extension sends nothing to anyone and downloads no list. The provider lists ship inside the extension and change only with a new version. Its only network activity is to ask Firefox's own DNS resolver, once more, for a name the page has just looked up, because Firefox does not let it read the page's cached answer ([bug 2051290](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290)).
2. **No address is kept.** Only aggregated counts are stored, by site, method, request type, provider and level, with the date the counts started. The site is the registrable domain of the page's address, such as `legifrance.gouv.fr`, and nothing else of an address is kept.
3. **It never claims more than it observes.** When it cannot know, it says so, and a doubt is never settled on the reassuring side.
4. **It never slows your browsing.** It watches requests without ever holding them.

These promises are the design rules of the project, whose binding wording is in [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), along with what the extension does with the cookie values Firefox hands it.

## Status

Under construction. The toolbar icon shows, for each tab, whether its requests go through a known provider, at which leak level and whether the decryption is proven: the cloud takes the colour of the most serious request, the badge counts the requests of the tab at that colour and level, with a + beyond 99, and the tooltip counts the requests of the tab at each level, then says what the provider of the most serious one sees, with a line more when a request carried a cookie of the site or an `Authorization` header through a provider, and another when one belonged to an anti-bot protection, each in the conditional unless the decryption of such a request was proven. While the extension lacks the access to all sites, every tab of a website says its view is partial, and so does reader view, which loads the images of the article from the web, while the other pages of the browser (a new tab, the settings, `view-source:`, a local file or an extension page) are no site and never say so. A tab also says so, for another reason, when the extension missed requests of its page: those a service worker serves, or those of a page loaded before the extension started. Back and Forward show again the state of the page they bring back, and a page reached without any request, such as a local file or a page of the browser, starts neutral. A link that opens no page, such as a download, leaves the icon on the page still shown. Nothing is counted or kept beyond the open tabs yet, and there is no map. The provider data covers Cloudflare, Akamai, Amazon CloudFront, Fastly, Imperva, Radware and OVHcloud CDN, with IP ranges for Cloudflare, CloudFront, Fastly and Imperva only, since Akamai, Radware and OVHcloud publish no list that covers their edge addresses.

## Build, test and run

The extension supports Firefox and LibreWolf, version 153 or later. Building it needs Node.js 22 or later.

Install the exact dependency versions from the lockfile:

```sh
npm ci
```

Build the extension into `dist/` and package it as `web-ext-artifacts/firefox-cloudleak-<version>.xpi`:

```sh
npm run build
```

Run the tests, which need no browser:

```sh
npm test
```

To try it in Firefox, start Firefox with a temporary profile and the extension installed, after a build:

```sh
npm start
```

`npm start` uses the `firefox` found on your `PATH`. To use another Firefox binary, pass its path:

```sh
npm start -- --firefox=/path/to/firefox
```

To try it in LibreWolf, where `npm start` cannot connect to the browser, load it by hand after a build:

1. Open `about:debugging` and choose "This LibreWolf" (the same page reads "This Firefox" in Firefox).
2. Click "Load Temporary Add-on…" and pick `dist/manifest.json`.

The extension stays installed until you remove it or restart the browser.

## License

Copyright (C) 2026 Adrien Kara.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. See [LICENSE](LICENSE).

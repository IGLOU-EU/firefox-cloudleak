# Cloud Leak

`firefox-cloudleak` is the code name of the repository.

When you browse, part of what you send and read goes through intermediaries such as Cloudflare, Akamai or Imperva, which decrypt the traffic, and nothing in the browser tells you. This Firefox extension shows it while you browse: when your data goes through one of them, what it can learn from it, and, on a map, which providers and which countries the sites you use depend on.

## Promises

1. **Everything stays on your computer.** The extension sends nothing to anyone and downloads no list. The provider lists ship inside the extension and change only with a new version. Its only network activity is to ask Firefox's own DNS resolver, once more, for a name the page has just looked up, because Firefox does not let it read the page's cached answer ([bug 2051290](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290)).
2. **No address is kept, unless you turn on the recording.** Only aggregated counts are stored, by site, method, request type, provider and level, with the day the counts started, never the hour, and the list of the sites you ask it to ignore. A site is the registrable domain of an address, such as `legifrance.gouv.fr`, and nothing else of an address is kept, unless you turn on the recording of addresses in the preferences, which is off by default. Then, and only for the requests of the levels you choose, level 4 alone or levels 3 and 4, outside private windows, it keeps their reduced address: the scheme, the host, the port, the path and the names of the query parameters, never their values, nor the fragment, nor a user name or a password, such as `https://cdn.example.net/assets/app.css?v=…&token=…`. For each site, provider, colour and level, method and request type, it keeps the distinct addresses, the most recent first and never with a time, up to the number you set, 100 by default, with no maximum. They are purged with the counts of their site, and all at once when you turn the recording off.
3. **It never claims more than it observes.** When it cannot know, it says so, and a doubt is never settled on the reassuring side.
4. **It never slows your browsing.** It watches requests without ever holding them.

These promises are the design rules of the project, whose binding wording is in [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), along with what the extension does with the cookie values Firefox hands it.

## Status

Under construction. The toolbar icon shows, for each tab, whether its requests go through a known provider, at which leak level and whether the decryption is proven: the cloud takes the colour of the most serious request, the badge counts the requests of the tab at that colour and level, with a + beyond 99, and the tooltip counts the requests of the tab at each level, then says what the provider of the most serious one sees, with a line more when a request carried a cookie of the site or an `Authorization` header through a provider, and another when one belonged to an anti-bot protection, each in the conditional unless the decryption of such a request was proven. While the extension lacks the access to all sites, every tab of a website says its view is partial, and so does reader view, which loads the images of the article from the web, while the other pages of the browser (a new tab, the settings, `view-source:`, a local file or an extension page) are no site and never say so. A tab also says so, for another reason, when the extension missed requests of its page: those a service worker serves, or those of a page loaded before the extension started. Back and Forward show again the state of the page they bring back, and a page reached without any request, such as a local file or a page of the browser, starts neutral. A link that opens no page, such as a download, leaves the icon on the page still shown. Clicking the icon opens a window that says the same of the page shown, then counts, by provider and level, every request of the site that went through a provider since the counts of the site started, the site being the registrable domain of the page's address, which the extension asks Firefox for in a tab open before it started. The counts are kept on your computer until you clear them, one site at a time, with a button of that window that clears the site shown and no other, whose counts then start again from the clear, while the other sites keep theirs and their start, or all at once from the map. The counts of private windows last only until the last private window closes, as Firefox's private session does, and are shown apart: in a private window, the same button clears the counts of the site in the private session and leaves its kept counts alone. A page of the browser, or a site the extension does not know, has nothing to clear and shows no such button. The same window ignores the site shown, after a question, since ignoring erases its counts, except in a private window, so that no site visited in private enters the list of ignored sites, which is kept on your computer. The window of an ignored site says so and shows no count, and its button watches the site again at once, in a private window too. A question mark in a circle, at the top right of the window and of the map, opens a help over them, for now a placeholder until its text, on the levels and how serious they are, is written. A gear at the top of the window opens the preferences of the extension, in its tab of the add-ons manager: the list of the ignored sites, each with a button that watches it again, and a field that adds a site named by a host, a host and its port, or the address of a page, and shows the site it gives while it is typed. A site is kept as its registrable domain. Once a site is ignored, none of its requests is looked at, those of its pages loaded from other hosts included, its counts and their start are erased, private session included, and every tab that shows it turns at once to the neutral cloud, with no badge and "Ignored site" as its tooltip. Watching it again starts its counts from nothing, from that day, and its pages still open say they missed requests until they navigate. The "See the map" button of the window opens the map in a tab of the same window, always on the whole: the sites on the left, from the most serious to the least under a heading for the category of their most serious request, a blue site as a point and a red or orange one as the cloud of the icon, the providers on the right with the emoji flag of the country whose law they are subject to, and one link between a site and each of its providers, in the colour of the most serious category of the pair, as thick as its level, and dashed when the decryption is not proven, blue staying solid. Beyond three, the blue sites through the same providers make one row. A click on a site, a provider or a link gives its details in the panel on the right, which otherwise gives the overview. A field keeps the sites whose name holds what is typed, and a click on a row of the overview limits the map to the links of a provider, of a category or to the providers of a country, one limit per list, each shown as a chip, all together with the search, the overview then counting what a click on each row would keep, and the providers left without a link leaving the column. The map asks again for the counts each time its tab comes back into view. Its only action, "Clear all", clears every kept count after a question, and the counts then start again that day for every site, while the ignored sites stay ignored. From a private window, the map shows and clears the counts of the private session only. Below the ignored sites, the preferences turn on the recording of the reduced addresses of requests, as promise 2 describes, for level 4 alone or for levels 3 and 4, with the number of addresses kept for each row, 100 by default and with no maximum, and going back to none clears every kept address after a question. The addresses are purged with the counts of their site, and what narrower settings leave out goes at once. In the panel of a site on the map, a row of a method and a type that has addresses kept carries a triangle, and a click unfolds the list of its addresses in alphabetical order, twelve in view, with how many are kept and whether the limit is reached. A click on an address copies it to the clipboard. Nothing is recorded, and no address is shown, in a private window. The provider data covers Cloudflare, Akamai, Amazon CloudFront, Fastly, Imperva, Radware and OVHcloud CDN, with IP ranges for Cloudflare, CloudFront, Fastly and Imperva only, since Akamai, Radware and OVHcloud publish no list that covers their edge addresses.

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

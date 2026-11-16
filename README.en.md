# Cloud Leak

Disponible en [français](README.md)

When you browse, part of what you send and read goes through intermediaries such as Cloudflare, Akamai or Imperva, which can read your traffic. This Firefox extension aims to make the scale of the problem more visible, by highlighting the data that goes through one of them, what it can learn from it, and which providers and which countries the sites you use depend on.

## Project rules

1. **Everything happens locally.** The extension sends nothing to anyone and downloads no list. One exception, due to a [temporary Firefox bug](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290): it asks the browser's DNS resolver again for a name the page has just resolved. The provider lists ship inside the extension and change only with a new version.
2. **No history.** You keep only aggregated statistics, by site, method, request type, provider and level. An option to partially record addresses is available in the preferences, to put the use of the third-party service into context.
3. **No hasty claims.** The level says what goes through the provider and, when that is sensitive, the colour says whether the provider is proven to read it: red if so, orange if not.

These are the basic rules for the design of this project, detailed further in [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), along with what the extension does with the cookie values Firefox hands it.

## Usage

The toolbar icon takes the colour of the highest level of the tab and shows the number of matching requests, or a `+` when there are too many. Its window details the request types, and lets you clear its statistics or ignore the site.

A map links all the sites using these services to their providers and to the country the data going through each of them depends on. In private browsing, nothing is kept after the last private window closes.

The extension does not know every provider, and although it tries to guess, a complete view is impossible. Still, it gives an idea of the privacy and data sovereignty issue, and also of which countries can decide on the right to access an online service.

## Build, test and run

The extension supports Firefox and LibreWolf, version 153 or later. Building it needs Node.js 22 or later.

Install the dependencies from the lockfile:

```sh
npm ci
```

Build the extension into `dist/` and package it as `web-ext-artifacts/firefox-cloudleak-<version>.xpi`:

```sh
npm run build
```

Run the tests:

```sh
npm test
```

To try it after a build, start Firefox with a temporary profile where the extension is installed:

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

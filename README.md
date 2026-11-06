# firefox-cloudleak

When you browse, part of what you send and read goes through intermediaries such as Cloudflare, Akamai or Imperva, which decrypt the traffic, and nothing in the browser tells you. This Firefox extension shows it while you browse: when your data goes through one of them, what it can learn from it, and, on a map, which providers and which countries the sites you use depend on.

## Promises

1. **Everything stays on your computer.** The extension makes no request of its own, downloads no list and sends nothing to anyone. The provider lists ship inside the extension and change only with a new version.
2. **No address is kept.** Only aggregated counts are stored: site, method, request type, provider and level.
3. **It never claims more than it observes.** When it cannot know, it says so, and a doubt is never settled on the reassuring side.
4. **It never slows your browsing.** It watches requests without ever holding them.

These promises are the design rules of the project, whose binding wording is in [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), along with what the extension does with the cookie values Firefox hands it.

## Status

Under construction, nothing usable yet. The extension builds, but it does not observe any request yet. Its provider data covers Cloudflare, Akamai, Imperva and Radware, with IP ranges for Cloudflare and Imperva only, since Akamai and Radware publish no list of their edge addresses.

## Build, test and run

The extension supports Firefox and LibreWolf, version 142 or later. Building it needs Node.js 22 or later.

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

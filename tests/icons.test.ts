// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The logo names the extension, and the clouds say a state. The logo goes in
// the about section, the header and the tab of the map, and the add-ons
// manager, never where a state is shown: the toolbar and the header of the
// popup keep their clouds, the neutral one included.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { htmlOf } from "./dom.js";

const LOGO = "icons/logo.svg";

const manifest = JSON.parse(
  readFileSync(new URL("../../manifest.json", import.meta.url), "utf8"),
) as {
  icons?: Record<string, string>;
  action: { default_icon: string };
};

// Each tag of the page whose attributes name the file.
function tagsOf(page: string, file: string): string[] {
  return [...htmlOf(page).matchAll(/<(?:img|link)\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => tag.includes(`"/${file}"`));
}

describe("the logo", () => {
  it("is the icon of the add-ons manager, declared at both sizes of an SVG", () => {
    assert.deepEqual(manifest.icons, { "32": LOGO, "64": LOGO });
  });

  it("names the map in its header, at 24 pixels, and in its tab", () => {
    assert.deepEqual(tagsOf("map/map.html", LOGO), [
      '<link rel="icon" href="/icons/logo.svg" type="image/svg+xml">',
      '<img src="/icons/logo.svg" alt="" width="24" height="24">',
    ]);
    assert.deepEqual(tagsOf("map/map.html", "icons/neutral.svg"), []);
  });

  it("is never the icon of a state: the toolbar and the popup keep the neutral cloud", () => {
    assert.equal(manifest.action.default_icon, "icons/neutral.svg");
    assert.deepEqual(tagsOf("popup/popup.html", LOGO), []);
    assert.deepEqual(tagsOf("popup/popup.html", "icons/neutral.svg"), [
      '<img id="state" src="/icons/neutral.svg" alt="" width="32" height="32">',
    ]);
  });

  it("is a standalone SVG that Firefox draws as an icon, in the ink of each theme", () => {
    const svg = readFileSync(new URL(`../../${LOGO}`, import.meta.url), "utf8");
    assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 16 16"/);
    assert.match(svg, /\.ink\{fill:#15141a\}/);
    assert.match(
      svg,
      /@media \(prefers-color-scheme:dark\)\{\.ink\{fill:#fbfbfe\}\}/,
    );
  });
});

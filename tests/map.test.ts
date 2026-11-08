// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The map page, compiled with the extension into build/extension/, driven by
// a stand-in for Firefox's browser object, for its clipboard and for the DOM
// of map.html: the addresses kept of the rows of the panel of a site.

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type {
  MapData,
  PopupRequest,
  Settings,
  SiteAddresses,
} from "../src/core/popup-message.js";
import { importModule, writeTable } from "./built-extension.js";
import { Element, find, htmlOf, installPage } from "./dom.js";

writeTable();

const HTML = htmlOf("map/map.html");
const SITE = "vm.home.arpa";

const DATA: MapData = {
  privateWindow: false,
  since: Date.UTC(2026, 10, 7, 12),
  siteSince: {},
  sites: {
    [SITE]: {
      edge: {
        red4: { "GET stylesheet": 3, "GET script": 2 },
        blue2: { "GET image": 3 },
      },
    },
  },
};

const STYLES = [
  "https://vm-tunnel.example.net/ui/css/dashboard.css?build=…",
  "https://cdn.example.net/assets/app.css?v=…&token=…",
  "https://cdn.example.net/fonts/inter/inter.css",
];
const ADDRESSES: SiteAddresses = {
  edge: { red4: { "GET stylesheet": STYLES } },
};

// Every promise already settled has run its callbacks, such as the answers
// of the stand-in, whatever the timers do.
function settled(): Promise<void> {
  return new Promise((done) => setImmediate(done));
}

interface Options {
  readonly privateWindow?: boolean;
  readonly limit?: number;
  // What the event page answers to "siteAddresses", once let through.
  readonly addresses?: () => Promise<SiteAddresses>;
  readonly writeText?: (text: string) => Promise<void>;
}

interface Opened {
  readonly root: Element;
  readonly sent: PopupRequest[];
  // What the page wrote to the clipboard.
  readonly copied: string[];
  element(id: string): Element;
  // The user clicks the row of the site in the column.
  chooseSite(): void;
  // The rows of the panel that unfold, as their text.
  kinds(): Element[];
  // The addresses listed, as their text.
  listed(): string[];
  note(): string | null;
  addressButtons(): Element[];
}

let opened = 0;

async function open(options: Options = {}): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const copied: string[] = [];
  const root = installPage(HTML);
  const privateWindow = options.privateWindow ?? false;
  Object.assign(globalThis, {
    // The page tells an element of the page by its class.
    Element,
    window: { addEventListener: () => {} },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: (text: string) => {
          copied.push(text);
          return options.writeText?.(text) ?? Promise.resolve();
        },
      },
    },
  });
  (globalThis as Record<string, unknown>)["browser"] = {
    extension: { inIncognitoContext: privateWindow },
    runtime: {
      sendMessage: async (
        request: PopupRequest,
      ): Promise<MapData | SiteAddresses | Settings> => {
        sent.push(request);
        switch (request.kind) {
          case "map":
            return { ...DATA, privateWindow };
          case "siteAddresses":
            return request.privateWindow
              ? {}
              : await (options.addresses?.() ?? ADDRESSES);
          case "settings":
            return { record: "level4", recordLimit: options.limit ?? 100 };
          default:
            throw new Error(`unexpected ${request.kind}`);
        }
      },
    },
    i18n: {
      getMessage: (name: string, substitutions: string[] = []) =>
        [name, ...substitutions].join(" "),
      getUILanguage: () => "fr",
    },
    publicSuffix: { getDomain: (host: string) => host },
  };
  opened += 1;
  // A module runs once per URL, so each page gets its own.
  await importModule(`map.js?${opened}`);
  await settled();
  const element = (id: string): Element => find(root, id);
  const panel = () => element("panel-content");
  const kinds = () => panel().querySelectorAll("button.kind");
  return {
    root,
    sent,
    copied,
    element,
    chooseSite: () => {
      const row = element("drawing")
        .querySelectorAll("[data-k]")
        .find((entry) => entry.dataset["k"] === `s:${SITE}`);
      assert.ok(row, "the column has no row for the site");
      element("plan").dispatch("click", { target: row });
    },
    kinds,
    listed: () =>
      panel()
        .querySelectorAll(".text")
        .map((text) => text.textContent),
    note: () => panel().querySelector(".addresses-note")?.textContent ?? null,
    addressButtons: () => panel().querySelectorAll("button.address"),
  };
}

function text(entry: Element): string {
  return entry.children
    .filter((part) => part.tagName === "span" && part.className !== "mark")
    .map((part) => part.textContent)
    .join(" ");
}

afterEach(() => {
  mock.timers.reset();
});

describe("the addresses of the panel of a site on the map", () => {
  it("asks for no address when the map opens, and for those of a site once its panel opens", async () => {
    const page = await open();
    assert.deepEqual(page.sent, [{ kind: "map", privateWindow: false }]);
    page.chooseSite();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "siteAddresses", site: SITE, privateWindow: false },
      { kind: "settings" },
    ]);
  });

  it("marks only the row that has addresses kept, folded", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    const kinds = page.kinds();
    assert.deepEqual(kinds.map(text), ["GET mapTypeStylesheet 3"]);
    assert.equal(kinds[0]?.getAttribute("aria-expanded"), "false");
    assert.equal(kinds[0]?.getAttribute("aria-controls"), null);
    assert.equal(kinds[0]?.querySelector(".mark") === null, false);
    assert.deepEqual(page.listed(), []);
    assert.equal(
      page.element("panel-content").querySelectorAll(".detail").length,
      2,
    );
  });

  it("unfolds the list of the row at a click, in alphabetical order, with its count, and folds it at a second", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    const row = page.kinds()[0];
    assert.ok(row);
    row.click();
    assert.equal(row.getAttribute("aria-expanded"), "true");
    const list = page.element("panel-content").querySelector("ul.addresses");
    assert.ok(list);
    assert.equal(row.getAttribute("aria-controls"), list.id);
    assert.deepEqual(page.listed(), [...STYLES].sort());
    assert.deepEqual(
      page.addressButtons().map((button) => button.title),
      [...STYLES].sort(),
    );
    assert.equal(page.note(), "mapAddressesMany 3");
    assert.equal(page.kinds()[0], row);
    row.click();
    assert.equal(row.getAttribute("aria-expanded"), "false");
    assert.equal(row.getAttribute("aria-controls"), null);
    assert.deepEqual(page.listed(), []);
    assert.equal(page.note(), null);
  });

  it("names the limit under a list that reached it", async () => {
    const page = await open({ limit: 3 });
    page.chooseSite();
    await settled();
    page.kinds()[0]?.click();
    assert.equal(page.note(), "mapAddressesLimitMany 3");
  });

  it("asks nothing and marks no row in a private window", async () => {
    const page = await open({ privateWindow: true });
    page.chooseSite();
    await settled();
    assert.deepEqual(page.sent, [{ kind: "map", privateWindow: true }]);
    assert.deepEqual(page.kinds(), []);
  });

  it("marks no row when the site has no address kept", async () => {
    const page = await open({ addresses: () => Promise.resolve({}) });
    page.chooseSite();
    await settled();
    assert.deepEqual(page.kinds(), []);
  });

  it("drops addresses that arrive once the panel of the site is closed", async () => {
    let release = () => {};
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const page = await open({
      addresses: async () => {
        await gate;
        return ADDRESSES;
      },
    });
    page.chooseSite();
    await settled();
    page.element("back").click();
    release();
    await settled();
    assert.deepEqual(page.kinds(), []);
    page.chooseSite();
    await settled();
    assert.equal(page.kinds().length, 1);
  });

  it("folds every row again when the panel of the site opens anew", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    page.kinds()[0]?.click();
    page.element("back").click();
    page.chooseSite();
    await settled();
    assert.equal(page.kinds()[0]?.getAttribute("aria-expanded"), "false");
    assert.deepEqual(page.listed(), []);
  });

  it("asks again for the addresses when the tab comes back into view, and keeps the row unfolded", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    page.kinds()[0]?.click();
    page.sent.length = 0;
    page.root.dispatch("visibilitychange");
    await settled();
    assert.deepEqual(page.sent, [
      { kind: "map", privateWindow: false },
      { kind: "siteAddresses", site: SITE, privateWindow: false },
      { kind: "settings" },
    ]);
    assert.equal(page.kinds()[0]?.getAttribute("aria-expanded"), "true");
    assert.deepEqual(page.listed(), [...STYLES].sort());
  });

  it("copies an address at a click, whole, says so on its chip for 1.5 s and to a screen reader", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    page.kinds()[0]?.click();
    mock.timers.enable({ apis: ["setTimeout"] });
    const [first] = page.addressButtons();
    assert.ok(first);
    first.click();
    await settled();
    assert.deepEqual(page.copied, [[...STYLES].sort()[0]]);
    assert.equal(first.classList.contains("done"), true);
    const chip = first.querySelector(".copied");
    assert.equal(chip?.getAttribute("aria-hidden"), "true");
    assert.equal(chip?.classList.contains("failed"), false);
    assert.equal(chip?.querySelector(".word")?.textContent, "mapAddressCopied");
    assert.equal(
      page.element("announce").textContent,
      "mapAddressCopiedAnnounced",
    );
    mock.timers.tick(1499);
    assert.equal(first.classList.contains("done"), true);
    mock.timers.tick(1);
    assert.equal(first.classList.contains("done"), false);
  });

  it("says a copy failed, on the chip without its mark and to a screen reader, and reports it", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        writeText: () => Promise.reject(new Error("NotAllowedError")),
      });
      page.chooseSite();
      await settled();
      page.kinds()[0]?.click();
      const [first] = page.addressButtons();
      assert.ok(first);
      first.click();
      await settled();
      const chip = first.querySelector(".copied");
      assert.equal(first.classList.contains("done"), true);
      assert.equal(chip?.classList.contains("failed"), true);
      assert.equal(
        chip?.querySelector(".word")?.textContent,
        "mapAddressCopyFailed",
      );
      assert.equal(
        page.element("announce").textContent,
        "mapAddressCopyFailed",
      );
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: address not copied: .*NotAllowedError/,
      );
    } finally {
      errors.mock.restore();
    }
  });
});

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
import { Element, find, focusedElement, htmlOf, installPage } from "./dom.js";

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
  // What the event page answers to "map", at each question.
  readonly data?: () => MapData;
  // What the event page answers to "siteAddresses", once let through.
  readonly addresses?: () => Promise<SiteAddresses>;
  readonly writeText?: (text: string) => Promise<void>;
  // How Firefox writes a site for display.
  readonly display?: (site: string) => string;
}

interface Opened {
  readonly root: Element;
  readonly sent: PopupRequest[];
  // What the page wrote to the clipboard.
  readonly copied: string[];
  // Each message the page asked Firefox for, its name then its
  // substitutions, and each site it asked Firefox to write.
  readonly messages: string[][];
  readonly domains: string[];
  element(id: string): Element;
  // The user clicks the row of the site in the column.
  chooseSite(): void;
  // The rows of the panel that unfold, as their text.
  kinds(): Element[];
  // The addresses listed, as their text.
  listed(): string[];
  note(): string | null;
  addressButtons(): Element[];
  // The names of the sites in the column, as they are shown.
  shownSites(): string[];
  // The tab of the map comes back into view.
  comeBack(): Promise<void>;
}

let opened = 0;

async function open(options: Options = {}): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const copied: string[] = [];
  const messages: string[][] = [];
  const domains: string[] = [];
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
      getManifest: () => ({ version: "9.8.7" }),
      sendMessage: async (
        request: PopupRequest,
      ): Promise<MapData | SiteAddresses | Settings> => {
        sent.push(request);
        switch (request.kind) {
          case "map":
            return { ...(options.data?.() ?? DATA), privateWindow };
          case "siteAddresses":
            return request.privateWindow
              ? {}
              : await (options.addresses?.() ?? ADDRESSES);
          case "settings":
            return {
              record: "level4",
              recordLimit: options.limit ?? 100,
              dynamic: false,
            };
          default:
            throw new Error(`unexpected ${request.kind}`);
        }
      },
    },
    i18n: {
      getMessage: (name: string, substitutions: string[] = []) => {
        messages.push([name, ...substitutions]);
        return [name, ...substitutions].join(" ");
      },
      getUILanguage: () => "fr",
    },
    publicSuffix: {
      getDomain: (host: string) => {
        domains.push(host);
        return options.display?.(host) ?? host;
      },
    },
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
    messages,
    domains,
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
    shownSites: () =>
      element("drawing")
        .querySelectorAll("[data-k]")
        .filter((row) => row.dataset["k"]?.startsWith("s:"))
        .map(
          (row) =>
            row.children.find((part) => part.tagName === "text")?.textContent ??
            "",
        ),
    comeBack: async () => {
      root.dispatch("visibilitychange");
      await settled();
    },
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

describe("the help of the map", () => {
  it("opens over the map at a click on its question mark, and closes by its cross", async () => {
    const page = await open();
    const help = page.element("help");
    const veil = page.element("help-veil");
    assert.equal(help.attributes.get("title"), "helpOpen");
    assert.equal(
      page.element("help-window").attributes.get("aria-label"),
      "helpOpen",
    );
    assert.equal(veil.hidden, true);
    help.click();
    assert.deepEqual(
      [veil.hidden, page.element("content").inert, focusedElement()],
      [false, true, page.element("help-close")],
    );
    page.element("help-close").click();
    assert.deepEqual(
      [veil.hidden, page.element("content").inert, focusedElement()],
      [true, false, help],
    );
  });

  it("has the tabs of the popup, opens on the help, and shows the about section of the popup in its own tab", async () => {
    const page = await open();
    const chosen = () =>
      ["help-tab", "about-tab"].map((id) =>
        page.element(id).getAttribute("aria-selected"),
      );
    page.element("help").click();
    assert.deepEqual(chosen(), ["true", "false"]);
    page.element("help-tab").dispatch("keydown", {
      key: "ArrowRight",
      preventDefault: () => {},
    });
    assert.deepEqual(chosen(), ["false", "true"]);
    assert.equal(
      page.element("about-panel").classList.contains("unseen"),
      false,
    );
    page.element("help-close").click();
    page.element("help").click();
    assert.deepEqual(chosen(), ["true", "false"]);
    const about = page.element("about-panel");
    assert.equal(
      about.querySelectorAll("p.meta").map((line) => line.textContent)[0],
      "aboutVersion 9.8.7",
    );
    assert.equal(about.querySelectorAll("a").length, 3);
  });
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

  // What makes the page ask again for the addresses of the site it shows.
  const askings: [string, (page: Opened) => Promise<void>][] = [
    ["the tab comes back into view", (page) => page.comeBack()],
    [
      "its site is chosen again",
      async (page) => {
        page.chooseSite();
        await settled();
      },
    ],
  ];

  for (const [name, ask] of askings) {
    it(`draws the panel once when ${name} and the addresses kept are the same`, async () => {
      let gate: Promise<void> = Promise.resolve();
      const page = await open({
        addresses: async () => {
          await gate;
          return ADDRESSES;
        },
      });
      page.chooseSite();
      await settled();
      page.kinds()[0]?.click();
      let release = () => {};
      gate = new Promise((done) => {
        release = done;
      });
      await ask(page);
      const list = page.element("panel-content").querySelector("ul.addresses");
      assert.ok(list);
      release();
      await settled();
      assert.equal(
        page.element("panel-content").querySelector("ul.addresses"),
        list,
      );
    });
  }

  it("draws the list again when the addresses kept changed", async () => {
    const more = "https://cdn.example.net/assets/print.css";
    let answer = ADDRESSES;
    const page = await open({ addresses: async () => answer });
    page.chooseSite();
    await settled();
    page.kinds()[0]?.click();
    answer = { edge: { red4: { "GET stylesheet": [more, ...STYLES] } } };
    await page.comeBack();
    assert.deepEqual(page.listed(), [more, ...STYLES].sort());
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

  it("holds an address in its text alone until a copy draws its chip, which the next copies keep", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      let failures = 1;
      const page = await open({
        writeText: () => {
          failures -= 1;
          return failures >= 0
            ? Promise.reject(new Error("NotAllowedError"))
            : Promise.resolve();
        },
      });
      page.chooseSite();
      await settled();
      page.kinds()[0]?.click();
      const [first] = page.addressButtons();
      assert.ok(first);
      assert.deepEqual(
        first.children.map((part) => part.className),
        ["text"],
      );
      first.click();
      await settled();
      first.click();
      await settled();
      const chips = first.querySelectorAll(".copied");
      assert.equal(chips.length, 1);
      assert.equal(chips[0]?.classList.contains("failed"), false);
      assert.equal(
        chips[0]?.querySelector(".word")?.textContent,
        "mapAddressCopied",
      );
    } finally {
      errors.mock.restore();
    }
  });
});

// The same counts, with one stylesheet more: 9 requests rather than 8.
const ONE_MORE: MapData = {
  ...DATA,
  sites: {
    [SITE]: {
      edge: {
        red4: { "GET stylesheet": 4, "GET script": 2 },
        blue2: { "GET image": 3 },
      },
    },
  },
};

describe("what the map asks Firefox to write", () => {
  it("asks for no message again while what the map writes stays the same", async () => {
    const page = await open();
    page.chooseSite();
    await settled();
    page.messages.length = 0;
    await page.comeBack();
    page.chooseSite();
    await settled();
    assert.deepEqual(page.messages, []);
  });

  it("asks only for the messages of the counts that changed, and keeps those of the last answer alone", async () => {
    const answers = [DATA, ONE_MORE, DATA, DATA];
    let answer = 0;
    const page = await open({ data: () => answers[answer] ?? DATA });
    const counted = () =>
      page.messages
        .filter(([name]) => name === "mapRequestsMany")
        .map((message) => message.slice(1));
    assert.deepEqual(counted(), [["8"]]);
    page.messages.length = 0;
    answer = 1;
    await page.comeBack();
    assert.deepEqual(counted(), [["9"]]);
    page.messages.length = 0;
    answer = 2;
    await page.comeBack();
    assert.deepEqual(counted(), [["8"]]);
    page.messages.length = 0;
    answer = 3;
    await page.comeBack();
    assert.deepEqual(page.messages, []);
  });

  it("asks Firefox to write a site only when one of its labels is in punycode, and once", async () => {
    const idn = "xn--bcher-kva.example";
    const page = await open({
      data: () => ({
        ...DATA,
        sites: { ...DATA.sites, [idn]: DATA.sites[SITE] ?? {} },
      }),
      display: (site) => (site === idn ? "bücher.example" : `shown ${site}`),
    });
    assert.deepEqual(page.domains, [idn]);
    assert.deepEqual(page.shownSites().sort(), ["bücher.example", SITE]);
    await page.comeBack();
    assert.deepEqual(page.domains, [idn]);
  });
});

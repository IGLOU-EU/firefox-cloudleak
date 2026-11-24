// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The map page, compiled with the extension into build/extension/, driven by
// a stand-in for Firefox's browser object, for its clipboard and for the DOM
// of map.html: the addresses kept of the rows of the panel of a site, and the
// column of the providers.

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type {
  MapData,
  PopupRequest,
  Settings,
  SiteAddresses,
  SiteCounts,
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
  // The size of the plan of the sites, which the stand-in does not lay out.
  readonly height?: number;
  readonly width?: number;
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
  const plan = find(root, "plan");
  plan.clientHeight = options.height ?? 0;
  plan.clientWidth = options.width ?? 0;
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

// Twenty sites, all in a view of 643 pixels, each through one of six
// providers of the data, at level 4, and through three supposed providers of
// its own: 66 providers of the rows in view, for 21 pills.
const KNOWN = ["edge", "keep0", "keep1", "keep2", "keep3", "keep4"];
const HEIGHT = 643;
const PILLS = 21;

function crowd(): MapData {
  const sites: Record<string, SiteCounts> = {};
  for (let index = 0; index < 20; index += 1) {
    const site: Record<string, SiteCounts[string]> = {
      [KNOWN[index % KNOWN.length] ?? "edge"]: { red4: { "GET script": 5 } },
    };
    for (let next = 0; next < 3; next += 1) {
      site[`s${index * 3 + next}.example`] = {
        orange4: { "GET image": 1 },
      };
    }
    sites[`site${String(index).padStart(2, "0")}.example`] = site;
  }
  return { ...DATA, sites };
}

// A tab 1280 pixels wide, its panel aside: the pills start at 354 pixels.
const PILL_X = 960 - 340 - 248 - 18;
// How far to the right of the pills the pill a point opens stands.
const LIFT_X = 8;

function crowded(): Promise<Opened> {
  return open({ data: crowd, height: HEIGHT, width: 960 });
}

const shown = (entry: Element) => entry.style.display !== "none";

function numbers(text: string | null): number[] {
  return (text?.match(/-?[\d.]+/g) ?? []).map(Number);
}

// What the column of the providers draws: the pills of the column and the
// points of the corridor shown, by provider, and where each link shown ends.
function drawingOf(page: Opened) {
  const image = page.element("drawing").querySelector("svg.providers");
  assert.ok(image);
  const providerOf = (entry: Element) =>
    (entry.dataset["k"] ?? "").replace(/^(?:f:|.*\|)/, "");
  const pills = new Map(
    image
      .querySelectorAll("g.fades[tabindex]")
      .filter(shown)
      .map((pill) => {
        const [x = 0, y = 0] = numbers(pill.getAttribute("transform"));
        return [providerOf(pill), { x, y, pill }];
      }),
  );
  const points = new Map(
    image
      .querySelectorAll("circle.hollow")
      .filter(shown)
      .map((point) => {
        const [x = 0, y = 0, r = 0] = ["cx", "cy", "r"].map((name) =>
          Number(point.getAttribute(name)),
        );
        return [providerOf(point), { x, y, r, point }];
      }),
  );
  const links = image
    .querySelectorAll("path.link")
    .filter(shown)
    .map((path) => {
      const [x = 0, y = 0] = numbers(path.getAttribute("d")).slice(-2);
      return { provider: providerOf(path), x, y, path };
    });
  const floating = image.querySelector("g.floating");
  return { image, pills, points, links, floating };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.05;

describe("the column of the providers on the map", () => {
  it("never goes beyond the view: the pills that fit, and a point for each of the others", async () => {
    const page = await crowded();
    const { pills, points } = drawingOf(page);
    assert.equal(pills.size, PILLS);
    assert.equal(points.size, 66 - PILLS);
    for (const id of KNOWN) {
      assert.equal(pills.has(id), true, id);
    }
    for (const { x, y } of pills.values()) {
      assert.equal(x, PILL_X);
      assert.ok(y - 12 >= 0 && y + 12 <= HEIGHT, `pill at ${y}`);
    }
    for (const { x, y, r } of points.values()) {
      assert.equal(x, PILL_X - 16);
      assert.ok(y >= 44 && y <= HEIGHT - 12 && y + r <= HEIGHT, `${y}`);
    }
  });

  it("ends each link on what names its provider: the middle of the left edge of its pill, or its point, never a pill", async () => {
    const page = await crowded();
    const { pills, points, links } = drawingOf(page);
    assert.equal(links.length, 20 * 4);
    for (const link of links) {
      const pill = pills.get(link.provider);
      const point = points.get(link.provider);
      if (pill !== undefined) {
        assert.ok(near(link.x, pill.x) && near(link.y, pill.y), link.provider);
        continue;
      }
      assert.ok(point, link.provider);
      assert.ok(near(link.x, point.x - point.r) && near(link.y, point.y));
      for (const other of pills.values()) {
        assert.equal(
          link.x >= other.x && Math.abs(link.y - other.y) <= 12,
          false,
          `${link.provider} ends on a pill`,
        );
      }
    }
  });

  it("opens the pill of a point under the pointer at its height, tied to it, and lights its links", async () => {
    const page = await crowded();
    const { image, points, links } = drawingOf(page);
    const [id, point] = [...points][3] ?? [];
    assert.ok(id && point);
    image.dispatch("pointerover", { target: point.point });
    const { floating } = drawingOf(page);
    assert.ok(floating);
    // Shifted to the right of the pills, cut out of them by its halo, and
    // tied to its point by a line drawn over the halo.
    const [pill, tie] = floating.parent?.children ?? [];
    assert.equal(tie?.tagName, "line");
    assert.deepEqual(
      ["x1", "y1", "x2", "y2"].map((name) => Number(tie?.getAttribute(name))),
      [point.x + point.r, point.y, PILL_X + LIFT_X, point.y],
    );
    assert.equal(pill, floating);
    assert.deepEqual(numbers(floating.getAttribute("transform")), [
      PILL_X + LIFT_X,
      point.y,
    ]);
    const halo = floating.children[0];
    assert.equal(halo?.getAttribute("class"), "halo");
    assert.deepEqual(
      ["x", "y", "width", "height"].map((name) =>
        Number(halo?.getAttribute(name)),
      ),
      [-3, -15, 254, 30],
    );
    assert.ok(point.y - 12 >= 24 && point.y + 12 <= HEIGHT);
    assert.equal(floating.dataset["k"], `f:${id}`);
    assert.equal(image.classList.contains("hovering"), true);
    assert.equal(point.point.classList.contains("hovered"), true);
    for (const link of links) {
      assert.equal(
        link.path.classList.contains("hovered"),
        link.provider === id,
      );
    }
    image.dispatch("pointerleave");
    assert.equal(drawingOf(page).floating, null);
    assert.equal(image.classList.contains("hovering"), false);
  });

  it("opens it as well under the pointer on one of its links, and closes it over a pill", async () => {
    const page = await crowded();
    const { image, points, pills, links } = drawingOf(page);
    const link = links.find((entry) => points.has(entry.provider));
    assert.ok(link);
    image.dispatch("pointerover", { target: link.path });
    const { floating } = drawingOf(page);
    assert.equal(floating?.dataset["k"], `f:${link.provider}`);
    assert.deepEqual(numbers(floating?.getAttribute("transform") ?? ""), [
      PILL_X + LIFT_X,
      points.get(link.provider)?.y,
    ]);
    const [named] = pills.values();
    assert.ok(named);
    image.dispatch("pointerover", { target: named.pill });
    assert.equal(drawingOf(page).floating, null);
  });

  it("goes through its points from the top with the arrows, says each, chooses with Enter and leaves with Escape", async () => {
    const page = await crowded();
    const { image, points } = drawingOf(page);
    const corridor = image.querySelector("rect.corridor-focus");
    assert.ok(corridor);
    assert.equal(corridor.getAttribute("tabindex"), "0");
    assert.equal(corridor.getAttribute("aria-label"), "mapCorridor");
    const fromTop = (drawn: typeof points) =>
      [...drawn].sort(([, a], [, b]) => a.y - b.y).map(([id]) => id);
    const order = fromTop(points);
    const opened = () => drawingOf(page).floating?.dataset["k"];
    let prevented = 0;
    const press = (key: string) =>
      corridor.dispatch("keydown", {
        key,
        preventDefault: () => {
          prevented += 1;
        },
      });
    corridor.focus();
    corridor.dispatch("focus");
    assert.equal(opened(), `f:${order[0]}`);
    assert.equal(
      page.element("announce").textContent,
      `mapProviderSpoken mapProviderSupposed ${order[0]} mapSitesOne 1`,
    );
    press("ArrowDown");
    assert.equal(opened(), `f:${order[1]}`);
    press("End");
    assert.equal(opened(), `f:${order.at(-1)}`);
    press("Home");
    press("ArrowUp");
    assert.equal(opened(), `f:${order[0]}`);
    assert.equal(prevented, 4);
    press("ArrowDown");
    press("Enter");
    assert.equal(page.element("back").hidden, false);
    const after = drawingOf(page);
    assert.equal(after.pills.has(order[1] ?? ""), true);
    assert.equal(after.points.has(order[1] ?? ""), false);
    assert.equal(after.pills.size, PILLS);
    press("ArrowDown");
    assert.equal(opened(), `f:${fromTop(after.points)[0]}`);
    press("Escape");
    assert.equal(opened(), undefined);
    assert.notEqual(focusedElement(), corridor);
    assert.equal(image.classList.contains("hovering"), false);
  });

  it("gives its pill to the provider chosen from its point, beyond the place of the pills", async () => {
    const page = await crowded();
    const [id, point] = [...drawingOf(page).points].at(-1) ?? [];
    assert.ok(id && point);
    page.element("plan").dispatch("click", { target: point.point });
    const { pills, points } = drawingOf(page);
    assert.equal(pills.has(id), true);
    assert.equal(points.has(id), false);
    assert.equal(pills.size, PILLS);
    assert.equal(points.size, 66 - PILLS);
  });

  it("hides the corridor while every provider of the rows in view has its pill", async () => {
    const page = await open({ height: HEIGHT, width: 960 });
    const corridor = page
      .element("drawing")
      .querySelector("svg.providers")
      ?.querySelector("g.corridor");
    assert.equal(corridor?.style.display, "none");
    assert.equal(drawingOf(page).pills.size, 1);
  });

  it("cuts a name that would run into the sites beside it, and keeps it whole in its tooltip", async () => {
    const long = "averyveryverylongcdn";
    const page = await open({
      data: () => ({
        ...DATA,
        sites: { [SITE]: { [long]: { red4: { "GET script": 1 } } } },
      }),
      height: HEIGHT,
      width: 960,
    });
    const pill = page
      .element("drawing")
      .querySelectorAll("g.fades[tabindex]")
      .find((entry) => entry.dataset["k"] === `f:${long}`);
    const [name, note] = pill?.querySelectorAll("text") ?? [];
    // 7 pixels a letter, beside "mapSitesOne 1" and the gap.
    const room = 248 - 2 * 12 - 8 - 7 * (note?.textContent.length ?? 0);
    assert.equal(name?.textContent, "averyveryverylon…");
    assert.ok(7 * (name?.textContent.length ?? 0) <= room);
    assert.equal(pill?.querySelector("title")?.textContent, long);
  });

  it("keeps the cut of a name beside the same sites, which a keystroke and a return to the tab measure no more", async () => {
    const long = "averyveryverylongcdn";
    const page = await open({
      data: () => ({
        ...DATA,
        sites: { [SITE]: { [long]: { red4: { "GET script": 1 } } } },
      }),
      height: HEIGHT,
      width: 960,
    });
    const measures = mock.method(Element.prototype, "getComputedTextLength");
    try {
      const search = page.element("search");
      search.value = "vm";
      search.dispatch("input");
      await page.comeBack();
      const name = page
        .element("drawing")
        .querySelectorAll("g.fades[tabindex]")
        .find((entry) => entry.dataset["k"] === `f:${long}`)
        ?.querySelector("text");
      assert.equal(name?.textContent, "averyveryverylon…");
      assert.equal(measures.mock.callCount(), 0);
    } finally {
      measures.mock.restore();
    }
  });
});

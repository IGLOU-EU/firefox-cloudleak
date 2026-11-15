// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The popup page, compiled with the extension into build/extension/, driven
// by a stand-in for Firefox's browser object and for the DOM of popup.html.

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Classification } from "../src/core/classify.js";
import type { PopupData, PopupRequest } from "../src/core/popup-message.js";
import {
  addRequest,
  IGNORED,
  markMissed,
  NEUTRAL,
  type TabState,
} from "../src/core/tab-state.js";
import { importModule, writeTable } from "./built-extension.js";
import { type Element, find, htmlOf, installPage, settled } from "./dom.js";
import { POPUP_MESSAGES } from "./messages.js";

writeTable();

const HTML = htmlOf("popup/popup.html");

// A row reads as its cloud, its label, its proof and its count.
function summarise(node: Element): string {
  if (node.className !== "row") {
    return node.textContent;
  }
  return node.children
    .flatMap((part) =>
      part.tagName === "img"
        ? [part.attributes.get("src") ?? ""]
        : [part.ownText, ...part.children.map((inner) => inner.textContent)],
    )
    .join(" ");
}

const SINCE = Date.UTC(2026, 10, 7, 12);
const CLEARED_AT = Date.UTC(2026, 11, 1, 12);
const WATCHED_AT = Date.UTC(2026, 11, 2, 12);
const dates = new Intl.DateTimeFormat("fr", { dateStyle: "long" });
const numbers = new Intl.NumberFormat("fr");

const EDGE_SESSION: Classification = {
  provider: "edge",
  proven: true,
  leak: { level: 4, case: "session", possible: false, challenge: false },
};
const EDGE_PUBLIC: Classification = {
  provider: "edge",
  proven: true,
  leak: { level: 2 },
};
const RED_STATE: TabState = [
  EDGE_SESSION,
  EDGE_SESSION,
  EDGE_SESSION,
  EDGE_PUBLIC,
  EDGE_PUBLIC,
].reduce(addRequest, NEUTRAL);
const RED_SITE: PopupData = {
  state: RED_STATE,
  page: "site",
  site: "xn--bcher-kva.example",
  privateWindow: false,
  since: SINCE,
  totals: {
    edge: {
      blue2: { "GET script": 1000, "GET image": 180 },
      red4: { "POST xmlhttprequest": 1, "GET main_frame": 2 },
    },
    other: { orange3: { "GET xmlhttprequest": 4 } },
  },
  ignored: false,
};
// What the event page answers once the site is ignored, and once it is
// watched again: its documents still open say they missed requests.
const IGNORED_SITE: PopupData = {
  ...RED_SITE,
  state: IGNORED,
  totals: {},
  ignored: true,
};
const WATCHED_SITE: PopupData = {
  ...RED_SITE,
  state: markMissed(NEUTRAL),
  since: WATCHED_AT,
  totals: {},
};
const PAGE_ROWS = [
  "/icons/red.svg level4 decryptionProven 3",
  "/icons/blue.svg level2 2",
];
const TOTALS_ROWS = [
  "Edge",
  "/icons/red.svg level4 decryptionProven 3",
  `/icons/blue.svg level2 ${numbers.format(1180)}`,
  "other",
  "/icons/orange.svg level3 decryptionUnproven 4",
];
const BUCHER = (host: string) =>
  host === "xn--bcher-kva.example" ? "bücher.example" : null;

interface Options {
  readonly tab?:
    | { id?: number; incognito: boolean; windowId?: number }
    | undefined;
  // What the event page answers to each "popup" request, in turn, the last
  // one again once they are all given.
  readonly answers?: readonly (PopupData | Error)[];
  readonly getDomain?: (host: string) => string | null;
  readonly openOptionsPage?: () => Promise<void>;
  readonly createTab?: () => Promise<object>;
}

interface Opened {
  readonly sent: PopupRequest[];
  readonly queries: object[];
  // The tabs the page asked Firefox to open.
  readonly created: object[];
  readonly root: Element;
  // How many times the page opened the preferences, and closed itself.
  readonly preferences: { opened: number; closed: number };
  element(id: string): Element;
  text(id: string): string;
  summary(id: string): string[];
}

let opened = 0;

async function open(options: Options): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const queries: object[] = [];
  const created: object[] = [];
  const preferences = { opened: 0, closed: 0 };
  const root = installPage(HTML);
  const tab =
    "tab" in options ? options.tab : { id: 7, incognito: false, windowId: 3 };
  const answers = options.answers ?? [RED_SITE];
  let asked = 0;
  (globalThis as Record<string, unknown>)["window"] = {
    close: () => {
      preferences.closed += 1;
    },
  };
  (globalThis as Record<string, unknown>)["browser"] = {
    tabs: {
      query: (query: object) => {
        queries.push(query);
        return Promise.resolve(tab === undefined ? [] : [tab]);
      },
      create: (properties: object) => {
        created.push(properties);
        return options.createTab?.() ?? Promise.resolve({});
      },
    },
    runtime: {
      getURL: (path: string) => `moz-extension://uuid/${path}`,
      sendMessage: (request: PopupRequest) => {
        sent.push(request);
        switch (request.kind) {
          case "clearSite":
            return Promise.resolve({
              since: request.privateWindow ? 0 : CLEARED_AT,
            });
          case "ignoreSite":
            return Promise.resolve({
              sites: [request.host],
              site: request.host,
            });
          case "unignoreSite":
            return Promise.resolve({ sites: [], site: request.site });
          case "popup": {
            const answer =
              answers[Math.min(asked, answers.length - 1)] ?? RED_SITE;
            asked += 1;
            return answer instanceof Error
              ? Promise.reject(answer)
              : Promise.resolve(answer);
          }
          default:
            return Promise.reject(new Error(`unexpected ${request.kind}`));
        }
      },
      openOptionsPage: () => {
        preferences.opened += 1;
        return options.openOptionsPage?.() ?? Promise.resolve();
      },
    },
    i18n: {
      getMessage: (name: string, substitutions: string[] = []) =>
        [name, ...substitutions].join(" "),
      getUILanguage: () => "fr",
    },
    publicSuffix: { getDomain: options.getDomain ?? (() => null) },
  };
  opened += 1;
  // A module runs once per URL, so each page gets its own.
  await importModule(`popup.js?${opened}`);
  await settled();
  const element = (id: string): Element => find(root, id);
  return {
    sent,
    queries,
    created,
    root,
    preferences,
    element,
    text: (id) => element(id).textContent,
    summary: (id) => element(id).children.map(summarise),
  };
}

// Ignore, stop ignoring and clear, in the order of the footer.
function footer(page: Opened): boolean[] {
  return ["ignore-site", "unignore-site", "clear-site"].map(
    (id) => !page.element(id).hidden,
  );
}

describe("the popup", () => {
  it("asks the event page about the active tab, and shows its answer", async () => {
    const page = await open({ getDomain: BUCHER });
    assert.deepEqual(page.queries, [{ active: true, currentWindow: true }]);
    assert.deepEqual(page.sent, [
      { kind: "popup", tabId: 7, privateWindow: false },
    ]);
    assert.equal(page.root.lang, "fr");
    assert.equal(page.element("state").attributes.get("src"), "/icons/red.svg");
    assert.equal(page.text("site"), "bücher.example");
    assert.equal(page.element("site").hidden, false);
    assert.equal(page.element("browser-page").hidden, true);
    assert.equal(page.element("unknown-site").hidden, true);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("ignored").hidden, true);
    assert.equal(page.element("watched-again").hidden, true);
    assert.equal(page.element("page").hidden, false);
    assert.equal(page.element("page-unit").hidden, false);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
    assert.deepEqual(page.summary("page-lines"), [
      "titleRed Edge",
      "titleSessionProven",
    ]);
    assert.equal(page.element("page-partial").hidden, true);
    assert.equal(page.element("totals").hidden, false);
    assert.equal(page.text("totals-title"), `popupSite ${dates.format(SINCE)}`);
    assert.equal(page.element("totals-unit").hidden, false);
    assert.equal(page.element("totals-empty").hidden, true);
    assert.deepEqual(page.summary("totals-rows"), TOTALS_ROWS);
    assert.equal(page.element("footer").hidden, false);
    assert.deepEqual(footer(page), [true, false, true]);
    assert.equal(page.element("clear-confirmation").hidden, true);
    assert.equal(page.element("ignore-confirmation").hidden, true);
  });

  it("writes every fixed label from its message, each known to the locales", async () => {
    const page = await open({});
    const labels = [...page.root.all()].filter(
      (entry) => entry.dataset["message"] !== undefined,
    );
    assert.ok(labels.length >= 15);
    for (const label of labels) {
      const message = label.dataset["message"] ?? "";
      assert.ok(POPUP_MESSAGES.includes(message), message);
      assert.equal(label.textContent, message);
    }
  });

  it("names the gear for those who cannot see it, and in its tooltip", async () => {
    const page = await open({});
    const gear = page.element("preferences");
    assert.equal(gear.attributes.get("aria-label"), "popupPreferences");
    assert.equal(gear.attributes.get("title"), "popupPreferences");
    assert.equal(gear.textContent, "");
  });

  it("opens the preferences from the gear, then closes, since Firefox leaves it open over them", async () => {
    const page = await open({});
    page.element("preferences").click();
    await settled();
    assert.deepEqual(page.preferences, { opened: 1, closed: 1 });
    assert.equal(page.sent.length, 1);
  });

  it("stays open and reports it when the preferences do not open", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        openOptionsPage: () => Promise.reject(new Error("No options page")),
      });
      page.element("preferences").click();
      await settled();
      assert.deepEqual(page.preferences, { opened: 1, closed: 0 });
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*No options page/,
      );
    } finally {
      errors.mock.restore();
    }
  });

  it("opens the map in a tab of its own window, then closes, since Firefox leaves it open over the map", async () => {
    const page = await open({});
    assert.equal(page.element("map").textContent, "popupMap");
    assert.equal(page.element("map").hidden, false);
    page.element("map").click();
    await settled();
    assert.deepEqual(page.created, [
      { url: "moz-extension://uuid/map/map.html", windowId: 3 },
    ]);
    assert.equal(page.preferences.closed, 1);
    assert.equal(page.sent.length, 1);
  });

  it("opens the map in the private window it belongs to, so that the map shows the private session", async () => {
    const page = await open({ tab: { id: 8, incognito: true, windowId: 5 } });
    page.element("map").click();
    await settled();
    assert.deepEqual(page.created, [
      { url: "moz-extension://uuid/map/map.html", windowId: 5 },
    ]);
  });

  it("opens the map in the window Firefox chooses when it gave no active tab", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({ tab: undefined });
      page.element("map").click();
      await settled();
      assert.deepEqual(page.created, [
        { url: "moz-extension://uuid/map/map.html" },
      ]);
    } finally {
      errors.mock.restore();
    }
  });

  it("stays open and reports it when the map does not open", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        createTab: () => Promise.reject(new Error("Not allowed")),
      });
      page.element("map").click();
      await settled();
      assert.equal(page.created.length, 1);
      assert.equal(page.preferences.closed, 0);
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*Not allowed/,
      );
    } finally {
      errors.mock.restore();
    }
  });

  it("asks before it clears the site, clears it on the answer, and shows its new start", async () => {
    const page = await open({ getDomain: BUCHER });
    page.element("clear-site").click();
    assert.equal(page.element("footer").hidden, true);
    assert.equal(page.element("clear-confirmation").hidden, false);
    assert.equal(page.element("ignore-confirmation").hidden, true);
    assert.equal(
      page.text("clear-question"),
      `popupClearSiteQuestion bücher.example ${dates.format(SINCE)}`,
    );
    page.element("clear-cancel").click();
    assert.equal(page.element("footer").hidden, false);
    assert.equal(page.element("clear-confirmation").hidden, true);
    assert.equal(page.sent.length, 1);
    page.element("clear-site").click();
    page.element("clear").click();
    await settled();
    assert.deepEqual(page.sent[1], {
      kind: "clearSite",
      site: "xn--bcher-kva.example",
      privateWindow: false,
    });
    assert.equal(page.sent.length, 2);
    assert.equal(page.element("clear-confirmation").hidden, true);
    assert.equal(page.element("footer").hidden, false);
    assert.deepEqual(footer(page), [true, false, true]);
    assert.equal(page.text("site"), "bücher.example");
    assert.equal(
      page.text("totals-title"),
      `popupSite ${dates.format(CLEARED_AT)}`,
    );
    assert.equal(
      page.text("clear-question"),
      `popupClearSiteQuestion bücher.example ${dates.format(CLEARED_AT)}`,
    );
    assert.equal(page.element("totals-empty").hidden, false);
    assert.equal(page.element("totals-unit").hidden, true);
    assert.deepEqual(page.summary("totals-rows"), []);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
  });

  it("asks before it ignores the site, then shows what the event page says of the tab", async () => {
    const page = await open({
      getDomain: BUCHER,
      answers: [RED_SITE, IGNORED_SITE],
    });
    page.element("ignore-site").click();
    assert.equal(page.element("footer").hidden, true);
    assert.equal(page.element("ignore-confirmation").hidden, false);
    assert.equal(page.element("clear-confirmation").hidden, true);
    assert.equal(
      page.text("ignore-question"),
      "popupIgnoreSiteQuestion bücher.example",
    );
    page.element("ignore-cancel").click();
    assert.equal(page.element("footer").hidden, false);
    assert.equal(page.element("ignore-confirmation").hidden, true);
    assert.equal(page.sent.length, 1);
    page.element("ignore-site").click();
    page.element("ignore").click();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "ignoreSite", host: "xn--bcher-kva.example" },
      { kind: "popup", tabId: 7, privateWindow: false },
    ]);
    assert.equal(page.element("ignore-confirmation").hidden, true);
    assert.equal(page.element("footer").hidden, false);
    assert.equal(
      page.element("state").attributes.get("src"),
      "/icons/neutral.svg",
    );
    assert.equal(page.text("site"), "bücher.example");
    assert.equal(page.element("ignored").hidden, false);
    assert.equal(page.element("page").hidden, true);
    assert.equal(page.element("totals").hidden, true);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("watched-again").hidden, true);
    assert.deepEqual(footer(page), [false, true, false]);
  });

  it("offers no ignore in a private window, and sends none, so that no site visited in private enters the list kept on disk", async () => {
    const page = await open({
      tab: { id: 3, incognito: true },
      answers: [{ ...RED_SITE, privateWindow: true, since: 0 }],
    });
    assert.deepEqual(footer(page), [false, false, true]);
    page.element("ignore-site").click();
    page.element("ignore").click();
    await settled();
    assert.deepEqual(page.sent, [
      { kind: "popup", tabId: 3, privateWindow: true },
    ]);
  });

  it("says an ignored site is ignored, and watches it again without asking, then says so", async () => {
    const page = await open({
      getDomain: BUCHER,
      answers: [IGNORED_SITE, WATCHED_SITE],
    });
    assert.equal(
      page.element("state").attributes.get("src"),
      "/icons/neutral.svg",
    );
    assert.equal(page.element("ignored").hidden, false);
    assert.equal(page.element("page").hidden, true);
    assert.equal(page.element("totals").hidden, true);
    assert.deepEqual(footer(page), [false, true, false]);
    page.element("unignore-site").click();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "unignoreSite", site: "xn--bcher-kva.example" },
      { kind: "popup", tabId: 7, privateWindow: false },
    ]);
    assert.equal(page.element("ignored").hidden, true);
    assert.equal(page.element("watched-again").hidden, false);
    assert.equal(page.element("page").hidden, false);
    assert.deepEqual(page.summary("page-lines"), ["titleNeutral"]);
    assert.deepEqual(page.summary("page-partial"), ["titleMissed"]);
    assert.equal(page.element("totals").hidden, false);
    assert.equal(
      page.text("totals-title"),
      `popupSite ${dates.format(WATCHED_AT)}`,
    );
    assert.deepEqual(footer(page), [true, false, true]);
    assert.equal(page.element("footer").hidden, false);
  });

  it("no longer says the site is watched again once it is ignored anew", async () => {
    const page = await open({
      answers: [IGNORED_SITE, WATCHED_SITE, IGNORED_SITE, WATCHED_SITE],
    });
    page.element("unignore-site").click();
    await settled();
    page.element("ignore-site").click();
    page.element("ignore").click();
    await settled();
    assert.equal(page.element("ignored").hidden, false);
    assert.equal(page.element("watched-again").hidden, true);
    page.element("unignore-site").click();
    await settled();
    assert.equal(page.element("watched-again").hidden, false);
  });

  it("watches an ignored site again from a private window too, which writes no site visited in private", async () => {
    const page = await open({
      tab: { id: 3, incognito: true },
      answers: [
        { ...IGNORED_SITE, privateWindow: true, since: 0 },
        { ...WATCHED_SITE, privateWindow: true, since: 0 },
      ],
    });
    assert.deepEqual(footer(page), [false, true, false]);
    page.element("unignore-site").click();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "unignoreSite", site: "xn--bcher-kva.example" },
      { kind: "popup", tabId: 3, privateWindow: true },
    ]);
    assert.equal(page.element("watched-again").hidden, false);
    assert.equal(page.text("totals-title"), "popupSitePrivate");
    assert.deepEqual(footer(page), [false, false, true]);
  });

  it("names the private session in a private window, and clears only the counts of the site there", async () => {
    const page = await open({
      tab: { id: 3, incognito: true },
      answers: [{ ...RED_SITE, privateWindow: true, since: 0 }],
    });
    assert.deepEqual(page.sent, [
      { kind: "popup", tabId: 3, privateWindow: true },
    ]);
    assert.equal(page.text("totals-title"), "popupSitePrivate");
    assert.deepEqual(page.summary("totals-rows"), TOTALS_ROWS);
    assert.equal(
      page.text("clear-question"),
      "popupClearSiteQuestionPrivate xn--bcher-kva.example",
    );
    page.element("clear-site").click();
    page.element("clear").click();
    await settled();
    assert.deepEqual(page.sent[1], {
      kind: "clearSite",
      site: "xn--bcher-kva.example",
      privateWindow: true,
    });
    assert.equal(page.element("clear-confirmation").hidden, true);
    assert.equal(page.element("clear-site").hidden, false);
    assert.equal(page.text("totals-title"), "popupSitePrivate");
    assert.equal(
      page.text("clear-question"),
      "popupClearSiteQuestionPrivate xn--bcher-kva.example",
    );
    assert.equal(page.element("totals-empty").hidden, false);
    assert.equal(page.element("totals-unit").hidden, true);
    assert.deepEqual(page.summary("totals-rows"), []);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
  });

  it("offers nothing on the site when the event page never answered, and sends nothing, since it cannot say which site", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        answers: [new Error("Receiving end does not exist")],
      });
      assert.deepEqual(footer(page), [false, false, false]);
      for (const [ask, confirm] of [
        ["clear-site", "clear"],
        ["ignore-site", "ignore"],
      ] as const) {
        page.element(ask).click();
        page.element(confirm).click();
      }
      page.element("unignore-site").click();
      await settled();
      assert.equal(page.sent.length, 1);
      assert.equal(page.element("clear-confirmation").hidden, true);
      assert.equal(page.element("ignore-confirmation").hidden, true);
      assert.equal(page.element("footer").hidden, false);
    } finally {
      errors.mock.restore();
    }
  });

  it("says a page of the browser has no site, and offers nothing on it, since there is no site", async () => {
    const page = await open({
      answers: [
        {
          state: NEUTRAL,
          page: "browser",
          site: null,
          privateWindow: false,
          since: SINCE,
          totals: {},
          ignored: false,
        },
      ],
    });
    assert.equal(
      page.element("state").attributes.get("src"),
      "/icons/neutral.svg",
    );
    assert.equal(page.element("site").hidden, true);
    assert.equal(page.element("browser-page").hidden, false);
    assert.equal(page.element("unknown-site").hidden, true);
    assert.equal(page.element("browser-notice").hidden, false);
    assert.equal(page.element("ignored").hidden, true);
    assert.equal(page.element("page").hidden, true);
    assert.equal(page.element("totals").hidden, true);
    assert.equal(page.element("footer").hidden, false);
    assert.deepEqual(footer(page), [false, false, false]);
    assert.equal(page.text("clear-question"), "");
    assert.equal(page.text("ignore-question"), "");
    assert.equal(page.element("preferences").hidden, false);
  });

  it("shows what a page of the browser saw without the notice that there is nothing to count", async () => {
    const page = await open({
      answers: [{ ...RED_SITE, page: "reader", site: null, totals: {} }],
    });
    assert.equal(page.element("browser-page").hidden, false);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("page").hidden, false);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
    assert.equal(page.element("totals").hidden, true);
    assert.deepEqual(footer(page), [false, false, false]);
  });

  it("says the site of a website is unknown, with what the tab saw and no totals", async () => {
    const page = await open({
      answers: [{ ...RED_SITE, page: "site", site: null, totals: {} }],
    });
    assert.equal(page.element("site").hidden, true);
    assert.equal(page.element("browser-page").hidden, true);
    assert.equal(page.element("unknown-site").hidden, false);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("page").hidden, false);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
    assert.equal(page.element("totals").hidden, true);
    assert.deepEqual(footer(page), [false, false, false]);
  });

  it("shows the site as it came when Firefox gives no display form, or fails to", async () => {
    const given = await open({ getDomain: () => null });
    assert.equal(given.text("site"), "xn--bcher-kva.example");
    const failing = await open({
      getDomain: () => {
        throw new Error("NS_ERROR_FAILURE");
      },
    });
    assert.equal(failing.text("site"), "xn--bcher-kva.example");
  });

  it("reports an event page that does not answer, and an absent tab, and shows nothing of a site", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const unanswered = await open({
        answers: [new Error("Receiving end does not exist")],
      });
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*Receiving end/,
      );
      assert.equal(unanswered.element("page").hidden, true);
      assert.equal(unanswered.element("totals").hidden, true);
      assert.equal(unanswered.element("ignored").hidden, true);
      const noTab = await open({ tab: undefined });
      assert.equal(errors.mock.callCount(), 2);
      assert.deepEqual(noTab.sent, []);
    } finally {
      errors.mock.restore();
    }
  });
});

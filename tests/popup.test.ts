// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The popup page, compiled with the extension into build/extension/, driven
// by a stand-in for Firefox's browser object and for the DOM of popup.html.
// The elements of the stand-in come from popup.html itself, so that the ids
// and the messages the page looks up are the ones the file has.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, mock } from "node:test";
import type { Classification } from "../src/core/classify.js";
import type { PopupData, PopupRequest } from "../src/core/popup-message.js";
import { addRequest, NEUTRAL, type TabState } from "../src/core/tab-state.js";
import { importModule, writeTable } from "./built-extension.js";
import { POPUP_MESSAGES } from "./messages.js";

writeTable();

const HTML = readFileSync(
  new URL("../../popup/popup.html", import.meta.url),
  "utf8",
);

class Element {
  readonly tagName: string;
  readonly children: Element[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners: (() => void)[] = [];
  id = "";
  className = "";
  hidden = false;
  lang = "";
  ownText: string;

  constructor(tagName: string, text = "") {
    this.tagName = tagName;
    this.ownText = text;
  }

  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.ownText = value;
  }

  append(...nodes: (Element | string)[]): void {
    for (const node of nodes) {
      this.children.push(
        typeof node === "string" ? new Element("#text", node) : node,
      );
    }
  }

  replaceChildren(...nodes: (Element | string)[]): void {
    this.children.length = 0;
    this.ownText = "";
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  click(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  *all(): Generator<Element> {
    yield this;
    for (const child of this.children) {
      yield* child.all();
    }
  }
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1];
}

// A flat list of the elements is enough: the page finds them by id and by
// data-message, and only appends into them.
function bodyOf(): Element {
  const body = new Element("body");
  for (const match of HTML.matchAll(/<(\w+)([^>]*)>/g)) {
    const element = new Element(match[1] ?? "");
    const attributes = match[2] ?? "";
    element.id = attribute(attributes, "id") ?? "";
    const message = attribute(attributes, "data-message");
    if (message !== undefined) {
      element.dataset["message"] = message;
    }
    element.hidden = /\shidden(?:\s|$)/.test(attributes);
    body.children.push(element);
  }
  return body;
}

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

// The handlers of the page settle within the promise chain of the stand-in,
// which one turn of the event loop lets finish.
function settled(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

const SINCE = Date.UTC(2026, 10, 7, 12);
const CLEARED_AT = Date.UTC(2026, 11, 1, 12);
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
      red4: { "GET main_frame": 2, "POST xmlhttprequest": 1 },
    },
    other: { orange3: { "GET xmlhttprequest": 4 } },
  },
  ignored: false,
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

interface Options {
  readonly tab?: { id?: number; incognito: boolean } | undefined;
  readonly answer?: PopupData | Error;
  readonly getDomain?: (host: string) => string | null;
}

interface Opened {
  readonly sent: PopupRequest[];
  readonly queries: object[];
  readonly root: Element;
  element(id: string): Element;
  text(id: string): string;
  summary(id: string): string[];
}

let opened = 0;

async function open(options: Options): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const queries: object[] = [];
  const root = new Element("html");
  root.children.push(bodyOf());
  const tab = "tab" in options ? options.tab : { id: 7, incognito: false };
  const answer = options.answer ?? RED_SITE;
  (globalThis as Record<string, unknown>)["document"] = {
    documentElement: root,
    getElementById: (id: string) =>
      [...root.all()].find((entry) => entry.id === id) ?? null,
    querySelectorAll: (selector: string) => {
      assert.equal(selector, "[data-message]");
      return [...root.all()].filter(
        (entry) => entry.dataset["message"] !== undefined,
      );
    },
    createElement: (tagName: string) => new Element(tagName),
  };
  (globalThis as Record<string, unknown>)["browser"] = {
    tabs: {
      query: (query: object) => {
        queries.push(query);
        return Promise.resolve(tab === undefined ? [] : [tab]);
      },
    },
    runtime: {
      sendMessage: (request: PopupRequest) => {
        sent.push(request);
        if (request.kind === "clearSite") {
          return Promise.resolve({
            since: request.privateWindow ? 0 : CLEARED_AT,
          });
        }
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
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
  const element = (id: string): Element => {
    const found = [...root.all()].find((entry) => entry.id === id);
    assert.ok(found, `popup.html has no element "${id}"`);
    return found;
  };
  return {
    sent,
    queries,
    root,
    element,
    text: (id) => element(id).textContent,
    summary: (id) => element(id).children.map(summarise),
  };
}

describe("the popup", () => {
  it("asks the event page about the active tab, and shows its answer", async () => {
    const page = await open({
      getDomain: (host) =>
        host === "xn--bcher-kva.example" ? "bücher.example" : null,
    });
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
    assert.equal(page.element("clear-site").hidden, false);
    assert.equal(page.element("confirmation").hidden, true);
  });

  it("writes every fixed label from its message, each known to the locales", async () => {
    const page = await open({});
    const labels = [...page.root.all()].filter(
      (entry) => entry.dataset["message"] !== undefined,
    );
    assert.ok(labels.length >= 8);
    for (const label of labels) {
      const message = label.dataset["message"] ?? "";
      assert.ok(POPUP_MESSAGES.includes(message), message);
      assert.equal(label.textContent, message);
    }
  });

  it("asks before it clears the site, clears it on the answer, and shows its new start", async () => {
    const page = await open({
      getDomain: (host) =>
        host === "xn--bcher-kva.example" ? "bücher.example" : null,
    });
    page.element("clear-site").click();
    assert.equal(page.element("footer").hidden, true);
    assert.equal(page.element("confirmation").hidden, false);
    assert.equal(
      page.text("question"),
      `popupClearSiteQuestion bücher.example ${dates.format(SINCE)}`,
    );
    page.element("cancel").click();
    assert.equal(page.element("footer").hidden, false);
    assert.equal(page.element("confirmation").hidden, true);
    assert.equal(page.sent.length, 1);
    page.element("clear-site").click();
    page.element("clear").click();
    await settled();
    assert.deepEqual(page.sent[1], {
      kind: "clearSite",
      site: "xn--bcher-kva.example",
      privateWindow: false,
    });
    assert.equal(page.element("confirmation").hidden, true);
    assert.equal(page.element("footer").hidden, false);
    assert.equal(page.element("clear-site").hidden, false);
    assert.equal(page.text("site"), "bücher.example");
    assert.equal(
      page.text("totals-title"),
      `popupSite ${dates.format(CLEARED_AT)}`,
    );
    assert.equal(
      page.text("question"),
      `popupClearSiteQuestion bücher.example ${dates.format(CLEARED_AT)}`,
    );
    assert.equal(page.element("totals-empty").hidden, false);
    assert.equal(page.element("totals-unit").hidden, true);
    assert.deepEqual(page.summary("totals-rows"), []);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
  });

  it("names the private session in a private window, and clears only the counts of the site there", async () => {
    const page = await open({
      tab: { id: 3, incognito: true },
      answer: { ...RED_SITE, privateWindow: true, since: 0 },
    });
    assert.deepEqual(page.sent, [
      { kind: "popup", tabId: 3, privateWindow: true },
    ]);
    assert.equal(page.text("totals-title"), "popupSitePrivate");
    assert.deepEqual(page.summary("totals-rows"), TOTALS_ROWS);
    assert.equal(
      page.text("question"),
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
    assert.equal(page.element("confirmation").hidden, true);
    assert.equal(page.element("clear-site").hidden, false);
    assert.equal(page.text("totals-title"), "popupSitePrivate");
    assert.equal(
      page.text("question"),
      "popupClearSiteQuestionPrivate xn--bcher-kva.example",
    );
    assert.equal(page.element("totals-empty").hidden, false);
    assert.equal(page.element("totals-unit").hidden, true);
    assert.deepEqual(page.summary("totals-rows"), []);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
  });

  it("offers no clear when the event page never answered, and sends none, since it cannot say which site", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        answer: new Error("Receiving end does not exist"),
      });
      assert.equal(page.element("clear-site").hidden, true);
      page.element("clear-site").click();
      page.element("clear").click();
      await settled();
      assert.equal(page.sent.length, 1);
      assert.equal(page.element("confirmation").hidden, true);
      assert.equal(page.element("footer").hidden, false);
    } finally {
      errors.mock.restore();
    }
  });

  it("says a page of the browser has no site, and offers no clear, since there is nothing to clear", async () => {
    const page = await open({
      answer: {
        state: NEUTRAL,
        page: "browser",
        site: null,
        privateWindow: false,
        since: SINCE,
        totals: {},
        ignored: false,
      },
    });
    assert.equal(
      page.element("state").attributes.get("src"),
      "/icons/neutral.svg",
    );
    assert.equal(page.element("site").hidden, true);
    assert.equal(page.element("browser-page").hidden, false);
    assert.equal(page.element("unknown-site").hidden, true);
    assert.equal(page.element("browser-notice").hidden, false);
    assert.equal(page.element("page").hidden, true);
    assert.equal(page.element("totals").hidden, true);
    assert.equal(page.element("footer").hidden, false);
    assert.equal(page.element("clear-site").hidden, true);
    assert.equal(page.text("question"), "");
  });

  it("shows what a page of the browser saw without the notice that there is nothing to count", async () => {
    const page = await open({
      answer: { ...RED_SITE, page: "reader", site: null, totals: {} },
    });
    assert.equal(page.element("browser-page").hidden, false);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("page").hidden, false);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
    assert.equal(page.element("totals").hidden, true);
    assert.equal(page.element("clear-site").hidden, true);
  });

  it("says the site of a website is unknown, with what the tab saw and no totals", async () => {
    const page = await open({
      answer: { ...RED_SITE, page: "site", site: null, totals: {} },
    });
    assert.equal(page.element("site").hidden, true);
    assert.equal(page.element("browser-page").hidden, true);
    assert.equal(page.element("unknown-site").hidden, false);
    assert.equal(page.element("browser-notice").hidden, true);
    assert.equal(page.element("page").hidden, false);
    assert.deepEqual(page.summary("page-rows"), PAGE_ROWS);
    assert.equal(page.element("totals").hidden, true);
    assert.equal(page.element("clear-site").hidden, true);
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
        answer: new Error("Receiving end does not exist"),
      });
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*Receiving end/,
      );
      assert.equal(unanswered.element("page").hidden, true);
      assert.equal(unanswered.element("totals").hidden, true);
      const noTab = await open({ tab: undefined });
      assert.equal(errors.mock.callCount(), 2);
      assert.deepEqual(noTab.sent, []);
    } finally {
      errors.mock.restore();
    }
  });
});

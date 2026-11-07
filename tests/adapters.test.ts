// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The adapters, compiled with the extension into build/extension/, driven by
// a stand-in for Firefox's browser object. This proves what the code does
// with a sequence of events, not that Firefox sends them so: the owner's
// trial in Firefox does.

import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import type {
  ClearedData,
  PopupData,
  SiteCounts,
} from "../src/core/popup-message.js";
import { EMPTY_RECORD, type TabRecord } from "../src/core/tab-record.js";
import { importModule, writeTable } from "./built-extension.js";

interface Answer {
  answer(message: unknown): Promise<PopupData | ClearedData> | undefined;
}

interface Requests {
  onSendHeaders(details: object): Promise<void>;
  onBeforeRedirect(details: object): Promise<void>;
  onResponseStarted(details: object): Promise<void>;
  onErrorOccurred(details: object): Promise<void>;
}

interface Tabs {
  readonly ready: Promise<void>;
  recordOf(tabId: number): TabRecord;
  onCommitted(details: object): Promise<void>;
  onCompleted(details: object): Promise<void>;
  onStatus(tabId: number, change: object, tab: object): Promise<void>;
  onAccessChange(): Promise<void>;
  forget(tabId: number): Promise<void>;
}

interface Cname {
  canonicalNameOf(host: string, now: number): Promise<string | null>;
}

const EDGE_IP = "192.0.2.10";
const OTHER_IP = "203.0.113.1";

// A tab the page held before it was suspended, and whose closing woke it.
const CLOSED_AT_WAKE_UP = 900;
const STORED: TabRecord = {
  document: "doc-900",
  shownAt: 100,
  navigation: "r900",
  state: { kind: "neutral", partial: false, missed: false },
  page: "site",
  site: "site.example",
  uncounted: [],
  previous: [],
};

// When the extension first runs, on the clock of the stand-in.
const INSTALLED_AT = 1_700_000_000_000;

interface Call {
  readonly tabId: number;
  readonly kind: "icon" | "badge" | "title";
  readonly value: string;
}

const calls: Call[] = [];
const session = new Map<string, unknown>([
  [`tab:${CLOSED_AT_WAKE_UP}`, STORED],
]);
const local = new Map<string, unknown>();
// Each write to storage.local, as Firefox would get it.
const localWrites: Record<string, unknown>[] = [];
const resolved: string[] = [];
let allSites = true;
let resolve: (host: string) => Promise<{ canonicalName?: string }> = () =>
  Promise.resolve({ canonicalName: "" });

// Firefox answers a read with what storage holds when it gets the call, so
// the stand-in takes its copy at once and hands it over when the test lets
// the wake-up finish.
let finishWakeUp = () => {};
const wakeUp = new Promise<void>((done) => {
  finishWakeUp = done;
});

function record(tabId: number, kind: Call["kind"], value: string): void {
  calls.push({ tabId, kind, value });
}

function read(
  store: Map<string, unknown>,
  keys: null | string | string[],
): Record<string, unknown> {
  const wanted =
    keys === null
      ? [...store.keys()]
      : typeof keys === "string"
        ? [keys]
        : keys;
  return Object.fromEntries(
    wanted.filter((key) => store.has(key)).map((key) => [key, store.get(key)]),
  );
}

// Firefox's own public suffix list is not at hand: the stand-in keeps the last
// two labels of a name, an address as it is when allowed, and refuses, as
// Firefox does, an empty label.
function getDomain(
  hostname: string,
  options: { allowIPAddress?: boolean } = {},
): string | null {
  if (hostname === "" || hostname.includes("..")) {
    throw new Error(`Invalid hostname: ${hostname}`);
  }
  if (hostname.startsWith("[") || /^[\d.]+$/.test(hostname)) {
    return options.allowIPAddress === true ? hostname : null;
  }
  return hostname.split(".").slice(-2).join(".");
}

// The listeners background.js adds, by event.
const listeners = new Map<string, ((...args: unknown[]) => unknown)[]>();
function event(name: string) {
  return {
    addListener: (listener: (...args: unknown[]) => unknown) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
  };
}

(globalThis as Record<string, unknown>)["browser"] = {
  storage: {
    session: {
      get: (keys: null | string | string[]) => {
        const items = read(session, keys);
        return wakeUp.then(() => items);
      },
      set: (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) {
          session.set(key, value);
        }
        return Promise.resolve();
      },
      remove: (key: string) => {
        session.delete(key);
        return Promise.resolve();
      },
    },
    local: {
      get: (keys: null | string | string[]) =>
        Promise.resolve(read(local, keys)),
      set: (items: Record<string, unknown>) => {
        localWrites.push(items);
        for (const [key, value] of Object.entries(items)) {
          local.set(key, value);
        }
        return Promise.resolve();
      },
      clear: () => {
        local.clear();
        return Promise.resolve();
      },
    },
  },
  permissions: {
    contains: () => Promise.resolve(allSites),
    onAdded: event("permissions.onAdded"),
    onRemoved: event("permissions.onRemoved"),
  },
  tabs: {
    query: () => Promise.resolve([]),
    onUpdated: event("tabs.onUpdated"),
    onRemoved: event("tabs.onRemoved"),
  },
  action: {
    setIcon: (details: { tabId: number; path: string }) => {
      record(details.tabId, "icon", details.path);
      return Promise.resolve();
    },
    setBadgeText: (details: { tabId: number; text: string }) => {
      record(details.tabId, "badge", details.text);
      return Promise.resolve();
    },
    setTitle: (details: { tabId: number; title: string }) => {
      record(details.tabId, "title", details.title);
      return Promise.resolve();
    },
    setBadgeBackgroundColor: () => Promise.resolve(),
    setBadgeTextColor: () => Promise.resolve(),
  },
  i18n: {
    getMessage: (name: string, substitutions: string[]) =>
      [name, ...substitutions].join(" "),
  },
  dns: {
    resolve: (host: string) => {
      resolved.push(host);
      return resolve(host);
    },
  },
  publicSuffix: { getDomain },
  webRequest: {
    onSendHeaders: event("webRequest.onSendHeaders"),
    onBeforeRedirect: event("webRequest.onBeforeRedirect"),
    onResponseStarted: event("webRequest.onResponseStarted"),
    onErrorOccurred: event("webRequest.onErrorOccurred"),
  },
  webNavigation: {
    onCommitted: event("webNavigation.onCommitted"),
    onCompleted: event("webNavigation.onCompleted"),
  },
  runtime: { onMessage: event("runtime.onMessage") },
};

writeTable();
mock.timers.enable({ apis: ["setTimeout", "Date"], now: INSTALLED_AT });

const tabs = await importModule<Tabs>("tabs.js");
const requests = await importModule<Requests>("requests.js");
const cname = await importModule<Cname>("cname.js");
const { answer } = await importModule<Answer>("answer.js");
await importModule<object>("background.js");

const closing = tabs.forget(CLOSED_AT_WAKE_UP);
finishWakeUp();
await closing;
await tabs.ready;

let lastId = 0;
function nextId(): string {
  lastId += 1;
  return `r${lastId}`;
}

// The requests go to the host of the site, whose CNAME names no provider.
async function send(
  tabId: number,
  requestId: string,
  type: string,
  timeStamp: number,
  cookie = false,
): Promise<void> {
  await requests.onSendHeaders({
    tabId,
    requestId,
    type,
    timeStamp,
    url: "https://site.example/account",
    method: "GET",
    requestHeaders: cookie ? [{ name: "Cookie", value: "sid=1" }] : [],
  });
}

function response(
  tabId: number,
  requestId: string,
  type: string,
  timeStamp: number,
  ip: string | null,
  statusCode = 200,
) {
  return {
    tabId,
    requestId,
    type,
    timeStamp,
    ip,
    fromCache: false,
    statusCode,
    responseHeaders: ip === EDGE_IP ? [{ name: "x-edge", value: "1" }] : [],
  };
}

// A request and its response, through the edge or elsewhere.
async function exchange(
  tabId: number,
  type: string,
  timeStamp: number,
  ip: string,
  cookie = false,
): Promise<string> {
  const requestId = nextId();
  await send(tabId, requestId, type, timeStamp, cookie);
  await requests.onResponseStarted(
    response(tabId, requestId, type, timeStamp + 1, ip),
  );
  return requestId;
}

async function commit(
  tabId: number,
  documentId: string,
  timeStamp: number,
  transitionQualifiers: string[] = [],
  url = "https://site.example/",
): Promise<void> {
  await tabs.onCommitted({
    tabId,
    frameId: 0,
    documentId,
    timeStamp,
    transitionQualifiers,
    url,
  });
}

// The status Firefox gives when a tab commits a new document.
async function status(tabId: number): Promise<void> {
  await tabs.onStatus(
    tabId,
    { status: "loading" },
    { id: tabId, url: "https://site.example/" },
  );
}

// A page through the edge with a session cookie: red, level 4.
async function redPage(tabId: number, at: number): Promise<void> {
  await exchange(tabId, "main_frame", at, EDGE_IP, true);
  await commit(tabId, `doc-${tabId}-${at}`, at + 10);
  await status(tabId);
  mock.timers.runAll();
}

function shown(tabId: number) {
  const last = (kind: Call["kind"]) =>
    calls.filter((call) => call.tabId === tabId && call.kind === kind).at(-1)
      ?.value;
  return { icon: last("icon"), badge: last("badge"), title: last("title") };
}

function sentSince(tabId: number, mark: number): Call["kind"][] {
  return calls
    .slice(mark)
    .filter((call) => call.tabId === tabId)
    .map((call) => call.kind);
}

function iconOf(tabId: number) {
  const { icon, badge } = shown(tabId);
  return { icon, badge };
}

const RED = { icon: "/icons/red.svg", badge: "1" };
const NEUTRAL = { icon: "/icons/neutral.svg", badge: "" };

describe("a navigation that never commits", () => {
  const endings: [
    string,
    (tabId: number, requestId: string) => Promise<void>,
  ][] = [
    [
      "a download",
      (tabId, requestId) =>
        requests.onResponseStarted(
          response(tabId, requestId, "main_frame", 2001, OTHER_IP),
        ),
    ],
    [
      "a 204 response",
      (tabId, requestId) =>
        requests.onResponseStarted(
          response(tabId, requestId, "main_frame", 2001, OTHER_IP, 204),
        ),
    ],
    [
      "a stop",
      (_tabId, requestId) =>
        requests.onErrorOccurred({ requestId, error: "NS_BINDING_ABORTED" }),
    ],
  ];

  for (const [index, [name, end]] of endings.entries()) {
    it(`keeps showing the page still shown after ${name}, and counts its requests for it`, async () => {
      const tab = 100 + index;
      await redPage(tab, 1000);
      assert.deepEqual(iconOf(tab), RED);
      const navigation = nextId();
      await send(tab, navigation, "main_frame", 2000);
      await end(tab, navigation);
      mock.timers.runAll();
      assert.deepEqual(iconOf(tab), RED);
      await exchange(tab, "xmlhttprequest", 3000, EDGE_IP, true);
      mock.timers.runAll();
      assert.deepEqual(iconOf(tab), { ...RED, badge: "2" });
      assert.match(shown(tab).title ?? "", /countLevel4ProvenMany 2/);
    });
  }

  it("shows the document the navigation opens once it commits, before the tab's status changes", async () => {
    const tab = 110;
    await redPage(tab, 1000);
    await exchange(tab, "main_frame", 2000, OTHER_IP);
    mock.timers.runAll();
    assert.deepEqual(iconOf(tab), RED);
    await commit(tab, "doc-110-b", 2010);
    mock.timers.runAll();
    assert.deepEqual(iconOf(tab), NEUTRAL);
  });
});

describe("a response whose request the extension never saw", () => {
  it("says the page missed requests, as when a service worker serves them or a request outlives a suspension", async () => {
    const tab = 200;
    await commit(tab, "doc-200", 1000);
    await status(tab);
    // The interception gives a redirect, then the response, never the
    // request (nsHttpChannel.cpp and WebRequest.sys.mjs, Firefox 159.0.1).
    await requests.onBeforeRedirect(
      response(tab, "sw1", "xmlhttprequest", 1100, null),
    );
    mock.timers.runAll();
    assert.doesNotMatch(shown(tab).title ?? "", /titleMissed/);
    await requests.onResponseStarted(
      response(tab, "sw1", "xmlhttprequest", 1101, null),
    );
    mock.timers.runAll();
    assert.equal(shown(tab).icon, "/icons/neutral.svg");
    assert.match(shown(tab).title ?? "", /titleMissed/);
  });

  it("leaves the page as it is for a redirect without its request, as an upgrade to HTTPS gives", async () => {
    const tab = 201;
    await commit(tab, "doc-201", 1000);
    await status(tab);
    await requests.onBeforeRedirect(
      response(tab, "hsts", "script", 1100, null),
    );
    mock.timers.runAll();
    assert.equal(tabs.recordOf(tab).state.kind, "neutral");
    assert.doesNotMatch(shown(tab).title ?? "", /titleMissed/);
  });

  it("leaves the tabs as they are for a response of the browser or of another extension", async () => {
    const tab = 202;
    await commit(tab, "doc-202", 1000);
    const before = tabs.recordOf(tab);
    await requests.onResponseStarted(
      response(-1, "worker", "xmlhttprequest", 1100, EDGE_IP),
    );
    assert.equal(tabs.recordOf(tab), before);
  });

  for (const commitFirst of [false, true]) {
    it(`marks the document a service worker served whole, not the page it leaves${commitFirst ? ", when the commit arrives first" : ""}`, async () => {
      const tab = commitFirst ? 204 : 203;
      await redPage(tab, 1000);
      if (commitFirst) {
        await commit(tab, "doc-new", 2010);
      }
      await requests.onResponseStarted(
        response(tab, "sw-document", "main_frame", 2000, null),
      );
      if (!commitFirst) {
        await commit(tab, "doc-new", 2010);
      }
      const now = tabs.recordOf(tab);
      assert.equal(now.document, "doc-new");
      assert.equal(now.state.kind === "neutral" && now.state.missed, true);
      const left = now.previous[0]?.state;
      assert.equal(left?.kind === "seen" && left.missed, false);
    });
  }
});

describe("a page whose start the extension did not see", () => {
  it("says a tab open before the extension started missed requests", async () => {
    const tab = 300;
    await exchange(tab, "image", 1000, EDGE_IP);
    mock.timers.runAll();
    assert.equal(shown(tab).icon, "/icons/blue.svg");
    assert.match(shown(tab).title ?? "", /titleMissed/);
  });

  it("says a page Back brings back, loaded before this run of the extension, missed requests", async () => {
    const tab = 301;
    await redPage(tab, 1000);
    await commit(tab, "doc-before-the-run", 2000, ["forward_back"]);
    await status(tab);
    assert.equal(shown(tab).icon, "/icons/neutral.svg");
    assert.match(shown(tab).title ?? "", /titleMissed/);
  });

  it("starts over complete a page a link opens without a request, such as a local file", async () => {
    const tab = 302;
    await redPage(tab, 1000);
    await commit(
      tab,
      "doc-file",
      2000,
      ["from_address_bar"],
      "file:///home/user/page.html",
    );
    await status(tab);
    assert.doesNotMatch(shown(tab).title ?? "", /titleMissed/);
  });
});

describe("the toolbar button", () => {
  it("sends again only the values that changed between two changes of the tab's status", async () => {
    const tab = 400;
    await commit(tab, "doc-400", 1000);
    await status(tab);
    let mark = calls.length;
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(sentSince(tab, mark), ["icon", "badge", "title"]);
    mark = calls.length;
    await exchange(tab, "image", 1200, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(sentSince(tab, mark), ["badge", "title"]);
    mark = calls.length;
    await exchange(tab, "script", 1300, EDGE_IP, true);
    mock.timers.runAll();
    assert.deepEqual(sentSince(tab, mark), ["icon", "badge", "title"]);
  });

  it("sends every value when the tab starts loading, since Firefox clears them for a new document", async () => {
    const tab = 401;
    await redPage(tab, 1000);
    const mark = calls.length;
    await status(tab);
    assert.deepEqual(sentSince(tab, mark), ["icon", "badge", "title"]);
    assert.deepEqual({ icon: shown(tab).icon, badge: shown(tab).badge }, RED);
  });

  // A new fragment, history.pushState or history.replaceState gives one
  // status, "complete" once the page has loaded, and the tab keeps its
  // values (ext-tabs-base.js and ext-browser.js, Firefox 159.0.1).
  it("sends nothing when the URL changes within the document, which clears none of the values", async () => {
    const tab = 402;
    await redPage(tab, 1000);
    const mark = calls.length;
    for (const fragment of ["#a", "#b", "#c"]) {
      await tabs.onStatus(
        tab,
        { status: "complete" },
        { id: tab, url: `https://site.example/${fragment}` },
      );
    }
    mock.timers.runAll();
    assert.deepEqual(sentSince(tab, mark), []);
    assert.deepEqual(iconOf(tab), RED);
  });

  it("sends what changed when the tab completes", async () => {
    const tab = 403;
    await commit(tab, "doc-403", 1000);
    await status(tab);
    await exchange(tab, "image", 1100, EDGE_IP);
    const mark = calls.length;
    await tabs.onStatus(
      tab,
      { status: "complete" },
      { id: tab, url: "https://site.example/" },
    );
    assert.deepEqual(sentSince(tab, mark), ["icon", "badge", "title"]);
    assert.equal(shown(tab).icon, "/icons/blue.svg");
  });
});

describe("a page of the browser, without the access to all sites", () => {
  before(async () => {
    allSites = false;
    await tabs.onAccessChange();
  });
  after(async () => {
    allSites = true;
    await tabs.onAccessChange();
  });

  // No access to sites covers the scheme of such a page, so Firefox gives
  // its URL to no extension without the tabs permission, as for a site out
  // of reach (ext-tabs-base.js, Firefox 159.0.1).
  async function statusWithoutUrl(tabId: number): Promise<void> {
    await tabs.onStatus(tabId, { status: "loading" }, { id: tabId });
  }

  const pages = [
    "about:newtab",
    "about:readerish",
    "about:blank#reader",
    "view-source:https://site.example/",
    "view-source:about:reader?url=https%3A%2F%2Fsite.example%2F",
    "file:///home/user/page.html",
    "file:///home/user/about:reader",
    "moz-extension://5f0c7a3e-1b2d-4c5e-8f9a-0b1c2d3e4f50/page.html",
  ];

  for (const [index, url] of pages.entries()) {
    it(`shows ${url} neutral, neither not observed nor partial, even when the tab's status comes before the commit`, async () => {
      const tab = 700 + index;
      await redPage(tab, 1000);
      await statusWithoutUrl(tab);
      await commit(tab, `doc-${tab}-page`, 2000, [], url);
      await statusWithoutUrl(tab);
      mock.timers.runAll();
      assert.deepEqual(iconOf(tab), NEUTRAL);
      assert.equal(shown(tab).title, "titleNeutral");
    });
  }

  // Firefox finds an about: page by its name, what comes before "?" or "#",
  // without regard to case (nsAboutProtocolUtils.h, mozilla-central).
  const readers = [
    "about:reader?url=https%3A%2F%2Fsite.example%2F",
    "about:reader#top",
    "about:READER?url=https%3A%2F%2Fsite.example%2F",
    "about:reader",
  ];

  for (const [index, url] of readers.entries()) {
    it(`shows ${url} neutral with a partial view, since reader view loads the article's images from the web`, async () => {
      const tab = 720 + index;
      await redPage(tab, 1000);
      await statusWithoutUrl(tab);
      await commit(tab, `doc-${tab}-reader`, 2000, [], url);
      await statusWithoutUrl(tab);
      mock.timers.runAll();
      assert.deepEqual(iconOf(tab), NEUTRAL);
      assert.equal(shown(tab).title, "titleNeutral\ntitlePartial");
    });
  }

  it("shows reader view neutral and complete while the extension has the access to all sites", async () => {
    allSites = true;
    await tabs.onAccessChange();
    try {
      const tab = 730;
      await redPage(tab, 1000);
      await commit(
        tab,
        "doc-730-reader",
        2000,
        [],
        "about:reader?url=https%3A%2F%2Fsite.example%2F",
      );
      await status(tab);
      mock.timers.runAll();
      assert.equal(shown(tab).title, "titleNeutral");
    } finally {
      allSites = false;
      await tabs.onAccessChange();
    }
  });

  it("shows the settings page neutral, which Firefox completes without a commit", async () => {
    const tab = 710;
    await redPage(tab, 1000);
    await statusWithoutUrl(tab);
    await tabs.onCompleted({
      tabId: tab,
      frameId: 0,
      documentId: "doc-settings",
      timeStamp: 2000,
      url: "about:preferences",
    });
    await statusWithoutUrl(tab);
    mock.timers.runAll();
    assert.deepEqual(iconOf(tab), NEUTRAL);
    assert.equal(shown(tab).title, "titleNeutral");
  });

  for (const [index, url] of ["https://hidden.example/", ""].entries()) {
    it(`still says not observed a page ${url === "" ? "whose URL Firefox did not give" : "of a site out of reach"}`, async () => {
      const tab = 711 + index;
      await commit(tab, `doc-${tab}`, 1000, [], url);
      await statusWithoutUrl(tab);
      mock.timers.runAll();
      assert.equal(shown(tab).icon, "/icons/not-observed.svg");
      assert.equal(shown(tab).title, "titleNotObserved");
    });
  }

  it("says not observed a site out of reach whose commit only its completion follows", async () => {
    const tab = 713;
    await redPage(tab, 1000);
    await commit(tab, "doc-713-hidden", 2000, [], "https://hidden.example/");
    await tabs.onStatus(tab, { status: "complete" }, { id: tab });
    assert.equal(shown(tab).icon, "/icons/not-observed.svg");
    assert.equal(shown(tab).title, "titleNotObserved");
  });
});

describe("a closed tab", () => {
  it("is not written back when its last request events arrive after it closed", async () => {
    const tab = 500;
    await redPage(tab, 1000);
    assert.equal(session.has(`tab:${tab}`), true);
    await tabs.forget(tab);
    assert.equal(session.has(`tab:${tab}`), false);
    const mark = calls.length;
    await exchange(tab, "main_frame", 2000, EDGE_IP, true);
    await exchange(tab, "beacon", 2100, EDGE_IP, true);
    mock.timers.runAll();
    assert.equal(session.has(`tab:${tab}`), false);
    assert.deepEqual(sentSince(tab, mark), []);
  });

  it("is forgotten when its closing woke the page, which read it back from storage", () => {
    assert.equal(tabs.recordOf(CLOSED_AT_WAKE_UP).document, "");
    assert.equal(session.has(`tab:${CLOSED_AT_WAKE_UP}`), false);
  });
});

// A host that resolves to the edge, sent apart from the site so that its
// canonical name is not known yet.
async function exchangeWith(
  host: string,
  tabId: number,
  timeStamp: number,
): Promise<void> {
  const requestId = nextId();
  await requests.onSendHeaders({
    tabId,
    requestId,
    type: "image",
    timeStamp,
    url: `https://${host}/logo.png`,
    method: "GET",
    requestHeaders: [],
  });
  await requests.onResponseStarted(
    response(tabId, requestId, "image", timeStamp + 1, OTHER_IP),
  );
}

const MINUTE = 60_000;

describe("the canonical name of a host", () => {
  it("is resolved once per wake-up, however long ago", async () => {
    resolve = () => Promise.resolve({ canonicalName: "a.edge.example.net" });
    assert.equal(
      await cname.canonicalNameOf("ok.example", 1000),
      "a.edge.example.net",
    );
    assert.equal(
      await cname.canonicalNameOf("ok.example", 1000 + 10 * MINUTE),
      "a.edge.example.net",
    );
    assert.deepEqual(
      resolved.filter((host) => host === "ok.example"),
      ["ok.example"],
    );
  });

  it("is not asked again within a minute of a failure, which is logged once", async () => {
    resolve = () => Promise.reject(new Error("NS_ERROR_UNKNOWN_PROXY_HOST"));
    const errors = mock.method(console, "error", () => {});
    try {
      assert.equal(await cname.canonicalNameOf("socks.example", 1000), null);
      assert.equal(await cname.canonicalNameOf("socks.example", 1000), null);
      assert.equal(
        await cname.canonicalNameOf("socks.example", 1000 + MINUTE - 1),
        null,
      );
      assert.deepEqual(
        resolved.filter((host) => host === "socks.example"),
        ["socks.example"],
      );
      assert.equal(errors.mock.callCount(), 1);
    } finally {
      errors.mock.restore();
    }
  });

  it("is asked again a minute after a failure, and kept once it is known", async () => {
    resolve = () => Promise.reject(new Error("NS_ERROR_UNKNOWN_HOST"));
    const errors = mock.method(console, "error", () => {});
    try {
      assert.equal(await cname.canonicalNameOf("flaky.example", 1000), null);
      assert.equal(
        await cname.canonicalNameOf("flaky.example", 1000 + MINUTE),
        null,
      );
      assert.equal(errors.mock.callCount(), 2);
      resolve = () => Promise.resolve({ canonicalName: "b.edge.example.net" });
      assert.equal(
        await cname.canonicalNameOf("flaky.example", 1000 + 2 * MINUTE),
        "b.edge.example.net",
      );
      assert.equal(
        await cname.canonicalNameOf("flaky.example", 1000 + 10 * MINUTE),
        "b.edge.example.net",
      );
      assert.deepEqual(
        resolved.filter((host) => host === "flaky.example"),
        ["flaky.example", "flaky.example", "flaky.example"],
      );
    } finally {
      errors.mock.restore();
    }
  });

  it("is asked again by a request that comes a minute after the one whose resolution failed", async () => {
    const tab = 600;
    await commit(tab, "doc-600", 1000);
    await status(tab);
    resolve = () => Promise.reject(new Error("NS_ERROR_UNKNOWN_HOST"));
    const errors = mock.method(console, "error", () => {});
    try {
      await exchangeWith("late.example", tab, 1100);
      resolve = () => Promise.resolve({ canonicalName: "c.edge.example.net" });
      await exchangeWith("late.example", tab, 1100 + MINUTE - 1);
      assert.equal(tabs.recordOf(tab).state.kind, "neutral");
      await exchangeWith("late.example", tab, 1100 + MINUTE);
      assert.equal(tabs.recordOf(tab).state.kind, "seen");
      assert.deepEqual(
        resolved.filter((host) => host === "late.example"),
        ["late.example", "late.example"],
      );
    } finally {
      errors.mock.restore();
    }
  });

  it("is never asked for an address", async () => {
    assert.equal(await cname.canonicalNameOf("192.0.2.10", 1000), null);
    assert.equal(await cname.canonicalNameOf("[2001:db8::1]", 1000), null);
    assert.deepEqual(
      resolved.filter((host) => host.includes("192.0.2") || host.includes(":")),
      [],
    );
  });
});

describe("the site of a document", () => {
  const cases: [string, string | null][] = [
    ["https://www.site.example/path?q=1#top", "site.example"],
    ["http://deep.sub.site.example/", "site.example"],
    ["https://192.0.2.7/", "192.0.2.7"],
    ["https://[2001:db8::1]:8443/", "[2001:db8::1]"],
    ["https://localhost/", "localhost"],
    // Firefox refuses an empty label: the host is kept as it is.
    ["https://a..b/", "a..b"],
    ["about:newtab", null],
    ["about:reader?url=https%3A%2F%2Fsite.example%2F", null],
    ["view-source:https://site.example/", null],
    ["file:///home/user/page.html", null],
    ["moz-extension://5f0c7a3e-1b2d-4c5e-8f9a-0b1c2d3e4f50/page.html", null],
    ["", null],
  ];

  for (const [index, [url, site]] of cases.entries()) {
    it(`is ${site ?? "none"} for ${url === "" ? "a URL Firefox did not give" : url}`, async () => {
      const tab = 1000 + index;
      await commit(tab, `doc-${tab}`, 1000, [], url);
      assert.equal(tabs.recordOf(tab).site, site);
    });
  }

  it("is the one of the page completed without a commit, such as the settings", async () => {
    const tab = 1020;
    await tabs.onCompleted({
      tabId: tab,
      frameId: 0,
      documentId: "doc-1020",
      timeStamp: 1000,
      url: "about:preferences",
    });
    assert.equal(tabs.recordOf(tab).site, null);
    await tabs.onCompleted({
      tabId: tab,
      frameId: 0,
      documentId: "doc-1020-site",
      timeStamp: 2000,
      url: "https://www.site.example/",
    });
    assert.equal(tabs.recordOf(tab).site, "site.example");
  });
});

describe("the kept counts", () => {
  function siteCounts(site: string): SiteCounts | undefined {
    return local.get(`site:${site}`) as SiteCounts | undefined;
  }

  async function popup(tab: number, privateWindow = false): Promise<PopupData> {
    return (await answer({
      kind: "popup",
      tabId: tab,
      privateWindow,
    })) as PopupData;
  }

  it("start when the extension first runs, before anything is counted", async () => {
    assert.equal(local.get("since"), INSTALLED_AT);
    assert.equal((await popup(1100)).since, INSTALLED_AT);
  });

  for (const commitFirst of [false, true]) {
    it(`count the top-level request of a page once its commit gives the site${commitFirst ? ", when the commit arrives first" : ""}`, async () => {
      const tab = commitFirst ? 1111 : 1110;
      const site = `t${tab}.example`;
      if (commitFirst) {
        await commit(tab, `doc-${tab}`, 2010, [], `https://www.${site}/`);
      }
      await exchange(tab, "main_frame", 2000, EDGE_IP);
      mock.timers.runAll();
      if (!commitFirst) {
        assert.equal(siteCounts(site), undefined);
        await commit(tab, `doc-${tab}`, 2010, [], `https://www.${site}/`);
        mock.timers.runAll();
      }
      assert.deepEqual(siteCounts(site), {
        edge: { red3: { "GET main_frame": 1 } },
      });
    });
  }

  it("count a request of the page shown at once, by provider, category and kind, and leave out a request through no provider", async () => {
    const tab = 1120;
    const site = "t1120.example";
    await commit(tab, "doc-1120", 1000, [], `https://${site}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    await exchange(tab, "image", 1200, OTHER_IP);
    await exchange(tab, "image", 1300, EDGE_IP);
    await exchange(tab, "xmlhttprequest", 1400, EDGE_IP, true);
    mock.timers.runAll();
    assert.deepEqual(siteCounts(site), {
      edge: {
        blue2: { "GET image": 2 },
        red4: { "GET xmlhttprequest": 1 },
      },
    });
    assert.deepEqual((await popup(tab)).totals, siteCounts(site));
  });

  it("agree with the badge: the popup sees what was counted before it is written", async () => {
    const tab = 1125;
    const site = "t1125.example";
    await commit(tab, "doc-1125", 1000, [], `https://${site}/`);
    await status(tab);
    await exchange(tab, "image", 1100, EDGE_IP);
    assert.equal(siteCounts(site), undefined);
    assert.deepEqual((await popup(tab)).totals, {
      edge: { blue2: { "GET image": 1 } },
    });
    mock.timers.runAll();
    assert.equal(shown(tab).badge, "1");
    assert.deepEqual(siteCounts(site), { edge: { blue2: { "GET image": 1 } } });
  });

  it("count a request of the page still shown while a navigation is pending, for that page", async () => {
    const tab = 1127;
    const site = "t1127.example";
    await commit(tab, "doc-1127", 1000, [], `https://${site}/`);
    await send(tab, nextId(), "main_frame", 2000);
    await exchange(tab, "image", 2100, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(siteCounts(site), { edge: { blue2: { "GET image": 1 } } });
  });

  it("count nothing for a page of the browser, reader view included, which has no site", async () => {
    const tab = 1130;
    await commit(
      tab,
      "doc-1130",
      1000,
      [],
      "about:reader?url=https%3A%2F%2Fsite.example%2F",
    );
    mock.timers.runAll();
    const writes = localWrites.length;
    const keys = [...local.keys()];
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    assert.equal(tabs.recordOf(tab).state.kind, "seen");
    assert.equal(localWrites.length, writes);
    assert.deepEqual([...local.keys()], keys);
    assert.deepEqual((await popup(tab)).totals, {});
  });

  it("count nothing for a tab the extension has not seen navigate, whose site it does not know", async () => {
    const tab = 1135;
    mock.timers.runAll();
    const writes = localWrites.length;
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    assert.equal(tabs.recordOf(tab).state.kind, "seen");
    assert.equal(localWrites.length, writes);
  });

  it("write the sites a burst touched once, after the burst", async () => {
    const a = 1140;
    const b = 1141;
    await commit(a, "doc-1140", 1000, [], "https://t1140.example/");
    await commit(b, "doc-1141", 1000, [], "https://t1141.example/");
    mock.timers.runAll();
    const writes = localWrites.length;
    for (const at of [1100, 1200, 1300]) {
      await exchange(a, "image", at, EDGE_IP);
    }
    await exchange(b, "script", 1400, EDGE_IP);
    assert.equal(localWrites.length, writes);
    mock.timers.runAll();
    assert.equal(localWrites.length, writes + 1);
    assert.deepEqual(localWrites[writes], {
      "site:t1140.example": { edge: { blue2: { "GET image": 3 } } },
      "site:t1141.example": { edge: { blue2: { "GET script": 1 } } },
    });
  });

  it("keep the counts of a private window for the session only, with no date, apart from the kept ones", async () => {
    const tab = 1150;
    const site = "t1150.example";
    mock.timers.runAll();
    const writes = localWrites.length;
    await requests.onSendHeaders({
      tabId: tab,
      requestId: "private-1",
      type: "main_frame",
      timeStamp: 1000,
      url: "https://site.example/account",
      method: "GET",
      requestHeaders: [],
      incognito: true,
    });
    await requests.onResponseStarted({
      ...response(tab, "private-1", "main_frame", 1001, EDGE_IP),
      incognito: true,
    });
    await commit(tab, "doc-1150", 1010, [], `https://${site}/`);
    mock.timers.runAll();
    assert.equal(siteCounts(site), undefined);
    assert.equal(localWrites.length, writes);
    assert.deepEqual(session.get("privateCounts"), {
      [site]: { edge: { red3: { "GET main_frame": 1 } } },
    });
    const data = await popup(tab, true);
    assert.equal(data.privateWindow, true);
    assert.equal(data.since, 0);
    assert.equal(data.site, site);
    assert.deepEqual(data.totals, { edge: { red3: { "GET main_frame": 1 } } });
    assert.deepEqual((await popup(tab)).totals, {});
  });

  it("clear everything counted, written or not, start a new period, and leave the private session alone", async () => {
    const tab = 1160;
    const site = "t1160.example";
    await commit(tab, "doc-1160", 1000, [], `https://${site}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    assert.notEqual(siteCounts(site), undefined);
    // Counted, and not yet written.
    await exchange(tab, "image", 1200, EDGE_IP);
    mock.timers.tick(1);
    const privateBefore = JSON.stringify(session.get("privateCounts"));
    const now = Date.now();
    assert.ok(now > INSTALLED_AT);
    const cleared = (await answer({ kind: "clear" })) as ClearedData;
    assert.equal(cleared.since, now);
    assert.deepEqual([...local.keys()], ["since"]);
    assert.equal(local.get("since"), now);
    mock.timers.runAll();
    assert.deepEqual([...local.keys()], ["since"]);
    assert.equal(JSON.stringify(session.get("privateCounts")), privateBefore);
    const data = await popup(tab);
    assert.equal(data.since, now);
    assert.deepEqual(data.totals, {});
    await exchange(tab, "image", 1300, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(siteCounts(site), { edge: { blue2: { "GET image": 1 } } });
  });
});

describe("the message handler", () => {
  const popup = { kind: "popup", tabId: 1299, privateWindow: false };

  it("answers the popup for the document the tab shows, with the totals of its site", async () => {
    const tab = 1200;
    const site = "t1200.example";
    await exchange(tab, "main_frame", 1000, EDGE_IP, true);
    await commit(tab, "doc-1200", 1010, [], `https://www.${site}/page`);
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    const data = (await answer({
      kind: "popup",
      tabId: tab,
      privateWindow: false,
    })) as PopupData;
    assert.equal(data.site, site);
    assert.equal(data.page, "site");
    assert.equal(data.privateWindow, false);
    assert.equal(data.state.kind, "seen");
    assert.equal(data.since, local.get("since"));
    assert.deepEqual(data.totals, {
      edge: { red4: { "GET main_frame": 1 }, blue2: { "GET image": 1 } },
    });
  });

  it("answers for the page still shown while a navigation is pending", async () => {
    const tab = 1210;
    await commit(tab, "doc-1210", 1000, [], "https://t1210.example/");
    await send(tab, nextId(), "main_frame", 2000);
    const data = (await answer({
      kind: "popup",
      tabId: tab,
      privateWindow: false,
    })) as PopupData;
    assert.equal(data.site, "t1210.example");
  });

  it("answers for a tab it never saw with an empty record and no totals", async () => {
    assert.deepEqual(await answer(popup), {
      state: EMPTY_RECORD.state,
      page: "site",
      site: null,
      privateWindow: false,
      since: local.get("since"),
      totals: {},
    });
  });

  it("ignores a message of another shape", () => {
    assert.equal(answer("popup"), undefined);
    assert.equal(answer(null), undefined);
    assert.equal(answer({ kind: "map" }), undefined);
    assert.equal(answer({ kind: "popup", tabId: "1" }), undefined);
    assert.equal(
      answer({ kind: "popup", tabId: 1, privateWindow: "yes" }),
      undefined,
    );
  });

  it("is registered by the event page on runtime.onMessage, and answers with a promise", async () => {
    const registered = listeners.get("runtime.onMessage") ?? [];
    assert.equal(registered.length, 1);
    const result = registered[0]?.(popup, {}, () => {});
    assert.ok(result instanceof Promise);
    assert.deepEqual(await result, await answer(popup));
    assert.equal(
      registered[0]?.({ kind: "map" }, {}, () => {}),
      undefined,
    );
  });
});

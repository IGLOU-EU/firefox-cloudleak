// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The adapters, compiled with the extension into build/extension/, driven by
// a stand-in for Firefox's browser object. This proves what the code does
// with a sequence of events, not that Firefox sends them so: the owner's
// trial in Firefox does.

import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { dayOf } from "../src/core/counts.js";
import type {
  ClearedData,
  IgnoredData,
  MapData,
  PopupData,
  Settings,
  SiteAddresses,
  SiteCounts,
} from "../src/core/popup-message.js";
import { viewOf } from "../src/core/popup-view.js";
import { EMPTY_RECORD, type TabRecord } from "../src/core/tab-record.js";
import { importModule, writeTable } from "./built-extension.js";

interface Answer {
  answer(
    message: unknown,
  ):
    | Promise<
        | PopupData
        | ClearedData
        | IgnoredData
        | MapData
        | Settings
        | SiteAddresses
      >
    | undefined;
}

interface Site {
  siteOfTyped(text: string): string | null;
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

interface Counts {
  readonly ready: Promise<void>;
  currentSettings(): Settings;
  siteAddresses(site: string, privateWindow: boolean): Promise<SiteAddresses>;
  totals(site: string | null, privateWindow: boolean): SiteCounts;
  since(site: string | null, privateWindow: boolean): number;
  onWindowRemoved(): Promise<void>;
  isIgnored(site: string | null): boolean;
  ignoredSites(): string[];
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
// Each read of storage.local: the keys asked for, null for every key, or
// "getKeys" for the list of the keys.
const localReads: (null | string | string[])[] = [];
// While set, a read of storage.local answers with what storage held when it
// was asked, once the gate opens, as Firefox answers a read that is slow.
let localReadGate: Promise<void> | null = null;
const resolved: string[] = [];
let allSites = true;
// The windows Firefox lists, those of private windows only when the
// extension may run in them.
let openWindows: { id: number; incognito: boolean }[] | Error = [
  { id: 1, incognito: false },
];
let windowReads = 0;
// What Firefox answers to webNavigation.getFrame for the top frame of a tab:
// null for a frame it cannot give, such as that of a discarded tab.
type Frame = { readonly url?: string } | null;
const NO_FRAME = () => Promise.resolve(null);
let frameOf: (tabId: number) => Promise<Frame> = NO_FRAME;
const frameReads: { tabId: number; frameId: number }[] = [];
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
      get: (keys: null | string | string[]) => {
        localReads.push(keys);
        const items = read(local, keys);
        return localReadGate === null
          ? Promise.resolve(items)
          : localReadGate.then(() => items);
      },
      getKeys: () => {
        localReads.push("getKeys");
        return Promise.resolve([...local.keys()]);
      },
      set: (items: Record<string, unknown>) => {
        localWrites.push(items);
        for (const [key, value] of Object.entries(items)) {
          local.set(key, value);
        }
        return Promise.resolve();
      },
      remove: (keys: string | string[]) => {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          local.delete(key);
        }
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
  windows: {
    getAll: () => {
      windowReads += 1;
      return openWindows instanceof Error
        ? Promise.reject(openWindows)
        : Promise.resolve(openWindows);
    },
    onRemoved: event("windows.onRemoved"),
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
    getFrame: (details: { tabId: number; frameId: number }) => {
      frameReads.push(details);
      return frameOf(details.tabId);
    },
  },
  runtime: { onMessage: event("runtime.onMessage") },
};

writeTable();
mock.timers.enable({ apis: ["setTimeout", "Date"], now: INSTALLED_AT });

const tabs = await importModule<Tabs>("tabs.js");
const requests = await importModule<Requests>("requests.js");
const cname = await importModule<Cname>("cname.js");
const counts = await importModule<Counts>("counts.js");
const { answer } = await importModule<Answer>("answer.js");
const { siteOfTyped } = await importModule<Site>("site.js");
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

// An image of a private window through the edge.
async function privateExchange(
  tabId: number,
  requestId: string,
  timeStamp: number,
): Promise<void> {
  await requests.onSendHeaders({
    tabId,
    requestId,
    type: "image",
    timeStamp,
    url: "https://site.example/logo.png",
    method: "GET",
    requestHeaders: [],
    incognito: true,
  });
  await requests.onResponseStarted({
    ...response(tabId, requestId, "image", timeStamp + 1, EDGE_IP),
    incognito: true,
  });
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

  it("shows neutral a page of the browser open before the extension started, once Firefox gives its URL", async () => {
    const tab = 740;
    frameOf = (tabId) =>
      Promise.resolve(tabId === tab ? { url: "about:newtab" } : null);
    try {
      await statusWithoutUrl(tab);
      await new Promise((done) => setImmediate(done));
      mock.timers.runAll();
      assert.deepEqual(iconOf(tab), NEUTRAL);
      assert.equal(shown(tab).title, "titleNeutral");
    } finally {
      frameOf = NO_FRAME;
    }
  });

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
    assert.equal(local.get("since"), dayOf(INSTALLED_AT));
    assert.equal((await popup(1100)).since, dayOf(INSTALLED_AT));
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

  it("count nothing for a tab the extension has not seen navigate, when Firefox gives no page for it", async () => {
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

  it("clear the site shown, written or not, start its counts again, and leave the other sites, the common date and the private session alone", async () => {
    const tab = 1160;
    const site = "t1160.example";
    const other = 1161;
    const otherSite = "t1161.example";
    const privateTab = 1162;
    await commit(tab, "doc-1160", 1000, [], `https://${site}/`);
    await commit(other, "doc-1161", 1000, [], `https://${otherSite}/`);
    await commit(privateTab, "doc-1162", 1000, [], `https://${site}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    await exchange(other, "image", 1100, EDGE_IP);
    await privateExchange(privateTab, "private-1162", 1100);
    mock.timers.runAll();
    assert.notEqual(siteCounts(site), undefined);
    // Counted, and not yet written.
    await exchange(tab, "image", 1200, EDGE_IP);
    mock.timers.tick(1);
    const common = local.get("since");
    assert.equal(common, dayOf(INSTALLED_AT));
    const otherBefore = JSON.stringify(siteCounts(otherSite));
    const privateBefore = JSON.stringify(session.get("privateCounts"));
    const now = Date.now();
    assert.ok(now > INSTALLED_AT);
    const today = dayOf(now);
    const cleared = (await answer({
      kind: "clearSite",
      site,
      privateWindow: false,
    })) as ClearedData;
    assert.equal(cleared.since, today);
    assert.deepEqual(siteCounts(site), {});
    assert.equal(local.get(`since:${site}`), today);
    // The write pending since before the clear brings nothing back.
    mock.timers.runAll();
    assert.deepEqual(siteCounts(site), {});
    assert.equal(local.get(`since:${site}`), today);
    assert.equal(local.get("since"), common);
    assert.equal(JSON.stringify(siteCounts(otherSite)), otherBefore);
    assert.equal(local.has(`since:${otherSite}`), false);
    assert.equal(JSON.stringify(session.get("privateCounts")), privateBefore);
    const data = await popup(tab);
    assert.equal(data.since, today);
    assert.deepEqual(data.totals, {});
    const otherData = await popup(other);
    assert.equal(otherData.since, common);
    assert.deepEqual(otherData.totals, { edge: { blue2: { "GET image": 1 } } });
    const privateData = await popup(privateTab, true);
    assert.equal(privateData.since, 0);
    assert.deepEqual(privateData.totals, {
      edge: { blue2: { "GET image": 1 } },
    });
    await exchange(tab, "image", 1300, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(siteCounts(site), { edge: { blue2: { "GET image": 1 } } });
    assert.equal((await popup(tab)).since, today);
  });

  it("clear in a private window the counts of the site in the private session only, and nothing of the kept counts nor of the other sites", async () => {
    const kept = 1170;
    const site = "t1170.example";
    await commit(kept, "doc-1170", 1000, [], `https://${site}/`);
    await exchange(kept, "image", 1100, EDGE_IP);
    const tab = 1171;
    await commit(tab, "doc-1171", 1000, [], `https://${site}/`);
    await privateExchange(tab, "private-1171", 1100);
    const other = 1172;
    const otherSite = "t1172.example";
    await commit(other, "doc-1172", 1000, [], `https://${otherSite}/`);
    await privateExchange(other, "private-1172", 1100);
    mock.timers.runAll();
    assert.notDeepEqual((await popup(tab, true)).totals, {});
    // Counted, and not yet written.
    await privateExchange(tab, "private-1171-b", 1150);
    const keptBefore = JSON.stringify([...local.entries()]);
    const writes = localWrites.length;
    const cleared = (await answer({
      kind: "clearSite",
      site,
      privateWindow: true,
    })) as ClearedData;
    assert.equal(cleared.since, 0);
    const data = await popup(tab, true);
    assert.equal(data.since, 0);
    assert.deepEqual(data.totals, {});
    mock.timers.runAll();
    const stored = session.get("privateCounts") as Record<string, SiteCounts>;
    assert.equal(stored[site], undefined);
    assert.deepEqual(stored[otherSite], {
      edge: { blue2: { "GET image": 1 } },
    });
    assert.deepEqual((await popup(other, true)).totals, {
      edge: { blue2: { "GET image": 1 } },
    });
    assert.equal(localWrites.length, writes);
    assert.equal(JSON.stringify([...local.entries()]), keptBefore);
    const keptData = await popup(kept);
    assert.equal(keptData.since, local.get("since"));
    assert.deepEqual(keptData.totals, { edge: { blue2: { "GET image": 1 } } });
    await privateExchange(tab, "private-1171-c", 1200);
    mock.timers.runAll();
    assert.deepEqual((await popup(tab, true)).totals, {
      edge: { blue2: { "GET image": 1 } },
    });
    assert.deepEqual(
      (session.get("privateCounts") as Record<string, SiteCounts>)[site],
      { edge: { blue2: { "GET image": 1 } } },
    );
  });

  it("read at a wake-up the start of each site cleared, and the common date for a site stored before any clear", async () => {
    const common = local.get("since");
    const clearedAt = INSTALLED_AT + 5000;
    local.set("site:t1175.example", { edge: { blue2: { "GET image": 2 } } });
    local.set("site:t1176.example", {});
    local.set("since:t1176.example", clearedAt);
    const privateBefore = session.get("privateCounts");
    try {
      const woken = await importModule<Counts>("counts.js?cleared-sites");
      await woken.ready;
      assert.equal(woken.since("t1175.example", false), common);
      assert.deepEqual(woken.totals("t1175.example", false), {
        edge: { blue2: { "GET image": 2 } },
      });
      assert.equal(woken.since("t1176.example", false), clearedAt);
      assert.deepEqual(woken.totals("t1176.example", false), {});
      assert.equal(woken.since("t1176.example", true), 0);
      assert.equal(woken.since(null, false), common);
      assert.equal(local.get("since"), common);
    } finally {
      if (privateBefore !== undefined) {
        session.set("privateCounts", privateBefore);
      }
    }
  });
});

describe("a tab the extension has not seen navigate", () => {
  after(() => {
    frameOf = NO_FRAME;
  });

  function siteCounts(site: string): SiteCounts | undefined {
    return local.get(`site:${site}`) as SiteCounts | undefined;
  }

  function readsOf(tabId: number) {
    return frameReads.filter((read) => read.tabId === tabId);
  }

  async function popup(tabId: number): Promise<PopupData> {
    return (await answer({
      kind: "popup",
      tabId,
      privateWindow: false,
    })) as PopupData;
  }

  // Firefox answers getFrame after the request that made the page ask.
  function answered(): Promise<void> {
    return new Promise((done) => setImmediate(done));
  }

  function frames(entries: Record<number, Frame | Error>): void {
    frameOf = (tabId) => {
      const frame = entries[tabId] ?? null;
      return frame instanceof Error
        ? Promise.reject(frame)
        : Promise.resolve(frame);
    };
  }

  // A frame Firefox gives only when the test lets it.
  function heldFrame(tab: number): (frame: Frame) => void {
    let give: (frame: Frame) => void = () => {};
    frameOf = (tabId) =>
      tabId === tab
        ? new Promise<Frame>((done) => {
            give = done;
          })
        : Promise.resolve(null);
    return (frame) => give(frame);
  }

  it("takes its site from the page Firefox shows in it, once, and counts its requests for that site", async () => {
    const tab = 1400;
    frames({ [tab]: { url: "https://www.t1400.example/live?channel=1" } });
    await exchange(tab, "image", 1100, EDGE_IP);
    await answered();
    await exchange(tab, "script", 1200, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(readsOf(tab), [{ tabId: tab, frameId: 0 }]);
    assert.equal(tabs.recordOf(tab).site, "t1400.example");
    assert.equal(tabs.recordOf(tab).page, "site");
    assert.deepEqual(siteCounts("t1400.example"), {
      edge: { blue2: { "GET image": 1, "GET script": 1 } },
    });
    assert.equal(
      JSON.stringify([...session.values()]).includes("channel"),
      false,
    );
  });

  it("keeps the requests that arrive while Firefox is asked, and counts them once it answers", async () => {
    const tab = 1401;
    const give = heldFrame(tab);
    await exchange(tab, "image", 1100, EDGE_IP);
    await exchange(tab, "image", 1200, EDGE_IP);
    mock.timers.runAll();
    assert.equal(siteCounts("t1401.example"), undefined);
    assert.equal(tabs.recordOf(tab).uncounted.length, 2);
    give({ url: "https://t1401.example/" });
    await answered();
    mock.timers.runAll();
    assert.deepEqual(siteCounts("t1401.example"), {
      edge: { blue2: { "GET image": 2 } },
    });
    assert.deepEqual(tabs.recordOf(tab).uncounted, []);
    assert.equal(readsOf(tab).length, 1);
  });

  it("is a page of the browser when Firefox shows one, such as about:debugging, and counts nothing", async () => {
    const tab = 1402;
    frames({ [tab]: { url: "about:debugging#/runtime/this-firefox" } });
    mock.timers.runAll();
    const writes = localWrites.length;
    await exchange(tab, "image", 1100, EDGE_IP);
    await answered();
    mock.timers.runAll();
    assert.equal(tabs.recordOf(tab).page, "browser");
    assert.equal(tabs.recordOf(tab).site, null);
    assert.equal(localWrites.length, writes);
    const data = await popup(tab);
    assert.equal(data.page, "browser");
    assert.equal(data.site, null);
    const state = data.state;
    assert.equal(
      state.kind === "seen" && !state.missed && !state.partial,
      true,
    );
  });

  it("shows a page of the browser opened before the extension as one it saw commit: neutral, with nothing to count", async () => {
    const tab = 1406;
    frames({ [tab]: { url: "about:debugging#/runtime/this-firefox" } });
    const data = await popup(tab);
    assert.equal(data.page, "browser");
    assert.deepEqual(data.state, {
      kind: "neutral",
      partial: false,
      missed: false,
    });
    const shown = viewOf(
      data,
      [],
      () => "",
      (site) => site,
    );
    assert.deepEqual(shown.header, { kind: "browser-page" });
    assert.equal(shown.icon, "neutral");
    assert.equal(shown.page, null);
    assert.equal(shown.totals, null);
    assert.equal(shown.notice, true);
  });

  it("stays unknown when Firefox gives no frame, as for a discarded tab, and its requests are dropped", async () => {
    const tab = 1403;
    frames({});
    await exchange(tab, "image", 1100, EDGE_IP);
    await answered();
    mock.timers.runAll();
    assert.equal(tabs.recordOf(tab).site, null);
    assert.deepEqual(tabs.recordOf(tab).uncounted, []);
    await exchange(tab, "image", 1200, EDGE_IP);
    await answered();
    assert.equal(readsOf(tab).length, 1);
    const data = await popup(tab);
    assert.equal(data.page, "site");
    assert.equal(data.site, null);
    assert.equal(readsOf(tab).length, 1);
  });

  it("stays unknown when Firefox fails to answer, which is logged once", async () => {
    const tab = 1404;
    frames({ [tab]: new Error(`Invalid tab ID: ${tab}`) });
    const errors = mock.method(console, "error", () => {});
    try {
      await exchange(tab, "image", 1100, EDGE_IP);
      await answered();
      await exchange(tab, "image", 1200, EDGE_IP);
      await answered();
      mock.timers.runAll();
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*Invalid tab ID/,
      );
    } finally {
      errors.mock.restore();
    }
    assert.equal(tabs.recordOf(tab).site, null);
    assert.deepEqual(tabs.recordOf(tab).uncounted, []);
  });

  it("gives no site to the document the tab left when another commits before Firefox answers", async () => {
    const tab = 1405;
    const give = heldFrame(tab);
    await exchange(tab, "image", 1100, EDGE_IP);
    await commit(tab, "doc-1405", 1200, [], "https://t1405.example/");
    give({ url: "https://t1405.example/" });
    await answered();
    mock.timers.runAll();
    const record = tabs.recordOf(tab);
    assert.equal(record.site, "t1405.example");
    assert.equal(record.previous[0]?.site, null);
    assert.deepEqual(record.previous[0]?.uncounted, []);
    assert.equal(siteCounts("t1405.example"), undefined);
  });

  it("is asked by the popup, which answers with the site and the totals Firefox's page gives", async () => {
    const counted = 1410;
    await commit(counted, "doc-1410", 1000, [], "https://t1410.example/");
    await exchange(counted, "image", 1100, EDGE_IP);
    const tab = 1411;
    frames({ [tab]: { url: "https://www.t1410.example/stream" } });
    const data = await popup(tab);
    assert.equal(data.page, "site");
    assert.equal(data.site, "t1410.example");
    assert.deepEqual(data.state, EMPTY_RECORD.state);
    assert.deepEqual(data.totals, { edge: { blue2: { "GET image": 1 } } });
    await popup(tab);
    assert.equal(readsOf(tab).length, 1);
  });
});

describe("the counts of a private session", () => {
  const PRIVATE: SiteCounts = { edge: { blue2: { "GET image": 4 } } };
  const NORMAL = { id: 1, incognito: false };

  after(() => {
    openWindows = [NORMAL];
  });

  // A tab of a private window whose site counted one image.
  async function privateSite(tab: number): Promise<string> {
    const site = `t${tab}.example`;
    await commit(tab, `doc-${tab}`, 1000, [], `https://${site}/`);
    await privateExchange(tab, `private-${tab}`, 1100);
    mock.timers.runAll();
    assert.deepEqual(counts.totals(site, true), {
      edge: { blue2: { "GET image": 1 } },
    });
    return site;
  }

  // Firefox fires windows.onRemoved once the window is gone from
  // windows.getAll (nsAppShellService.cpp, Firefox 159.0.1).
  async function close(id: number): Promise<void> {
    openWindows = (openWindows as { id: number; incognito: boolean }[]).filter(
      (window) => window.id !== id,
    );
    await counts.onWindowRemoved();
  }

  it("stay while a private window is open, and go when the last one closes, leaving the kept counts alone", async () => {
    openWindows = [
      NORMAL,
      { id: 2, incognito: true },
      { id: 3, incognito: true },
    ];
    const site = await privateSite(1180);
    await commit(1181, "doc-1181", 1000, [], "https://t1181.example/");
    await exchange(1181, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    const keptBefore = JSON.stringify([...local.entries()]);
    await close(2);
    assert.notDeepEqual(counts.totals(site, true), {});
    assert.equal(session.has("privateCounts"), true);
    await close(3);
    assert.deepEqual(counts.totals(site, true), {});
    assert.equal(session.has("privateCounts"), false);
    mock.timers.runAll();
    assert.equal(session.has("privateCounts"), false);
    assert.equal(JSON.stringify([...local.entries()]), keptBefore);
    assert.deepEqual(counts.totals("t1181.example", false), {
      edge: { blue2: { "GET image": 1 } },
    });
  });

  it("ask nothing of Firefox when a window closes while the private session counted nothing", async () => {
    const reads = windowReads;
    await counts.onWindowRemoved();
    assert.equal(windowReads, reads);
  });

  it("stay when Firefox cannot list its windows, which is logged", async () => {
    openWindows = [NORMAL, { id: 4, incognito: true }];
    const site = await privateSite(1182);
    openWindows = new Error("NS_ERROR_FAILURE");
    const errors = mock.method(console, "error", () => {});
    try {
      await counts.onWindowRemoved();
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*NS_ERROR_FAILURE/,
      );
    } finally {
      errors.mock.restore();
    }
    assert.notDeepEqual(counts.totals(site, true), {});
    openWindows = [NORMAL];
    await counts.onWindowRemoved();
    assert.deepEqual(counts.totals(site, true), {});
  });

  it("are dropped by the event page through windows.onRemoved, which wakes it when suspended", async () => {
    openWindows = [NORMAL, { id: 5, incognito: true }];
    const site = await privateSite(1183);
    const registered = listeners.get("windows.onRemoved") ?? [];
    assert.equal(registered.length, 1);
    openWindows = [NORMAL];
    registered[0]?.(5);
    await new Promise((done) => setImmediate(done));
    assert.deepEqual(counts.totals(site, true), {});
  });

  // The page reads the counts at each wake-up, and the last private window
  // may have closed while it was suspended.
  for (const [name, windows, expected] of [
    ["go at a wake-up when no private window is open", [NORMAL], {}],
    [
      "stay at a wake-up while a private window is open",
      [NORMAL, { id: 6, incognito: true }],
      PRIVATE,
    ],
    [
      "stay at a wake-up when Firefox cannot list its windows",
      new Error("NS_ERROR_FAILURE"),
      PRIVATE,
    ],
  ] as const) {
    it(name, async () => {
      session.set("privateCounts", { "t1190.example": PRIVATE });
      openWindows = windows instanceof Error ? windows : [...windows];
      const errors = mock.method(console, "error", () => {});
      try {
        const woken = await importModule<Counts>(
          `counts.js?${encodeURIComponent(name)}`,
        );
        await woken.ready;
        assert.deepEqual(woken.totals("t1190.example", true), expected);
        assert.equal(
          session.has("privateCounts"),
          Object.keys(expected).length > 0,
        );
        assert.equal(errors.mock.callCount(), windows instanceof Error ? 1 : 0);
      } finally {
        errors.mock.restore();
        session.delete("privateCounts");
      }
    });
  }
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

  it("answers for a tab it never saw, when Firefox gives no page for it, with an empty record and no totals", async () => {
    assert.deepEqual(await answer(popup), {
      state: EMPTY_RECORD.state,
      page: "site",
      site: null,
      privateWindow: false,
      since: local.get("since"),
      totals: {},
      ignored: false,
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
    assert.equal(answer({ kind: "clear", privateWindow: false }), undefined);
    assert.equal(
      answer({ kind: "clearSite", privateWindow: false }),
      undefined,
    );
    assert.equal(
      answer({ kind: "clearSite", site: "", privateWindow: false }),
      undefined,
    );
    assert.equal(
      answer({ kind: "clearSite", site: 1, privateWindow: false }),
      undefined,
    );
    assert.equal(answer({ kind: "clearSite", site: "a.example" }), undefined);
    assert.equal(
      answer({ kind: "clearSite", site: "a.example", privateWindow: "no" }),
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

describe("a site the user ignores", () => {
  const IGNORED_SHOWN = {
    icon: "/icons/neutral.svg",
    badge: "",
    title: "titleIgnored",
  };

  after(() => {
    frameOf = NO_FRAME;
  });

  async function ignore(host: string): Promise<IgnoredData> {
    return (await answer({ kind: "ignoreSite", host })) as IgnoredData;
  }

  async function unignore(site: string): Promise<IgnoredData> {
    return (await answer({ kind: "unignoreSite", site })) as IgnoredData;
  }

  async function popup(tabId: number, privateWindow = false) {
    return (await answer({
      kind: "popup",
      tabId,
      privateWindow,
    })) as PopupData;
  }

  // A request of the tab to a host whose canonical name is not known yet,
  // such as a library a page loads from a CDN.
  async function exchangeTo(
    host: string,
    tabId: number,
    type: string,
    timeStamp: number,
  ): Promise<void> {
    const requestId = nextId();
    await requests.onSendHeaders({
      tabId,
      requestId,
      type,
      timeStamp,
      url: `https://${host}/lib.js`,
      method: "GET",
      requestHeaders: [],
    });
    await requests.onResponseStarted(
      response(tabId, requestId, type, timeStamp + 1, OTHER_IP),
    );
  }

  function resolutionsOf(host: string): string[] {
    return resolved.filter((entry) => entry === host);
  }

  describe("named by what the user typed", () => {
    const cases: [string, string | null][] = [
      ["www.t1500.example", "t1500.example"],
      ["www.t1500.example:8080", "t1500.example"],
      ["https://www.t1500.example/directory?tab=1#top", "t1500.example"],
      ["wss://chat.t1500.example/socket", "t1500.example"],
      ["  WWW.T1500.Example  ", "t1500.example"],
      ["http:t1500.example", "t1500.example"],
      ["https://user:secret@www.t1500.example/", "t1500.example"],
      ["www.bücher.example", "xn--bcher-kva.example"],
      ["https://www.bücher.example/", "xn--bcher-kva.example"],
      ["192.0.2.7", "192.0.2.7"],
      ["192.0.2.7:8080", "192.0.2.7"],
      ["[2001:db8::1]:8443", "[2001:db8::1]"],
      ["localhost:3000", "localhost"],
      ["", null],
      ["   ", null],
      ["www t1500 example", null],
      ["ftp://files.t1500.example/", null],
      ["file:///home/user/page.html", null],
      ["about:config", null],
      ["javascript:alert(1)", null],
      ["mailto:user@t1500.example", null],
      ["https://", null],
      ["www.t1500.example:99999", null],
      ["2001:db8::1", null],
    ];

    for (const [text, site] of cases) {
      it(`gives ${site ?? "no site"} for ${JSON.stringify(text)}`, () => {
        assert.equal(siteOfTyped(text), site);
      });
    }

    it("is answered with the site it names, kept alone, in storage.local, with the ignored sites in order", async () => {
      const first = await ignore("https://www.t1501b.example/live?channel=1");
      assert.equal(first.site, "t1501b.example");
      const second = await ignore("www.t1501a.example:8080");
      assert.equal(second.site, "t1501a.example");
      assert.deepEqual(second.sites, [...second.sites].sort());
      assert.ok(second.sites.includes("t1501a.example"));
      assert.ok(second.sites.includes("t1501b.example"));
      assert.deepEqual(local.get("ignored"), second.sites);
      assert.equal(JSON.stringify([...local.values()]).includes("live"), false);
      assert.equal(JSON.stringify([...local.values()]).includes("8080"), false);
      const again = await ignore("t1501a.example");
      assert.deepEqual(again.sites, second.sites);
    });

    it("is answered with no site, and changes nothing, when what the user typed names no site", async () => {
      const before = counts.ignoredSites();
      const writes = localWrites.length;
      for (const text of ["", "   ", "ftp://files.example/", "about:config"]) {
        assert.deepEqual(await ignore(text), { sites: before, site: null });
      }
      assert.equal(localWrites.length, writes);
    });
  });

  it("drops every request of a document of the site before it is classified, so that none costs a DNS resolution", async () => {
    const tab = 1510;
    const site = "t1510.example";
    await ignore(site);
    await commit(tab, "doc-1510", 1000, [], `https://www.${site}/`);
    await status(tab);
    mock.timers.runAll();
    const writes = localWrites.length;
    await exchangeTo("cdn1510.example", tab, "script", 1100);
    await exchange(tab, "image", 1200, EDGE_IP, true);
    mock.timers.runAll();
    assert.deepEqual(resolutionsOf("cdn1510.example"), []);
    assert.deepEqual(tabs.recordOf(tab).state, { kind: "ignored" });
    assert.deepEqual(shown(tab), IGNORED_SHOWN);
    assert.equal(local.has(`site:${site}`), false);
    assert.equal(localWrites.length, writes);
    // The same request of a watched page is resolved: the stand-in sees
    // every resolution.
    const watched = 1511;
    await commit(watched, "doc-1511", 1000, [], "https://t1511.example/");
    await exchangeTo("cdn1510.example", watched, "script", 1100);
    assert.deepEqual(resolutionsOf("cdn1510.example"), ["cdn1510.example"]);
  });

  it("drops a request sent before the site was ignored when its response comes after", async () => {
    const tab = 1512;
    const site = "t1512.example";
    await commit(tab, "doc-1512", 1000, [], `https://${site}/`);
    const requestId = nextId();
    await requests.onSendHeaders({
      tabId: tab,
      requestId,
      type: "script",
      timeStamp: 1100,
      url: "https://cdn1512.example/lib.js",
      method: "GET",
      requestHeaders: [],
    });
    await ignore(site);
    await requests.onResponseStarted(
      response(tab, requestId, "script", 1101, OTHER_IP),
    );
    mock.timers.runAll();
    assert.deepEqual(resolutionsOf("cdn1512.example"), []);
    assert.deepEqual(tabs.recordOf(tab).state, { kind: "ignored" });
    assert.equal(local.has(`site:${site}`), false);
  });

  it("drops at the commit the top-level request classified before it, and counts nothing of it", async () => {
    const tab = 1520;
    const site = "t1520.example";
    await ignore(site);
    mock.timers.runAll();
    const writes = localWrites.length;
    await exchange(tab, "main_frame", 2000, EDGE_IP, true);
    await commit(tab, "doc-1520", 2010, [], `https://www.${site}/`);
    await status(tab);
    mock.timers.runAll();
    const record = tabs.recordOf(tab);
    assert.deepEqual(record.state, { kind: "ignored" });
    assert.deepEqual(record.uncounted, []);
    assert.deepEqual(shown(tab), IGNORED_SHOWN);
    assert.equal(local.has(`site:${site}`), false);
    assert.equal(localWrites.length, writes);
  });

  it("drops before it is classified the top-level request whose commit arrived first", async () => {
    const tab = 1521;
    const site = "t1521.example";
    await ignore(site);
    await commit(tab, "doc-1521", 2010, [], `https://www.${site}/`);
    await exchangeTo("main1521.example", tab, "main_frame", 2000);
    mock.timers.runAll();
    assert.deepEqual(resolutionsOf("main1521.example"), []);
    assert.deepEqual(tabs.recordOf(tab).state, { kind: "ignored" });
  });

  it("is decided for a tab the extension has not seen navigate once Firefox gives its site, and drops the requests held for it", async () => {
    const tab = 1530;
    const site = "t1530.example";
    await ignore(site);
    frameOf = (tabId) =>
      Promise.resolve(
        tabId === tab ? { url: `https://www.${site}/live` } : null,
      );
    try {
      mock.timers.runAll();
      const writes = localWrites.length;
      await exchange(tab, "image", 1100, EDGE_IP);
      await new Promise((done) => setImmediate(done));
      mock.timers.runAll();
      const record = tabs.recordOf(tab);
      assert.equal(record.site, site);
      assert.deepEqual(record.state, { kind: "ignored" });
      assert.deepEqual(record.uncounted, []);
      await exchangeTo("cdn1530.example", tab, "script", 1200);
      mock.timers.runAll();
      assert.deepEqual(resolutionsOf("cdn1530.example"), []);
      assert.equal(local.has(`site:${site}`), false);
      assert.equal(localWrites.length, writes);
      const data = await popup(tab);
      assert.equal(data.site, site);
      assert.equal(data.ignored, true);
      assert.deepEqual(data.totals, {});
    } finally {
      frameOf = NO_FRAME;
    }
  });

  it("erases the kept counts of the site, written or not, its own start and its counts of the private session, and nothing of the other sites", async () => {
    const tab = 1540;
    const site = "t1540.example";
    const privateTab = 1541;
    const other = 1542;
    const otherSite = "t1542.example";
    await commit(tab, "doc-1540", 1000, [], `https://${site}/`);
    await commit(privateTab, "doc-1541", 1000, [], `https://${site}/`);
    await commit(other, "doc-1542", 1000, [], `https://${otherSite}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    await answer({ kind: "clearSite", site, privateWindow: false });
    await exchange(tab, "image", 1200, EDGE_IP);
    await exchange(other, "image", 1200, EDGE_IP);
    await privateExchange(privateTab, "private-1541", 1200);
    mock.timers.runAll();
    // Counted, and not yet written.
    await exchange(tab, "script", 1300, EDGE_IP);
    assert.notEqual(local.get(`site:${site}`), undefined);
    assert.notEqual(local.get(`since:${site}`), undefined);
    assert.notEqual(
      (session.get("privateCounts") as Record<string, SiteCounts>)[site],
      undefined,
    );
    const otherBefore = JSON.stringify(local.get(`site:${otherSite}`));
    await ignore(site);
    assert.equal(local.has(`site:${site}`), false);
    assert.equal(local.has(`since:${site}`), false);
    mock.timers.runAll();
    assert.equal(local.has(`site:${site}`), false);
    assert.equal(
      (session.get("privateCounts") as Record<string, SiteCounts>)[site],
      undefined,
    );
    assert.deepEqual(counts.totals(site, false), {});
    assert.deepEqual(counts.totals(site, true), {});
    assert.equal(counts.since(site, false), local.get("since"));
    assert.equal(JSON.stringify(local.get(`site:${otherSite}`)), otherBefore);
    assert.deepEqual(counts.totals(otherSite, false), {
      edge: { blue2: { "GET image": 1 } },
    });
  });

  it("turns at once every tab that shows the site ignored, private windows and pages Back brings back included", async () => {
    const site = "t1550.example";
    const red = 1550;
    await exchange(red, "main_frame", 1000, EDGE_IP, true);
    await commit(red, "doc-1550", 1010, [], `https://www.${site}/`);
    await status(red);
    const left = 1551;
    await commit(left, "doc-1551", 1000, [], `https://${site}/`);
    await exchange(left, "image", 1100, EDGE_IP);
    await commit(left, "doc-1551-b", 2000, [], "https://t1551.example/");
    await status(left);
    const privateTab = 1552;
    await commit(privateTab, "doc-1552", 1000, [], `https://${site}/`);
    await status(privateTab);
    await privateExchange(privateTab, "private-1552", 1100);
    mock.timers.runAll();
    assert.deepEqual(iconOf(red), RED);
    assert.equal(shown(privateTab).icon, "/icons/blue.svg");
    await ignore(site);
    mock.timers.runAll();
    assert.deepEqual(shown(red), IGNORED_SHOWN);
    assert.deepEqual(shown(privateTab), IGNORED_SHOWN);
    assert.equal(shown(left).title, "titleNeutral");
    assert.deepEqual(tabs.recordOf(left).previous[0]?.state, {
      kind: "ignored",
    });
    assert.deepEqual(
      (session.get(`tab:${red}`) as TabRecord | undefined)?.state,
      { kind: "ignored" },
    );
    await commit(left, "doc-1551", 3000, ["forward_back"], `https://${site}/`);
    await status(left);
    assert.deepEqual(shown(left), IGNORED_SHOWN);
    const data = await popup(red);
    assert.equal(data.ignored, true);
    assert.deepEqual(data.state, { kind: "ignored" });
    assert.deepEqual(data.totals, {});
  });

  it("is watched again from nothing: its open pages say they missed requests, and its counts start that day", async () => {
    const tab = 1560;
    const site = "t1560.example";
    await ignore(site);
    await commit(tab, "doc-1560", 1000, [], `https://www.${site}/`);
    await status(tab);
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    const watched = await unignore(site);
    assert.equal(watched.site, site);
    assert.equal(watched.sites.includes(site), false);
    assert.deepEqual(local.get("ignored"), watched.sites);
    mock.timers.runAll();
    assert.deepEqual(shown(tab), {
      icon: "/icons/neutral.svg",
      badge: "",
      title: "titleNeutral\ntitleMissed",
    });
    const today = dayOf(Date.now());
    assert.equal(local.get(`since:${site}`), today);
    assert.deepEqual(local.get(`site:${site}`), {});
    const data = await popup(tab);
    assert.equal(data.ignored, false);
    assert.equal(data.since, today);
    assert.deepEqual(data.totals, {});
    await exchange(tab, "image", 1200, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(local.get(`site:${site}`), {
      edge: { blue2: { "GET image": 1 } },
    });
    assert.equal(shown(tab).badge, "1");
    assert.match(shown(tab).title ?? "", /titleMissed/);
    await commit(tab, "doc-1560-b", 2000, [], `https://www.${site}/next`);
    await status(tab);
    assert.equal(shown(tab).title, "titleNeutral");
  });

  it("changes nothing when the site watched again was not ignored, and keeps its counts", async () => {
    const tab = 1561;
    const site = "t1561.example";
    await commit(tab, "doc-1561", 1000, [], `https://${site}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    mock.timers.runAll();
    const writes = localWrites.length;
    const before = counts.ignoredSites();
    assert.deepEqual(await unignore(site), { sites: before, site });
    assert.equal(localWrites.length, writes);
    assert.deepEqual(local.get(`site:${site}`), {
      edge: { blue2: { "GET image": 1 } },
    });
  });

  it("keeps nothing when the popup clears it", async () => {
    const site = "t1570.example";
    await ignore(site);
    const writes = localWrites.length;
    await answer({ kind: "clearSite", site, privateWindow: false });
    assert.equal(localWrites.length, writes);
    assert.equal(local.has(`since:${site}`), false);
  });

  it("is read back from storage.local at a wake-up", async () => {
    await ignore("t1580.example");
    const privateBefore = session.get("privateCounts");
    try {
      const woken = await importModule<Counts>("counts.js?ignored-sites");
      await woken.ready;
      assert.equal(woken.isIgnored("t1580.example"), true);
      assert.equal(woken.isIgnored("t1561.example"), false);
      assert.equal(woken.isIgnored(null), false);
      assert.deepEqual(woken.ignoredSites(), counts.ignoredSites());
    } finally {
      if (privateBefore !== undefined) {
        session.set("privateCounts", privateBefore);
      }
    }
  });

  it("lists the ignored sites, in order", async () => {
    const listed = (await answer({ kind: "ignoredSites" })) as IgnoredData;
    assert.deepEqual(listed, { sites: counts.ignoredSites(), site: null });
    assert.deepEqual(listed.sites, [...listed.sites].sort());
    assert.ok(listed.sites.includes("t1580.example"));
  });

  it("answers no message of another shape", () => {
    assert.equal(answer({ kind: "ignoreSite" }), undefined);
    assert.equal(answer({ kind: "ignoreSite", host: 1 }), undefined);
    assert.equal(answer({ kind: "ignoreSite", host: null }), undefined);
    assert.equal(answer({ kind: "unignoreSite" }), undefined);
    assert.equal(answer({ kind: "unignoreSite", site: "" }), undefined);
    assert.equal(answer({ kind: "unignoreSite", site: 1 }), undefined);
    assert.equal(answer({ kind: "ignored" }), undefined);
  });
});

// Last, since purging every site leaves nothing of what the tests above
// counted.
describe("the map", () => {
  async function map(privateWindow: boolean): Promise<MapData> {
    return (await answer({ kind: "map", privateWindow })) as MapData;
  }

  async function popup(tab: number, privateWindow = false): Promise<PopupData> {
    return (await answer({
      kind: "popup",
      tabId: tab,
      privateWindow,
    })) as PopupData;
  }

  function storedSites(): string[] {
    return [...local.keys()].filter(
      (key) => key.startsWith("site:") || key.startsWith("since:"),
    );
  }

  it("is answered with the kept counts of every site, their start and the start of each site cleared alone", async () => {
    const tab = 1700;
    const site = "t1700.example";
    await commit(tab, "doc-1700", 1000, [], `https://${site}/`);
    await exchange(tab, "image", 1100, EDGE_IP);
    await answer({
      kind: "clearSite",
      site: "t1701.example",
      privateWindow: false,
    });
    const data = await map(false);
    assert.equal(data.privateWindow, false);
    assert.equal(data.since, local.get("since"));
    assert.deepEqual(data.sites[site], { edge: { blue2: { "GET image": 1 } } });
    assert.equal(
      data.siteSince["t1701.example"],
      local.get("since:t1701.example"),
    );
    assert.equal(data.siteSince[site], undefined);
    for (const ignored of counts.ignoredSites()) {
      assert.equal(data.sites[ignored], undefined, ignored);
    }
  });

  it("is answered in a private window with the counts of the private session only, without a date", async () => {
    const tab = 1710;
    const site = "t1710.example";
    await commit(tab, "doc-1710", 1000, [], `https://${site}/`);
    await privateExchange(tab, "private-1710", 1100);
    const data = await map(true);
    assert.equal(data.privateWindow, true);
    assert.equal(data.since, 0);
    assert.deepEqual(data.siteSince, {});
    assert.deepEqual(data.sites[site], { edge: { blue2: { "GET image": 1 } } });
    assert.equal(data.sites["t1700.example"], undefined);
    assert.equal((await map(false)).sites[site], undefined);
  });

  it("purges in a private window the counts of the private session only, and nothing of the kept counts", async () => {
    const tab = 1720;
    await commit(tab, "doc-1720", 1000, [], "https://t1720.example/");
    await privateExchange(tab, "private-1720", 1100);
    mock.timers.runAll();
    assert.ok(Object.keys((await map(true)).sites).length > 0);
    const keptBefore = JSON.stringify([...local.entries()]);
    const writes = localWrites.length;
    const ignoredBefore = counts.ignoredSites();
    const purged = (await answer({
      kind: "purgeAll",
      privateWindow: true,
    })) as ClearedData;
    assert.equal(purged.since, 0);
    assert.deepEqual((await map(true)).sites, {});
    assert.equal(session.has("privateCounts"), false);
    mock.timers.runAll();
    assert.equal(localWrites.length, writes);
    assert.equal(JSON.stringify([...local.entries()]), keptBefore);
    assert.deepEqual(counts.ignoredSites(), ignoredBefore);
    assert.ok(Object.keys((await map(false)).sites).length > 0);
    // The private session counts again at once.
    await privateExchange(tab, "private-1720-b", 1200);
    assert.deepEqual((await map(true)).sites["t1720.example"], {
      edge: { blue2: { "GET image": 1 } },
    });
  });

  it("purges every kept count, written or not, and the start of each site cleared alone, and starts again that day for every site", async () => {
    const written = 1730;
    const pending = 1731;
    const privateTab = 1732;
    await commit(written, "doc-1730", 1000, [], "https://t1730.example/");
    await commit(pending, "doc-1731", 1000, [], "https://t1731.example/");
    await commit(privateTab, "doc-1732", 1000, [], "https://t1732.example/");
    await exchange(written, "image", 1100, EDGE_IP);
    await privateExchange(privateTab, "private-1732", 1100);
    await answer({
      kind: "clearSite",
      site: "t1733.example",
      privateWindow: false,
    });
    // Two days later, with a count not yet written.
    mock.timers.tick(2 * 86_400_000);
    await exchange(pending, "image", 1200, EDGE_IP);
    assert.ok(storedSites().includes("site:t1730.example"));
    assert.ok(storedSites().includes("since:t1733.example"));
    assert.equal(local.has("site:t1731.example"), false);
    // A site stored and no longer in memory, as when the read at the wake-up
    // failed.
    local.set("site:t1734.example", { edge: { blue2: { "GET image": 3 } } });
    local.set("since:t1735.example", INSTALLED_AT);
    const ignoredBefore = local.get("ignored");
    assert.ok(Array.isArray(ignoredBefore) && ignoredBefore.length > 0);
    const privateBefore = JSON.stringify(session.get("privateCounts"));
    const today = dayOf(Date.now());
    assert.notEqual(today, local.get("since"));
    const writes = localWrites.length;

    const purged = (await answer({
      kind: "purgeAll",
      privateWindow: false,
    })) as ClearedData;
    assert.equal(purged.since, today);
    assert.equal(local.get("since"), today);
    assert.deepEqual(storedSites(), []);
    assert.deepEqual(local.get("ignored"), ignoredBefore);
    assert.deepEqual(counts.ignoredSites(), ignoredBefore);
    // The new start and the emptied counts in one transaction.
    const write = localWrites[writes] ?? {};
    assert.equal(localWrites.length, writes + 1);
    assert.equal(write["since"], today);
    assert.deepEqual(write["site:t1730.example"], {});
    assert.deepEqual(write["site:t1731.example"], {});
    assert.deepEqual(write["site:t1734.example"], {});
    assert.equal(write["since:t1733.example"], today);
    assert.equal(write["since:t1735.example"], today);
    assert.equal(write["ignored"], undefined);
    assert.equal(JSON.stringify(session.get("privateCounts")), privateBefore);

    const data = await map(false);
    assert.deepEqual(data, {
      privateWindow: false,
      since: today,
      siteSince: {},
      sites: {},
    });
    assert.ok(Object.keys((await map(true)).sites).includes("t1732.example"));
    const shown = await popup(written);
    assert.equal(shown.since, today);
    assert.deepEqual(shown.totals, {});
    // The write pending since before the purge brings nothing back.
    mock.timers.runAll();
    assert.deepEqual(storedSites(), []);
    // A request counted after the purge is kept, from the new start.
    await exchange(written, "image", 1300, EDGE_IP);
    mock.timers.runAll();
    assert.deepEqual(local.get("site:t1730.example"), {
      edge: { blue2: { "GET image": 1 } },
    });
    assert.equal((await popup(written)).since, today);
  });

  it("starts at a wake-up from the start the purge wrote", async () => {
    const privateBefore = session.get("privateCounts");
    try {
      const woken = await importModule<Counts>("counts.js?purged");
      await woken.ready;
      assert.equal(woken.since("t1730.example", false), local.get("since"));
      assert.equal(woken.since("t1733.example", false), local.get("since"));
      assert.equal(woken.since(null, false), local.get("since"));
    } finally {
      if (privateBefore !== undefined) {
        session.set("privateCounts", privateBefore);
      }
    }
  });

  it("answers no map or purge of another shape", () => {
    assert.equal(answer({ kind: "map" }), undefined);
    assert.equal(answer({ kind: "map", privateWindow: "no" }), undefined);
    assert.equal(answer({ kind: "map", privateWindow: 0 }), undefined);
    assert.equal(answer({ kind: "purgeAll" }), undefined);
    assert.equal(answer({ kind: "purgeAll", privateWindow: null }), undefined);
    assert.equal(answer({ kind: "purge", privateWindow: false }), undefined);
    assert.equal(answer({ kind: "clearAll", privateWindow: false }), undefined);
  });
});

describe("the recording of addresses", () => {
  const SECRET = "s3cr3t-value";
  let at = 2000;

  // Every promise already settled has run its callbacks, such as a read of
  // storage.local the stand-in answered at once.
  function settled(): Promise<void> {
    return new Promise((done) => setImmediate(done));
  }

  async function flush(): Promise<void> {
    await settled();
    mock.timers.runAll();
    await settled();
  }

  async function settings(): Promise<Settings> {
    return (await answer({ kind: "settings" })) as Settings;
  }

  async function setSettings(
    record: string,
    recordLimit: number,
  ): Promise<Settings> {
    return (await answer({
      kind: "setSettings",
      record,
      recordLimit,
    })) as Settings;
  }

  async function addressesOf(
    site: string,
    privateWindow = false,
  ): Promise<SiteAddresses> {
    return (await answer({
      kind: "siteAddresses",
      site,
      privateWindow,
    })) as SiteAddresses;
  }

  function stored(site: string): unknown {
    return local.get(`addresses:${site}`);
  }

  function addressKeys(): string[] {
    return [...local.keys()].filter((key) => key.startsWith("addresses:"));
  }

  // A tab that shows a page of the site, committed.
  async function page(tab: number, site: string): Promise<void> {
    await commit(tab, `doc-${tab}`, 1000, [], `https://${site}/`);
  }

  // A request of the page through the edge, which proves the decryption
  // unless told otherwise: with a session cookie it is of level 4, and
  // without one, an XMLHttpRequest is of level 3 and an image of level 2.
  async function load(
    tab: number,
    url: string,
    options: {
      readonly type?: string;
      readonly method?: string;
      readonly cookie?: boolean;
      readonly proven?: boolean;
      readonly privateWindow?: boolean;
    } = {},
  ): Promise<void> {
    const {
      type = "xmlhttprequest",
      method = "GET",
      cookie = false,
      proven = true,
      privateWindow = false,
    } = options;
    const requestId = nextId();
    at += 10;
    const incognito = privateWindow ? { incognito: true } : {};
    await requests.onSendHeaders({
      tabId: tab,
      requestId,
      type,
      timeStamp: at,
      url,
      method,
      requestHeaders: cookie
        ? [{ name: "Cookie", value: `sid=${SECRET}` }]
        : [],
      ...incognito,
    });
    await requests.onResponseStarted({
      tabId: tab,
      requestId,
      type,
      timeStamp: at + 1,
      ip: EDGE_IP,
      fromCache: false,
      statusCode: 200,
      responseHeaders: proven ? [{ name: "x-edge", value: "1" }] : [],
      ...incognito,
    });
  }

  function holdsNoSecret(): void {
    const everything = JSON.stringify([
      ...local.entries(),
      ...session.entries(),
    ]);
    assert.equal(everything.includes(SECRET), false);
    assert.equal(everything.includes("#"), false);
  }

  after(async () => {
    await setSettings("none", 100);
  });

  it("records nothing by default, and keeps 100 addresses per row once on", async () => {
    assert.deepEqual(await settings(), { record: "none", recordLimit: 100 });
    const tab = 2300;
    const site = "t2300.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me?token=${SECRET}`, { cookie: true });
    await load(tab, `https://api.${site}/list`);
    await flush();
    assert.deepEqual(local.get(`site:${site}`), {
      edge: {
        red4: { "GET xmlhttprequest": 1 },
        red3: { "GET xmlhttprequest": 1 },
      },
    });
    assert.deepEqual(addressKeys(), []);
    assert.deepEqual(await addressesOf(site), {});
    assert.equal(JSON.stringify(tabs.recordOf(tab)).includes("address"), false);
    holdsNoSecret();
  });

  it("answers no settings request of another shape, and brings the limit into its range", async () => {
    for (const message of [
      { kind: "setSettings", record: "all", recordLimit: 10 },
      { kind: "setSettings", record: "level 4", recordLimit: 10 },
      { kind: "setSettings", recordLimit: 10 },
      { kind: "setSettings", record: "level4" },
      { kind: "setSettings", record: "level4", recordLimit: "10" },
      { kind: "setSettings", record: "level4", recordLimit: Number.NaN },
      { kind: "setSettings", record: "level4", recordLimit: null },
      { kind: "setting" },
      { kind: "siteAddresses", site: "t2300.example" },
      { kind: "siteAddresses", site: "", privateWindow: false },
      { kind: "siteAddresses", site: 2300, privateWindow: false },
      { kind: "siteAddresses", site: "t2300.example", privateWindow: "no" },
    ]) {
      assert.equal(answer(message), undefined, JSON.stringify(message));
    }
    assert.deepEqual(await settings(), { record: "none", recordLimit: 100 });
    for (const [limit, kept] of [
      [0, 1],
      [-3, 1],
      [5000, 1000],
      [2.5, 3],
      [100, 100],
    ] as const) {
      assert.deepEqual(await setSettings("none", limit), {
        record: "none",
        recordLimit: kept,
      });
      assert.deepEqual(local.get("settings"), {
        record: "none",
        recordLimit: kept,
      });
    }
    assert.deepEqual(await settings(), { record: "none", recordLimit: 100 });
  });

  it("records at level 4 the reduced address of each request of level 4, red or orange, once, the most recent first, and nothing of levels 3 and 2", async () => {
    const writes = localWrites.length;
    assert.deepEqual(await setSettings("level4", 100), {
      record: "level4",
      recordLimit: 100,
    });
    assert.equal(localWrites.length, writes + 1);
    assert.deepEqual(Object.keys(localWrites[writes] ?? {}), ["settings"]);
    const tab = 2310;
    const site = "t2310.example";
    await page(tab, site);
    const me = `https://api.${site}/v1/me?token=${SECRET}#${SECRET}`;
    await load(tab, me, { cookie: true });
    await load(
      tab,
      `https://user:${SECRET}@api.${site}:8443/v1/save?id=${SECRET}&flag`,
      { method: "POST", proven: false },
    );
    await load(tab, `https://api.${site}/v1/list?page=${SECRET}`);
    await load(tab, `https://cdn.${site}/logo.png?v=${SECRET}`, {
      type: "image",
      cookie: false,
    });
    await load(tab, me, { cookie: true });
    await load(tab, `https://api.${site}/v1/other`, { cookie: true });
    await load(tab, me, { cookie: true });
    const expected = {
      edge: {
        red4: {
          "GET xmlhttprequest": [
            `https://api.${site}/v1/me?token=…`,
            `https://api.${site}/v1/other`,
          ],
        },
        orange4: {
          "POST xmlhttprequest": [`https://api.${site}:8443/v1/save?id=…&flag`],
        },
      },
    };
    assert.deepEqual(await addressesOf(site), expected);
    await flush();
    assert.deepEqual(stored(site), expected);
    assert.deepEqual(local.get(`site:${site}`), {
      edge: {
        red4: { "GET xmlhttprequest": 4 },
        orange4: { "POST xmlhttprequest": 1 },
        red3: { "GET xmlhttprequest": 1 },
        blue2: { "GET image": 1 },
      },
    });
    holdsNoSecret();
  });

  it("records at levels 3 and 4 the addresses of both, and never those of level 2", async () => {
    await setSettings("level3and4", 100);
    const tab = 2320;
    const site = "t2320.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/list?page=2`);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await load(tab, `https://cdn.${site}/logo.png`, { type: "image" });
    await load(tab, `https://cdn.${site}/app.js`, { type: "script" });
    await flush();
    assert.deepEqual(stored(site), {
      edge: {
        red3: { "GET xmlhttprequest": [`https://api.${site}/list?page=…`] },
        red4: { "GET xmlhttprequest": [`https://api.${site}/me`] },
      },
    });
  });

  it("writes the addresses under a key of their own, in the same write as the counts of the burst, and again only when they change", async () => {
    await setSettings("level4", 100);
    const tab = 2330;
    const site = "t2330.example";
    await page(tab, site);
    await flush();
    let writes = localWrites.length;
    for (const path of ["/a", "/b", "/a"]) {
      await load(tab, `https://api.${site}${path}`, { cookie: true });
    }
    await load(tab, `https://cdn.${site}/logo.png`, { type: "image" });
    await settled();
    assert.equal(localWrites.length, writes);
    mock.timers.runAll();
    assert.equal(localWrites.length, writes + 1);
    const write = localWrites[writes] ?? {};
    assert.deepEqual(write[`site:${site}`], {
      edge: {
        red4: { "GET xmlhttprequest": 3 },
        blue2: { "GET image": 1 },
      },
    });
    assert.deepEqual(write[`addresses:${site}`], {
      edge: {
        red4: {
          "GET xmlhttprequest": [
            `https://api.${site}/a`,
            `https://api.${site}/b`,
          ],
        },
      },
    });
    assert.deepEqual(Object.keys(write).sort(), [
      `addresses:${site}`,
      `site:${site}`,
    ]);
    writes = localWrites.length;
    await load(tab, `https://api.${site}/a`, { cookie: true });
    await flush();
    assert.equal(localWrites.length, writes + 1);
    assert.deepEqual(Object.keys(localWrites[writes] ?? {}), [`site:${site}`]);
  });

  it("keeps at most the limit in each row, the oldest dropped, and trims every kept row at once when the limit falls", async () => {
    await setSettings("level3and4", 3);
    const tab = 2340;
    const site = "t2340.example";
    await page(tab, site);
    for (const path of ["/1", "/2", "/3", "/4"]) {
      await load(tab, `https://api.${site}${path}`, { cookie: true });
    }
    await load(tab, `https://api.${site}/list`);
    await flush();
    assert.deepEqual(stored(site), {
      edge: {
        red4: {
          "GET xmlhttprequest": [
            `https://api.${site}/4`,
            `https://api.${site}/3`,
            `https://api.${site}/2`,
          ],
        },
        red3: { "GET xmlhttprequest": [`https://api.${site}/list`] },
      },
    });
    // A site this run of the page has not read.
    const unread = "t2341.example";
    local.set(`addresses:${unread}`, {
      edge: { orange4: { "POST xmlhttprequest": ["/c", "/b", "/a"] } },
    });
    const writes = localWrites.length;
    assert.deepEqual(await setSettings("level3and4", 1), {
      record: "level3and4",
      recordLimit: 1,
    });
    assert.equal(localWrites.length, writes + 1);
    const write = localWrites[writes] ?? {};
    assert.deepEqual(write["settings"], {
      record: "level3and4",
      recordLimit: 1,
    });
    assert.deepEqual(write[`addresses:${site}`], {
      edge: {
        red4: { "GET xmlhttprequest": [`https://api.${site}/4`] },
        red3: { "GET xmlhttprequest": [`https://api.${site}/list`] },
      },
    });
    assert.deepEqual(write[`addresses:${unread}`], {
      edge: { orange4: { "POST xmlhttprequest": ["/c"] } },
    });
    assert.deepEqual(stored(unread), write[`addresses:${unread}`]);
    await load(tab, `https://api.${site}/5`, { cookie: true });
    await flush();
    assert.deepEqual(
      (stored(site) as SiteAddresses)["edge"]?.red4?.["GET xmlhttprequest"],
      [`https://api.${site}/5`],
    );
    // A higher limit drops nothing.
    const before = JSON.stringify([...local.entries()]);
    await setSettings("level3and4", 50);
    assert.equal(
      JSON.stringify(
        [...local.entries()].filter(([key]) => key !== "settings"),
      ),
      JSON.stringify(
        (JSON.parse(before) as [string, unknown][]).filter(
          ([key]) => key !== "settings",
        ),
      ),
    );
  });

  it("drops at once every kept address of level 3 when the recording narrows to level 4", async () => {
    await setSettings("level3and4", 100);
    const tab = 2350;
    const site = "t2350.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/list`);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await flush();
    const unread = "t2351.example";
    local.set(`addresses:${unread}`, {
      edge: { orange3: { "GET xmlhttprequest": ["/list"] } },
    });
    await setSettings("level4", 100);
    assert.deepEqual(stored(site), {
      edge: { red4: { "GET xmlhttprequest": [`https://api.${site}/me`] } },
    });
    assert.deepEqual(stored(unread), {});
    for (const key of addressKeys()) {
      const categories = Object.values(local.get(key) as SiteAddresses).flatMap(
        (byCategory) => Object.keys(byCategory),
      );
      assert.equal(
        categories.some((category) => category.endsWith("3")),
        false,
        key,
      );
    }
    assert.deepEqual(await addressesOf(site), {
      edge: { red4: { "GET xmlhttprequest": [`https://api.${site}/me`] } },
    });
    // A request of level 3 is no longer recorded.
    await load(tab, `https://api.${site}/list`);
    await flush();
    assert.deepEqual(stored(site), {
      edge: { red4: { "GET xmlhttprequest": [`https://api.${site}/me`] } },
    });
  });

  it("never records a request of a private window, and answers no address there", async () => {
    await setSettings("level3and4", 100);
    const tab = 2360;
    const site = "t2360.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me?token=${SECRET}`, {
      cookie: true,
      privateWindow: true,
    });
    await load(tab, `https://api.${site}/list`, { privateWindow: true });
    await flush();
    assert.equal(stored(site), undefined);
    assert.equal(local.has(`site:${site}`), false);
    assert.deepEqual(counts.totals(site, true), {
      edge: {
        red4: { "GET xmlhttprequest": 1 },
        red3: { "GET xmlhttprequest": 1 },
      },
    });
    assert.deepEqual(await addressesOf(site, true), {});
    assert.deepEqual(await addressesOf("t2350.example", true), {});
    assert.ok(Object.keys(await addressesOf("t2350.example")).length > 0);
    holdsNoSecret();
  });

  it("purges the addresses of a site with its counts, in the same write, when the site is cleared, and leaves the other sites alone", async () => {
    await setSettings("level4", 100);
    const tab = 2370;
    const site = "t2370.example";
    const other = 2371;
    const otherSite = "t2371.example";
    await page(tab, site);
    await page(other, otherSite);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await load(other, `https://api.${otherSite}/me`, { cookie: true });
    await flush();
    const otherBefore = JSON.stringify(stored(otherSite));
    // Recorded, and not yet written.
    await load(tab, `https://api.${site}/later`, { cookie: true });
    const writes = localWrites.length;
    await answer({ kind: "clearSite", site, privateWindow: false });
    const write = localWrites[writes] ?? {};
    assert.deepEqual(write[`site:${site}`], {});
    assert.deepEqual(write[`addresses:${site}`], {});
    assert.equal(local.has(`addresses:${site}`), false);
    assert.deepEqual(await addressesOf(site), {});
    await flush();
    assert.equal(local.has(`addresses:${site}`), false);
    assert.equal(JSON.stringify(stored(otherSite)), otherBefore);
    // A clear in a private window leaves the kept addresses alone.
    await answer({ kind: "clearSite", site: otherSite, privateWindow: true });
    assert.equal(JSON.stringify(stored(otherSite)), otherBefore);
    // The site records again from nothing.
    await load(tab, `https://api.${site}/again`, { cookie: true });
    await flush();
    assert.deepEqual(stored(site), {
      edge: { red4: { "GET xmlhttprequest": [`https://api.${site}/again`] } },
    });
  });

  it("brings nothing back from a read of the addresses that a clear overtakes", async () => {
    await setSettings("level4", 100);
    const tab = 2375;
    const site = "t2375.example";
    await page(tab, site);
    local.set(`addresses:${site}`, {
      edge: { red4: { "GET xmlhttprequest": ["/before"] } },
    });
    let open = () => {};
    localReadGate = new Promise<void>((done) => {
      open = done;
    });
    try {
      await load(tab, `https://api.${site}/during`, { cookie: true });
      assert.ok(localReads.at(-1)?.includes(`addresses:${site}`));
      await answer({ kind: "clearSite", site, privateWindow: false });
    } finally {
      localReadGate = null;
      open();
    }
    await flush();
    assert.equal(local.has(`addresses:${site}`), false);
    assert.deepEqual(await addressesOf(site), {});
  });

  it("purges the addresses of a site the user ignores", async () => {
    await setSettings("level4", 100);
    const tab = 2380;
    const site = "t2380.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await flush();
    assert.notEqual(stored(site), undefined);
    const writes = localWrites.length;
    await answer({ kind: "ignoreSite", host: site });
    assert.deepEqual(localWrites[writes]?.[`addresses:${site}`], {});
    assert.equal(local.has(`addresses:${site}`), false);
    assert.deepEqual(await addressesOf(site), {});
    await answer({ kind: "unignoreSite", site });
    assert.deepEqual(await addressesOf(site), {});
  });

  it("purges every kept address with every kept count, and none from a private window", async () => {
    await setSettings("level4", 100);
    const tab = 2390;
    const site = "t2390.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await flush();
    local.set("addresses:t2391.example", {
      edge: { red4: { "GET xmlhttprequest": ["/x"] } },
    });
    const keysBefore = addressKeys();
    assert.ok(keysBefore.length >= 2);
    await answer({ kind: "purgeAll", privateWindow: true });
    assert.deepEqual(addressKeys(), keysBefore);
    const writes = localWrites.length;
    const reads = localReads.length;
    await answer({ kind: "purgeAll", privateWindow: false });
    // Found without reading every value into the page.
    assert.equal(localReads.slice(reads).includes(null), false);
    const write = localWrites[writes] ?? {};
    for (const key of keysBefore) {
      assert.deepEqual(write[key], {}, key);
    }
    assert.deepEqual(addressKeys(), []);
    assert.deepEqual(await addressesOf(site), {});
    await load(tab, `https://api.${site}/after`, { cookie: true });
    await flush();
    assert.deepEqual(stored(site), {
      edge: { red4: { "GET xmlhttprequest": [`https://api.${site}/after`] } },
    });
  });

  it("reads at a wake-up the settings and every count at once, and the addresses of a site when they are asked", async () => {
    await setSettings("level4", 100);
    const tab = 2400;
    const site = "t2400.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await answer({
      kind: "clearSite",
      site: "t2401.example",
      privateWindow: false,
    });
    await flush();
    assert.ok(addressKeys().length > 0);
    const reads = localReads.length;
    const woken = await importModule<Counts>("counts.js?recording");
    await woken.ready;
    assert.deepEqual(localReads.slice(reads), [null]);
    assert.deepEqual(woken.currentSettings(), {
      record: "level4",
      recordLimit: 100,
    });
    assert.deepEqual(woken.totals(site, false), local.get(`site:${site}`));
    assert.equal(
      woken.since("t2401.example", false),
      local.get("since:t2401.example"),
    );
    assert.deepEqual(await woken.siteAddresses(site, false), stored(site));
    assert.deepEqual(localReads.at(-1), `addresses:${site}`);
  });

  it("purges every kept address at once when the recording is turned off, then records nothing", async () => {
    await setSettings("level3and4", 100);
    const tab = 2410;
    const site = "t2410.example";
    await page(tab, site);
    await load(tab, `https://api.${site}/me`, { cookie: true });
    await flush();
    local.set("addresses:t2411.example", {
      edge: { red4: { "GET xmlhttprequest": ["/x"] } },
    });
    // Recorded, and not yet written.
    await load(tab, `https://api.${site}/pending`, { cookie: true });
    const keysBefore = addressKeys();
    assert.ok(keysBefore.length >= 2);
    const writes = localWrites.length;
    assert.deepEqual(await setSettings("none", 100), {
      record: "none",
      recordLimit: 100,
    });
    const write = localWrites[writes] ?? {};
    assert.deepEqual(write["settings"], { record: "none", recordLimit: 100 });
    for (const key of keysBefore) {
      assert.deepEqual(write[key], {}, key);
    }
    assert.deepEqual(addressKeys(), []);
    await flush();
    assert.deepEqual(addressKeys(), []);
    assert.deepEqual(await addressesOf(site), {});
    await load(tab, `https://api.${site}/off`, { cookie: true });
    await flush();
    assert.deepEqual(addressKeys(), []);
    const woken = await importModule<Counts>("counts.js?recording-off");
    await woken.ready;
    assert.deepEqual(woken.currentSettings(), {
      record: "none",
      recordLimit: 100,
    });
  });
});

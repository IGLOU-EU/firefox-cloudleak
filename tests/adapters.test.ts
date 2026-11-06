// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The adapters, compiled with the extension into build/extension/, driven by
// a stand-in for Firefox's browser object. This proves what the code does
// with a sequence of events, not that Firefox sends them so: the owner's
// trial in Firefox does.

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { describe, it, mock } from "node:test";
import type {
  ProviderEntry,
  ProviderTable,
} from "../src/core/provider-table.js";
import type { TabRecord } from "../src/core/tab-record.js";

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
  onStatus(tabId: number, tab: object): Promise<void>;
  forget(tabId: number): Promise<void>;
}

interface Cname {
  canonicalNameOf(host: string, now: number): Promise<string | null>;
}

const EDGE: ProviderEntry = {
  id: "edge",
  name: "Edge",
  country: "US",
  parent: null,
  ranges: ["192.0.2.0/24"],
  headers: [{ name: "x-edge", value: null }],
  cookies: [],
  siteConnectorCookies: [],
  server: [],
  cname: ["edge.example.net"],
  challengeHosts: [],
  challengePaths: [],
  challengeHeaders: [],
  challengeQueryNames: [],
};
const TABLE: ProviderTable = { providers: [EDGE], consentCookies: [] };
const EDGE_IP = "192.0.2.10";
const OTHER_IP = "203.0.113.1";

// A tab the page held before it was suspended, and whose closing woke it.
const CLOSED_AT_WAKE_UP = 900;
const STORED: TabRecord = {
  document: "doc-900",
  shownAt: 100,
  navigation: "r900",
  state: { kind: "neutral", partial: false, missed: false },
  previous: [],
};

interface Call {
  readonly tabId: number;
  readonly kind: "icon" | "badge" | "title";
  readonly value: string;
}

const calls: Call[] = [];
const session = new Map<string, unknown>([
  [`tab:${CLOSED_AT_WAKE_UP}`, STORED],
]);
const resolved: string[] = [];
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

(globalThis as Record<string, unknown>)["browser"] = {
  storage: {
    session: {
      get: () => {
        const items = Object.fromEntries(session);
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
  },
  permissions: { contains: () => Promise.resolve(true) },
  tabs: { query: () => Promise.resolve([]) },
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
};

const extension = new URL("../extension/", import.meta.url);
writeFileSync(
  new URL("providers.js", extension),
  `export default ${JSON.stringify(TABLE)};\n`,
);
mock.timers.enable({ apis: ["setTimeout"] });

async function importModule<T>(file: string): Promise<T> {
  return (await import(new URL(file, extension).href)) as T;
}

const tabs = await importModule<Tabs>("tabs.js");
const requests = await importModule<Requests>("requests.js");
const cname = await importModule<Cname>("cname.js");

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
): Promise<void> {
  await tabs.onCommitted({
    tabId,
    frameId: 0,
    documentId,
    timeStamp,
    transitionQualifiers,
  });
}

async function status(tabId: number): Promise<void> {
  await tabs.onStatus(tabId, { id: tabId, url: "https://site.example/" });
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
    await commit(tab, "doc-file", 2000, ["from_address_bar"]);
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

  it("sends every value at each change of the tab's status, since Firefox clears them for a new document", async () => {
    const tab = 401;
    await redPage(tab, 1000);
    const mark = calls.length;
    await status(tab);
    assert.deepEqual(sentSince(tab, mark), ["icon", "badge", "title"]);
    assert.deepEqual({ icon: shown(tab).icon, badge: shown(tab).badge }, RED);
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

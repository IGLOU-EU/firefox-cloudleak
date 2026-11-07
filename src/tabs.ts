// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { hasAllSites, readAccess } from "./access.js";
import { batch, WRITE_DELAY_MS } from "./batch.js";
import type { SeenRequest } from "./core/counts.js";
import { displayOf } from "./core/display.js";
import {
  displayedDocument,
  EMPTY_RECORD,
  foldRequest,
  markHiddenSite,
  markMissedRequest,
  markPartialView,
  type Page,
  showCompletedDocument,
  showDocument,
  startNavigation,
  type TabRecord,
  takeCountable,
} from "./core/tab-record.js";
import { count, ready as countsReady } from "./counts.js";
import table from "./providers.js";
import { siteOf } from "./site.js";
import { forgetSent, render, report } from "./toolbar.js";

// Firefox suspends the event page after 30 s without an event and its memory
// goes with it, so the tabs live in storage.session, which stays in memory
// and never reaches the disk. Private windows are kept the same way. Only
// the kept counts, by site, go to storage.local (counts.ts).
const PREFIX = "tab:";

// Every request changes the counts of its tab, so the toolbar is updated
// once per burst of requests rather than once per request, soon enough to
// look immediate.
const SHOW_DELAY_MS = 100;

const records = new Map<number, TabRecord>();

// Firefox sends the closing of a tab at once and the request events in
// batches, up to 250 ms late, so events of a closed tab still arrive after
// it. It never gives a closed tab's id to another tab (ConduitsParent.sys.mjs
// and ext-browser.js, Firefox 159.0.1), so a closed tab stays closed for the
// life of the page.
const closed = new Set<number>();

// Every change waits for this, so that the tabs read at the wake-up are not
// overwritten by the first event that woke the page, and so that the counts
// a change feeds are read too.
export const ready: Promise<void> = Promise.all([
  browser.storage.session.get(null).then(
    (items) => {
      for (const [key, value] of Object.entries(items)) {
        const tabId = Number(key.slice(PREFIX.length));
        if (key.startsWith(PREFIX) && Number.isInteger(tabId)) {
          records.set(tabId, value as TabRecord);
        }
      }
    },
    (error: unknown) => {
      console.error(`Cloud Leak: tab states not read: ${String(error)}`);
    },
  ),
  readAccess(),
  countsReady,
]).then(() => undefined);

export function recordOf(tabId: number): TabRecord {
  return records.get(tabId) ?? EMPTY_RECORD;
}

export function navigate(
  tabId: number,
  navigation: string,
  sentAt: number,
): void {
  update(tabId, (record) =>
    startNavigation(record, navigation, !hasAllSites(), sentAt),
  );
}

// The webNavigation types stop at Firefox 143, while Firefox gives the
// documentId of a frame's document from 153 on (browser-compat-data,
// webextensions.api.webNavigation.onCommitted.documentId), and gives none
// only to a frame left without a document (ExtensionDocumentId.sys.mjs,
// Firefox 159.0.1).
type DocumentDetails = {
  readonly tabId: number;
  readonly frameId: number;
  readonly timeStamp: number;
  readonly documentId?: string;
  // "forward_back" for Back and Forward (ext-webNavigation.js, Firefox
  // 159.0.1). onCompleted gives none.
  readonly transitionQualifiers?: readonly string[];
  // Only its scheme, the name of an about: page and the host of a website
  // are ever read, by documentOf.
  readonly url: string;
};

// The schemes that "*" covers in a match pattern, the only ones a site whose
// access the user grants or withdraws can have.
const WEB_SCHEMES = new Set(["http", "https", "ws", "wss"]);

// What a committed document is: a website, reader view or another page of
// the browser, and for a website its site.
interface Document {
  readonly page: Page;
  readonly site: string | null;
}

// Firefox gives the URL of the document, view-source: and about:reader
// included (WebNavigation.sys.mjs, WebNavigationContent.cpp and
// nsViewSourceChannel.cpp, Firefox 159.0.1). Its scheme tells a page of the
// browser from a website, and the name of an about: page tells reader view,
// whose images come from the web. Firefox finds an about: page by what comes
// before "?" or "#", without regard to case (nsAboutProtocolUtils.h,
// mozilla-central), and what follows holds the address of the article in
// reader view, so it is never read. Of a website, the host is read too, and
// reduced at once to its registrable domain, the site under which its
// requests are counted: that domain is the only thing of the URL that goes
// further than this function. A URL without a scheme is taken for a website,
// so that the doubt does not reassure, and a website whose host cannot be
// read has no site to count for.
function documentOf(url: string): Document {
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined || WEB_SCHEMES.has(scheme)) {
    return { page: "site", site: siteOfUrl(url) };
  }
  if (scheme !== "about") {
    return { page: "browser", site: null };
  }
  const name = /^about:([^?#]*)/i.exec(url)?.[1]?.toLowerCase();
  return { page: name === "reader" ? "reader" : "browser", site: null };
}

// The host as the URL gives it, in punycode, with the brackets of an IPv6
// address, which Firefox's registrable domain accepts.
function siteOfUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return hostname === "" ? null : siteOf(hostname);
}

// The icon speaks of the page the tab shows, not of its frames. The
// documentId of a page brought back from the back-forward cache is the one
// it had when first loaded (MDN, Work with documentId).
export async function onCommitted(details: DocumentDetails): Promise<void> {
  if (details.frameId !== 0 || details.documentId === undefined) {
    return;
  }
  const { tabId, documentId, timeStamp } = details;
  const backOrForward =
    details.transitionQualifiers?.includes("forward_back") === true;
  const { page, site } = documentOf(details.url);
  await ready;
  update(tabId, (record) =>
    showDocument(
      record,
      documentId,
      timeStamp,
      !hasAllSites(),
      backOrForward,
      page,
      site,
    ),
  );
}

// A page Firefox loads in its own process, such as about:preferences, gets
// no onCommitted, since the event needs a content process to report it, but
// it gets onCompleted (WebNavigationContent.cpp and WebNavigation.sys.mjs,
// Firefox 159.0.1).
export async function onCompleted(details: DocumentDetails): Promise<void> {
  if (details.frameId !== 0 || details.documentId === undefined) {
    return;
  }
  const { tabId, documentId, timeStamp } = details;
  const { page, site } = documentOf(details.url);
  await ready;
  update(tabId, (record) =>
    showCompletedDocument(
      record,
      documentId,
      timeStamp,
      !hasAllSites(),
      page,
      site,
    ),
  );
}

export function fold(
  tabId: number,
  navigation: string,
  request: SeenRequest | null,
): void {
  update(tabId, (record) => foldRequest(record, navigation, request));
}

export function missRequest(tabId: number, navigation: string): void {
  update(tabId, (record) => markMissedRequest(record, navigation));
}

function show(tabId: number, everything: boolean): void {
  const { state } = displayedDocument(recordOf(tabId));
  render(tabId, displayOf(state, table.providers), everything);
}

// Firefox gives the URL of a tab only for a site the extension has access
// to, so a missing URL, without the access to all sites, means a site it
// cannot see or a page of the browser, which its commit told apart
// (ext-tabs-base.js, Firefox 159.0.1). A new document clears the
// icon of the tab, and its commit gives the status "loading" right after,
// so the icon is shown again whole then. A new fragment, history.pushState
// or history.replaceState gives a status too, "complete" once the page has
// loaded, and clears nothing, so only what changed is sent: a page that
// rewrites its URL every second would otherwise repaint the button as often
// (ExtensionActions.sys.mjs, ext-browser.js and ext-tabs-base.js, Firefox
// 159.0.1).
export async function onStatus(
  tabId: number,
  change: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): Promise<void> {
  await ready;
  if (tab.url === undefined && !hasAllSites()) {
    update(tabId, markHiddenSite);
  }
  show(tabId, change.status === "loading");
}

// A withdrawal of the access to all sites makes every open tab partial at
// once. A grant changes no tab: what a tab missed meanwhile stays missed
// until it navigates again. tabs.query needs no permission when it filters
// on neither URL nor title (schemas/tabs.json, Firefox 159.0.1).
export async function onAccessChange(): Promise<void> {
  await ready;
  await readAccess();
  if (hasAllSites()) {
    return;
  }
  for (const tab of await browser.tabs.query({})) {
    if (tab.id !== undefined) {
      update(tab.id, markPartialView);
    }
  }
}

// After the read of the wake-up, which may still hold the tab when its
// closing is what woke the page.
export async function forget(tabId: number): Promise<void> {
  await ready;
  closed.add(tabId);
  records.delete(tabId);
  forgetSent(tabId);
  report(browser.storage.session.remove(`${PREFIX}${tabId}`));
}

// A tab closed during the burst has no record and is left out.
const scheduleShow = batch<number>(SHOW_DELAY_MS, (tabIds) => {
  for (const tabId of tabIds) {
    if (records.has(tabId)) {
      show(tabId, false);
    }
  }
});

const scheduleWrite = batch<number>(WRITE_DELAY_MS, (tabIds) => {
  const items: Record<string, TabRecord> = {};
  for (const tabId of tabIds) {
    if (records.has(tabId)) {
      items[`${PREFIX}${tabId}`] = recordOf(tabId);
    }
  }
  if (Object.keys(items).length > 0) {
    report(browser.storage.session.set(items));
  }
});

// The display follows the document the tab shows, which changes when a
// pending navigation commits even if no count does. The kept counts take
// what a change lets them, at the same point where the tab counts it, so
// that the badge and the kept counts agree.
function update(tabId: number, change: (record: TabRecord) => TabRecord): void {
  if (closed.has(tabId)) {
    return;
  }
  const record = recordOf(tabId);
  const changed = change(record);
  if (changed === record) {
    return;
  }
  const { record: next, countable } = takeCountable(changed);
  records.set(tabId, next);
  for (const { site, request } of countable) {
    count(site, request);
  }
  if (displayedDocument(next).state !== displayedDocument(record).state) {
    scheduleShow(tabId);
  }
  scheduleWrite(tabId);
}

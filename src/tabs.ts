// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { hasAllSites, readAccess } from "./access.js";
import type { Classification } from "./core/classify.js";
import { displayOf } from "./core/display.js";
import {
  EMPTY_RECORD,
  foldRequest,
  markHiddenSite,
  markPartialView,
  showCompletedDocument,
  showDocument,
  startNavigation,
  type TabRecord,
} from "./core/tab-record.js";
import table from "./providers.js";
import { render, report } from "./toolbar.js";

// Firefox suspends the event page after 30 s without an event and its memory
// goes with it, so the tabs live in storage.session, which stays in memory
// and never reaches the disk. Private windows are kept the same way, and
// nothing goes to storage.local.
const PREFIX = "tab:";

// Long enough to gather the requests of a page load into one write, far
// shorter than the suspension delay so that no write is lost.
const WRITE_DELAY_MS = 500;

// Every request changes the counts of its tab, so the toolbar is updated
// once per burst of requests rather than once per request, soon enough to
// look immediate.
const SHOW_DELAY_MS = 100;

const records = new Map<number, TabRecord>();

// Every change waits for this, so that the tabs read at the wake-up are not
// overwritten by the first event that woke the page.
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
};

// The icon speaks of the page the tab shows, not of its frames. The
// documentId of a page brought back from the back-forward cache is the one
// it had when first loaded (MDN, Work with documentId).
export async function onCommitted(details: DocumentDetails): Promise<void> {
  if (details.frameId !== 0 || details.documentId === undefined) {
    return;
  }
  const { tabId, documentId, timeStamp } = details;
  await ready;
  update(tabId, (record) =>
    showDocument(record, documentId, timeStamp, !hasAllSites()),
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
  await ready;
  update(tabId, (record) =>
    showCompletedDocument(record, documentId, timeStamp, !hasAllSites()),
  );
}

export function fold(
  tabId: number,
  navigation: string,
  request: Classification | null,
): void {
  update(tabId, (record) => foldRequest(record, navigation, request));
}

function show(tabId: number): void {
  render(tabId, displayOf(recordOf(tabId).state, table.providers));
}

// Firefox gives the URL of a tab only for a site the extension has access
// to, so a missing URL, without the access to all sites, means a site it
// cannot see (ext-tabs-base.js, Firefox 159.0.1). A new document clears the
// icon of the tab, and its status changes right after, so the icon is shown
// again at each change (ExtensionActions.sys.mjs and ext-browser.js, Firefox
// 159.0.1).
export async function onStatus(
  tabId: number,
  tab: browser.tabs.Tab,
): Promise<void> {
  await ready;
  if (tab.url === undefined && !hasAllSites()) {
    update(tabId, markHiddenSite);
  }
  show(tabId);
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

export function forget(tabId: number): void {
  records.delete(tabId);
  report(browser.storage.session.remove(`${PREFIX}${tabId}`));
}

// Gathers the tabs that change during a burst and hands them over once,
// after the delay. A tab closed meanwhile has no record and is left out.
function batch(
  delayMs: number,
  flush: (tabIds: readonly number[]) => void,
): (tabId: number) => void {
  const pending = new Set<number>();
  return (tabId) => {
    if (pending.size === 0) {
      setTimeout(() => {
        const tabIds = [...pending].filter((id) => records.has(id));
        pending.clear();
        flush(tabIds);
      }, delayMs);
    }
    pending.add(tabId);
  };
}

const scheduleShow = batch(SHOW_DELAY_MS, (tabIds) => {
  for (const tabId of tabIds) {
    show(tabId);
  }
});

const scheduleWrite = batch(WRITE_DELAY_MS, (tabIds) => {
  const items: Record<string, TabRecord> = {};
  for (const tabId of tabIds) {
    items[`${PREFIX}${tabId}`] = recordOf(tabId);
  }
  report(browser.storage.session.set(items));
});

function update(tabId: number, change: (record: TabRecord) => TabRecord): void {
  const record = recordOf(tabId);
  const next = change(record);
  if (next === record) {
    return;
  }
  records.set(tabId, next);
  if (next.state !== record.state) {
    scheduleShow(tabId);
  }
  scheduleWrite(tabId);
}

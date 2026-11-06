// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { hasAllSites } from "./access.js";
import type { Classification } from "./core/classify.js";
import { displayOf } from "./core/display.js";
import {
  EMPTY_RECORD,
  foldRequest,
  markHiddenSite,
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

const records = new Map<number, TabRecord>();
const unwritten = new Set<number>();
let writeScheduled = false;

// Every change waits for this, so that the tabs read at the wake-up are not
// overwritten by the first event that woke the page.
export const ready: Promise<void> = browser.storage.session.get(null).then(
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
);

export function recordOf(tabId: number): TabRecord {
  return records.get(tabId) ?? EMPTY_RECORD;
}

export function navigate(tabId: number, navigation: string): void {
  update(tabId, (record) => startNavigation(record, navigation));
}

export function fold(
  tabId: number,
  navigation: string,
  request: Classification | null,
): void {
  update(tabId, (record) => foldRequest(record, navigation, request));
}

function markHidden(tabId: number): void {
  update(tabId, markHiddenSite);
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
  if (tab.url === undefined && !(await hasAllSites())) {
    markHidden(tabId);
  }
  show(tabId);
}

export function forget(tabId: number): void {
  records.delete(tabId);
  unwritten.delete(tabId);
  report(browser.storage.session.remove(`${PREFIX}${tabId}`));
}

function update(tabId: number, change: (record: TabRecord) => TabRecord): void {
  const record = recordOf(tabId);
  const next = change(record);
  if (next === record) {
    return;
  }
  records.set(tabId, next);
  if (next.state !== record.state) {
    show(tabId);
  }
  unwritten.add(tabId);
  if (!writeScheduled) {
    writeScheduled = true;
    setTimeout(write, WRITE_DELAY_MS);
  }
}

function write(): void {
  writeScheduled = false;
  const items: Record<string, TabRecord> = {};
  for (const tabId of unwritten) {
    const record = records.get(tabId);
    if (record !== undefined) {
      items[`${PREFIX}${tabId}`] = record;
    }
  }
  unwritten.clear();
  report(browser.storage.session.set(items));
}

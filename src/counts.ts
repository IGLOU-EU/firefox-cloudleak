// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { batch, WRITE_DELAY_MS } from "./batch.js";
import {
  countRequest,
  emptyCounts,
  type KeptCounts,
  type SeenRequest,
  totalsOf,
} from "./core/counts.js";
import type { SiteCounts } from "./core/popup-message.js";
import { report } from "./toolbar.js";

// storage.local holds the kept counts and nothing else: when they started,
// and the counts of each site under its own key, so that a burst of requests
// writes the sites it touched rather than the whole history.
const SINCE_KEY = "since";
const SITE_PREFIX = "site:";

// The counts of private windows never reach the disk: they live in
// storage.session, beside the tabs, and go with the browser session. They
// are few, so they fit under one key.
const PRIVATE_KEY = "privateCounts";

let kept: KeptCounts = emptyCounts(0);
let privateSession: KeptCounts = emptyCounts(0);

function sitesOf(
  items: Record<string, unknown>,
  prefix: string,
): Record<string, SiteCounts> {
  const sites: Record<string, SiteCounts> = {};
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(prefix)) {
      sites[key.slice(prefix.length)] = value as SiteCounts;
    }
  }
  return sites;
}

// The counts start the first time the extension runs, so that the popup
// dates them from then rather than from the first request counted.
async function readKept(): Promise<void> {
  try {
    const items = await browser.storage.local.get(null);
    const since = items[SINCE_KEY];
    const sites = sitesOf(items, SITE_PREFIX);
    if (typeof since === "number") {
      kept = { since, sites };
      return;
    }
    kept = { since: Date.now(), sites };
    await browser.storage.local.set({ [SINCE_KEY]: kept.since });
  } catch (error: unknown) {
    console.error(`Cloud Leak: kept counts not read: ${String(error)}`);
  }
}

async function readPrivate(): Promise<void> {
  try {
    const items = await browser.storage.session.get(PRIVATE_KEY);
    const sites = items[PRIVATE_KEY];
    if (typeof sites === "object" && sites !== null) {
      privateSession = { since: 0, sites: sites as KeptCounts["sites"] };
    }
  } catch (error: unknown) {
    console.error(`Cloud Leak: private counts not read: ${String(error)}`);
  }
}

// Every count waits for this, so that the counts read at the wake-up are
// not overwritten by the first request that woke the page.
export const ready: Promise<void> = Promise.all([
  readKept(),
  readPrivate(),
]).then(() => undefined);

const scheduleKeptWrite = batch<string>(WRITE_DELAY_MS, (sites) => {
  const items: Record<string, SiteCounts> = {};
  for (const site of sites) {
    const counts = kept.sites[site];
    // A site cleared since has nothing to write.
    if (counts !== undefined) {
      items[`${SITE_PREFIX}${site}`] = counts;
    }
  }
  if (Object.keys(items).length > 0) {
    report(browser.storage.local.set(items));
  }
});

const schedulePrivateWrite = batch<string>(WRITE_DELAY_MS, () => {
  report(browser.storage.session.set({ [PRIVATE_KEY]: privateSession.sites }));
});

export function count(site: string, request: SeenRequest): void {
  if (request.privateWindow) {
    privateSession = countRequest(privateSession, site, request);
    schedulePrivateWrite(site);
    return;
  }
  kept = countRequest(kept, site, request);
  scheduleKeptWrite(site);
}

export function totals(
  site: string | null,
  privateWindow: boolean,
): SiteCounts {
  return totalsOf(privateWindow ? privateSession : kept, site);
}

// Zero in a private window: its counts live only for the session.
export function since(privateWindow: boolean): number {
  return privateWindow ? 0 : kept.since;
}

// The counts the popup of the window shows go, written or not. In a private
// window, those of the private session, and nothing of the kept counts:
// a write still pending writes what was counted since. Outside, a new period
// starts now, and a write still pending finds nothing to write. A site
// counted while the storage was being cleared is written again, so that the
// clear takes nothing counted after it.
export async function clear(privateWindow: boolean): Promise<number> {
  if (privateWindow) {
    privateSession = emptyCounts(0);
    await browser.storage.session.remove(PRIVATE_KEY);
    return since(true);
  }
  kept = emptyCounts(Date.now());
  await browser.storage.local.clear();
  await browser.storage.local.set({ [SINCE_KEY]: kept.since });
  for (const site of Object.keys(kept.sites)) {
    scheduleKeptWrite(site);
  }
  return kept.since;
}

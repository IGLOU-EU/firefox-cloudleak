// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { batch, WRITE_DELAY_MS } from "./batch.js";
import {
  clearSite,
  countRequest,
  dayOf,
  dropSite,
  emptyCounts,
  type KeptCounts,
  type SeenRequest,
  sinceOf,
  totalsOf,
} from "./core/counts.js";
import type { MapData, SiteCounts } from "./core/popup-message.js";
import { report } from "./toolbar.js";

// storage.local holds the kept counts and the sites the user ignores, and
// nothing else: when the counts started, and the counts of each site under
// its own key, so that a burst of requests writes the sites it touched rather
// than the whole history. A site cleared since has its own start under a key
// of its own, rather than inside its counts, so that the counts stored before
// any clear read as they are, without a migration, and a site without that
// key starts with all the counts. The ignored sites are one sorted list,
// written whole at each change the user makes. Never storage.sync, which
// Firefox sends to Mozilla's servers.
const SINCE_KEY = "since";
const SITE_PREFIX = "site:";
const SITE_SINCE_PREFIX = "since:";
const IGNORED_KEY = "ignored";

// The counts of private windows never reach the disk: they live in
// storage.session, beside the tabs, and go with the private session, which
// Firefox ends when its last private window closes. They are few, so they
// fit under one key.
const PRIVATE_KEY = "privateCounts";

let kept: KeptCounts = emptyCounts(0);
let privateSession: KeptCounts = emptyCounts(0);

// Read at each wake-up and kept in memory, so that a document is told ignored
// with one lookup when its site becomes known.
let ignored = new Set<string>();

function sitesOf<T>(
  items: Record<string, unknown>,
  prefix: string,
): Record<string, T> {
  const sites: Record<string, T> = {};
  for (const [key, value] of Object.entries(items)) {
    if (key.startsWith(prefix)) {
      sites[key.slice(prefix.length)] = value as T;
    }
  }
  return sites;
}

// The counts start the first time the extension runs, so that the popup
// dates them from then rather than from the first request counted.
async function readKept(): Promise<void> {
  try {
    const items = await browser.storage.local.get(null);
    ignored = new Set((items[IGNORED_KEY] as string[] | undefined) ?? []);
    const since = items[SINCE_KEY];
    const siteSince = sitesOf<number>(items, SITE_SINCE_PREFIX);
    const sites = sitesOf<SiteCounts>(items, SITE_PREFIX);
    if (typeof since === "number") {
      kept = { since, siteSince, sites };
      return;
    }
    kept = { since: dayOf(Date.now()), siteSince, sites };
    await browser.storage.local.set({ [SINCE_KEY]: kept.since });
  } catch (error: unknown) {
    console.error(`Cloud Leak: kept counts not read: ${String(error)}`);
  }
}

// Firefox lists a private window only to an extension allowed to run in it,
// which alone receives its requests, and removes a closing window from the
// list before it fires windows.onRemoved (ext-browser.js, ext-windows.js and
// nsAppShellService.cpp, Firefox 159.0.1). Not knowing keeps the counts, so
// that a failure loses nothing the session counted.
async function privateSessionEnded(): Promise<boolean> {
  try {
    const windows = await browser.windows.getAll();
    return !windows.some((window) => window.incognito);
  } catch (error: unknown) {
    console.error(`Cloud Leak: windows not read: ${String(error)}`);
    return false;
  }
}

async function dropPrivate(): Promise<void> {
  privateSession = emptyCounts(0);
  await browser.storage.session.remove(PRIVATE_KEY);
}

// The last private window may have closed while the page was suspended.
async function readPrivate(): Promise<void> {
  try {
    const items = await browser.storage.session.get(PRIVATE_KEY);
    const sites = items[PRIVATE_KEY];
    if (typeof sites !== "object" || sites === null) {
      return;
    }
    if (await privateSessionEnded()) {
      await dropPrivate();
      return;
    }
    privateSession = {
      ...emptyCounts(0),
      sites: sites as KeptCounts["sites"],
    };
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

// Every window that closes wakes the page for this, so Firefox is asked
// nothing while the private session counted nothing.
export async function onWindowRemoved(): Promise<void> {
  await ready;
  if (Object.keys(privateSession.sites).length > 0) {
    if (await privateSessionEnded()) {
      await dropPrivate();
    }
  }
}

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
export function since(site: string | null, privateWindow: boolean): number {
  return privateWindow ? 0 : sinceOf(kept, site);
}

// The counts of the site the popup of the window shows go, written or not,
// and nothing of the other sites. In a private window, its counts of the
// private session, and nothing of the kept counts: the private write takes
// what is counted when it runs. Outside, its kept counts start again now, and
// a write still pending finds nothing of the site to write. Firefox makes the
// writes of storage.local in the order they are asked, each in one IndexedDB
// transaction that is kept whole or not at all (child/ext-storage.js and
// ExtensionStorageIDB.sys.mjs, LibreWolf 159.0.1): a request counted after
// the clear is written after it, and the counts written empty rather than
// removed go in the same transaction as their new start, since one without
// the other would claim what was not observed.
export async function clear(
  site: string,
  privateWindow: boolean,
): Promise<number> {
  // An ignored site has nothing to clear, and a start of its own would keep
  // a day the user was there.
  if (ignored.has(site)) {
    return since(site, privateWindow);
  }
  if (privateWindow) {
    privateSession = clearSite(privateSession, site, 0);
    schedulePrivateWrite(site);
    return since(site, true);
  }
  const at = dayOf(Date.now());
  kept = clearSite(kept, site, at);
  await browser.storage.local.set({
    [`${SITE_SINCE_PREFIX}${site}`]: at,
    [`${SITE_PREFIX}${site}`]: {},
  });
  return at;
}

// Every site, for the map: the kept counts, or in a private window those of
// the private session, which have no start.
export function mapData(privateWindow: boolean): MapData {
  if (privateWindow) {
    return {
      privateWindow,
      since: 0,
      siteSince: {},
      sites: privateSession.sites,
    };
  }
  return {
    privateWindow,
    since: kept.since,
    siteSince: kept.siteSince,
    sites: kept.sites,
  };
}

// The counts of every site go, written or not. In a private window, those of
// the private session, and nothing of the kept counts: a private write still
// pending takes what is counted when it runs. Outside, every kept count and
// the start of each site cleared alone go, and the counts start again now,
// for every site, while the ignored sites stay. The keys stored go with those
// in memory, should the read at the wake-up have failed, since their names
// would keep which sites the user went to. The emptied counts and the new
// starts go in the same transaction as the common start, since one without
// the other would claim what was not observed. The keys go in a second one,
// since a write cannot remove a key, asked in the same turn as the memory
// empties, so that no count written after the purge comes before either. A
// write still pending finds nothing of those sites to write.
export async function purgeAll(privateWindow: boolean): Promise<number> {
  if (privateWindow) {
    await dropPrivate();
    return 0;
  }
  const stored = Object.keys(await browser.storage.local.get(null));
  const at = dayOf(Date.now());
  const items: Record<string, unknown> = { [SINCE_KEY]: at };
  for (const key of [
    ...stored,
    ...Object.keys(kept.sites).map((site) => `${SITE_PREFIX}${site}`),
    ...Object.keys(kept.siteSince).map((site) => `${SITE_SINCE_PREFIX}${site}`),
  ]) {
    if (key.startsWith(SITE_PREFIX)) {
      items[key] = {};
    } else if (key.startsWith(SITE_SINCE_PREFIX)) {
      items[key] = at;
    }
  }
  kept = emptyCounts(at);
  const written = browser.storage.local.set(items);
  const removed = browser.storage.local.remove(
    Object.keys(items).filter((key) => key !== SINCE_KEY),
  );
  await Promise.all([written, removed]);
  return at;
}

export function isIgnored(site: string | null): boolean {
  return site !== null && ignored.has(site);
}

// In punycode, as the sites are kept, so in alphabetical order.
export function ignoredSites(): string[] {
  return [...ignored].sort();
}

// Nothing of an ignored site is kept: its kept counts, its own start and its
// counts of the private session go, written or not. The list and the emptied
// counts go in one transaction, so that the counts never outlive an ignore
// that reached the disk. The keys go in a second one, since a write cannot
// remove a key, and a write still pending finds nothing of the site to write.
// Asking again repeats it, so a failure can be made good.
export async function ignore(site: string): Promise<void> {
  ignored.add(site);
  kept = dropSite(kept, site);
  if (privateSession.sites[site] !== undefined) {
    privateSession = dropSite(privateSession, site);
    schedulePrivateWrite(site);
  }
  await browser.storage.local.set({
    [IGNORED_KEY]: ignoredSites(),
    [`${SITE_PREFIX}${site}`]: {},
  });
  await browser.storage.local.remove([
    `${SITE_PREFIX}${site}`,
    `${SITE_SINCE_PREFIX}${site}`,
  ]);
}

// A site watched again counts from nothing, from that day: its start goes in
// the same transaction as the list, since the common start would claim it was
// watched all along. A site that was not ignored keeps its counts.
export async function watch(site: string): Promise<void> {
  if (!ignored.delete(site)) {
    return;
  }
  const at = dayOf(Date.now());
  kept = clearSite(kept, site, at);
  await browser.storage.local.set({
    [IGNORED_KEY]: ignoredSites(),
    [`${SITE_SINCE_PREFIX}${site}`]: at,
    [`${SITE_PREFIX}${site}`]: {},
  });
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { batch, WRITE_DELAY_MS } from "./batch.js";
import {
  addAddress,
  DEFAULT_SETTINGS,
  fitAddresses,
  keepsFewer,
  recordsLevel,
  settingsOf,
} from "./core/addresses.js";
import type { LeakLevel } from "./core/classify.js";
import {
  clearSite,
  countInSite,
  dayOf,
  dropSite,
  emptyCounts,
  type KeptCounts,
  type SeenRequest,
  sinceOf,
  totalsOf,
} from "./core/counts.js";
import type {
  MapData,
  Settings,
  SiteAddresses,
  SiteCounts,
} from "./core/popup-message.js";
import { report } from "./toolbar.js";

// storage.local holds the kept counts, the sites the user ignores, the
// settings and the recorded addresses, and nothing else: when the counts
// started, and the counts of each site under its own key, so that a burst of
// requests writes the sites it touched rather than the whole history. A site
// cleared since has its own start under a key of its own, rather than inside
// its counts, so that the counts stored before any clear read as they are,
// without a migration, and a site without that key starts with all the
// counts. The ignored sites are one sorted list, written whole at each change
// the user makes. Never storage.sync, which Firefox sends to Mozilla's
// servers.
//
// Each wake-up reads the settings, the ignored sites and the common start
// alone, which every event may need: reading the whole store would make
// Firefox read and copy every value, the recorded addresses included, at
// each wake-up, 17 ms more in the extensions' process for 900 sites and
// 155 ms more with 7.9 MB of addresses (LibreWolf 159.0.1, measured on
// 2026-11-08). The keys of a site derive from its name, so its counts and
// its own start are read the first time this run of the page needs them, as
// its addresses are, and no list of keys is kept.
const SINCE_KEY = "since";
const SITE_PREFIX = "site:";
const SITE_SINCE_PREFIX = "since:";
const IGNORED_KEY = "ignored";
const SETTINGS_KEY = "settings";

// The recorded addresses of each site go under a key of their own, apart from
// its counts, so that a burst writes the addresses of the sites it touched
// alone, and so that reading the counts of a site leaves them aside: the
// limit of each row has no maximum. The addresses of a site are read when a
// request of the site is recorded or a page asks for them.
const ADDRESSES_PREFIX = "addresses:";

// The counts of private windows never reach the disk: they live in
// storage.session, beside the tabs, and go with the private session, which
// Firefox ends when its last private window closes. They are few, so they
// fit under one key.
const PRIVATE_KEY = "privateCounts";

// The common start, and the counts and own start of the sites read during
// this run of the page.
let kept: KeptCounts = emptyCounts(0);
let privateSession: KeptCounts = emptyCounts(0);

// The sites whose counts and own start are in memory, read during this run of
// the page or emptied since by the user. What memory holds of them is what
// storage holds, with the counts of the burst not yet written.
const keptSites = new Set<string>();

// Read at each wake-up and kept in memory, so that a document is told ignored
// with one lookup when its site becomes known.
let ignored = new Set<string>();

let settings: Settings = DEFAULT_SETTINGS;

// The recorded addresses of the sites read during this run of the page, each
// fitted to the settings, and those changed since their last write.
const addresses = new Map<string, SiteAddresses>();
const addressesToWrite = new Set<string>();

// The sites whose counts or addresses are being read, with the requests
// counted or recorded meanwhile, which wait for the read.
interface Reading {
  readonly waiting: SeenRequest[];
  readonly done: Promise<void>;
}
const countReads = new Map<string, Reading>();
const addressReads = new Map<string, Reading>();

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
    const items = await browser.storage.local.get([
      SETTINGS_KEY,
      IGNORED_KEY,
      SINCE_KEY,
    ]);
    settings = settingsOf(items[SETTINGS_KEY]);
    ignored = new Set((items[IGNORED_KEY] as string[] | undefined) ?? []);
    const since = items[SINCE_KEY];
    if (typeof since === "number") {
      kept = emptyCounts(since);
      return;
    }
    kept = emptyCounts(dayOf(Date.now()));
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

// Every event waits for this, so that the settings and the ignored sites read
// at the wake-up are not overwritten by the first event that woke the page.
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

// The counts and the addresses a burst changed go in one write.
const scheduleKeptWrite = batch<string>(WRITE_DELAY_MS, (sites) => {
  const items: Record<string, SiteCounts | SiteAddresses> = {};
  for (const site of sites) {
    const counts = kept.sites[site];
    // A site cleared since has nothing to write.
    if (counts !== undefined) {
      items[`${SITE_PREFIX}${site}`] = counts;
    }
    const recorded = addresses.get(site);
    if (recorded !== undefined && addressesToWrite.delete(site)) {
      items[`${ADDRESSES_PREFIX}${site}`] = recorded;
    }
  }
  if (Object.keys(items).length > 0) {
    report(browser.storage.local.set(items));
  }
});

const schedulePrivateWrite = batch<string>(WRITE_DELAY_MS, () => {
  report(browser.storage.session.set({ [PRIVATE_KEY]: privateSession.sites }));
});

// Whether the address of a request may be recorded, which its level decides
// once its response is classified. requests.ts keeps the address of a request
// only then.
export function recording(): boolean {
  return settings.record !== "none";
}

export function recordsAddressOf(level: LeakLevel): boolean {
  return recordsLevel(settings.record, level);
}

// What storage holds for the addresses of a site, which only this page
// writes.
function storedAddresses(value: unknown): SiteAddresses {
  return typeof value === "object" && value !== null
    ? (value as SiteAddresses)
    : {};
}

// Reads keys of a site once for this run of the page, a single read however
// many requests need it. The requests that arrive meanwhile wait for the
// read, and go after what it gives, as the most recent. A clear, a purge or
// an ignore of the site meanwhile drops the read, since what it read is gone:
// the next request starts another, which Firefox makes after the write that
// emptied them (child/ext-storage.js and ExtensionStorageIDB.sys.mjs,
// LibreWolf 159.0.1). A read that fails drops the requests that waited for
// it rather than write over what it could not read, and the next request
// starts another.
function readOnce(
  reads: Map<string, Reading>,
  site: string,
  keys: string[],
  arrive: (
    items: Record<string, unknown>,
    waiting: readonly SeenRequest[],
  ) => void,
): Reading {
  const current = reads.get(site);
  if (current !== undefined) {
    return current;
  }
  const waiting: SeenRequest[] = [];
  const done = browser.storage.local.get(keys).then(
    (items) => {
      if (reads.get(site) === entry) {
        reads.delete(site);
        arrive(items, waiting);
      }
    },
    (error: unknown) => {
      if (reads.get(site) === entry) {
        reads.delete(site);
      }
      throw error;
    },
  );
  const entry: Reading = { waiting, done };
  reads.set(site, entry);
  report(done);
  return entry;
}

// The settings may change while the addresses are read, so what is read is
// fitted to those of the moment it arrives.
function readAddresses(site: string): Reading {
  const key = `${ADDRESSES_PREFIX}${site}`;
  return readOnce(addressReads, site, [key], (items, waiting) => {
    let recorded = fitAddresses(storedAddresses(items[key]), settings);
    for (const request of waiting) {
      if (recordsAddressOf(request.classification.leak.level)) {
        recorded = addAddress(recorded, request, settings.recordLimit);
      }
    }
    addresses.set(site, recorded);
    if (waiting.length > 0) {
      addressesToWrite.add(site);
      scheduleKeptWrite(site);
    }
  });
}

// The counts and the own start of a site, which only this page writes. The
// requests counted while they are read are counted after what storage holds,
// so that none is lost and none writes over the stored counts.
function readCounts(site: string): Reading {
  const countsKey = `${SITE_PREFIX}${site}`;
  const sinceKey = `${SITE_SINCE_PREFIX}${site}`;
  return readOnce(countReads, site, [countsKey, sinceKey], (items, waiting) => {
    const counts = items[countsKey];
    const own = items[sinceKey];
    if (typeof counts === "object" && counts !== null) {
      (kept.sites as Record<string, SiteCounts>)[site] = counts as SiteCounts;
    }
    if (typeof own === "number") {
      (kept.siteSince as Record<string, number>)[site] = own;
    }
    keptSites.add(site);
    for (const request of waiting) {
      countKept(site, request);
    }
  });
}

// What a page asks of a site waits for its counts, read once.
async function siteRead(site: string | null): Promise<void> {
  if (site !== null && !keptSites.has(site)) {
    await readCounts(site).done;
  }
}

// The address goes first in its row, once, written with the counts of the
// burst. The settings decide again here, since they may have changed since
// the response of the request.
function recordAddress(site: string, request: SeenRequest): void {
  if (
    request.address === undefined ||
    !recordsAddressOf(request.classification.leak.level)
  ) {
    return;
  }
  const known = addresses.get(site);
  if (known === undefined) {
    readAddresses(site).waiting.push(request);
    return;
  }
  const recorded = addAddress(known, request, settings.recordLimit);
  if (recorded !== known) {
    addresses.set(site, recorded);
    addressesToWrite.add(site);
  }
}

function forgetAddresses(site: string): void {
  addresses.delete(site);
  addressesToWrite.delete(site);
  addressReads.delete(site);
}

function forgetAllAddresses(): void {
  addresses.clear();
  addressesToWrite.clear();
  addressReads.clear();
}

// The sites of the counts are an object this page alone holds, made anew at
// each read, clear and purge, and which a page of the extension receives
// only as a copy: a request changes the counts of its site in place, since a
// copy of every site at each request would cost as much as the sites kept.
function countIn(counts: KeptCounts, site: string, request: SeenRequest): void {
  (counts.sites as Record<string, SiteCounts>)[site] = countInSite(
    counts.sites[site],
    request,
  );
}

function countKept(site: string, request: SeenRequest): void {
  countIn(kept, site, request);
  recordAddress(site, request);
  scheduleKeptWrite(site);
}

// A request of a private window records nothing, whatever the settings. The
// counts of the private session are read whole at the wake-up.
export function count(site: string, request: SeenRequest): void {
  if (request.privateWindow) {
    countIn(privateSession, site, request);
    schedulePrivateWrite(site);
    return;
  }
  if (!keptSites.has(site)) {
    readCounts(site).waiting.push(request);
    return;
  }
  countKept(site, request);
}

export async function totals(
  site: string | null,
  privateWindow: boolean,
): Promise<SiteCounts> {
  if (privateWindow) {
    return totalsOf(privateSession, site);
  }
  await siteRead(site);
  return totalsOf(kept, site);
}

// Zero in a private window: its counts live only for the session.
export async function since(
  site: string | null,
  privateWindow: boolean,
): Promise<number> {
  if (privateWindow) {
    return 0;
  }
  await siteRead(site);
  return sinceOf(kept, site);
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
// the other would claim what was not observed. Its recorded addresses go in
// that same transaction, emptied, whatever the settings, then their key
// goes, since a write cannot remove a key. In a private window, nothing is
// recorded, and the addresses stay with the kept counts.
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
  keptSites.add(site);
  countReads.delete(site);
  forgetAddresses(site);
  const key = `${ADDRESSES_PREFIX}${site}`;
  const written = browser.storage.local.set({
    [`${SITE_SINCE_PREFIX}${site}`]: at,
    [`${SITE_PREFIX}${site}`]: {},
    [key]: {},
  });
  const removed = browser.storage.local.remove(key);
  await Promise.all([written, removed]);
  return at;
}

// Every site, for the map: the kept counts, or in a private window those of
// the private session, which have no start. A copy of the sites, which the
// requests counted afterwards change in place. The map wants every site, so
// each time it asks, while the user looks at it, the whole store is read,
// and what memory holds of a site read during this run of the page wins,
// since it holds the counts of the burst not yet written. The requests
// counted before the map asked are counted first.
export async function mapData(privateWindow: boolean): Promise<MapData> {
  if (privateWindow) {
    return {
      privateWindow,
      since: 0,
      siteSince: {},
      sites: { ...privateSession.sites },
    };
  }
  await Promise.allSettled([...countReads.values()].map((read) => read.done));
  const items = await browser.storage.local.get(null);
  const sites = sitesOf<SiteCounts>(items, SITE_PREFIX);
  const siteSince = sitesOf<number>(items, SITE_SINCE_PREFIX);
  for (const site of keptSites) {
    delete sites[site];
    delete siteSince[site];
    const counts = kept.sites[site];
    const own = kept.siteSince[site];
    if (counts !== undefined) {
      sites[site] = counts;
    }
    if (own !== undefined) {
      siteSince[site] = own;
    }
  }
  return { privateWindow, since: kept.since, siteSince, sites };
}

// The counts of every site go, written or not. In a private window, those of
// the private session, and nothing of the kept counts: a private write still
// pending takes what is counted when it runs. Outside, every kept count and
// the start of each site cleared alone go, and the counts start again now,
// for every site, while the ignored sites stay. The keys stored go, those of
// the sites this run of the page never read included, with those in memory
// not yet written, since their names would keep which sites the user went
// to. The emptied counts and the new starts go in the same transaction as
// the common start, since one without the other would claim what was not
// observed. The keys go in a second one, since a write cannot remove a key,
// asked in the same turn as the memory empties, so that no count written
// after the purge comes before either. A write still pending finds nothing
// of those sites to write. The recorded addresses go the same way as the
// counts, in the same transactions. The keys stored are listed with getKeys,
// which keeps their values out of the page.
export async function purgeAll(privateWindow: boolean): Promise<number> {
  if (privateWindow) {
    await dropPrivate();
    return 0;
  }
  const stored = await browser.storage.local.getKeys();
  const at = dayOf(Date.now());
  const items: Record<string, unknown> = { [SINCE_KEY]: at };
  for (const key of [
    ...stored,
    ...Object.keys(kept.sites).map((site) => `${SITE_PREFIX}${site}`),
    ...Object.keys(kept.siteSince).map((site) => `${SITE_SINCE_PREFIX}${site}`),
    ...[...addresses.keys()].map((site) => `${ADDRESSES_PREFIX}${site}`),
  ]) {
    if (key.startsWith(SITE_PREFIX) || key.startsWith(ADDRESSES_PREFIX)) {
      items[key] = {};
    } else if (key.startsWith(SITE_SINCE_PREFIX)) {
      items[key] = at;
    }
  }
  kept = emptyCounts(at);
  keptSites.clear();
  countReads.clear();
  forgetAllAddresses();
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

// Nothing of an ignored site is kept: its kept counts, its own start, its
// recorded addresses and its counts of the private session go, written or
// not. The list and the emptied counts and addresses go in one transaction,
// so that neither outlives an ignore that reached the disk. The keys go in a
// second one, since a write cannot remove a key, and a write still pending
// finds nothing of the site to write. Asking again repeats it, so a failure
// can be made good.
export async function ignore(site: string): Promise<void> {
  ignored.add(site);
  kept = dropSite(kept, site);
  keptSites.delete(site);
  countReads.delete(site);
  forgetAddresses(site);
  if (privateSession.sites[site] !== undefined) {
    privateSession = dropSite(privateSession, site);
    schedulePrivateWrite(site);
  }
  await browser.storage.local.set({
    [IGNORED_KEY]: ignoredSites(),
    [`${SITE_PREFIX}${site}`]: {},
    [`${ADDRESSES_PREFIX}${site}`]: {},
  });
  await browser.storage.local.remove([
    `${SITE_PREFIX}${site}`,
    `${SITE_SINCE_PREFIX}${site}`,
    `${ADDRESSES_PREFIX}${site}`,
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
  keptSites.add(site);
  countReads.delete(site);
  await browser.storage.local.set({
    [IGNORED_KEY]: ignoredSites(),
    [`${SITE_SINCE_PREFIX}${site}`]: at,
    [`${SITE_PREFIX}${site}`]: {},
  });
}

export function currentSettings(): Settings {
  return settings;
}

// The keys of the recorded addresses that storage holds, listed without
// bringing their values into the page.
async function storedAddressKeys(): Promise<string[]> {
  return (await browser.storage.local.getKeys()).filter((key) =>
    key.startsWith(ADDRESSES_PREFIX),
  );
}

// Nothing the new settings leave out stays on disk: turning the recording
// off empties every recorded address in the same transaction as the
// settings, then their keys go, since a write cannot remove a key. Narrowing the levels or lowering the limit
// reads every site's addresses, as a request of the site would, and writes
// them fitted in the same transaction as the settings. The memory changes
// first, so that a request recorded meanwhile follows the new settings, and
// a read under way is fitted when it ends. The settings written are those of
// the moment of the write, should another change come meanwhile. A failure
// brings the previous settings back, so that asking again drops what it
// failed to drop.
export async function changeSettings(next: Settings): Promise<Settings> {
  const previous = settings;
  settings = next;
  try {
    if (!keepsFewer(previous, next)) {
      await browser.storage.local.set({ [SETTINGS_KEY]: settings });
    } else if (next.record === "none") {
      await dropAllAddresses();
    } else {
      await fitAllAddresses();
    }
  } catch (error: unknown) {
    if (settings === next) {
      settings = previous;
    }
    throw error;
  }
  return settings;
}

async function dropAllAddresses(): Promise<void> {
  forgetAllAddresses();
  const keys = await storedAddressKeys();
  const written = browser.storage.local.set({
    [SETTINGS_KEY]: settings,
    ...Object.fromEntries(keys.map((key) => [key, {}])),
  });
  const removed = browser.storage.local.remove(keys);
  await Promise.all([written, removed]);
}

async function fitAllAddresses(): Promise<void> {
  for (const [site, recorded] of addresses) {
    addresses.set(site, fitAddresses(recorded, settings));
  }
  const sites = (await storedAddressKeys()).map((key) =>
    key.slice(ADDRESSES_PREFIX.length),
  );
  await Promise.all(
    sites
      .filter((site) => !addresses.has(site))
      .map((site) => readAddresses(site).done),
  );
  const items: Record<string, unknown> = { [SETTINGS_KEY]: settings };
  for (const [site, recorded] of addresses) {
    const fitted = fitAddresses(recorded, settings);
    addresses.set(site, fitted);
    addressesToWrite.delete(site);
    items[`${ADDRESSES_PREFIX}${site}`] = fitted;
  }
  await browser.storage.local.set(items);
}

// The recorded addresses of a site, read when first asked for, or none in a
// private window, where nothing is recorded.
export async function siteAddresses(
  site: string,
  privateWindow: boolean,
): Promise<SiteAddresses> {
  if (privateWindow || settings.record === "none") {
    return {};
  }
  if (!addresses.has(site)) {
    await readAddresses(site).done;
  }
  return addresses.get(site) ?? {};
}

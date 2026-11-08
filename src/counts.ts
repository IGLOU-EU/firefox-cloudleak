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
  countRequest,
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
const SINCE_KEY = "since";
const SITE_PREFIX = "site:";
const SITE_SINCE_PREFIX = "since:";
const IGNORED_KEY = "ignored";
const SETTINGS_KEY = "settings";

// The recorded addresses of each site go under a key of their own, apart from
// its counts, and are read only when a request of the site is recorded or a
// page asks for them, never at the wake-up: they can weigh far more than
// every count. Firefox walks the whole store, values included, to answer
// get(null), and getKeys too (ExtensionStorageIDB.sys.mjs, LibreWolf
// 159.0.1). So while the recording is on, the keys of the counts are listed
// under a key of their own, written in the same transaction as any write
// that changes them, and the wake-up reads those keys alone. While it is
// off, no address is stored and the wake-up reads the whole store at once,
// since Firefox reads a list of keys one key after another: for 1000 sites,
// about 80 ms against 12 ms, with the same IndexedDB reads timed in a page
// of LibreWolf 159.0.1 on 2026-11-08.
const ADDRESSES_PREFIX = "addresses:";
const COUNT_KEYS_KEY = "countKeys";

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

let settings: Settings = DEFAULT_SETTINGS;

// The list of the keys of the counts the last write carried, or the wake-up
// read, while the recording is on. Null when the next write must carry it.
let listedKeys: readonly string[] | null = null;

// The recorded addresses of the sites read during this run of the page, each
// fitted to the settings, and those changed since their last write.
const addresses = new Map<string, SiteAddresses>();
const addressesToWrite = new Set<string>();

// The sites whose addresses are being read, with the requests recorded
// meanwhile, which wait for the read.
interface Reading {
  readonly waiting: SeenRequest[];
  readonly done: Promise<void>;
}
const reading = new Map<string, Reading>();

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

function isTextList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

// The counts start the first time the extension runs, so that the popup
// dates them from then rather than from the first request counted. The
// addresses are never read here.
async function readKept(): Promise<void> {
  try {
    const head = await browser.storage.local.get([
      SETTINGS_KEY,
      COUNT_KEYS_KEY,
    ]);
    settings = settingsOf(head[SETTINGS_KEY]);
    const listed = head[COUNT_KEYS_KEY];
    const byList = settings.record !== "none" && isTextList(listed);
    const items = await browser.storage.local.get(
      byList ? [SINCE_KEY, IGNORED_KEY, ...listed] : null,
    );
    listedKeys = byList ? listed : null;
    ignored = new Set((items[IGNORED_KEY] as string[] | undefined) ?? []);
    const since = items[SINCE_KEY];
    const siteSince = sitesOf<number>(items, SITE_SINCE_PREFIX);
    const sites = sitesOf<SiteCounts>(items, SITE_PREFIX);
    if (typeof since === "number") {
      kept = { since, siteSince, sites };
      return;
    }
    kept = { since: dayOf(Date.now()), siteSince, sites };
    await writeLocal({ [SINCE_KEY]: kept.since });
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

// The keys of the counts in memory, which hold every key stored and those
// still to write: a site cleared alone keeps its emptied counts under its
// key, beside its start.
function countKeys(): string[] {
  const cleared = Object.keys(kept.siteSince);
  const sites = new Set([...Object.keys(kept.sites), ...cleared]);
  return [
    ...[...sites].map((site) => `${SITE_PREFIX}${site}`),
    ...cleared.map((site) => `${SITE_SINCE_PREFIX}${site}`),
  ];
}

function sameList(a: readonly string[], b: readonly string[] | null): boolean {
  return (
    b !== null &&
    a.length === b.length &&
    a.every((item, index) => item === b[index])
  );
}

// Every write to storage.local goes through here, after the change it writes
// is made in memory: while the recording is on, the list of the keys of the
// counts goes in the same transaction as any write that changes it, so that
// the wake-up never misses a site's counts. A failed write may have carried
// it, so the next one carries it again.
function writeLocal(items: Record<string, unknown>): Promise<void> {
  const keys = settings.record === "none" ? null : countKeys();
  const listed =
    keys === null || sameList(keys, listedKeys)
      ? {}
      : { [COUNT_KEYS_KEY]: keys };
  if (keys !== null) {
    listedKeys = keys;
  }
  return browser.storage.local
    .set({ ...items, ...listed })
    .catch((error: unknown) => {
      listedKeys = null;
      throw error;
    });
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
    report(writeLocal(items));
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

// Reads the addresses of a site, once for this run of the page. The requests
// recorded meanwhile wait for the read, and go after what it gives, as the
// most recent. A clear, a purge or an ignore of the site meanwhile drops the
// read, since what it read is gone: the next request starts another, which
// Firefox makes after the write that emptied them (child/ext-storage.js and
// ExtensionStorageIDB.sys.mjs, LibreWolf 159.0.1). The settings may change
// meanwhile, so what is read is fitted to those of the moment it arrives.
function readAddresses(site: string): Reading {
  const current = reading.get(site);
  if (current !== undefined) {
    return current;
  }
  const key = `${ADDRESSES_PREFIX}${site}`;
  const waiting: SeenRequest[] = [];
  const done = browser.storage.local.get(key).then(
    (items) => {
      if (reading.get(site) !== entry) {
        return;
      }
      reading.delete(site);
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
    },
    (error: unknown) => {
      if (reading.get(site) === entry) {
        reading.delete(site);
      }
      throw error;
    },
  );
  const entry: Reading = { waiting, done };
  reading.set(site, entry);
  report(done);
  return entry;
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
  reading.delete(site);
}

function forgetAllAddresses(): void {
  addresses.clear();
  addressesToWrite.clear();
  reading.clear();
}

// A request of a private window records nothing, whatever the settings.
export function count(site: string, request: SeenRequest): void {
  if (request.privateWindow) {
    privateSession = countRequest(privateSession, site, request);
    schedulePrivateWrite(site);
    return;
  }
  kept = countRequest(kept, site, request);
  recordAddress(site, request);
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
  forgetAddresses(site);
  const key = `${ADDRESSES_PREFIX}${site}`;
  const written = writeLocal({
    [`${SITE_SINCE_PREFIX}${site}`]: at,
    [`${SITE_PREFIX}${site}`]: {},
    [key]: {},
  });
  const removed = browser.storage.local.remove(key);
  await Promise.all([written, removed]);
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
// write still pending finds nothing of those sites to write. The recorded
// addresses go the same way as the counts, in the same transactions. The
// keys stored are listed with getKeys, which keeps their values out of the
// page.
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
    ...countKeys(),
    ...[...addresses.keys()].map((site) => `${ADDRESSES_PREFIX}${site}`),
  ]) {
    if (key.startsWith(SITE_PREFIX) || key.startsWith(ADDRESSES_PREFIX)) {
      items[key] = {};
    } else if (key.startsWith(SITE_SINCE_PREFIX)) {
      items[key] = at;
    }
  }
  kept = emptyCounts(at);
  forgetAllAddresses();
  const written = writeLocal(items);
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
  forgetAddresses(site);
  if (privateSession.sites[site] !== undefined) {
    privateSession = dropSite(privateSession, site);
    schedulePrivateWrite(site);
  }
  await writeLocal({
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
  await writeLocal({
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
// settings, then their keys and the list of the keys of the counts go, since
// a write cannot remove a key. Narrowing the levels or lowering the limit
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
      await writeLocal({ [SETTINGS_KEY]: settings });
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
  listedKeys = null;
  const keys = await storedAddressKeys();
  const written = writeLocal({
    [SETTINGS_KEY]: settings,
    ...Object.fromEntries(keys.map((key) => [key, {}])),
  });
  const removed = browser.storage.local.remove([...keys, COUNT_KEYS_KEY]);
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
  await writeLocal(items);
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

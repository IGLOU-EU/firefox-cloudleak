// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { isRecordLevel, recordLimitOf } from "./core/addresses.js";
import type {
  ClearedData,
  IgnoredData,
  MapData,
  PopupData,
  PopupRequest,
  Settings,
  SiteAddresses,
} from "./core/popup-message.js";
import { displayedDocument } from "./core/tab-record.js";
import {
  changeSettings,
  clear,
  currentSettings,
  ignore,
  ignoredSites,
  isIgnored,
  mapData,
  purgeAll,
  since,
  siteAddresses,
  totals,
  watch,
} from "./counts.js";
import { siteOfTyped } from "./site.js";
import { ignoreInTabs, learnedRecordOf, ready, watchInTabs } from "./tabs.js";

// The answer to a message of a page of the extension, or nothing for a
// message of another shape, which is left to whoever it is for.
export function answer(
  message: unknown,
):
  | Promise<
      PopupData | ClearedData | IgnoredData | MapData | Settings | SiteAddresses
    >
  | undefined {
  const request = requestOf(message);
  if (request === null) {
    return undefined;
  }
  switch (request.kind) {
    case "popup":
      return popupData(request);
    case "clearSite":
      return cleared(request);
    case "ignoreSite":
      return ignoring(request.host);
    case "unignoreSite":
      return watching(request.site);
    case "ignoredSites":
      return listed();
    case "map":
      return mapped(request.privateWindow);
    case "purgeAll":
      return purged(request.privateWindow);
    case "settings":
      return settingsData();
    case "setSettings":
      return settingsChanged(request);
    case "siteAddresses":
      return addressesData(request);
  }
}

function requestOf(message: unknown): PopupRequest | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const {
    kind,
    tabId,
    site,
    privateWindow,
    host,
    record,
    recordLimit,
    dynamic,
  } = message as Record<string, unknown>;
  if (
    kind === "clearSite" &&
    typeof site === "string" &&
    site !== "" &&
    typeof privateWindow === "boolean"
  ) {
    return { kind, site, privateWindow };
  }
  if (
    kind === "popup" &&
    typeof tabId === "number" &&
    typeof privateWindow === "boolean"
  ) {
    return { kind, tabId, privateWindow };
  }
  // Any text: what names no site is answered as such.
  if (kind === "ignoreSite" && typeof host === "string") {
    return { kind, host };
  }
  if (kind === "unignoreSite" && typeof site === "string" && site !== "") {
    return { kind, site };
  }
  if (kind === "ignoredSites") {
    return { kind };
  }
  if (
    (kind === "map" || kind === "purgeAll") &&
    typeof privateWindow === "boolean"
  ) {
    return { kind, privateWindow };
  }
  if (kind === "settings") {
    return { kind };
  }
  // A level that is not one of the three is refused, and so are a limit that
  // is not an integer of at least 1 and a dynamic detection neither on nor
  // off.
  if (
    kind === "setSettings" &&
    isRecordLevel(record) &&
    typeof dynamic === "boolean"
  ) {
    const limit = recordLimitOf(recordLimit);
    if (limit !== null) {
      return { kind, record, recordLimit: limit, dynamic };
    }
  }
  if (
    kind === "siteAddresses" &&
    typeof site === "string" &&
    site !== "" &&
    typeof privateWindow === "boolean"
  ) {
    return { kind, site, privateWindow };
  }
  return null;
}

// Of the document the tab shows, and of its site, which Firefox gives for a
// tab the extension never saw navigate, whose counts are read when first
// asked. Without it, the site is unknown and the totals are empty.
async function popupData({
  tabId,
  privateWindow,
}: Extract<PopupRequest, { kind: "popup" }>): Promise<PopupData> {
  await ready;
  const { state, page, site } = displayedDocument(await learnedRecordOf(tabId));
  return {
    state,
    page,
    site,
    privateWindow,
    since: await since(site, privateWindow),
    totals: await totals(site, privateWindow),
    ignored: isIgnored(site),
  };
}

// Not before the stored counts are read, which would bring the counts of the
// site back.
async function cleared({
  site,
  privateWindow,
}: Extract<PopupRequest, { kind: "clearSite" }>): Promise<ClearedData> {
  await ready;
  return { since: await clear(site, privateWindow) };
}

// The counts, the list and the tabs change together before the first write,
// so that no event comes between them: a request of the site that arrives
// meanwhile finds its document ignored already.
async function ignoring(host: string): Promise<IgnoredData> {
  await ready;
  const site = siteOfTyped(host);
  if (site === null) {
    return { sites: ignoredSites(), site };
  }
  const written = ignore(site);
  ignoreInTabs(site);
  await written;
  return { sites: ignoredSites(), site };
}

async function watching(site: string): Promise<IgnoredData> {
  await ready;
  const written = watch(site);
  watchInTabs(site);
  await written;
  return { sites: ignoredSites(), site };
}

async function listed(): Promise<IgnoredData> {
  await ready;
  return { sites: ignoredSites(), site: null };
}

async function mapped(privateWindow: boolean): Promise<MapData> {
  await ready;
  return mapData(privateWindow);
}

// Not before the stored counts are read, which would bring them back.
async function purged(privateWindow: boolean): Promise<ClearedData> {
  await ready;
  return { since: await purgeAll(privateWindow) };
}

async function settingsData(): Promise<Settings> {
  await ready;
  return currentSettings();
}

// Not before the stored settings are read, which would bring them back.
async function settingsChanged({
  record,
  recordLimit,
  dynamic,
}: Extract<PopupRequest, { kind: "setSettings" }>): Promise<Settings> {
  await ready;
  return changeSettings({ record, recordLimit, dynamic });
}

async function addressesData({
  site,
  privateWindow,
}: Extract<PopupRequest, { kind: "siteAddresses" }>): Promise<SiteAddresses> {
  await ready;
  return siteAddresses(site, privateWindow);
}

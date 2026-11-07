// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type {
  ClearedData,
  IgnoredData,
  PopupData,
  PopupRequest,
} from "./core/popup-message.js";
import { displayedDocument } from "./core/tab-record.js";
import {
  clear,
  ignore,
  ignoredSites,
  isIgnored,
  since,
  totals,
  watch,
} from "./counts.js";
import { siteOfTyped } from "./site.js";
import { ignoreInTabs, learnedRecordOf, ready, watchInTabs } from "./tabs.js";

// The answer to a message of a page of the extension, or nothing for a
// message of another shape, which is left to whoever it is for.
export function answer(
  message: unknown,
): Promise<PopupData | ClearedData | IgnoredData> | undefined {
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
  }
}

function requestOf(message: unknown): PopupRequest | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const { kind, tabId, site, privateWindow, host } = message as Record<
    string,
    unknown
  >;
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
  return null;
}

// Of the document the tab shows, and of its site, which Firefox gives for a
// tab the extension never saw navigate. Without it, the site is unknown and
// the totals are empty.
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
    since: since(site, privateWindow),
    totals: totals(site, privateWindow),
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

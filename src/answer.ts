// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type {
  ClearedData,
  PopupData,
  PopupRequest,
} from "./core/popup-message.js";
import { displayedDocument } from "./core/tab-record.js";
import { clear, since, totals } from "./counts.js";
import { learnedRecordOf, ready } from "./tabs.js";

// The answer to a message of the popup, or nothing for a message of another
// shape, which is left to whoever it is for.
export function answer(
  message: unknown,
): Promise<PopupData | ClearedData> | undefined {
  const request = requestOf(message);
  if (request === null) {
    return undefined;
  }
  return request.kind === "popup" ? popupData(request) : cleared(request);
}

function requestOf(message: unknown): PopupRequest | null {
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const { kind, tabId, site, privateWindow } = message as Record<
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

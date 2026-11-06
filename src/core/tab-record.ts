// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Classification } from "./classify.js";
import {
  addRequest,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "./tab-state.js";

// What the extension keeps of a tab between two wake-ups: the navigation it
// shows, and the state of that navigation. Nothing of the URL.
export interface TabRecord {
  // The request id of the top-level document, which a redirect keeps, so
  // that a redirect does not start the tab over.
  readonly navigation: string;
  readonly state: TabState;
}

// A tab the extension has not seen navigate yet, such as one opened before
// it was installed.
export const EMPTY_RECORD: TabRecord = { navigation: "", state: NEUTRAL };

// The navigation of a page whose site the extension has no access to: it
// receives no request id for its document.
export const HIDDEN_SITE = "hidden";

export function startNavigation(
  record: TabRecord,
  navigation: string,
): TabRecord {
  if (record.navigation === navigation) {
    return record;
  }
  return { navigation, state: NEUTRAL };
}

// A request counts for the navigation during which it was sent: one that ends
// after the user left the page says nothing of the new page.
export function foldRequest(
  record: TabRecord,
  navigation: string,
  request: Classification | null,
): TabRecord {
  if (navigation !== record.navigation) {
    return record;
  }
  const state = addRequest(record.state, request);
  return state === record.state ? record : { navigation, state };
}

// What the tab shows is out of reach: it starts over as not observed, then
// keeps what frames of other sites let the extension see, as a partial view.
export function markHiddenSite(record: TabRecord): TabRecord {
  if (record.navigation !== HIDDEN_SITE) {
    return { navigation: HIDDEN_SITE, state: NOT_OBSERVED };
  }
  const state = markPartial(record.state);
  return state === record.state ? record : { navigation: HIDDEN_SITE, state };
}

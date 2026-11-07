// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Classification } from "./classify.js";
import {
  addRequest,
  clearPartial,
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "./tab-state.js";

// One document of a tab and what its requests showed. Nothing of the URL: the
// document is named by the id Firefox gives it, a random value.
export interface DocumentRecord {
  // Null while the navigation that opens it has not committed.
  readonly document: string | null;
  // When the tab last showed it, in milliseconds since the epoch on
  // Firefox's clock, the one of the request and navigation events. Zero
  // while it has not committed.
  readonly shownAt: number;
  // What the requests of the document carry to find it: the request id of
  // its top-level document, which a redirect keeps, or its own id when no
  // request the extension saw opened it.
  readonly navigation: string;
  readonly state: TabState;
  // A website while the navigation has not committed.
  readonly page: Page;
}

// What a document is, as the scheme of its URL tells, and for reader view the
// name of its about: page. A page of the browser, such as a new tab, the
// settings, a local file or a source view, is no site whose access the user
// could withdraw, so it is never out of reach nor partial for want of that
// access. Reader view is a page of the browser too, but it loads the images
// of the article from the web, so the lack of the access to all sites makes
// its view partial.
export type Page = "site" | "browser" | "reader";

// What the extension keeps of a tab between two wake-ups: the document it
// shows, and the documents it showed before, which Back and Forward bring
// back from the back-forward cache without sending any request.
export interface TabRecord extends DocumentRecord {
  // The most recently shown first, all committed.
  readonly previous: readonly DocumentRecord[];
}

// Firefox keeps at most 8 pages in its back-forward cache for the whole
// browser, and only those within 3 entries of the current one, so a tab
// brings back at most 6 of them. The 8 shown last leave room for a history
// that branched (nsSHistory.cpp and nsSHistory.h, Firefox 159.0.1).
export const PREVIOUS_DOCUMENTS = 8;

// A tab the extension has not seen navigate yet, such as one opened before
// it was installed, updated or reloaded: it shows a document whose id the
// extension never got, and whose first requests it missed.
export const EMPTY_RECORD: TabRecord = {
  document: "",
  shownAt: 0,
  navigation: "",
  state: markMissed(NEUTRAL),
  page: "site",
  previous: [],
};

// The navigation of a page whose site the extension has no access to: it
// receives no request id for its document.
export const HIDDEN_SITE = "hidden";

// Partial when the extension lacks the access to all sites: a request of a
// site it cannot see may go through a provider.
function startState(partial: boolean): TabState {
  return partial ? markPartial(NEUTRAL) : NEUTRAL;
}

// The document the tab leaves goes first among the previous ones. A
// navigation that never committed showed nothing, and is not kept.
function remember(record: TabRecord): readonly DocumentRecord[] {
  if (record.document === null) {
    return record.previous;
  }
  const { previous, ...left } = record;
  return [
    left,
    ...previous.filter((entry) => entry.document !== left.document),
  ].slice(0, PREVIOUS_DOCUMENTS);
}

// Firefox delivers request events in batches and navigation events at once,
// so a top-level request can reach the extension after the commit of the
// document it opened. Such a request was sent before that commit, and opens
// the first document the tab committed after it was sent, which keeps the
// requests already counted for it.
export function startNavigation(
  record: TabRecord,
  navigation: string,
  partial: boolean,
  sentAt: number,
): TabRecord {
  if (record.navigation === navigation) {
    return record;
  }
  const opened = [record, ...record.previous]
    .filter((entry) => entry.document !== null && entry.shownAt > sentAt)
    .reduce<DocumentRecord | null>(
      (first, entry) =>
        first === null || entry.shownAt < first.shownAt ? entry : first,
      null,
    );
  if (opened !== null) {
    return replace(record, opened, { ...opened, navigation });
  }
  return {
    document: null,
    shownAt: 0,
    navigation,
    state: startState(partial),
    page: "site",
    previous: remember(record),
  };
}

// Firefox commits a document. One the tab showed before comes back with what
// it saw, as Back and Forward bring it back from the back-forward cache, and
// with a partial view if the extension lost the access to all sites since.
// The pending navigation takes the document it opened. Any other document
// was opened by no request the extension saw, such as a page of the browser
// or of a site out of reach, and starts over. Back and Forward can also bring
// back a document the tab does not know, loaded before the extension started
// or shown before the documents the tab keeps: the extension missed its
// requests.
export function showDocument(
  record: TabRecord,
  document: string,
  shownAt: number,
  partial: boolean,
  backOrForward = false,
  page: Page = "site",
): TabRecord {
  if (record.document === document) {
    return record;
  }
  const lacking = partial && page !== "browser";
  const saved = record.previous.find((entry) => entry.document === document);
  if (saved !== undefined) {
    const others = record.previous.filter((entry) => entry !== saved);
    return {
      ...saved,
      shownAt,
      state: lacking ? markPartial(saved.state) : saved.state,
      previous: remember({ ...record, previous: others }),
    };
  }
  if (record.document === null) {
    return {
      ...record,
      document,
      shownAt,
      state: openedState(record.state, page, lacking),
      page,
    };
  }
  const state = startState(lacking);
  return {
    document,
    shownAt,
    navigation: document,
    state: backOrForward ? markMissed(state) : state,
    page,
    previous: remember(record),
  };
}

// A page of the browser that a pending navigation opens keeps what the
// navigation saw, but the navigation may be the wait for a site out of reach,
// which was waiting for no site. The page is then never out of reach, and only
// reader view is partial for want of the access to all sites.
function openedState(state: TabState, page: Page, lacking: boolean): TabState {
  if (page === "site") {
    return state;
  }
  if (page === "browser") {
    return clearPartial(state);
  }
  return state.kind === "not-observed" ? startState(lacking) : state;
}

// Firefox signals no commit for a page it loads in its own process, such as
// its settings, only its completion. A document the tab already knows has
// committed, and its completion changes nothing.
export function showCompletedDocument(
  record: TabRecord,
  document: string,
  completedAt: number,
  partial: boolean,
  page: Page = "site",
): TabRecord {
  const known =
    record.document === document ||
    record.previous.some((entry) => entry.document === document);
  return known
    ? record
    : showDocument(record, document, completedAt, partial, false, page);
}

// What the tab shows. A navigation that has not committed shows nothing yet,
// and may never commit: a download, a 204 response or a stop end without one
// (DocumentLoadListener.cpp and nsURILoader.cpp, Firefox 159.0.1), and the
// tab keeps the page it had. The wait for a site out of reach is shown at
// once, since the tab already reports that site as its page.
export function displayedDocument(record: TabRecord): DocumentRecord {
  if (record.document !== null || record.navigation === HIDDEN_SITE) {
    return record;
  }
  return record.previous[0] ?? record;
}

// A request belongs to the document the tab showed when it was sent: one sent
// before the tab showed its document comes from the page it left, even when
// Firefox delivers it after the commit, and one sent while a navigation is
// pending comes from the page still shown. The wait for a site out of reach
// takes every request, as the tab shows it.
export function navigationAt(record: TabRecord, sentAt: number): string {
  const committed = record.document !== null;
  if (
    (committed && sentAt >= record.shownAt) ||
    (!committed && record.navigation === HIDDEN_SITE)
  ) {
    return record.navigation;
  }
  const shownThen = record.previous.find((entry) => entry.shownAt <= sentAt);
  return shownThen?.navigation ?? record.navigation;
}

// A request counts for the document it was sent for, the one shown or one
// shown before. A request of a navigation the tab no longer keeps says
// nothing of any document it keeps.
export function foldRequest(
  record: TabRecord,
  navigation: string,
  request: Classification | null,
): TabRecord {
  return changeState(record, navigation, (state) => addRequest(state, request));
}

// Firefox gave the response of a request whose sending the extension never
// saw: a service worker answered it, or it went out before the event page
// last started, which forgets the requests it waited on. The document it was
// sent for missed it.
export function markMissedRequest(
  record: TabRecord,
  navigation: string,
): TabRecord {
  return changeState(record, navigation, markMissed);
}

// Changes the state of the document a navigation opened, the one shown or one
// shown before. A navigation the tab no longer keeps changes nothing.
function changeState(
  record: TabRecord,
  navigation: string,
  change: (state: TabState) => TabState,
): TabRecord {
  const entry =
    record.navigation === navigation
      ? record
      : record.previous.find((saved) => saved.navigation === navigation);
  if (entry === undefined) {
    return record;
  }
  const state = change(entry.state);
  return state === entry.state
    ? record
    : replace(record, entry, { ...entry, state });
}

// What the tab shows is out of reach. A document no request opened is that
// page: it becomes not observed, then keeps what frames of other sites let
// the extension see, as a partial view. A document opened by a request the
// extension saw is in reach, so the page out of reach is the next one, whose
// commit has not arrived yet: it waits for it. A navigation the extension saw
// and that has not committed is in reach too, so the page out of reach is
// the one still shown, already marked. Firefox withholds the URL of a page of
// the browser too, reader view included, which is no site out of reach: it
// stays as it is, and a site the tab opens next is marked once it commits.
export function markHiddenSite(record: TabRecord): TabRecord {
  if (record.page !== "site") {
    return record;
  }
  const openedByRequest =
    record.navigation !== record.document && record.navigation !== HIDDEN_SITE;
  if (openedByRequest && record.document === null) {
    return record;
  }
  if (openedByRequest) {
    return {
      document: null,
      shownAt: 0,
      navigation: HIDDEN_SITE,
      state: NOT_OBSERVED,
      page: "site",
      previous: remember(record),
    };
  }
  const state =
    record.state.kind === "neutral" ? NOT_OBSERVED : markPartial(record.state);
  return state === record.state ? record : { ...record, state };
}

// The access to all sites was withdrawn while the tab was open: the requests
// of the sites now out of reach go unseen from then on, and a later grant
// does not bring back those it missed.
// The page still shown during a pending navigation receives the requests of
// that time, so it becomes partial too. A page of the browser is no site the
// withdrawal concerns, and stays as it is, but for reader view, whose images
// come from the web.
export function markPartialView(record: TabRecord): TabRecord {
  const shown = displayedDocument(record);
  const marked =
    shown === record || shown.page === "browser"
      ? record
      : changeState(record, shown.navigation, markPartial);
  if (marked.page === "browser") {
    return marked;
  }
  const state = markPartial(marked.state);
  return state === marked.state ? marked : { ...marked, state };
}

// Puts a changed document in the place of the one it changes, the one shown
// or one shown before.
function replace(
  record: TabRecord,
  entry: DocumentRecord,
  changed: DocumentRecord,
): TabRecord {
  if (entry === record) {
    return { ...record, ...changed };
  }
  return {
    ...record,
    previous: record.previous.map((saved) =>
      saved === entry ? changed : saved,
    ),
  };
}

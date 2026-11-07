// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import {
  type Classification,
  type Colour,
  colourOf,
  type LeakLevel,
} from "./classify.js";

// The number of requests of a tab at one level, and, for the levels whose
// colour depends on it, with or without proven decryption.
export interface Tally {
  readonly level: LeakLevel;
  // Null where the colour does not depend on the proof.
  readonly proven: boolean | null;
  readonly count: number;
}

// Whether the tab saw a kind of request, and whether the decryption of one of
// them was proven: the tooltip states what such a request shows only then,
// and speaks of it in the conditional otherwise.
export type Sighting = "none" | "unproven" | "proven";

export type TabState =
  | {
      readonly kind: "neutral";
      // The extension lacks the access to all sites, so a request it did not
      // see may have gone through a provider.
      readonly partial: boolean;
      // Firefox gave the response of a request whose sending the extension
      // never saw, or the extension started after the page did, so requests
      // of the page went unseen whatever the access to sites.
      readonly missed: boolean;
    }
  | { readonly kind: "not-observed" }
  // The user asked to ignore the site of the document, so none of its
  // requests is looked at and there is nothing to say of it.
  | { readonly kind: "ignored" }
  | {
      readonly kind: "seen";
      // The most serious request of the tab, which gives the icon its colour
      // and level and the tooltip its provider.
      readonly request: Classification;
      // From the most serious to the least.
      readonly tallies: readonly Tally[];
      // A request through a provider carried a cookie of the site or an
      // Authorization header, which may be enough to open the user's account.
      readonly session: Sighting;
      // A request belonged to the anti-bot machinery of a provider.
      readonly antiBot: Sighting;
      // The extension had no access to at least one site of the tab, so
      // what it shows is what it saw, not the whole of the tab.
      readonly partial: boolean;
      // As for a neutral state.
      readonly missed: boolean;
    };

// No request of the tab went through a known provider.
export const NEUTRAL: TabState = {
  kind: "neutral",
  partial: false,
  missed: false,
};

// The extension has no access to the site the tab shows and saw nothing
// through a known provider, so it cannot know.
export const NOT_OBSERVED: TabState = { kind: "not-observed" };

export const IGNORED: TabState = { kind: "ignored" };

const COLOUR_RANK: Record<Colour, number> = { blue: 0, orange: 1, red: 2 };

function isPartial(state: TabState): boolean {
  return (
    state.kind === "not-observed" || (state.kind !== "ignored" && state.partial)
  );
}

// The tab shows its most serious request, so that one alarming request is
// never hidden by many harmless ones, even when the view is partial: what was
// seen is still true. A document of an ignored site counts nothing.
export function addRequest(
  state: TabState,
  request: Classification | null,
): TabState {
  if (request === null || state.kind === "ignored") {
    return state;
  }
  const seen = state.kind === "seen" ? state : null;
  const kept =
    seen !== null && !isMoreSerious(request, seen.request)
      ? seen.request
      : request;
  return {
    kind: "seen",
    request: kept,
    tallies: count(seen?.tallies ?? [], request),
    session: sight(seen?.session ?? "none", request, isSession(request)),
    antiBot: sight(seen?.antiBot ?? "none", request, isAntiBot(request)),
    partial: isPartial(state),
    missed: state.kind !== "not-observed" && state.missed,
  };
}

// A proof, once seen, stays: one request read in clear is enough.
function sight(
  sighting: Sighting,
  request: Classification,
  matches: boolean,
): Sighting {
  if (!matches || sighting === "proven") {
    return sighting;
  }
  return request.proven ? "proven" : "unproven";
}

export function colourOfRequest(request: Classification): Colour {
  return colourOf(request.leak.level, request.proven);
}

function count(tallies: readonly Tally[], request: Classification): Tally[] {
  const level = request.leak.level;
  const proven =
    colourOf(level, true) === colourOf(level, false) ? null : request.proven;
  const found = tallies.find(
    (tally) => tally.level === level && tally.proven === proven,
  );
  if (found !== undefined) {
    return tallies.map((tally) =>
      tally === found ? { ...tally, count: tally.count + 1 } : tally,
    );
  }
  return [...tallies, { level, proven, count: 1 }].sort(
    (a, b) => -compareGrades(a, b),
  );
}

// The order of the icon, red before orange before blue, then by level
// number, so that the tooltip lists the counts in the order the icon follows.
function compareGrades(
  a: { readonly level: LeakLevel; readonly proven: boolean | null },
  b: { readonly level: LeakLevel; readonly proven: boolean | null },
): number {
  const colour =
    COLOUR_RANK[colourOf(a.level, a.proven === true)] -
    COLOUR_RANK[colourOf(b.level, b.proven === true)];
  return colour !== 0 ? colour : a.level - b.level;
}

// At the same colour and level, a request of the site replaces one of the
// anti-bot machinery, so that the provider the tooltip names is the one the
// site's own exchanges go through, not one whose protection alone leaks as
// much. Then a session replaces a possible session, so that it names the
// provider that carried the surer sign of an account.
function isMoreSerious(request: Classification, kept: Classification): boolean {
  const order = compareGrades(
    { level: request.leak.level, proven: request.proven },
    { level: kept.leak.level, proven: kept.proven },
  );
  if (order !== 0) {
    return order > 0;
  }
  if (isAntiBot(kept) !== isAntiBot(request)) {
    return isAntiBot(kept);
  }
  return isPossibleSession(kept) && isSureSession(request);
}

function isAntiBot(request: Classification): boolean {
  return request.leak.level === 4 && request.leak.challenge;
}

function isSession(request: Classification): boolean {
  return request.leak.level === 4 && request.leak.case === "session";
}

function isSureSession(request: Classification): boolean {
  const leak = request.leak;
  return leak.level === 4 && leak.case === "session" && !leak.possible;
}

function isPossibleSession(request: Classification): boolean {
  const leak = request.leak;
  return leak.level === 4 && leak.case === "session" && leak.possible;
}

// The extension lacks the access to all sites. What it saw stays true, and a
// tab where it saw nothing stays neutral: the crossed cloud is kept for a tab
// whose own site is out of reach. A document of an ignored site looks at
// nothing, so what the extension could not see does not concern it.
export function markPartial(state: TabState): TabState {
  if (
    state.kind === "not-observed" ||
    state.kind === "ignored" ||
    state.partial
  ) {
    return state;
  }
  return { ...state, partial: true };
}

// Requests of the page went unseen. What was seen stays true, and a tab where
// nothing was seen stays neutral. A tab not observed already says the
// extension can say nothing of it, and a document of an ignored site misses
// nothing it would look at.
export function markMissed(state: TabState): TabState {
  if (
    state.kind === "not-observed" ||
    state.kind === "ignored" ||
    state.missed
  ) {
    return state;
  }
  return { ...state, missed: true };
}

// A page of the browser is no site whose access the user could withdraw, so
// the lack of that access says nothing of it. What was seen and what was
// missed stay true.
export function clearPartial(state: TabState): TabState {
  if (state.kind === "not-observed") {
    return NEUTRAL;
  }
  if (state.kind === "ignored") {
    return state;
  }
  return state.partial ? { ...state, partial: false } : state;
}

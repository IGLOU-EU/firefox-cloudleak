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

export type TabState =
  | {
      readonly kind: "neutral";
      // The extension lacks the access to all sites, so a request it did not
      // see may have gone through a provider.
      readonly partial: boolean;
    }
  | { readonly kind: "not-observed" }
  | {
      readonly kind: "seen";
      // The most serious request of the tab, which gives the icon its colour
      // and level and the tooltip its provider and case.
      readonly request: Classification;
      // From the most serious to the least.
      readonly tallies: readonly Tally[];
      // The extension had no access to at least one site of the tab, so
      // what it shows is what it saw, not the whole of the tab.
      readonly partial: boolean;
    };

// No request of the tab went through a known provider.
export const NEUTRAL: TabState = { kind: "neutral", partial: false };

// The extension has no access to the site the tab shows and saw nothing
// through a known provider, so it cannot know.
export const NOT_OBSERVED: TabState = { kind: "not-observed" };

const COLOUR_RANK: Record<Colour, number> = { blue: 0, orange: 1, red: 2 };

function isPartial(state: TabState): boolean {
  return state.kind === "not-observed" || state.partial;
}

// The tab shows its most serious request, so that one alarming request is
// never hidden by many harmless ones, even when the view is partial: what was
// seen is still true.
export function addRequest(
  state: TabState,
  request: Classification | null,
): TabState {
  if (request === null) {
    return state;
  }
  const kept =
    state.kind === "seen" && !isMoreSerious(request, state.request)
      ? state.request
      : request;
  return {
    kind: "seen",
    request: kept,
    tallies: count(state.kind === "seen" ? state.tallies : [], request),
    partial: isPartial(state),
  };
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
// anti-bot machinery: the mark would otherwise suggest that the leak comes
// from the protection alone, while the site leaks as much. Then a session
// replaces a possible session, so that a tab where a session was seen for
// sure does not say it is only possible.
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
// whose own site is out of reach.
export function markPartial(state: TabState): TabState {
  if (state.kind === "not-observed" || state.partial) {
    return state;
  }
  return { ...state, partial: true };
}

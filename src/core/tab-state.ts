// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { type Classification, type Colour, colourOf } from "./classify.js";

export type TabState =
  | { readonly kind: "neutral" }
  | { readonly kind: "not-observed" }
  | {
      readonly kind: "seen";
      // The most serious request of the tab, which gives the icon its colour
      // and level and the tooltip its provider and case.
      readonly request: Classification;
      // The extension had no access to at least one site of the tab, so
      // what it shows is what it saw, not the whole of the tab.
      readonly partial: boolean;
    };

// No request of the tab went through a known provider.
export const NEUTRAL: TabState = { kind: "neutral" };

// The extension had no access to a site of the tab and saw nothing through a
// known provider, so it cannot know.
export const NOT_OBSERVED: TabState = { kind: "not-observed" };

const COLOUR_RANK: Record<Colour, number> = { blue: 0, orange: 1, red: 2 };

function isPartial(state: TabState): boolean {
  return (
    state.kind === "not-observed" || (state.kind === "seen" && state.partial)
  );
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
  if (state.kind === "seen" && !isMoreSerious(request, state.request)) {
    return state;
  }
  return { kind: "seen", request, partial: isPartial(state) };
}

export function colourOfRequest(request: Classification): Colour {
  return colourOf(request.leak.level, request.proven);
}

// At the same colour and level, a request of the site replaces one of the
// anti-bot machinery: the mark would otherwise suggest that the leak comes
// from the protection alone, while the site leaks as much.
function isMoreSerious(request: Classification, kept: Classification): boolean {
  const colour =
    COLOUR_RANK[colourOfRequest(request)] - COLOUR_RANK[colourOfRequest(kept)];
  if (colour !== 0) {
    return colour > 0;
  }
  const level = request.leak.level - kept.leak.level;
  if (level !== 0) {
    return level > 0;
  }
  return isAntiBot(kept) && !isAntiBot(request);
}

function isAntiBot(request: Classification): boolean {
  return request.leak.level === 4 && request.leak.challenge;
}

// The extension has no access to a site of the tab. A tab where nothing was
// seen must not pass for one where nothing goes through a provider.
export function markPartial(state: TabState): TabState {
  if (state.kind !== "seen") {
    return NOT_OBSERVED;
  }
  return state.partial ? state : { ...state, partial: true };
}

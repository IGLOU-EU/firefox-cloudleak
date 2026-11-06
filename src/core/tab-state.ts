// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import {
  type Classification,
  type Colour,
  colourOf,
  type LeakLevel,
} from "./classify.js";

export type TabState =
  | { readonly kind: "neutral" }
  | { readonly kind: "not-observed" }
  | {
      readonly kind: "seen";
      readonly colour: Colour;
      readonly level: LeakLevel;
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
  const level = request.leak.level;
  const colour = colourOf(level, request.proven);
  if (state.kind === "seen") {
    const rank = COLOUR_RANK[colour] - COLOUR_RANK[state.colour];
    if (rank < 0 || (rank === 0 && level <= state.level)) {
      return state;
    }
  }
  return { kind: "seen", colour, level, partial: isPartial(state) };
}

// The extension has no access to a site of the tab. A tab where nothing was
// seen must not pass for one where nothing goes through a provider.
export function markPartial(state: TabState): TabState {
  if (state.kind !== "seen") {
    return NOT_OBSERVED;
  }
  return state.partial ? state : { ...state, partial: true };
}

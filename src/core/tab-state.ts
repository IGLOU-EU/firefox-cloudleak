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
    };

// No request of the tab went through a known provider.
export const NEUTRAL: TabState = { kind: "neutral" };

// The extension has no access to the site, so it cannot know.
export const NOT_OBSERVED: TabState = { kind: "not-observed" };

const COLOUR_RANK: Record<Colour, number> = { blue: 0, orange: 1, red: 2 };

// The tab shows its most serious request, so that one alarming request is
// never hidden by many harmless ones. A site the extension cannot observe
// stays so: what it sees there is partial, and a partial view must not pass
// for the whole.
export function addRequest(
  state: TabState,
  request: Classification | null,
): TabState {
  if (request === null || state.kind === "not-observed") {
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
  return { kind: "seen", colour, level };
}

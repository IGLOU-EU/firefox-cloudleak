// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Colour } from "./classify.js";
import {
  colourOfRequest,
  type Sighting,
  type TabState,
  type Tally,
} from "./tab-state.js";

export type Icon = "neutral" | "blue" | "orange" | "red" | "not-observed";

// One line of the tooltip: the name of its message in _locales, and the
// values of its placeholders, in order.
export interface TitleLine {
  readonly message: string;
  readonly substitutions: readonly string[];
}

export interface Display {
  readonly icon: Icon;
  // The number of requests at the colour and level of the icon, empty when
  // there is nothing to count.
  readonly badge: string;
  // Paragraphs of lines: the counts of the tab, then what the provider of the
  // most serious request sees and what the tab saw among it.
  readonly title: readonly (readonly TitleLine[])[];
}

export function displayOf(
  state: TabState,
  providers: readonly { readonly id: string; readonly name: string }[],
): Display {
  if (state.kind === "neutral") {
    return {
      icon: "neutral",
      badge: "",
      title: [[line("titleNeutral"), ...partialLines(state)]],
    };
  }
  if (state.kind === "not-observed") {
    return {
      icon: "not-observed",
      badge: "",
      title: [[line("titleNotObserved")]],
    };
  }
  const request = state.request;
  const provider =
    providers.find((entry) => entry.id === request.provider)?.name ??
    request.provider;
  const colour = colourOfRequest(request);
  return {
    icon: colour,
    badge: badgeOf(state.tallies),
    title: [
      state.tallies.map(countLine),
      [
        line(MEANING[colour], provider),
        ...sightingLines("titleSession", state.session),
        ...sightingLines("titleAntiBot", state.antiBot),
        ...partialLines(state),
      ],
    ],
  };
}

// The extension sees one load of the page, not what a cookie holds nor what
// a request is for, so the message says what the provider is placed to see,
// from the colour alone. Levels 1 and 2 are blue whatever the proof.
const MEANING: Record<Colour, string> = {
  blue: "titleBlue",
  orange: "titleOrange",
  red: "titleRed",
};

function sightingLines(name: string, sighting: Sighting): TitleLine[] {
  if (sighting === "none") {
    return [];
  }
  return [line(`${name}${sighting === "proven" ? "Proven" : "Unproven"}`)];
}

// A blank line sets the counts apart from what they mean, so that each reads
// at a glance.
export function titleText(
  title: Display["title"],
  message: (name: string, substitutions: readonly string[]) => string,
): string {
  return title
    .map((lines) =>
      lines
        .map((entry) => message(entry.message, entry.substitutions))
        .join("\n"),
    )
    .join("\n\n");
}

// Each reason for a partial view has its own line, since only the first is in
// the user's hands: granting the access to all sites.
function partialLines(state: {
  readonly partial: boolean;
  readonly missed: boolean;
}): TitleLine[] {
  return [
    ...(state.partial ? [line("titlePartial")] : []),
    ...(state.missed ? [line("titleMissed")] : []),
  ];
}

// The tallies go from the most serious, so the first is the one the icon
// shows. Firefox cuts the badge past two characters (toolbarbutton.css,
// Firefox 159.0.1), so a count above 99 is a plus rather than its first
// digits, which would read as a smaller number.
function badgeOf(tallies: readonly Tally[]): string {
  const count = tallies[0]?.count ?? 0;
  return count > 99 ? "+" : String(count);
}

export function line(message: string, ...substitutions: string[]): TitleLine {
  return { message, substitutions };
}

// One request and several take different messages, since the plural changes
// the words around the number.
function countLine(tally: Tally): TitleLine {
  const proof =
    tally.proven === null ? "" : tally.proven ? "Proven" : "Unproven";
  const name = `countLevel${tally.level}${proof}`;
  return tally.count === 1
    ? line(`${name}One`)
    : line(`${name}Many`, String(tally.count));
}

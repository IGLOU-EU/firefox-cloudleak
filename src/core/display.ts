// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Classification } from "./classify.js";
import { colourOfRequest, type TabState, type Tally } from "./tab-state.js";

export type Icon = "neutral" | "blue" | "orange" | "red" | "not-observed";

// One line of the tooltip: the name of its message in _locales, and the
// values of its placeholders, in order.
export interface TitleLine {
  readonly message: string;
  readonly substitutions: readonly string[];
}

export interface Display {
  readonly icon: Icon;
  // Empty when there is nothing to count.
  readonly badge: string;
  // Paragraphs of lines: the counts of the tab, then what the most serious
  // request means.
  readonly title: readonly (readonly TitleLine[])[];
}

export function displayOf(
  state: TabState,
  providers: readonly { readonly id: string; readonly name: string }[],
): Display {
  if (state.kind === "neutral") {
    const title = [line("titleNeutral")];
    if (state.partial) {
      title.push(line("titlePartial"));
    }
    return { icon: "neutral", badge: "", title: [title] };
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
  const meaning = [line(messageOf(request), provider)];
  if (request.leak.level === 4 && request.leak.challenge) {
    meaning.push(line("titleAntiBot", provider));
  }
  if (state.partial) {
    meaning.push(line("titlePartial"));
  }
  return {
    icon: colourOfRequest(request),
    badge: String(request.leak.level),
    title: [state.tallies.map(countLine), meaning],
  };
}

// A blank line sets the counts apart from what the most serious request
// means, so that each reads at a glance.
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

function line(message: string, ...substitutions: string[]): TitleLine {
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

// Levels 1 and 2 are blue whatever the proof, so their sentence does not
// speak of it.
function messageOf(request: Classification): string {
  const proof = request.proven ? "Proven" : "Unproven";
  const leak = request.leak;
  if (leak.level !== 4) {
    return leak.level === 2 ? "titleLevel2" : `titleLevel3${proof}`;
  }
  if (leak.case === "data-sent") {
    return `titleLevel4DataSent${proof}`;
  }
  return leak.possible
    ? `titleLevel4SessionPossible${proof}`
    : `titleLevel4Session${proof}`;
}

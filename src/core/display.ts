// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Classification } from "./classify.js";
import { colourOfRequest, type TabState } from "./tab-state.js";

export type Icon = "neutral" | "blue" | "orange" | "red" | "not-observed";

// One sentence of the tooltip: the name of its message in _locales, and the
// provider name it takes, if any.
export interface TitlePart {
  readonly message: string;
  readonly provider: string | null;
}

export interface Display {
  readonly icon: Icon;
  // Empty when there is nothing to count.
  readonly badge: string;
  readonly title: readonly TitlePart[];
}

export function displayOf(
  state: TabState,
  providers: readonly { readonly id: string; readonly name: string }[],
): Display {
  if (state.kind === "neutral") {
    return { icon: "neutral", badge: "", title: [part("titleNeutral")] };
  }
  if (state.kind === "not-observed") {
    return {
      icon: "not-observed",
      badge: "",
      title: [part("titleNotObserved")],
    };
  }
  const request = state.request;
  const provider =
    providers.find((entry) => entry.id === request.provider)?.name ??
    request.provider;
  const title = [part(messageOf(request), provider)];
  if (request.leak.level === 4 && request.leak.challenge) {
    title.push(part("titleAntiBot", provider));
  }
  if (state.partial) {
    title.push(part("titlePartial"));
  }
  return {
    icon: colourOfRequest(request),
    badge: String(request.leak.level),
    title,
  };
}

function part(message: string, provider: string | null = null): TitlePart {
  return { message, provider };
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

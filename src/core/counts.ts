// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { type Classification, colourOf } from "./classify.js";
import type { Category, SiteCounts } from "./popup-message.js";

// What the kept counts take of a request through a provider: its
// classification, which gives the provider and the category, the method and
// request type that key its count, and whether it belongs to a private
// window, whose counts live only for the private session. Nothing of its URL.
export interface SeenRequest {
  readonly classification: Classification;
  readonly method: string;
  // The webRequest resource type, as Firefox gives it.
  readonly type: string;
  readonly privateWindow: boolean;
}

// The counts of every site, and when they started, in milliseconds since the
// epoch.
export interface KeptCounts {
  readonly since: number;
  // A site cleared since has counted only from its clear, so the common start
  // would claim more than was observed for it.
  readonly siteSince: { readonly [site: string]: number };
  readonly sites: { readonly [site: string]: SiteCounts };
}

export function emptyCounts(since: number): KeptCounts {
  return { since, siteSince: {}, sites: {} };
}

// The category the icon and the badge show for a request: its colour, then
// its level.
export function categoryOf(request: Classification): Category {
  const level = request.leak.level;
  return `${colourOf(level, request.proven)}${level}`;
}

// The method and request type key of a count, such as "GET image", as
// Firefox gives both.
export function requestKindOf(request: SeenRequest): string {
  return `${request.method} ${request.type}`;
}

// Counts one request of a site. The counts given are never changed: the new
// ones share with them every site the request does not touch.
export function countRequest(
  counts: KeptCounts,
  site: string,
  request: SeenRequest,
): KeptCounts {
  const { provider } = request.classification;
  const category = categoryOf(request.classification);
  const kind = requestKindOf(request);
  const siteCounts = counts.sites[site] ?? {};
  const providerCounts = siteCounts[provider] ?? {};
  const kinds = providerCounts[category] ?? {};
  return {
    ...counts,
    sites: {
      ...counts.sites,
      [site]: {
        ...siteCounts,
        [provider]: {
          ...providerCounts,
          [category]: { ...kinds, [kind]: (kinds[kind] ?? 0) + 1 },
        },
      },
    },
  };
}

// The counts of a site, empty for a site that sent nothing through a
// provider and for a document that has no site.
export function totalsOf(counts: KeptCounts, site: string | null): SiteCounts {
  return site === null ? {} : (counts.sites[site] ?? {});
}

// The counts of one site go, and it counts again from the given moment, while
// every other site keeps its counts and its start. The counts given are never
// changed.
export function clearSite(
  counts: KeptCounts,
  site: string,
  at: number,
): KeptCounts {
  return {
    since: counts.since,
    siteSince: { ...counts.siteSince, [site]: at },
    sites: Object.fromEntries(
      Object.entries(counts.sites).filter(([key]) => key !== site),
    ),
  };
}

// When the counts of a site started: at its last clear, or with all the
// counts for a site never cleared and for a document that has no site.
export function sinceOf(counts: KeptCounts, site: string | null): number {
  return site === null
    ? counts.since
    : (counts.siteSince[site] ?? counts.since);
}

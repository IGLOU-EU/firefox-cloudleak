// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the popup and the event page exchange through runtime.sendMessage: the
// popup asks, the event page answers. The popup thus never reads the layout
// of the storage, and the event page stays the only writer of the counts.

import type { Colour, LeakLevel } from "./classify.js";
import type { Page } from "./tab-record.js";
import type { TabState } from "./tab-state.js";

// The colour and level of a request, which is also the category the icon and
// the badge show: "red4", "orange3", "blue2".
export type Category = `${Colour}${LeakLevel}`;

// By method and request type, such as "GET image" or "POST xmlhttprequest".
export type RequestKindCounts = {
  readonly [methodAndType: string]: number;
};

export type CategoryCounts = {
  readonly [category in Category]?: RequestKindCounts;
};

// The requests of a site that went through providers, counted and nothing
// else: by provider id, then by category, then by method and request type.
export type SiteCounts = {
  readonly [provider: string]: CategoryCounts;
};

export type PopupRequest =
  // What the active tab shows, and what its site sent through providers.
  | {
      readonly kind: "popup";
      readonly tabId: number;
      readonly privateWindow: boolean;
    }
  // Clear the kept counts of every site and start a new period. The counts
  // of a private session are not kept, so they are left alone.
  | { readonly kind: "clear" };

export interface PopupData {
  // Of the document the tab shows.
  readonly state: TabState;
  readonly page: Page;
  // The registrable domain of the document, in punycode, or null when the
  // document is no website.
  readonly site: string | null;
  readonly privateWindow: boolean;
  // When the kept counts started, in milliseconds since the epoch. Zero in a
  // private window, whose counts live only for the private session.
  readonly since: number;
  // Of the site, kept without limit of time, or of the private session only.
  // Empty when nothing of the site went through a provider.
  readonly totals: SiteCounts;
}

// The answer to a "clear" request.
export interface ClearedData {
  // The start of the new period.
  readonly since: number;
}

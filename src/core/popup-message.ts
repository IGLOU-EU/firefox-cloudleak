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
  // Clear the counts of the site the popup shows, the one PopupData.site
  // gave it, and of no other. Outside a private window, its kept counts,
  // which start again at once. In a private window, its counts of the private
  // session, those the popup shows there, and its kept counts are left alone.
  | {
      readonly kind: "clearSite";
      readonly site: string;
      readonly privateWindow: boolean;
    };

export interface PopupData {
  // Of the document the tab shows.
  readonly state: TabState;
  readonly page: Page;
  // The registrable domain of the document, in punycode, or null for a page
  // of the browser and for a website whose site the extension does not know.
  readonly site: string | null;
  readonly privateWindow: boolean;
  // When the counts of the site started, in milliseconds since the epoch: at
  // its last clear, or when the kept counts started for a site never cleared
  // and for a document without a site. Zero in a private window, whose counts
  // live only for the private session.
  readonly since: number;
  // Of the site, kept without limit of time, or of the private session only.
  // Empty when nothing of the site went through a provider.
  readonly totals: SiteCounts;
}

// The answer to a "clearSite" request.
export interface ClearedData {
  // The new start of the counts of the site, zero in a private window.
  readonly since: number;
}

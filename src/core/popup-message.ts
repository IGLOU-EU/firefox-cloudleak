// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the popup, the preferences page, the map and the event page exchange
// through runtime.sendMessage: the pages ask, the event page answers. The
// pages thus never read the layout of the storage, and the event page stays
// the only writer of the counts and of the ignored sites.

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
    }
  // Ignore a site from now on. The host is a site, as PopupData.site gives
  // it, or what the user typed in the preferences, and the event page reduces
  // it to its registrable domain. The kept counts of the site and its counts
  // of the private session go, its requests are no longer looked at, and the
  // tabs that show it turn to the ignored state.
  | { readonly kind: "ignoreSite"; readonly host: string }
  // Watch a site again: its counts start from nothing.
  | { readonly kind: "unignoreSite"; readonly site: string }
  // The ignored sites, for the preferences page.
  | { readonly kind: "ignoredSites" }
  // The counts of every site, for the map: the kept counts, or in a private
  // window those of the private session only.
  | { readonly kind: "map"; readonly privateWindow: boolean }
  // Clear the counts of every site, those the map shows. Outside a private
  // window, every kept count and the start of each site cleared alone, and
  // the counts start again at once, for every site. In a private window, the
  // counts of the private session, and the kept counts are left alone. The
  // ignored sites stay ignored.
  | { readonly kind: "purgeAll"; readonly privateWindow: boolean };

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
  // The user asked to ignore the site: nothing of it is looked at or kept.
  readonly ignored: boolean;
}

// The answer to a "clearSite" or a "purgeAll" request.
export interface ClearedData {
  // The new start of the counts of the site, or of every site, zero in a
  // private window.
  readonly since: number;
}

// The answer to a "map" request.
export interface MapData {
  readonly privateWindow: boolean;
  // When the counts started, in milliseconds since the epoch: at the first
  // run of the extension or at the last purge of every site. Zero in a
  // private window, whose counts live only for the private session.
  readonly since: number;
  // The start of each site cleared alone since, or watched again, which the
  // common start would misdate. Empty in a private window.
  readonly siteSince: { readonly [site: string]: number };
  // By site, in punycode. A site may have an empty entry, as one cleared
  // alone has until a request of it goes through a provider again.
  readonly sites: { readonly [site: string]: SiteCounts };
}

// The answer to "ignoreSite", "unignoreSite" and "ignoredSites".
export interface IgnoredData {
  // In punycode, in alphabetical order.
  readonly sites: readonly string[];
  // The site the request named, once reduced, or null when what the user
  // typed names no site. Null for "ignoredSites".
  readonly site: string | null;
}

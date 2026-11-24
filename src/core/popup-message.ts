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

// Which requests have their address recorded: none, those of level 4 only,
// or those of levels 3 and 4. Never those of level 2, nor those of a private
// window.
export type RecordLevel = "none" | "level4" | "level3and4";

// The preferences of the user, kept in storage.local.
export interface Settings {
  readonly record: RecordLevel;
  // How many addresses each row keeps: an integer of at least 1, as large as
  // the user wants.
  readonly recordLimit: number;
  // The dynamic detection: a request no known provider claims, whose host
  // has a canonical name that leaves its domain, counts for a supposed
  // provider, named by the domain of that name. Off by default.
  readonly dynamic: boolean;
}

// The recorded addresses of a site, laid out as its counts are: by provider
// id, then by category, then by method and request type. Each row lists
// distinct addresses, the most recently seen first, and nothing else: no
// count and no time, which would tell when the user was on the site.
export type SiteAddresses = {
  readonly [provider: string]: {
    readonly [category in Category]?: {
      readonly [methodAndType: string]: readonly string[];
    };
  };
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
  // which start again at once, and its recorded addresses. In a private
  // window, its counts of the private session, those the popup shows there,
  // and its kept counts and addresses are left alone.
  | {
      readonly kind: "clearSite";
      readonly site: string;
      readonly privateWindow: boolean;
    }
  // Ignore a site from now on. The host is a site, as PopupData.site gives
  // it, or what the user typed in the preferences, and the event page reduces
  // it to its registrable domain. The kept counts of the site, its recorded
  // addresses and its counts of the private session go, its requests are no
  // longer looked at, and the tabs that show it turn to the ignored state.
  | { readonly kind: "ignoreSite"; readonly host: string }
  // Watch a site again: its counts start from nothing.
  | { readonly kind: "unignoreSite"; readonly site: string }
  // The ignored sites, for the preferences page.
  | { readonly kind: "ignoredSites" }
  // The counts of every site, for the map: the kept counts, or in a private
  // window those of the private session only.
  | { readonly kind: "map"; readonly privateWindow: boolean }
  // The counts of every site, as "map" gives them, with the recorded
  // addresses of every site, for the export of the map, answered with
  // ExportData. In a private window, no address.
  | { readonly kind: "export"; readonly privateWindow: boolean }
  // Clear the counts of every site, those the map shows. Outside a private
  // window, every kept count and the start of each site cleared alone, and
  // the counts start again at once, for every site. In a private window, the
  // counts of the private session, and the kept counts are left alone. The
  // ignored sites stay ignored. The recorded addresses go with the kept
  // counts.
  | { readonly kind: "purgeAll"; readonly privateWindow: boolean }
  // The settings, answered with Settings.
  | { readonly kind: "settings" }
  // Change the settings, answered with the Settings kept. A limit that is
  // not an integer of at least 1 is refused. Turning the recording off,
  // narrowing its levels or lowering its limit drops at once every kept
  // address the new settings leave out. Turning the dynamic detection off
  // drops at once everything kept of the supposed providers.
  | {
      readonly kind: "setSettings";
      readonly record: RecordLevel;
      readonly recordLimit: number;
      readonly dynamic: boolean;
    }
  // The recorded addresses of a site, answered with SiteAddresses, always
  // empty in a private window, where nothing is recorded.
  | {
      readonly kind: "siteAddresses";
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

// The answer to an "export" request.
export interface ExportData extends MapData {
  // By site, in punycode, as the panel of each site shows them: those
  // recorded and not yet written included, and the sites without any left
  // out. Empty in a private window, where nothing is recorded.
  readonly addresses: { readonly [site: string]: SiteAddresses };
}

// The answer to "ignoreSite", "unignoreSite" and "ignoredSites".
export interface IgnoredData {
  // In punycode, in alphabetical order.
  readonly sites: readonly string[];
  // The site the request named, once reduced, or null when what the user
  // typed names no site. Null for "ignoredSites".
  readonly site: string | null;
}

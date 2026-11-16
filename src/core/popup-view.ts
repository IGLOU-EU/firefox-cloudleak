// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the popup shows of the data the event page answers: the rows of its
// tables, their order, its titles and which sections show. Pure, so that it
// is tested without a browser, and the page only puts it into the DOM.

import { type Colour, colourOf, type LeakLevel } from "./classify.js";
import {
  CATEGORIES,
  colourOfCategory,
  levelOfCategory,
  proofOfCategory,
  rankOf,
  sumOf,
} from "./counts.js";
import {
  type Display,
  displayOf,
  type Icon,
  line,
  type TitleLine,
} from "./display.js";
import type { CategoryCounts, PopupData, SiteCounts } from "./popup-message.js";
import type { Tally } from "./tab-state.js";

// One row of a table of counts: the cloud of its category, the name of its
// level, the proof of decryption where the colour depends on it, and the
// number of requests.
export interface Row {
  readonly colour: Colour;
  readonly level: LeakLevel;
  readonly label: TitleLine;
  // Null where the colour does not depend on the proof.
  readonly proof: TitleLine | null;
  readonly count: number;
}

export interface ProviderRows {
  readonly name: string;
  // From the most serious category.
  readonly rows: readonly Row[];
}

export interface PageSection {
  // The counts of the tab, from the most serious.
  readonly rows: readonly Row[];
  // What the provider of the most serious request sees and what the tab saw
  // among it, or why there is nothing to count.
  readonly lines: readonly TitleLine[];
  // Why the view is partial, set apart from the rest.
  readonly partial: readonly TitleLine[];
}

export interface SiteSection {
  readonly title: TitleLine;
  // Empty when nothing of the site went through a provider.
  readonly providers: readonly ProviderRows[];
}

// What the header names: the registrable domain of a website, in punycode, a
// website whose site the extension does not know, or a page of the browser,
// reader view included.
export type Header =
  | { readonly kind: "site"; readonly site: string }
  | { readonly kind: "unknown-site" }
  | { readonly kind: "browser-page" };

export interface PopupView {
  readonly icon: Icon;
  readonly header: Header;
  // Null for a page of the browser whose state has nothing to say.
  readonly page: PageSection | null;
  // Null when the site is not known, as for a page of the browser.
  readonly totals: SiteSection | null;
  // Whether the popup says there is nothing to count, which it says only
  // when it shows nothing else.
  readonly notice: boolean;
  // Whether the popup says the site is ignored, in place of the page and of
  // its totals, since nothing of it is looked at.
  readonly ignored: boolean;
  // Whether the popup says the site it has just stopped ignoring is watched
  // again.
  readonly watchedAgain: boolean;
  // What ignoring the site asks before it ignores. Null without a site, for
  // a site already ignored, and in a private window, so that no site visited
  // in private enters the list of the ignored sites, which is kept on disk.
  readonly ignoreQuestion: TitleLine | null;
  // Whether the popup offers to watch the site again: for an ignored site
  // only, private window included, since that writes no site visited in
  // private.
  readonly unignore: boolean;
  // What the clear of the site asks before it clears. Null without a site,
  // which leaves nothing to clear, and for an ignored site, which keeps
  // nothing.
  readonly clearQuestion: TitleLine | null;
}

export type Providers = readonly {
  readonly id: string;
  readonly name: string;
}[];

// The date is asked for only outside a private window, whose counts have no
// start: they live with the private session. The site is asked for in the
// form the header shows it, so that each question names the site the user
// reads above. The site is watched again when the popup has just stopped
// ignoring it.
export function viewOf(
  data: PopupData,
  providers: Providers,
  formatDate: (sinceMs: number) => string,
  formatSite: (site: string) => string,
  watchedAgain = false,
): PopupView {
  if (data.ignored && data.site !== null) {
    return ignoredView(data.site);
  }
  const display = displayOf(data.state, providers);
  const date = data.privateWindow ? null : formatDate(data.since);
  const page = pageOf(data, display);
  const totals: SiteSection | null =
    data.site === null
      ? null
      : {
          title:
            date === null ? line("popupSitePrivate") : line("popupSite", date),
          providers: providerRows(data.totals, providers),
        };
  return {
    icon: display.icon,
    header: headerOf(data),
    page,
    totals,
    notice: page === null && totals === null,
    ignored: false,
    watchedAgain: watchedAgain && data.site !== null,
    ignoreQuestion:
      data.site === null || data.privateWindow
        ? null
        : line("popupIgnoreSiteQuestion", formatSite(data.site)),
    unignore: false,
    clearQuestion: questionOf(data.site, date, formatSite),
  };
}

// The event page says the site is ignored, whatever the state of the
// document: the cloud then has nothing to warn of, and the popup counts
// nothing.
function ignoredView(site: string): PopupView {
  return {
    icon: "neutral",
    header: { kind: "site", site },
    page: null,
    totals: null,
    notice: false,
    ignored: true,
    watchedAgain: false,
    ignoreQuestion: null,
    unignore: true,
    clearQuestion: null,
  };
}

function questionOf(
  site: string | null,
  date: string | null,
  formatSite: (site: string) => string,
): TitleLine | null {
  if (site === null) {
    return null;
  }
  return date === null
    ? line("popupClearSiteQuestionPrivate", formatSite(site))
    : line("popupClearSiteQuestion", formatSite(site), date);
}

// A clear takes the counts of the site the popup shows, those of the private
// session in a private window, and the event page gives their new start,
// zero in a private window.
export function cleared(data: PopupData, since: number): PopupData {
  return { ...data, totals: {}, since };
}

// A website whose site the extension does not know is still a website: it
// is not named a page of the browser.
function headerOf(data: PopupData): Header {
  if (data.page !== "site") {
    return { kind: "browser-page" };
  }
  return data.site === null
    ? { kind: "unknown-site" }
    : { kind: "site", site: data.site };
}

const PARTIAL = new Set(["titlePartial", "titleMissed"]);

// The tooltip says the counts of the tab, then what they mean: the counts are
// rows here, and its last paragraph is what they mean. A page of the browser
// sends no request of its own, so a state that says nothing is left to the
// notice of the page, while reader view loads the images of the article from
// the web, so what such a tab saw is shown as for a site. A website always
// says what the tab saw, whether its site is known or not.
function pageOf(data: PopupData, display: Display): PageSection | null {
  const state = data.state;
  if (
    data.page !== "site" &&
    state.kind === "neutral" &&
    !state.partial &&
    !state.missed
  ) {
    return null;
  }
  const last = display.title[display.title.length - 1] ?? [];
  return {
    rows: state.kind === "seen" ? state.tallies.map(rowOfTally) : [],
    lines: last.filter((entry) => !PARTIAL.has(entry.message)),
    partial: last.filter((entry) => PARTIAL.has(entry.message)),
  };
}

function rowOfTally(tally: Tally): Row {
  return rowOf(
    colourOf(tally.level, tally.proven === true),
    tally.level,
    tally.proven,
    tally.count,
  );
}

function rowOf(
  colour: Colour,
  level: LeakLevel,
  proven: boolean | null,
  count: number,
): Row {
  return {
    colour,
    level,
    label: line(`level${level}`),
    proof:
      proven === null
        ? null
        : line(proven ? "decryptionProven" : "decryptionUnproven"),
    count,
  };
}

// A provider comes before another when its most serious category does, and
// by name at the same category. One without any request is left out.
function providerRows(
  totals: SiteCounts,
  providers: Providers,
): ProviderRows[] {
  return Object.entries(totals)
    .map(([id, categories]) => ({
      name: providers.find((entry) => entry.id === id)?.name ?? id,
      rows: rowsOf(categories),
    }))
    .filter((entry) => entry.rows.length > 0)
    .sort(
      (a, b) =>
        leadRank(a) - leadRank(b) || a.name.localeCompare(b.name, undefined),
    );
}

function leadRank(entry: ProviderRows): number {
  const lead = entry.rows[0];
  return lead === undefined
    ? Number.POSITIVE_INFINITY
    : rankOf(lead.colour, lead.level);
}

// A row for each category of CATEGORIES with requests, in its order, with the
// proof its colour says.
function rowsOf(categories: CategoryCounts): Row[] {
  const rows: Row[] = [];
  for (const category of CATEGORIES) {
    const count = sumOf(categories[category]);
    if (count > 0) {
      rows.push(
        rowOf(
          colourOfCategory(category),
          levelOfCategory(category),
          proofOfCategory(category),
          count,
        ),
      );
    }
  }
  return rows;
}

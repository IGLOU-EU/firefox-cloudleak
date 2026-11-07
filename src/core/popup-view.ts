// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the popup shows of the data the event page answers: the rows of its
// tables, their order, its titles and which sections show. Pure, so that it
// is tested without a browser, and the page only puts it into the DOM.

import { type Colour, colourOf, type LeakLevel } from "./classify.js";
import {
  type Display,
  displayOf,
  type Icon,
  line,
  type TitleLine,
} from "./display.js";
import type {
  CategoryCounts,
  PopupData,
  RequestKindCounts,
  SiteCounts,
} from "./popup-message.js";
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

export interface PopupView {
  readonly icon: Icon;
  // The registrable domain of the document, in punycode, or null for a page
  // of the browser.
  readonly site: string | null;
  // Null for a page of the browser whose state has nothing to say.
  readonly page: PageSection | null;
  // Null for a page of the browser, which has no site.
  readonly totals: SiteSection | null;
  // What "clear all" asks before it clears.
  readonly question: TitleLine;
}

export type Providers = readonly {
  readonly id: string;
  readonly name: string;
}[];

// The date is asked for only outside a private window, whose counts have no
// start: they live with the private session.
export function viewOf(
  data: PopupData,
  providers: Providers,
  formatDate: (sinceMs: number) => string,
): PopupView {
  const display = displayOf(data.state, providers);
  const date = data.privateWindow ? null : formatDate(data.since);
  return {
    icon: display.icon,
    site: data.site,
    page: pageOf(data, display),
    totals:
      data.site === null
        ? null
        : {
            title:
              date === null
                ? line("popupSitePrivate")
                : line("popupSite", date),
            providers: providerRows(data.totals, providers),
          },
    question:
      date === null
        ? line("popupClearQuestionPrivate")
        : line("popupClearQuestion", date),
  };
}

// The counts of a private session are not kept, so a clear leaves them alone
// and the popup of a private window keeps showing them.
export function cleared(data: PopupData, since: number): PopupData {
  return data.privateWindow ? data : { ...data, totals: {}, since };
}

const PARTIAL = new Set(["titlePartial", "titleMissed"]);

// The tooltip says the counts of the tab, then what they mean: the counts are
// rows here, and its last paragraph is what they mean. A page of the browser
// sends no request of its own, so a state that says nothing is left to the
// notice of the page, while reader view loads the images of the article from
// the web, so what such a tab saw is shown as for a site.
function pageOf(data: PopupData, display: Display): PageSection | null {
  const state = data.state;
  if (
    data.site === null &&
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

// The order of the icon and the tooltip: red before orange before blue, then
// the highest level first.
const COLOURS: readonly Colour[] = ["red", "orange", "blue"];
const LEVELS: readonly LeakLevel[] = [4, 3, 2, 1];

function rankOf(row: Row): number {
  return (
    COLOURS.indexOf(row.colour) * LEVELS.length + LEVELS.indexOf(row.level)
  );
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
  return lead === undefined ? Number.POSITIVE_INFINITY : rankOf(lead);
}

// A category is its colour then its level, "red4", and its proof is what the
// colour says: red is proven, orange is not, and blue depends on no proof. A
// category this version does not know is left out rather than guessed.
function rowsOf(categories: CategoryCounts): Row[] {
  const rows: Row[] = [];
  for (const colour of COLOURS) {
    for (const level of LEVELS) {
      const count = sumOf(categories[`${colour}${level}`]);
      if (count > 0) {
        rows.push(
          rowOf(
            colour,
            level,
            colour === "blue" ? null : colour === "red",
            count,
          ),
        );
      }
    }
  }
  return rows;
}

function sumOf(kinds: RequestKindCounts | undefined): number {
  return Object.values(kinds ?? {}).reduce((sum, count) => sum + count, 0);
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the preferences page shows: the ignored sites, what the text the user
// types to add one gives, and the recording of addresses. Pure, so that it is
// tested without a browser, and the page only puts it into the DOM.

import { recordLimitOf } from "./addresses.js";
import { line, type TitleLine } from "./display.js";
import type { RecordLevel } from "./popup-message.js";

export interface IgnoredRow {
  // In punycode, as the event page names it.
  readonly site: string;
  // As the header of the popup shows it.
  readonly text: string;
  // The accessible name of its button, which names the site, since every row
  // has the same button.
  readonly remove: TitleLine;
}

// In the order of the text the user reads, which the punycode does not
// follow: xn--bcher-kva.de is bücher.de.
export function rowsOf(
  sites: readonly string[],
  formatSite: (site: string) => string,
): IgnoredRow[] {
  return sites
    .map((site) => {
      const text = formatSite(site);
      return { site, text, remove: line("optionsRemoveSite", text) };
    })
    .sort((a, b) => a.text.localeCompare(b.text));
}

// What the line under the field says: how to name a site while nothing is
// typed, the site the text gives, in the form the list shows it, or why
// adding it adds nothing.
export type FieldNote =
  | { readonly kind: "help" }
  | { readonly kind: "preview"; readonly site: string }
  | { readonly kind: "already"; readonly line: TitleLine }
  | { readonly kind: "refused"; readonly line: TitleLine };

// The site is the reduction the event page makes of the same text, made in
// the page so that the text goes to the event page only once the user adds
// it. A refused text is shown back as the user reads it in the field.
export function noteOf(
  typed: string,
  site: string | null,
  sites: readonly string[],
  formatSite: (site: string) => string,
): FieldNote {
  const text = typed.trim();
  if (text === "") {
    return { kind: "help" };
  }
  if (site === null) {
    return { kind: "refused", line: line("optionsRefused", text) };
  }
  if (sites.includes(site)) {
    return { kind: "already", line: line("optionsAlready", formatSite(site)) };
  }
  return { kind: "preview", site: formatSite(site) };
}

// What the section of the recording shows, from the level the event page
// keeps and the one the radio buttons show. Going back to none purges the
// kept addresses, so it is asked first: the radio buttons show none while
// the question waits, and nothing changes before the user confirms. The
// limit counts only while something is recorded.
export interface RecordView {
  readonly asking: boolean;
  readonly limit: boolean;
}

export function recordViewOf(
  kept: RecordLevel,
  chosen: RecordLevel,
): RecordView {
  return {
    asking: chosen === "none" && kept !== "none",
    limit: chosen !== "none",
  };
}

// The limit typed in its field: an integer of at least 1, written in digits,
// as large as the user wants, or null for anything else, which the field
// refuses and nothing keeps.
export function limitOf(typed: string): number | null {
  const text = typed.trim();
  return /^[0-9]+$/.test(text) ? recordLimitOf(Number(text)) : null;
}

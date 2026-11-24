// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The file the map saves at a click on its download icon, so that the user
// can study what the extension kept: the statistics the map shows, by site,
// and the addresses recorded, never the settings nor the ignored sites. Its
// format is described in CONTRIBUTING.md, section "The export file", and its
// number changes with any change a reader of the file would have to follow.

import type { ExportData, SiteAddresses, SiteCounts } from "./popup-message.js";

const EXPORT_FORMAT = 1;

export interface ExportFile {
  readonly format: typeof EXPORT_FORMAT;
  // Of the extension that wrote the file.
  readonly version: string;
  // Each date is a day, YYYY-MM-DD in the local time of the browser, as the
  // starts of the counts are kept.
  readonly exported: string;
  readonly privateWindow: boolean;
  // Null in a private window, whose counts live only for the private session.
  readonly since: string | null;
  readonly siteSince: { readonly [site: string]: string };
  readonly sites: { readonly [site: string]: SiteCounts };
  readonly addresses: { readonly [site: string]: SiteAddresses };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

// The local day of a moment, as dayOf of core/counts.ts keeps it.
function dayText(ms: number): string {
  const day = new Date(ms);
  return `${day.getFullYear()}-${twoDigits(day.getMonth() + 1)}-${twoDigits(day.getDate())}`;
}

// A site the map shows: one request at least, through some provider.
function hasCounts(counts: SiteCounts): boolean {
  return Object.values(counts).some((categories) =>
    Object.values(categories).some((kinds) =>
      Object.values(kinds ?? {}).some((count) => count > 0),
    ),
  );
}

// The keys of an object in order, at every depth, so that the same
// statistics always give the same file. A list keeps its order: the
// addresses of a row go from the most recently seen.
function sorted<T>(value: T): T {
  if (Array.isArray(value) || typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, sorted(entry)]),
  ) as T;
}

// The sites of the file are those the map shows: a site cleared alone with
// nothing counted since goes, with its own start and its addresses.
export function exportFileOf(
  data: ExportData,
  version: string,
  now: number,
): ExportFile {
  const sites = Object.fromEntries(
    Object.entries(data.sites).filter(([, counts]) => hasCounts(counts)),
  );
  const shown = (site: string) => Object.hasOwn(sites, site);
  return {
    format: EXPORT_FORMAT,
    version,
    exported: dayText(now),
    privateWindow: data.privateWindow,
    since: data.privateWindow ? null : dayText(data.since),
    siteSince: sorted(
      Object.fromEntries(
        Object.entries(data.siteSince)
          .filter(([site]) => shown(site))
          .map(([site, since]) => [site, dayText(since)]),
      ),
    ),
    sites: sorted(sites),
    addresses: sorted(
      Object.fromEntries(
        Object.entries(data.addresses).filter(([site]) => shown(site)),
      ),
    ),
  };
}

// The name the browser offers for the file, of the day of the export.
export function exportNameOf(now: number): string {
  return `cloud-leak-${dayText(now)}.json`;
}

// Indented, to be read as it is, and ended by a line break, as a text file.
export function exportTextOf(file: ExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

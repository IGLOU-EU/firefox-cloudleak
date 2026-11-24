// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the map shows of the counts the event page answers: the column of the
// sites, the providers on the right and the links between them, what the
// search and the limits keep, and the panel. Pure, so that it is tested
// without a browser, and the page only puts it into the DOM.

import type { Colour } from "./classify.js";
import {
  CATEGORIES,
  colourOfCategory,
  type KnownCategory,
  levelOfCategory,
  proofOfCategory,
  sumOf,
} from "./counts.js";
import type {
  CategoryCounts,
  MapData,
  RequestKindCounts,
  SiteAddresses,
} from "./popup-message.js";
import { isSupposed } from "./supposed.js";

// The column, its headings and the panel follow the order of CATEGORIES.
function rankOf(category: KnownCategory): number {
  return CATEGORIES.indexOf(category);
}

// The keys of what the map draws and what a click selects: a site, a
// provider, a group of blue sites by its providers, and the link of a site or
// of a group to a provider.
function siteKey(site: string): string {
  return `s:${site}`;
}

function providerKey(provider: string): string {
  return `f:${provider}`;
}

function groupKey(together: string): string {
  return `g:${together}`;
}

function siteLinkKey(site: string, provider: string): string {
  return `l:${site}|${provider}`;
}

function groupLinkKey(together: string, provider: string): string {
  return `lg:${together}|${provider}`;
}

export interface KeyParts {
  readonly kind: "site" | "provider" | "group" | "site-link" | "group-link";
  // The site, the provider or the providers of the group, and for a link
  // those of its row.
  readonly name: string;
}

const KEY_KINDS: ReadonlyMap<string, KeyParts["kind"]> = new Map([
  ["s", "site"],
  ["f", "provider"],
  ["g", "group"],
  ["l", "site-link"],
  ["lg", "group-link"],
]);

// The kind ends at the first colon, since a site in IPv6 holds colons of its
// own, and a link names its provider after the last bar, since a provider id
// holds none. Null for a key of no kind the map draws.
export function keyPartsOf(key: string): KeyParts | null {
  const colon = key.indexOf(":");
  const kind = KEY_KINDS.get(key.slice(0, colon));
  if (kind === undefined) {
    return null;
  }
  const rest = key.slice(colon + 1);
  return {
    kind,
    name:
      kind === "site-link" || kind === "group-link"
        ? rest.slice(0, rest.lastIndexOf("|"))
        : rest,
  };
}

// "red4" names its messages "…Red4".
function suffixOf(category: KnownCategory): string {
  return `${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

// The geometry of the column, in pixels: a row of each site or group, and a
// heading above each category.
export const LIST_TOP = 32;
export const ROW_HEIGHT = 24;
const LIST_BOTTOM = 12;

// The blue sites through the same providers make one row past three, since
// hundreds of them would push the others out of sight.
const GROUP_ABOVE = 3;

// The middle of the row in a slot of the column.
export function yOf(slot: number): number {
  return LIST_TOP + slot * ROW_HEIGHT + ROW_HEIGHT / 2;
}

export function heightOf(column: Column): number {
  return LIST_TOP + column.slots * ROW_HEIGHT + LIST_BOTTOM;
}

// What the map writes, in the language of the browser.
export interface MapFormats {
  // A message of _locales, its placeholders filled in order.
  readonly message: (name: string, substitutions: readonly string[]) => string;
  readonly number: (count: number) => string;
  readonly date: (ms: number) => string;
  // Whether a count takes the singular of the word it counts, which 0 also
  // does in French.
  readonly singular: (count: number) => boolean;
  // The name of a country by its ISO 3166-1 alpha-2 code.
  readonly country: (code: string) => string;
  // Names joined as a sentence lists them: "Cloudflare et Fastly".
  readonly list: (names: readonly string[]) => string;
  // A site as the header of the popup shows it, from its punycode.
  readonly site: (site: string) => string;
}

// The numbers, dates, plurals, countries and lists of the language, as the
// browser writes them.
export function formatsOf(
  language: string,
  message: MapFormats["message"],
  site: MapFormats["site"],
): MapFormats {
  const numbers = new Intl.NumberFormat(language);
  const dates = new Intl.DateTimeFormat(language, { dateStyle: "long" });
  const plurals = new Intl.PluralRules(language);
  const regions = new Intl.DisplayNames(language, { type: "region" });
  const lists = new Intl.ListFormat(language, { type: "conjunction" });
  return {
    message,
    number: (count) => numbers.format(count),
    date: (ms) => dates.format(ms),
    singular: (count) => plurals.select(count) === "one",
    // The data holds codes the build checked, and of() throws on others.
    country: (code) =>
      /^[A-Z]{2}$/.test(code) ? (regions.of(code) ?? code) : code,
    list: (names) => lists.format(names),
    site,
  };
}

export type MapProviders = readonly {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly parent: { readonly name: string; readonly country: string } | null;
}[];

// Stands for the country of a supposed provider, which nothing tells: a
// limit of the map by country takes it as any other.
export const UNKNOWN_COUNTRY = "?";

// The flag of a country, as the pair of regional indicator symbols of its
// ISO 3166-1 alpha-2 code, which Firefox draws with its own emoji font: no
// image to ship. A question mark for the unknown country of a supposed
// provider, and nothing for a code that is not one.
export function flagOf(country: string): string {
  if (country === UNKNOWN_COUNTRY) {
    return "\u2753";
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    return "";
  }
  return String.fromCodePoint(
    ...[...country].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
  );
}

// The requests of a site through one provider, of the categories this
// version knows. The link takes the most serious of them.
export interface MapLink {
  readonly provider: string;
  readonly categories: {
    readonly [category in KnownCategory]?: RequestKindCounts;
  };
  readonly total: number;
  readonly worst: KnownCategory;
  readonly title: string;
}

export interface MapSite {
  // In punycode, as the event page names it.
  readonly site: string;
  // As the header of the popup shows it, and the search reads it.
  readonly name: string;
  readonly key: string;
  // Its own start, for a site cleared alone or watched again, or null.
  readonly since: number | null;
  // From the most serious, then the most requests.
  readonly links: readonly MapLink[];
  readonly worst: KnownCategory;
  readonly total: number;
  // Its providers, which a blue site shares with the others of its group.
  readonly together: string;
  readonly title: string;
}

export interface MapProvider {
  readonly id: string;
  readonly name: string;
  // Empty for a provider this version no longer knows, and UNKNOWN_COUNTRY
  // for a supposed provider.
  readonly country: string;
  readonly flag: string;
  readonly parent: { readonly name: string; readonly country: string } | null;
  // Its name, the law it is subject to, and its parent company when another
  // law applies to it.
  readonly title: string;
  // Its sites, from the most serious link, then the most requests.
  readonly sites: readonly { readonly site: MapSite; readonly link: MapLink }[];
}

interface Basis {
  readonly privateWindow: boolean;
  readonly since: number;
  // In no particular order: the column ranks them.
  readonly sites: readonly MapSite[];
  readonly site: ReadonlyMap<string, MapSite>;
  // The most sites first.
  readonly providers: readonly MapProvider[];
  readonly provider: ReadonlyMap<string, MapProvider>;
  // How many blue sites each set of providers has.
  readonly groups: ReadonlyMap<string, number>;
  readonly formats: MapFormats;
}

export interface PreparedMap extends Basis {
  // The column without any filter, whose order the panel keeps whatever the
  // filters.
  readonly whole: Column;
  // The providers from the top of the right side, at the mean height of
  // their sites in the whole column, so that they keep their place whatever
  // the filters and their links cross as little as they can.
  readonly order: readonly string[];
}

function counted(
  formats: MapFormats,
  word: "mapSites" | "mapProviders" | "mapRequests",
  count: number,
): string {
  return formats.message(`${word}${formats.singular(count) ? "One" : "Many"}`, [
    formats.number(count),
  ]);
}

// "12 sites sur 334" under a filter, and "334 sites" when all are kept.
function sitesOf(formats: MapFormats, count: number, of: number): string {
  if (count === of) {
    return counted(formats, "mapSites", of);
  }
  return formats.message(
    `mapSitesOf${formats.singular(count) ? "One" : "Many"}`,
    [formats.number(count), formats.number(of)],
  );
}

function levelOf(formats: MapFormats, category: KnownCategory): string {
  return formats.message(`mapLevel${suffixOf(category)}`, []);
}

function linkOf(
  provider: string,
  counts: CategoryCounts,
): Omit<MapLink, "title"> | null {
  const categories: { [category in KnownCategory]?: RequestKindCounts } = {};
  let total = 0;
  let worst: KnownCategory | null = null;
  for (const category of CATEGORIES) {
    const kinds = counts[category];
    const count = sumOf(kinds);
    if (kinds !== undefined && count > 0) {
      categories[category] = kinds;
      total += count;
      worst ??= category;
    }
  }
  return worst === null ? null : { provider, categories, total, worst };
}

function providerTitle(
  formats: MapFormats,
  name: string,
  country: string,
  parent: MapProvider["parent"],
): string {
  if (country === "") {
    return name;
  }
  if (country === UNKNOWN_COUNTRY) {
    return formats.message("mapProviderSupposed", [name]);
  }
  const law = formats.message(`mapLawOf${country}`, []);
  if (parent === null || parent.country === country) {
    return formats.message("mapProviderLaw", [name, law]);
  }
  return formats.message("mapProviderLawParent", [
    name,
    law,
    parent.name,
    formats.message(`mapIn${parent.country}`, []),
  ]);
}

// Once for each answer of the event page: what does not depend on the
// filters, the tooltips of the sites and of their links included.
export function prepare(
  data: MapData,
  table: MapProviders,
  formats: MapFormats,
): PreparedMap {
  const known = new Map(table.map((entry) => [entry.id, entry]));
  const nameOf = (id: string) => known.get(id)?.name ?? id;
  const levels = new Map(
    CATEGORIES.map((category) => [category, levelOf(formats, category)]),
  );
  const sites: MapSite[] = [];
  for (const [site, counts] of Object.entries(data.sites)) {
    const name = formats.site(site);
    const links = Object.entries(counts)
      .map(([provider, categories]) => linkOf(provider, categories))
      .filter((link) => link !== null)
      .sort(
        (a, b) =>
          rankOf(a.worst) - rankOf(b.worst) ||
          b.total - a.total ||
          a.provider.localeCompare(b.provider),
      )
      .map((link) => ({
        ...link,
        title: formats.message("mapLinkTitle", [
          name,
          nameOf(link.provider),
          counted(formats, "mapRequests", link.total),
          levels.get(link.worst) ?? "",
        ]),
      }));
    const lead = links[0];
    if (lead === undefined) {
      continue;
    }
    const total = links.reduce((sum, link) => sum + link.total, 0);
    sites.push({
      site,
      name,
      key: name.toLowerCase(),
      since: data.privateWindow ? null : (data.siteSince[site] ?? null),
      links,
      worst: lead.worst,
      total,
      together: links
        .map((link) => link.provider)
        .sort()
        .join("+"),
      title: formats.message("mapSiteTitle", [
        name,
        counted(formats, "mapRequests", total),
        levels.get(lead.worst) ?? "",
      ]),
    });
  }
  sites.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const bySite = new Map(sites.map((entry) => [entry.site, entry]));
  const lists = new Map<string, { site: MapSite; link: MapLink }[]>();
  const groups = new Map<string, number>();
  for (const site of sites) {
    for (const link of site.links) {
      const list = lists.get(link.provider) ?? [];
      list.push({ site, link });
      lists.set(link.provider, list);
    }
    if (site.worst === "blue2") {
      groups.set(site.together, (groups.get(site.together) ?? 0) + 1);
    }
  }
  const providers: MapProvider[] = [...lists]
    .map(([id, list]) => {
      const entry = known.get(id);
      const name = entry?.name ?? id;
      const country = entry?.country ?? (isSupposed(id) ? UNKNOWN_COUNTRY : "");
      const parent = entry?.parent ?? null;
      return {
        id,
        name,
        country,
        flag: flagOf(country),
        parent,
        title: providerTitle(formats, name, country, parent),
        sites: list.sort(
          (a, b) =>
            rankOf(a.link.worst) - rankOf(b.link.worst) ||
            b.link.total - a.link.total,
        ),
      };
    })
    .sort(
      (a, b) => b.sites.length - a.sites.length || a.name.localeCompare(b.name),
    );
  const basis: Basis = {
    privateWindow: data.privateWindow,
    since: data.since,
    sites,
    site: bySite,
    providers,
    provider: new Map(providers.map((entry) => [entry.id, entry])),
    groups,
    formats,
  };
  const whole = columnOf(basis, NO_FILTER);
  return { ...basis, whole, order: orderOf(providers, whole) };
}

function orderOf(
  providers: readonly MapProvider[],
  whole: Column,
): readonly string[] {
  const slots = new Map<string, number[]>();
  for (const link of whole.links) {
    const list = slots.get(link.provider) ?? [];
    list.push(link.slot);
    slots.set(link.provider, list);
  }
  const mean = (id: string) => {
    const list = slots.get(id) ?? [];
    return list.reduce((sum, slot) => sum + slot, 0) / (list.length || 1);
  };
  return providers.map((entry) => entry.id).sort((a, b) => mean(a) - mean(b));
}

// What the search and the limits ask for. One limit per list: a second one
// replaces the first.
export interface Filters {
  readonly text: string;
  readonly provider: string | null;
  readonly category: KnownCategory | null;
  readonly country: string | null;
}

export type LimitList = "provider" | "category" | "country";

export const NO_FILTER: Filters = {
  text: "",
  provider: null,
  category: null,
  country: null,
};

export function isFiltered(filters: Filters): boolean {
  return (
    filters.text.trim() !== "" ||
    filters.provider !== null ||
    filters.category !== null ||
    filters.country !== null
  );
}

// A click on the row of the active limit removes it, a click on another row
// of its list replaces it.
export function toggled(
  filters: Filters,
  list: LimitList,
  value: string,
): Filters {
  if (list === "category") {
    const category = CATEGORIES.find((entry) => entry === value) ?? null;
    return {
      ...filters,
      category: filters.category === category ? null : category,
    };
  }
  return { ...filters, [list]: filters[list] === value ? null : value };
}

export function withoutLimit(filters: Filters, list: LimitList): Filters {
  return { ...filters, [list]: null };
}

interface Kept {
  readonly site: MapSite;
  // Those the limits keep.
  readonly links: readonly MapLink[];
}

// The search reads the name as Firefox shows it, whatever its case and never
// in punycode, but keeps its accents, since almost every domain name is
// written without them.
function searchOf(filters: Filters): string {
  return filters.text.trim().toLowerCase();
}

// A link stays if it goes to the provider, to a provider subject to the law
// of the country, and if its own category is the one asked for. A site stays
// if it passes the search and keeps at least one link.
function keptOf(basis: Basis, filters: Filters): Kept[] {
  const text = searchOf(filters);
  const countryOf = (id: string) => basis.provider.get(id)?.country ?? "";
  const passes = (link: MapLink) =>
    (filters.provider === null || link.provider === filters.provider) &&
    (filters.country === null ||
      countryOf(link.provider) === filters.country) &&
    (filters.category === null || link.worst === filters.category);
  const kept: Kept[] = [];
  for (const site of basis.sites) {
    if (text !== "" && !site.key.includes(text)) {
      continue;
    }
    const links = site.links.filter(passes);
    if (links.length > 0) {
      kept.push({ site, links });
    }
  }
  return kept;
}

export interface Match {
  readonly start: number;
  readonly end: number;
}

export interface SiteRow {
  readonly kind: "site";
  readonly key: string;
  readonly slot: number;
  readonly site: MapSite;
  // Those the limits keep, the only ones drawn.
  readonly links: readonly MapLink[];
  // Where the name holds what was searched.
  readonly match: Match | null;
}

export interface GroupRow {
  readonly kind: "group";
  readonly key: string;
  readonly slot: number;
  // Those the filters keep, the most requests first.
  readonly sites: readonly MapSite[];
  // Those the limits keep, the only ones linked.
  readonly providers: readonly string[];
  // "12 sites sur 334", or "334 sites" when all are kept.
  readonly label: string;
  readonly suffix: string;
  readonly title: string;
  readonly total: number;
  // All the providers of its sites, as the first site lists them.
  readonly names: readonly string[];
}

export interface HeadingRow {
  readonly kind: "heading";
  readonly slot: number;
  readonly text: string;
}

export type ColumnRow = HeadingRow | SiteRow | GroupRow;

export interface ColumnLink {
  readonly key: string;
  readonly slot: number;
  readonly provider: string;
  readonly category: KnownCategory;
  readonly title: string;
}

export interface Column {
  readonly rows: readonly ColumnRow[];
  readonly slots: number;
  readonly filtered: boolean;
  // From the least serious, so that the most serious are drawn on top.
  readonly links: readonly ColumnLink[];
  // The sites kept, and their requests through the links kept.
  readonly sites: number;
  readonly requests: number;
  // How many sites kept each provider, category of link and country has,
  // counted by the links kept.
  readonly byProvider: ReadonlyMap<string, number>;
  readonly byCategory: ReadonlyMap<KnownCategory, number>;
  readonly byCountry: ReadonlyMap<string, number>;
  // The row that shows each site kept, its own or that of its group.
  readonly rowOf: ReadonlyMap<string, string>;
}

function add<K>(counts: Map<K, number>, key: K, count = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

function countBy<K>(
  kept: readonly Kept[],
  keyOf: (link: MapLink) => K,
): Map<K, number> {
  const counts = new Map<K, number>();
  for (const entry of kept) {
    for (const key of new Set(entry.links.map(keyOf))) {
      add(counts, key);
    }
  }
  return counts;
}

type Pending =
  | { readonly kind: "site"; readonly entry: Kept }
  | {
      readonly kind: "group";
      readonly together: string;
      readonly sites: readonly MapSite[];
      readonly total: number;
    };

// The sites from the most serious to the least, under a heading for the
// category of their most serious request whatever the limits, then the blue
// ones, their groups first.
export function columnOf(basis: Basis, filters: Filters): Column {
  const { formats } = basis;
  const kept = keptOf(basis, filters);
  const text = searchOf(filters);
  const countryOf = (id: string) => basis.provider.get(id)?.country ?? "";
  const passesProvider = (id: string) =>
    (filters.provider === null || id === filters.provider) &&
    (filters.country === null || countryOf(id) === filters.country);

  const serious: Kept[] = [];
  const blue = new Map<string, Kept[]>();
  for (const entry of kept) {
    if (entry.site.worst === "blue2") {
      const list = blue.get(entry.site.together) ?? [];
      list.push(entry);
      blue.set(entry.site.together, list);
    } else {
      serious.push(entry);
    }
  }
  serious.sort(
    (a, b) =>
      rankOf(a.site.worst) - rankOf(b.site.worst) ||
      b.site.total - a.site.total,
  );
  const background: (Pending & {
    readonly count: number;
    readonly sum: number;
  })[] = [];
  for (const [together, entries] of blue) {
    if (entries.length > GROUP_ABOVE) {
      const sites = entries
        .map((entry) => entry.site)
        .sort((a, b) => b.total - a.total);
      const total = sites.reduce((sum, site) => sum + site.total, 0);
      background.push({
        kind: "group",
        together,
        sites,
        total,
        count: sites.length,
        sum: total,
      });
    } else {
      for (const entry of entries) {
        background.push({
          kind: "site",
          entry,
          count: 1,
          sum: entry.site.total,
        });
      }
    }
  }
  background.sort((a, b) => b.count - a.count || b.sum - a.sum);

  const rows: ColumnRow[] = [];
  const links: ColumnLink[] = [];
  const rowOf = new Map<string, string>();
  let slot = 0;
  let last: KnownCategory | null = null;
  const pending: Pending[] = [
    ...serious.map((entry) => ({ kind: "site" as const, entry })),
    ...background,
  ];
  for (const item of pending) {
    const category = item.kind === "site" ? item.entry.site.worst : "blue2";
    if (category !== last) {
      rows.push({
        kind: "heading",
        slot,
        text: formats.message(`mapHeading${suffixOf(category)}`, []),
      });
      slot += 1;
      last = category;
    }
    if (item.kind === "site") {
      const { site } = item.entry;
      const key = siteKey(site.site);
      const start = text === "" ? -1 : site.key.indexOf(text);
      rows.push({
        kind: "site",
        key,
        slot,
        site,
        links: item.entry.links,
        match: start < 0 ? null : { start, end: start + text.length },
      });
      rowOf.set(site.site, key);
      for (const link of item.entry.links) {
        links.push({
          key: siteLinkKey(site.site, link.provider),
          slot,
          provider: link.provider,
          category: link.worst,
          title: link.title,
        });
      }
    } else {
      const key = groupKey(item.together);
      const of = basis.groups.get(item.together) ?? item.sites.length;
      const label = sitesOf(formats, item.sites.length, of);
      const names = (item.sites[0]?.links ?? []).map(
        (link) => basis.provider.get(link.provider)?.name ?? link.provider,
      );
      const providers = item.together.split("+").filter(passesProvider);
      rows.push({
        kind: "group",
        key,
        slot,
        sites: item.sites,
        providers,
        label,
        suffix: formats.message("mapGroupLevel", []),
        title: formats.message("mapGroupTitle", [label, formats.list(names)]),
        total: item.total,
        names,
      });
      for (const site of item.sites) {
        rowOf.set(site.site, key);
      }
      for (const provider of providers) {
        links.push({
          key: groupLinkKey(item.together, provider),
          slot,
          provider,
          category: "blue2",
          title: formats.message("mapGroupLinkTitle", [
            label,
            basis.provider.get(provider)?.name ?? provider,
          ]),
        });
      }
    }
    slot += 1;
  }
  links.sort((a, b) => rankOf(b.category) - rankOf(a.category));

  return {
    rows,
    slots: slot,
    filtered: isFiltered(filters),
    links,
    sites: kept.length,
    requests: kept.reduce(
      (sum, entry) =>
        sum + entry.links.reduce((count, link) => count + link.total, 0),
      0,
    ),
    byProvider: countBy(kept, (link) => link.provider),
    byCategory: countBy(kept, (link) => link.worst),
    byCountry: countBy(kept, (link) => countryOf(link.provider)),
    rowOf,
  };
}

// The longest start of a text that fits a width with "…" after it, since the
// start of a domain name says the most, or the text itself when it fits.
// The width of a text is measured by the page, a few times at most.
export function cutToFit(
  text: string,
  maxWidth: number,
  widthOf: (text: string) => number,
): string {
  if (widthOf(text) <= maxWidth) {
    return text;
  }
  const letters = [...text];
  const cut = (count: number) =>
    `${letters.slice(0, count).join("").trimEnd()}…`;
  let fits = 0;
  let tooLong = letters.length;
  while (tooLong - fits > 1) {
    const middle = Math.floor((fits + tooLong) / 2);
    if (widthOf(cut(middle)) <= maxWidth) {
      fits = middle;
    } else {
      tooLong = middle;
    }
  }
  return cut(fits);
}

// The geometry of the providers, in pixels: their pills from the top, at
// least a step apart, and on their left the corridor of the points.
const PROVIDERS_TOP = 44;
const PROVIDERS_BOTTOM = 10;
export const PILL_HEIGHT = 24;
const PILL_STEP = 28;
// Points that would come closer are set this far apart, or closer when the
// corridor has no room for it.
const POINT_STEP = 8;

// A link the map draws, from the middle of its row in the view.
export interface LinkInView {
  readonly provider: string;
  readonly y: number;
  readonly category: KnownCategory;
}

export interface ProvidersInView {
  // The middle of the pill of each provider named, in the order of the
  // column.
  readonly pills: ReadonlyMap<string, number>;
  // The middle of the point of each of the others, from the top.
  readonly points: ReadonlyMap<string, number>;
  readonly radius: number;
  // The corridor, which its points never leave.
  readonly top: number;
  readonly bottom: number;
}

// As many pills as fit from the top of the column to 10 pixels above the
// bottom of the view, at the least step, and always one, for the provider
// chosen.
export function pillsIn(viewHeight: number): number {
  return Math.max(
    1,
    Math.floor(
      (viewHeight - PROVIDERS_TOP - PROVIDERS_BOTTOM - PILL_HEIGHT) / PILL_STEP,
    ) + 1,
  );
}

interface Target {
  readonly id: string;
  readonly y: number;
  readonly rank: number;
}

// Each point as near its target as it can be, a step apart at least from the
// next, between top and bottom: those that would come closer gather into a
// run, centred on what its points aim at.
function nearest(
  targets: readonly Target[],
  step: number,
  top: number,
  bottom: number,
): Map<string, number> {
  interface Run {
    readonly members: Target[];
    start: number;
  }
  const settle = (run: Run) => {
    const size = run.members.length;
    const mean =
      run.members.reduce(
        (sum, target, index) => sum + target.y - index * step,
        0,
      ) / size;
    run.start = Math.min(Math.max(mean, top), bottom - (size - 1) * step);
  };
  const runs: Run[] = [];
  const sorted = targets
    .map((target) => ({
      ...target,
      y: Math.min(Math.max(target.y, top), bottom),
    }))
    .sort((a, b) => a.y - b.y || a.rank - b.rank);
  for (const target of sorted) {
    let run: Run = { members: [target], start: 0 };
    settle(run);
    let above = runs.at(-1);
    while (
      above !== undefined &&
      above.start + above.members.length * step > run.start + 1e-6
    ) {
      above.members.push(...run.members);
      runs.pop();
      run = above;
      settle(run);
      above = runs.at(-1);
    }
    runs.push(run);
  }
  return new Map(
    runs.flatMap((run) =>
      run.members.map((target, index): [string, number] => [
        target.id,
        run.start + index * step,
      ]),
    ),
  );
}

// The providers the rows in view link to, with the one chosen, never go
// beyond the view, however many they are. Those that fit have their pill,
// from the top in the order of the column, spread over the height when few,
// up to twice the least step. Each of the others has a point on a corridor,
// in front of its rows, so that its links stay drawn and end on what stands
// for their provider, never on a pill. The pills go first to the one chosen,
// then to the providers of the data before the supposed ones, which a single
// site may add, then to the most links in view, then to the most serious of
// them, then to the order of the column.
export function placesInView(
  order: readonly string[],
  links: readonly LinkInView[],
  chosen: string | null,
  supposed: (provider: string) => boolean,
  viewHeight: number,
): ProvidersInView {
  const count = new Map<string, number>();
  const sum = new Map<string, number>();
  const worst = new Map<string, number>();
  for (const link of links) {
    add(count, link.provider);
    add(sum, link.provider, link.y);
    worst.set(
      link.provider,
      Math.min(
        worst.get(link.provider) ?? CATEGORIES.length,
        rankOf(link.category),
      ),
    );
  }
  const rank = new Map(order.map((id, index) => [id, index]));
  const shown = order.filter((id) => id === chosen || count.has(id));
  const named = new Set(
    [...shown]
      .sort(
        (a, b) =>
          Number(b === chosen) - Number(a === chosen) ||
          Number(supposed(a)) - Number(supposed(b)) ||
          (count.get(b) ?? 0) - (count.get(a) ?? 0) ||
          (worst.get(a) ?? 0) - (worst.get(b) ?? 0) ||
          (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
      )
      .slice(0, pillsIn(viewHeight)),
  );
  const pills = shown.filter((id) => named.has(id));
  const room = viewHeight - PROVIDERS_TOP - PROVIDERS_BOTTOM;
  const pillStep = Math.min(
    2 * PILL_STEP,
    Math.max(PILL_STEP, room / (pills.length || 1)),
  );
  // The pill a point opens on hover, at its height, stays within the view.
  const top = PROVIDERS_TOP;
  const bottom = Math.max(top, viewHeight - PILL_HEIGHT / 2);
  const others = shown.filter((id) => !named.has(id));
  const pointStep = Math.min(
    POINT_STEP,
    (bottom - top) / Math.max(1, others.length - 1),
  );
  return {
    pills: new Map(
      pills.map((id, index) => [id, PROVIDERS_TOP + pillStep * (index + 0.5)]),
    ),
    points: nearest(
      others.map((id) => ({
        id,
        y: (sum.get(id) ?? 0) / (count.get(id) ?? 1),
        rank: rank.get(id) ?? 0,
      })),
      pointStep,
      top,
      bottom,
    ),
    radius: Math.max(1.5, Math.min(3, pointStep / 2 - 1)),
    top,
    bottom,
  };
}

export interface ProviderLabel {
  readonly key: string;
  readonly provider: MapProvider;
  readonly name: string;
  // Its sites, or how many of them stay under a filter.
  readonly sites: string;
  // What a screen reader hears of it: its law and its sites.
  readonly spoken: string;
}

export interface Places {
  readonly providers: readonly ProviderLabel[];
}

// The providers keep the order they have without filter. Under a filter,
// those left without a link leave the column.
export function placesOf(map: PreparedMap, column: Column): Places {
  const { formats } = map;
  const shown = map.order
    .filter((id) => (column.byProvider.get(id) ?? 0) > 0)
    .map((id) => map.provider.get(id))
    .filter((entry) => entry !== undefined);
  return {
    providers: shown.map((provider) => {
      const count = column.byProvider.get(provider.id) ?? 0;
      const sites = column.filtered
        ? sitesOf(formats, count, provider.sites.length)
        : counted(formats, "mapSites", provider.sites.length);
      return {
        key: providerKey(provider.id),
        provider,
        name:
          provider.flag === ""
            ? provider.name
            : `${provider.flag} ${provider.name}`,
        sites:
          provider.country === UNKNOWN_COUNTRY
            ? formats.message("mapSupposedSites", [sites])
            : sites,
        spoken: formats.message("mapProviderSpoken", [provider.title, sites]),
      };
    }),
  };
}

export interface MapHeader {
  readonly subtitle: string;
  // What the purge of every site asks, or null when nothing is kept, which
  // hides its button.
  readonly question: string | null;
  // What the map says in place of the column when nothing is kept.
  readonly empty: string | null;
  // What the counts leave out, at the end of the legend.
  readonly scope: string;
  // What the script writes into the drawing and the search field, which no
  // label of the page can carry.
  readonly sitesHeading: string;
  readonly unit: string;
  readonly providersHeading: string;
  // The name of the corridor of the providers without a pill, which says
  // its keys.
  readonly corridor: string;
  readonly search: string;
}

export function headerOf(map: PreparedMap): MapHeader {
  const { formats } = map;
  const empty = map.sites.length === 0;
  const sites = counted(formats, "mapSites", map.sites.length);
  const providers = counted(formats, "mapProviders", map.providers.length);
  const fixed = {
    sitesHeading: formats.message("mapSitesHeading", []),
    unit: formats.message("mapUnit", []),
    providersHeading: formats.message("mapProvidersHeading", []),
    corridor: formats.message("mapCorridor", []),
    search: formats.message("mapSearch", []),
  };
  if (map.privateWindow) {
    return {
      ...fixed,
      subtitle: empty
        ? formats.message("mapPrivateSession", [])
        : formats.message("mapPrivateSessionSummary", [sites, providers]),
      question: empty
        ? null
        : formats.message("mapPurgeAllQuestionPrivate", []),
      empty: empty ? formats.message("mapNothingPrivate", []) : null,
      scope: formats.message("mapLegendScopePrivate", []),
    };
  }
  const date = formats.date(map.since);
  return {
    ...fixed,
    subtitle: empty
      ? formats.message("mapKeptSince", [date])
      : formats.message("mapKeptSinceSummary", [date, sites, providers]),
    question: empty ? null : formats.message("mapPurgeAllQuestion", [date]),
    empty: empty ? formats.message("mapNothingKept", [date]) : null,
    scope: formats.message("mapLegendScope", []),
  };
}

export type Icon =
  | { readonly kind: "cloud"; readonly colour: Colour }
  | { readonly kind: "point" }
  | { readonly kind: "points" }
  | {
      readonly kind: "flag";
      readonly flag: string;
      readonly title: string | null;
    };

// The point of a blue site, the cloud of its category for the others.
function siteIcon(category: KnownCategory): Icon {
  return category === "blue2"
    ? { kind: "point" }
    : { kind: "cloud", colour: colourOfCategory(category) };
}

export interface Chip {
  readonly list: LimitList;
  readonly icon: Icon;
  readonly label: string;
  // The accessible name of its cross.
  readonly remove: string;
}

export interface Tools {
  readonly chips: readonly Chip[];
  // How many sites stay, under a filter.
  readonly shown: string | null;
}

function countryName(formats: MapFormats, country: string): string {
  if (country === UNKNOWN_COUNTRY) {
    return formats.message("mapCountryUnknown", []);
  }
  return country === "" ? "" : formats.country(country);
}

export function toolsOf(
  map: PreparedMap,
  column: Column,
  filters: Filters,
): Tools {
  const { formats } = map;
  const chips: Chip[] = [];
  const chip = (list: LimitList, icon: Icon, label: string) =>
    chips.push({
      list,
      icon,
      label,
      remove: formats.message("mapRemoveLimit", [label]),
    });
  if (filters.provider !== null) {
    const provider = map.provider.get(filters.provider);
    chip(
      "provider",
      { kind: "flag", flag: provider?.flag ?? "", title: null },
      provider?.name ?? filters.provider,
    );
  }
  if (filters.category !== null) {
    chip(
      "category",
      { kind: "cloud", colour: colourOfCategory(filters.category) },
      formats.message(`mapCategory${suffixOf(filters.category)}`, []),
    );
  }
  if (filters.country !== null) {
    chip(
      "country",
      { kind: "flag", flag: flagOf(filters.country), title: null },
      countryName(formats, filters.country),
    );
  }
  return {
    chips,
    shown: column.filtered
      ? sitesOf(formats, column.sites, map.sites.length)
      : null,
  };
}

export interface Heading {
  readonly title: string;
  readonly unit: string | null;
}

// A row of the overview that limits the map, with how many sites a click on
// it would keep.
export interface LimitRow {
  readonly list: LimitList;
  readonly value: string;
  readonly icon: Icon;
  readonly label: string;
  readonly proof: string | null;
  readonly bold: boolean;
  readonly count: string;
  // It would keep no site, so it no longer limits anything, unless it is the
  // active one, which a click removes.
  readonly zero: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
}

export interface LimitSection {
  readonly heading: Heading;
  readonly rows: readonly LimitRow[];
  readonly note: string | null;
}

// A row of the panel that opens the panel of a site or of a provider.
export interface Choice {
  readonly key: string;
  readonly icon: Icon;
  readonly label: string;
  readonly bold: boolean;
  readonly count: string;
  readonly title: string | null;
}

export interface CategoryLine {
  readonly colour: Colour;
  readonly label: string;
  readonly proof: string | null;
  readonly count: string;
  // By method and request type, the most requests first.
  readonly details: readonly DetailLine[];
}

export interface DetailLine {
  readonly kind: string;
  readonly count: string;
  // The addresses kept of the requests of the row, or null for a row that
  // has none, which unfolds nothing.
  readonly addresses: AddressRow | null;
}

export interface AddressRow {
  // Names the row in the panel of its site, by its provider, its category,
  // its method and its request type, so that it stays unfolded while the
  // panel is drawn again.
  readonly key: string;
  readonly open: boolean;
  // In alphabetical order, which says nothing of when each was seen.
  readonly addresses: readonly string[];
  // How many are kept, and at the limit, that it is the limit set in the
  // preferences, so that the list does not pass for complete.
  readonly note: string;
}

// The addresses the event page keeps of a site, for the panel of that site,
// with the limit of each row.
export interface SiteRecord {
  readonly site: string;
  readonly addresses: SiteAddresses;
  readonly limit: number;
}

// What a click on an address says: on its chip once copied, on its chip
// and to a screen reader when the copy fails, and to a screen reader once
// copied.
export interface CopyTexts {
  readonly copied: string;
  readonly failed: string;
  readonly announced: string;
}

export type Panel =
  | {
      readonly kind: "overview";
      readonly heading: Heading;
      readonly line: string;
      readonly notes: readonly string[];
      readonly sections: readonly LimitSection[];
    }
  | {
      readonly kind: "site";
      readonly icon: Icon;
      readonly name: string;
      readonly heading: Heading;
      readonly note: string | null;
      readonly providers: readonly {
        readonly choice: Choice;
        readonly lines: readonly CategoryLine[];
      }[];
      readonly copy: CopyTexts;
    }
  | {
      readonly kind: "provider";
      readonly flag: string;
      readonly name: string;
      readonly title: string;
      readonly texts: readonly string[];
      readonly note: string;
      readonly worst: {
        readonly heading: Heading;
        readonly lines: readonly CategoryLine[];
      };
      readonly sites: {
        readonly heading: Heading;
        readonly choices: readonly Choice[];
      };
    }
  | {
      readonly kind: "group";
      readonly name: string;
      readonly text: string;
      readonly heading: Heading;
      readonly choices: readonly Choice[];
    };

// The request types the panel of a site names in words. Firefox has more,
// which are shown as it names them.
const TYPES: Readonly<Record<string, string>> = {
  main_frame: "mapTypeMainFrame",
  sub_frame: "mapTypeSubFrame",
  xmlhttprequest: "mapTypeXmlhttprequest",
  script: "mapTypeScript",
  image: "mapTypeImage",
  stylesheet: "mapTypeStylesheet",
  font: "mapTypeFont",
  media: "mapTypeMedia",
  websocket: "mapTypeWebsocket",
  other: "mapTypeOther",
};

// "GET xmlhttprequest" reads "GET XHR".
function kindText(formats: MapFormats, kind: string): string {
  const space = kind.indexOf(" ");
  if (space < 0) {
    return kind;
  }
  const type = kind.slice(space + 1);
  const message = TYPES[type];
  return `${kind.slice(0, space)} ${message === undefined ? type : formats.message(message, [])}`;
}

function levelLine(formats: MapFormats, category: KnownCategory) {
  const proven = proofOfCategory(category);
  return {
    colour: colourOfCategory(category),
    label: formats.message(`level${levelOfCategory(category)}`, []),
    proof:
      proven === null
        ? null
        : formats.message(
            proven ? "decryptionProven" : "decryptionUnproven",
            [],
          ),
  };
}

// The rows of the addresses kept of a provider and a category, by method
// and request type, with the rows the user unfolded.
interface RowAddresses {
  readonly prefix: string;
  readonly kinds: { readonly [methodAndType: string]: readonly string[] };
  readonly limit: number;
  readonly unfolded: ReadonlySet<string>;
}

function addressRow(
  formats: MapFormats,
  rows: RowAddresses | null,
  kind: string,
): AddressRow | null {
  const kept = rows?.kinds[kind];
  if (rows === null || kept === undefined || kept.length === 0) {
    return null;
  }
  const key = `${rows.prefix}|${kind}`;
  const count = kept.length;
  const limit = count >= rows.limit ? "Limit" : "";
  return {
    key,
    open: rows.unfolded.has(key),
    addresses: [...kept].sort(),
    note: formats.message(
      `mapAddresses${limit}${formats.singular(count) ? "One" : "Many"}`,
      [formats.number(count)],
    ),
  };
}

function categoryLine(
  formats: MapFormats,
  category: KnownCategory,
  count: number,
  kinds: RequestKindCounts | null,
  rows: RowAddresses | null = null,
): CategoryLine {
  return {
    ...levelLine(formats, category),
    count: formats.number(count),
    details:
      kinds === null
        ? []
        : Object.entries(kinds)
            .filter(([, value]) => value > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, value]) => ({
              kind: kindText(formats, kind),
              count: formats.number(value),
              addresses: addressRow(formats, rows, kind),
            })),
  };
}

function providerChoice(provider: MapProvider, count: string): Choice {
  return {
    key: providerKey(provider.id),
    icon: { kind: "flag", flag: provider.flag, title: null },
    label: provider.name,
    bold: true,
    count,
    title: provider.title,
  };
}

function siteChoice(
  formats: MapFormats,
  site: MapSite,
  category: KnownCategory,
  count: number,
): Choice {
  return {
    key: siteKey(site.site),
    icon: siteIcon(category),
    label: site.name,
    bold: false,
    count: formats.number(count),
    title: null,
  };
}

// What a click on each row of a list would keep: the sites shown, the limit
// of its own list set aside, since a click replaces it. Without a limit in
// the list, the sites shown themselves.
function facetsOf(
  map: PreparedMap,
  column: Column,
  filters: Filters,
): Record<LimitList, ReadonlyMap<string, number>> {
  const countryOf = (id: string) => map.provider.get(id)?.country ?? "";
  const keys: Record<LimitList, (link: MapLink) => string> = {
    category: (link) => link.worst,
    country: (link) => countryOf(link.provider),
    provider: (link) => link.provider,
  };
  const shown: Record<LimitList, ReadonlyMap<string, number>> = {
    category: column.byCategory,
    country: column.byCountry,
    provider: column.byProvider,
  };
  const facets = { ...shown };
  for (const list of ["category", "country", "provider"] as const) {
    if (filters[list] !== null) {
      facets[list] = countBy(
        keptOf(map, withoutLimit(filters, list)),
        keys[list],
      );
    }
  }
  return facets;
}

function overviewOf(map: PreparedMap, column: Column, filters: Filters): Panel {
  const { formats } = map;
  const facets = facetsOf(map, column, filters);
  const unit = formats.message("mapSitesUnit", []);
  const limitRow = (
    list: LimitList,
    value: string,
    icon: Icon,
    label: string,
    proof: string | null,
    bold: boolean,
  ): LimitRow => {
    const count = facets[list].get(value) ?? 0;
    const pressed = filters[list] === value;
    return {
      list,
      value,
      icon,
      label,
      proof,
      bold,
      count: formats.number(count),
      zero: count === 0,
      pressed,
      disabled: count === 0 && !pressed,
    };
  };
  const whole = map.whole;
  const providers = [...column.byProvider.values()].filter(
    (count) => count > 0,
  );
  return {
    kind: "overview",
    heading: {
      title: formats.message(
        column.filtered ? "mapShownSites" : "mapOverview",
        [],
      ),
      unit: null,
    },
    line: formats.message("mapOverviewLine", [
      column.filtered
        ? sitesOf(formats, column.sites, map.sites.length)
        : counted(formats, "mapSites", map.sites.length),
      counted(formats, "mapProviders", providers.length),
      counted(formats, "mapRequests", column.requests),
    ]),
    notes: [
      formats.message("mapOverviewHelp", []),
      formats.message("mapLimitHelp", []),
    ],
    sections: [
      {
        heading: { title: formats.message("mapByLinks", []), unit },
        rows: CATEGORIES.filter((category) =>
          whole.byCategory.has(category),
        ).map((category) => {
          const { colour, label, proof } = levelLine(formats, category);
          return limitRow(
            "category",
            category,
            { kind: "cloud", colour },
            label,
            proof,
            false,
          );
        }),
        note: formats.message("mapByLinksNote", []),
      },
      {
        heading: { title: formats.message("mapByCountry", []), unit },
        rows: [...whole.byCountry]
          .filter(([country]) => country !== "")
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([country]) =>
            limitRow(
              "country",
              country,
              { kind: "flag", flag: flagOf(country), title: null },
              countryName(formats, country),
              country === UNKNOWN_COUNTRY
                ? formats.message("mapCountryUnknownNote", [])
                : null,
              false,
            ),
          ),
        note: formats.message("mapByCountryNote", []),
      },
      {
        heading: { title: formats.message("mapByProvider", []), unit },
        rows: map.providers.map((provider) =>
          limitRow(
            "provider",
            provider.id,
            { kind: "flag", flag: provider.flag, title: provider.title },
            provider.name,
            null,
            true,
          ),
        ),
        note: null,
      },
    ],
  };
}

function sincePanel(map: PreparedMap): string {
  const { formats } = map;
  return map.privateWindow
    ? formats.message("mapThisPrivateSession", [])
    : formats.message("mapSince", [formats.date(map.since)]);
}

// The addresses go only into the panel of the site they were asked for, and
// never into one of a private window, where nothing is recorded.
function sitePanel(
  map: PreparedMap,
  site: MapSite,
  record: SiteRecord | null,
  unfolded: ReadonlySet<string>,
): Panel {
  const { formats } = map;
  const kept =
    record !== null && record.site === site.site && !map.privateWindow
      ? record
      : null;
  const own = !map.privateWindow && site.since !== null;
  const title = map.privateWindow
    ? formats.message("popupSitePrivate", [])
    : site.since !== null
      ? formats.message("popupSite", [formats.date(site.since)])
      : formats.message("mapSince", [formats.date(map.since)]);
  return {
    kind: "site",
    icon: siteIcon(site.worst),
    name: site.name,
    heading: { title, unit: formats.message("mapUnit", []) },
    note: own ? formats.message("mapOwnDate", []) : null,
    providers: site.links.map((link) => {
      const provider = map.provider.get(link.provider);
      return {
        choice:
          provider === undefined
            ? {
                key: providerKey(link.provider),
                icon: { kind: "flag", flag: "", title: null },
                label: link.provider,
                bold: true,
                count: formats.number(link.total),
                title: null,
              }
            : providerChoice(provider, formats.number(link.total)),
        lines: CATEGORIES.flatMap((category) => {
          const kinds = link.categories[category];
          const recorded = kept?.addresses[link.provider]?.[category];
          return kinds === undefined
            ? []
            : [
                categoryLine(
                  formats,
                  category,
                  sumOf(kinds),
                  kinds,
                  kept === null || recorded === undefined
                    ? null
                    : {
                        prefix: `${link.provider}|${category}`,
                        kinds: recorded,
                        limit: kept.limit,
                        unfolded,
                      },
                ),
              ];
        }),
      };
    }),
    copy: {
      copied: formats.message("mapAddressCopied", []),
      failed: formats.message("mapAddressCopyFailed", []),
      announced: formats.message("mapAddressCopiedAnnounced", []),
    },
  };
}

function providerPanel(map: PreparedMap, provider: MapProvider): Panel {
  const { formats } = map;
  const texts: string[] = [];
  if (provider.country === UNKNOWN_COUNTRY) {
    texts.push(
      formats.message("mapSubjectToUnknown", [provider.flag]),
      formats.message("mapSupposedOrigin", []),
    );
  } else if (provider.country !== "") {
    texts.push(
      formats.message("mapSubjectTo", [
        countryName(formats, provider.country),
        provider.flag,
      ]),
    );
  }
  const { parent } = provider;
  if (parent !== null && parent.country !== provider.country) {
    texts.push(
      formats.message("mapParent", [
        parent.name,
        countryName(formats, parent.country),
        flagOf(parent.country),
      ]),
    );
  }
  const byWorst = new Map<KnownCategory, number>();
  for (const { link } of provider.sites) {
    add(byWorst, link.worst);
  }
  const count = provider.sites.length;
  return {
    kind: "provider",
    flag: provider.flag,
    name: provider.name,
    title: provider.title,
    texts,
    note: map.privateWindow
      ? formats.message("mapProviderNotePrivate", [])
      : formats.message("mapProviderNote", [formats.date(map.since)]),
    worst: {
      heading: {
        title: formats.message("mapByWorst", []),
        unit: formats.message("mapSitesUnit", []),
      },
      lines: CATEGORIES.filter((category) => byWorst.has(category)).map(
        (category) =>
          categoryLine(formats, category, byWorst.get(category) ?? 0, null),
      ),
    },
    sites: {
      heading: {
        title:
          count === 1
            ? formats.message("mapItsSite", [])
            : formats.message("mapItsSites", [formats.number(count)]),
        unit: formats.message("mapUnit", []),
      },
      choices: provider.sites.map(({ site, link }) =>
        siteChoice(formats, site, link.worst, link.total),
      ),
    },
  };
}

function groupPanel(map: PreparedMap, group: GroupRow): Panel {
  const { formats } = map;
  return {
    kind: "group",
    name: group.label,
    text: formats.message("mapGroupText", [formats.list(group.names)]),
    heading: { title: sincePanel(map), unit: formats.message("mapUnit", []) },
    choices: group.sites.map((site) =>
      siteChoice(formats, site, "blue2", site.total),
    ),
  };
}

// The panel of what is selected, or the overview without a selection and for
// a selection the map no longer shows. The panel of a site lists the
// addresses kept of its rows, those the event page gave for it, and unfolds
// the rows named.
export function panelOf(
  map: PreparedMap,
  column: Column,
  filters: Filters,
  selection: string | null,
  record: SiteRecord | null = null,
  unfolded: ReadonlySet<string> = new Set(),
): Panel {
  if (selection !== null) {
    const parts = keyPartsOf(selection);
    if (parts?.kind === "site") {
      const site = map.site.get(parts.name);
      if (site !== undefined) {
        return sitePanel(map, site, record, unfolded);
      }
    } else if (parts?.kind === "provider") {
      const provider = map.provider.get(parts.name);
      if (provider !== undefined) {
        return providerPanel(map, provider);
      }
    } else if (parts?.kind === "group") {
      const group = column.rows.find(
        (row): row is GroupRow => row.kind === "group" && row.key === selection,
      );
      if (group !== undefined) {
        return groupPanel(map, group);
      }
    }
  }
  return overviewOf(map, column, filters);
}

// A link stands for its site, or for its group.
export function selectionOf(key: string): string {
  const parts = keyPartsOf(key);
  if (parts?.kind === "site-link") {
    return siteKey(parts.name);
  }
  if (parts?.kind === "group-link") {
    return groupKey(parts.name);
  }
  return key;
}

export interface Highlight {
  // What stays lit while the rest fades: the selected row or provider, and
  // what its links reach.
  readonly active: ReadonlySet<string>;
  // The row or the label that is selected, the row of its group for a site
  // in a group, or null for a site the column does not show.
  readonly chosen: string | null;
}

export function highlightOf(
  column: Column,
  selection: string | null,
): Highlight {
  const active = new Set<string>();
  if (selection === null) {
    return { active, chosen: null };
  }
  const linksOf = (row: SiteRow | GroupRow): [string, string][] =>
    row.kind === "site"
      ? row.links.map((link) => [
          link.provider,
          siteLinkKey(row.site.site, link.provider),
        ])
      : row.providers.map((provider) => [
          provider,
          groupLinkKey(keyPartsOf(row.key)?.name ?? "", provider),
        ]);
  const parts = keyPartsOf(selection);
  const chosen =
    parts?.kind === "site" ? (column.rowOf.get(parts.name) ?? null) : selection;
  if (parts?.kind === "site" || parts?.kind === "group") {
    const row = column.rows.find(
      (entry): entry is SiteRow | GroupRow =>
        entry.kind !== "heading" && entry.key === chosen,
    );
    if (row !== undefined) {
      active.add(row.key);
      for (const [provider, link] of linksOf(row)) {
        active.add(providerKey(provider));
        active.add(link);
      }
    }
  } else if (parts?.kind === "provider") {
    active.add(selection);
    for (const row of column.rows) {
      if (row.kind === "heading") {
        continue;
      }
      for (const [provider, link] of linksOf(row)) {
        if (provider === parts.name) {
          active.add(row.key);
          active.add(link);
        }
      }
    }
  }
  return { active, chosen };
}

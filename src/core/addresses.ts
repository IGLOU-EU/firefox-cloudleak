// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { LeakLevel } from "./classify.js";
import { categoryOf, requestKindOf, type SeenRequest } from "./counts.js";
import type {
  Category,
  RecordLevel,
  Settings,
  SiteAddresses,
} from "./popup-message.js";
import { schemeOf, WEB_SCHEMES } from "./request-facts.js";

// Off by default: no address is kept until the user asks for it.
export const DEFAULT_SETTINGS: Settings = { record: "none", recordLimit: 100 };

const RECORD_LEVELS: readonly RecordLevel[] = ["none", "level4", "level3and4"];

// Stands for a value of the query, which is never kept. A URL writes a
// character outside ASCII percent-encoded in its query, so this one can
// never come from the URL itself.
const HIDDEN_VALUE = "…";

// The address of a request as it may be kept: its scheme, its host, its port
// when it is not the default one of the scheme, its path, and the names of
// its query parameters, each value replaced. Never a value, which can hold
// what the user typed or a token, nor the fragment, nor a user name or a
// password. A name stays as the URL writes it, encoded, so that it can
// neither pass for another name nor hold a separator. An empty value is
// kept empty, since it hides nothing. The full URL goes no further than this
// function.
export function addressOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!WEB_SCHEMES.has(schemeOf(parsed))) {
    return null;
  }
  // Split by hand rather than with URLSearchParams, so that the values are
  // never even decoded.
  const names = parsed.search
    .slice(1)
    .split("&")
    .filter((part) => part !== "")
    .map((part) => {
      const equals = part.indexOf("=");
      if (equals < 0) {
        return part;
      }
      const name = part.slice(0, equals);
      return equals === part.length - 1
        ? `${name}=`
        : `${name}=${HIDDEN_VALUE}`;
    });
  const query = names.length === 0 ? "" : `?${names.join("&")}`;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`;
}

export function isRecordLevel(value: unknown): value is RecordLevel {
  return RECORD_LEVELS.includes(value as RecordLevel);
}

// Whether a request of this level has its address recorded. Never level 2,
// a public resource, nor level 1.
export function recordsLevel(record: RecordLevel, level: LeakLevel): boolean {
  switch (record) {
    case "none":
      return false;
    case "level4":
      return level === 4;
    case "level3and4":
      return level >= 3;
  }
}

// The limit the user sets: an integer of at least 1, as large as the user
// wants, since the user decides how much is kept. Anything else is refused
// rather than brought to a near value, which the user did not ask for.
export function recordLimitOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

// The settings as stored, each one that is not valid replaced by its
// default, so that a doubt records nothing rather than something.
export function settingsOf(value: unknown): Settings {
  if (typeof value !== "object" || value === null) {
    return DEFAULT_SETTINGS;
  }
  const { record, recordLimit } = value as Record<string, unknown>;
  return {
    record: isRecordLevel(record) ? record : DEFAULT_SETTINGS.record,
    recordLimit: recordLimitOf(recordLimit) ?? DEFAULT_SETTINGS.recordLimit,
  };
}

// Records the address of a request in its row: the row of its provider,
// category, method and request type. The address goes first, once, and the
// oldest go beyond the limit. The addresses given are never changed, and
// come back as they are when the address is already the most recent, so
// that nothing is written again for it.
export function addAddress(
  addresses: SiteAddresses,
  request: SeenRequest,
  limit: number,
): SiteAddresses {
  const { address } = request;
  if (address === undefined) {
    return addresses;
  }
  const { provider } = request.classification;
  const category = categoryOf(request.classification);
  const kind = requestKindOf(request);
  const providerAddresses = addresses[provider] ?? {};
  const rows = providerAddresses[category] ?? {};
  const row = rows[kind] ?? [];
  if (row[0] === address) {
    return addresses;
  }
  return {
    ...addresses,
    [provider]: {
      ...providerAddresses,
      [category]: {
        ...rows,
        [kind]: [address, ...row.filter((seen) => seen !== address)].slice(
          0,
          limit,
        ),
      },
    },
  };
}

function levelOf(category: Category): LeakLevel {
  return Number(category.slice(-1)) as LeakLevel;
}

// What the settings keep of the addresses: the categories of the levels
// recorded, and in each row the most recent up to the limit. A provider or a
// category left without a row goes. The addresses given are never changed.
export function fitAddresses(
  addresses: SiteAddresses,
  settings: Settings,
): SiteAddresses {
  const fitted: Record<string, SiteAddresses[string]> = {};
  for (const [provider, categories] of Object.entries(addresses)) {
    const kept: Partial<Record<Category, Record<string, readonly string[]>>> =
      {};
    for (const [category, rows] of Object.entries(categories) as [
      Category,
      Record<string, readonly string[]>,
    ][]) {
      if (!recordsLevel(settings.record, levelOf(category))) {
        continue;
      }
      const keptRows: Record<string, readonly string[]> = {};
      for (const [kind, row] of Object.entries(rows)) {
        if (row.length > 0) {
          keptRows[kind] = row.slice(0, settings.recordLimit);
        }
      }
      if (Object.keys(keptRows).length > 0) {
        kept[category] = keptRows;
      }
    }
    if (Object.keys(kept).length > 0) {
      fitted[provider] = kept;
    }
  }
  return fitted;
}

// Whether an address the previous settings keep is left out by the next
// ones: the recording turned off, fewer levels, or a lower limit.
export function keepsFewer(previous: Settings, next: Settings): boolean {
  if (previous.record === "none") {
    return false;
  }
  return (
    next.record === "none" ||
    (previous.record === "level3and4" && next.record === "level4") ||
    next.recordLimit < previous.recordLimit
  );
}

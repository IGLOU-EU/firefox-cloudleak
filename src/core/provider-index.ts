// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { ipv4Of, parseIp } from "./cidr.js";
import { matchesPattern } from "./pattern.js";
import type { ProviderEntry, ProviderTable } from "./provider-table.js";

// The signatures of every provider, arranged so that finding the provider of
// a request costs about the same whatever the number of providers. Each entry
// keeps the position of its provider in the table: where several providers
// answer the same step, the first one in the table wins, as when the steps
// compared the request with each provider in turn.

interface Entry<T> {
  readonly position: number;
  readonly pattern: string;
  readonly data: T;
}

// Patterns without "*" are found by their lowercase text in one lookup, the
// others compared one by one. Both lists keep the order of the table.
interface PatternIndex<T> {
  readonly exact: Map<string, Entry<T>[]>;
  readonly wild: Entry<T>[];
}

// The networks of all the ranges of one prefix length, each with the first
// provider that holds it.
interface Ipv4Networks {
  readonly mask: number;
  readonly networks: Map<number, number>;
}

interface Ipv6Networks {
  readonly hostBits: bigint;
  readonly networks: Map<bigint, number>;
}

export interface ProviderIndex {
  readonly ipv4: readonly Ipv4Networks[];
  readonly ipv6: readonly Ipv6Networks[];
  // Response headers by name, with their value pattern or null for presence.
  // A server value is a header named "server".
  readonly headers: PatternIndex<string | null>;
  readonly cookies: PatternIndex<null>;
  readonly siteConnectorCookies: PatternIndex<null>;
  readonly cname: Map<string, number>;
}

function patternIndex<T>(): PatternIndex<T> {
  return { exact: new Map(), wild: [] };
}

function add<T>(
  index: PatternIndex<T>,
  position: number,
  pattern: string,
  data: T,
): void {
  const entry = { position, pattern, data };
  if (pattern.includes("*")) {
    index.wild.push(entry);
    return;
  }
  const key = pattern.toLowerCase();
  const entries = index.exact.get(key);
  if (entries === undefined) {
    index.exact.set(key, [entry]);
  } else {
    entries.push(entry);
  }
}

// The first provider of a network keeps it.
function keep<K>(networks: Map<K, number>, key: K, position: number): void {
  if (!networks.has(key)) {
    networks.set(key, position);
  }
}

function buildIndex(providers: readonly ProviderEntry[]): ProviderIndex {
  const ipv4 = new Map<number, Map<number, number>>();
  const ipv6 = new Map<number, Map<bigint, number>>();
  const index = {
    headers: patternIndex<string | null>(),
    cookies: patternIndex<null>(),
    siteConnectorCookies: patternIndex<null>(),
    cname: new Map<string, number>(),
  };
  for (const [position, provider] of providers.entries()) {
    for (const { network, mask } of provider.ranges.ipv4) {
      const networks = ipv4.get(mask) ?? new Map<number, number>();
      ipv4.set(mask, networks);
      keep(networks, network, position);
    }
    for (const { network, prefixLength } of provider.ranges.ipv6) {
      const networks = ipv6.get(prefixLength) ?? new Map<bigint, number>();
      ipv6.set(prefixLength, networks);
      keep(networks, network >> BigInt(128 - prefixLength), position);
    }
    for (const { name, value } of provider.headers) {
      add(index.headers, position, name, value);
    }
    for (const value of provider.server) {
      add(index.headers, position, "server", value);
    }
    for (const name of provider.cookies) {
      add(index.cookies, position, name, null);
    }
    for (const name of provider.siteConnectorCookies) {
      add(index.siteConnectorCookies, position, name, null);
    }
    for (const suffix of provider.cname) {
      keep(index.cname, suffix.toLowerCase(), position);
    }
  }
  return {
    ...index,
    ipv4: [...ipv4].map(([mask, networks]) => ({ mask, networks })),
    ipv6: [...ipv6].map(([prefixLength, networks]) => ({
      hostBits: BigInt(128 - prefixLength),
      networks,
    })),
  };
}

// The extension loads one table per wake-up, and the tests build their own
// without ever changing one, so an index is built once per table.
const indexes = new WeakMap<ProviderTable, ProviderIndex>();

export function indexOf(table: ProviderTable): ProviderIndex {
  let index = indexes.get(table);
  if (index === undefined) {
    index = buildIndex(table.providers);
    indexes.set(table, index);
  }
  return index;
}

// No provider is at position Infinity: the searches below start from it and
// keep the smallest position they meet.
export const NONE = Number.POSITIVE_INFINITY;

function earlier(found: number | undefined, best: number): number {
  return found !== undefined && found < best ? found : best;
}

// An IPv4 address mapped in IPv6 is an IPv6 address, which no IPv4 range
// holds.
export function byAddress(ip: string | null, index: ProviderIndex): number {
  if (ip === null) {
    return NONE;
  }
  let best = NONE;
  if (!ip.includes(":")) {
    const address = ipv4Of(ip);
    if (address === undefined) {
      return NONE;
    }
    for (const { mask, networks } of index.ipv4) {
      best = earlier(networks.get((address & mask) >>> 0), best);
    }
    return best;
  }
  const address = parseIp(ip);
  if (!address.ok || address.value.family !== 6) {
    return NONE;
  }
  for (const { hostBits, networks } of index.ipv6) {
    best = earlier(networks.get(address.value.value >> hostBits), best);
  }
  return best;
}

// The first provider, before `best`, with a pattern that matches the text
// and whose data `accepts`. An exact pattern that answers only lowers the
// bound: a pattern with "*" may still belong to an earlier provider.
function firstMatch<T>(
  index: PatternIndex<T>,
  text: string,
  accepts: (data: T) => boolean,
  bound: number,
): number {
  let best = bound;
  for (const entry of index.exact.get(text.toLowerCase()) ?? []) {
    if (entry.position >= best) {
      break;
    }
    if (accepts(entry.data)) {
      best = entry.position;
      break;
    }
  }
  for (const entry of index.wild) {
    if (entry.position >= best) {
      break;
    }
    if (matchesPattern(entry.pattern, text) && accepts(entry.data)) {
      return entry.position;
    }
  }
  return best;
}

export function bySignal(
  headers: readonly { readonly name: string; readonly value: string }[],
  setCookies: readonly string[],
  index: ProviderIndex,
): number {
  let best = NONE;
  for (const { name, value } of headers) {
    best = firstMatch(
      index.headers,
      name,
      (pattern) => pattern === null || matchesPattern(pattern, value),
      best,
    );
  }
  for (const name of setCookies) {
    best = firstMatch(index.cookies, name, () => true, best);
  }
  return best;
}

// Some anti-bot products also hand their cookies to a connector installed at
// the site, which sets them without the provider ever being in the path. Such
// a cookie shows the provider saw the request, not that it read the traffic.
export function bySiteConnectorCookie(
  setCookies: readonly string[],
  index: ProviderIndex,
): number {
  let best = NONE;
  for (const name of setCookies) {
    best = firstMatch(index.siteConnectorCookies, name, () => true, best);
  }
  return best;
}

// A suffix counts on a label boundary only, so that "xcdn.example.net" is not
// taken for a host of "cdn.example.net": the name and each of its parts after
// a dot are looked up.
export function byCname(
  names: readonly string[],
  index: ProviderIndex,
): number {
  let best = NONE;
  for (const name of names) {
    let host = name.toLowerCase();
    for (;;) {
      best = earlier(index.cname.get(host), best);
      const dot = host.indexOf(".");
      if (dot === -1) {
        break;
      }
      host = host.slice(dot + 1);
    }
  }
  return best;
}

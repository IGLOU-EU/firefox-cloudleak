// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { cidrContains, parseCidr, parseIp } from "./cidr.js";
import { matchesPattern } from "./pattern.js";
import type { ProviderEntry, ProviderTable } from "./provider-table.js";

export interface ResponseHeader {
  readonly name: string;
  readonly value: string;
}

// What the classification needs to know about one request, and nothing more.
// Cookie and Authorization values never enter it, and the URL enters only as
// the host and path that the challenge and home page rules compare.
export interface RequestFacts {
  readonly method: string;
  // The webRequest resource type, such as "main_frame" or "xmlhttprequest".
  readonly type: string;
  // Plain HTTP is read in clear by whoever relays it, which proves decryption.
  readonly tls: boolean;
  readonly host: string;
  readonly path: string;
  // Null when Firefox gives no address, as for a response from the cache.
  readonly ip: string | null;
  // Names of the cookies the request carries.
  readonly cookies: readonly string[];
  readonly authorization: boolean;
  // Every response header but Set-Cookie, whose values are cookie values.
  readonly responseHeaders: readonly ResponseHeader[];
  // Names of the cookies the response sets.
  readonly setCookies: readonly string[];
  // The CNAME chain of the host as Firefox resolved it, absent when it could
  // not be read.
  readonly cnames?: readonly string[];
}

export type LeakLevel = 1 | 2 | 3 | 4;

export type Leak =
  | { readonly level: 2 | 3 }
  | { readonly level: 4; readonly case: "session"; readonly possible: boolean }
  | {
      readonly level: 4;
      readonly case: "data-sent";
      readonly challenge: boolean;
    };

export interface Classification {
  readonly provider: string;
  readonly proven: boolean;
  readonly leak: Leak;
}

export type Colour = "blue" | "orange" | "red";

// The search stops at the first step that answers: the address says where
// the request went, the response shows a provider the address does not
// reveal, and the CNAME chain names one that shows in neither.
export function findProvider(
  facts: RequestFacts,
  table: ProviderTable,
): ProviderEntry | null {
  return (
    findByAddress(facts.ip, table.providers) ??
    table.providers.find((provider) => hasHttpSignal(facts, provider)) ??
    table.providers.find((provider) =>
      (facts.cnames ?? []).some((name) => endsWithSuffix(name, provider.cname)),
    ) ??
    null
  );
}

// A suffix counts on a label boundary only, so that "xcdn.example.net" is not
// taken for a host of "cdn.example.net".
function endsWithSuffix(name: string, suffixes: readonly string[]): boolean {
  const host = name.toLowerCase();
  return suffixes.some((text) => {
    const suffix = text.toLowerCase();
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

function findByAddress(
  ip: string | null,
  providers: readonly ProviderEntry[],
): ProviderEntry | undefined {
  const address = ip === null ? null : parseIp(ip);
  if (address === null || !address.ok) {
    return undefined;
  }
  return providers.find((provider) =>
    provider.ranges.some((text) => {
      const range = parseCidr(text);
      return range.ok && cidrContains(range.value, address.value);
    }),
  );
}

function matchesAny(patterns: readonly string[], text: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, text));
}

function isSignal(header: ResponseHeader, provider: ProviderEntry): boolean {
  if (
    header.name.toLowerCase() === "server" &&
    matchesAny(provider.server, header.value)
  ) {
    return true;
  }
  return provider.headers.some(
    (signature) =>
      matchesPattern(signature.name, header.name) &&
      (signature.value === null ||
        matchesPattern(signature.value, header.value)),
  );
}

// Only the provider's own servers add its headers and cookies to a response,
// so their presence shows that it read the traffic. The cookies a request
// carries say nothing of the response and are not signals.
export function hasHttpSignal(
  facts: RequestFacts,
  provider: ProviderEntry,
): boolean {
  return (
    facts.responseHeaders.some((header) => isSignal(header, provider)) ||
    facts.setCookies.some((name) => matchesAny(provider.cookies, name))
  );
}

// A missing signal proves nothing: a provider can strip its own headers.
export function isDecryptionProven(
  facts: RequestFacts,
  provider: ProviderEntry,
): boolean {
  return !facts.tls || hasHttpSignal(facts, provider);
}

function isChallenge(facts: RequestFacts, provider: ProviderEntry): boolean {
  return (
    matchesAny(provider.challengeHosts, facts.host) ||
    provider.challengePaths.some((prefix) => facts.path.startsWith(prefix))
  );
}

// Compared without case, because fetch() sends a lowercase "patch" as it is
// written, and a body missed would understate the leak.
const BODY_METHODS = ["POST", "PUT", "PATCH"];

// The level follows what the request carries, never its type alone. The
// provider's own cookies only tell it its own state, and consent and
// audience-measurement cookies are not a session, so neither raises the
// level. Any other cookie may be a session, and a doubt is never resolved on
// the reassuring side.
export function leakOf(
  facts: RequestFacts,
  provider: ProviderEntry,
  consentCookies: readonly string[],
): Leak {
  if (facts.authorization) {
    return { level: 4, case: "session", possible: false };
  }
  const siteCookie = facts.cookies.some(
    (name) =>
      !matchesAny(provider.cookies, name) && !matchesAny(consentCookies, name),
  );
  if (siteCookie) {
    return { level: 4, case: "session", possible: true };
  }
  // The bodies a challenge sends are opaque, so they count as data sent.
  if (isChallenge(facts, provider)) {
    return { level: 4, case: "data-sent", challenge: true };
  }
  if (BODY_METHODS.includes(facts.method.toUpperCase())) {
    return { level: 4, case: "data-sent", challenge: false };
  }
  if (facts.type === "main_frame" || facts.type === "sub_frame") {
    // The home page tells little more than the visit of the site.
    return { level: facts.path === "/" ? 2 : 3 };
  }
  if (facts.type === "xmlhttprequest") {
    return { level: 3 };
  }
  return { level: 2 };
}

export function classifyRequest(
  facts: RequestFacts,
  table: ProviderTable,
): Classification | null {
  const provider = findProvider(facts, table);
  if (provider === null) {
    return null;
  }
  return {
    provider: provider.id,
    proven: isDecryptionProven(facts, provider),
    leak: leakOf(facts, provider, table.consentCookies),
  };
}

// Levels 1 and 2 leak only the use of a public resource, so the proof does
// not change their colour.
export function colourOf(level: LeakLevel, proven: boolean): Colour {
  if (level <= 2) {
    return "blue";
  }
  return proven ? "red" : "orange";
}

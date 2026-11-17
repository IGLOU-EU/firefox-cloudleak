// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { matchesPattern } from "./pattern.js";
import {
  byAddress,
  byCname,
  bySignal,
  bySiteConnectorCookie,
  indexOf,
  NONE,
} from "./provider-index.js";
import type { ProviderEntry, ProviderTable } from "./provider-table.js";

export interface ResponseHeader {
  readonly name: string;
  readonly value: string;
}

// What the classification needs to know about one request, and nothing more.
// Cookie and Authorization values never enter it, and the URL enters only as
// the host, the path and the query parameter names that the challenge and
// home page rules compare. A query value can hold what the user typed or a
// token, so it never enters.
export interface RequestFacts {
  readonly method: string;
  // The webRequest resource type, such as "main_frame" or "xmlhttprequest".
  readonly type: string;
  // Plain HTTP is read in clear by whoever relays it, which proves decryption.
  readonly tls: boolean;
  readonly host: string;
  readonly path: string;
  // Names of the URL query parameters, empty when the URL has no query.
  readonly queryNames: readonly string[];
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
  | {
      readonly level: 4;
      readonly case: "session";
      readonly possible: boolean;
      readonly challenge: boolean;
    }
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
// reveal, and the CNAME chain names one that shows in neither. Within the
// response, a signal that proves who relayed it outweighs a cookie that the
// site itself may have set for another provider.
export function findProvider(
  facts: RequestFacts,
  table: ProviderTable,
): ProviderEntry | null {
  const index = indexOf(table);
  let position = byAddress(facts.ip, index);
  if (position === NONE) {
    position = bySignal(facts.responseHeaders, facts.setCookies, index);
  }
  if (position === NONE) {
    position = bySiteConnectorCookie(facts.setCookies, index);
  }
  if (position === NONE) {
    position = byCname(facts.cnames ?? [], index);
  }
  return position === NONE ? null : (table.providers[position] ?? null);
}

function matchesAny(patterns: readonly string[], text: string): boolean {
  return patterns.some((pattern) => matchesPattern(pattern, text));
}

function matchesHeader(
  signatures: ProviderEntry["headers"],
  header: ResponseHeader,
): boolean {
  return signatures.some(
    (signature) =>
      matchesPattern(signature.name, header.name) &&
      (signature.value === null ||
        matchesPattern(signature.value, header.value)),
  );
}

function isSignal(header: ResponseHeader, provider: ProviderEntry): boolean {
  if (
    header.name.toLowerCase() === "server" &&
    matchesAny(provider.server, header.value)
  ) {
    return true;
  }
  return matchesHeader(provider.headers, header);
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

// The verification page and the form that validates the challenge are
// recognised by their response header and query parameter names, which say
// only that they belong to the challenge.
function isChallenge(facts: RequestFacts, provider: ProviderEntry): boolean {
  return (
    matchesAny(provider.challengeHosts, facts.host) ||
    provider.challengePaths.some((prefix) => facts.path.startsWith(prefix)) ||
    facts.responseHeaders.some((header) =>
      matchesHeader(provider.challengeHeaders, header),
    ) ||
    facts.queryNames.some((name) =>
      matchesAny(provider.challengeQueryNames, name),
    )
  );
}

// Compared without case, because fetch() sends a lowercase "patch" as it is
// written, and a body missed would understate the leak.
const BODY_METHODS = ["POST", "PUT", "PATCH"];

// The level follows what the request carries, never its type alone. The
// provider's own cookies only tell it its own state, and consent and
// audience-measurement cookies are not a session, so neither raises the
// level. Any other cookie may be a session, and a doubt is never resolved on
// the reassuring side, which holds for the cookies a connector at the site
// sets too: they belong to the site as much as to the provider.
export function leakOf(
  facts: RequestFacts,
  provider: ProviderEntry,
  consentCookies: readonly string[],
): Leak {
  // The mark tells the user a request belongs to the challenge and not to the
  // site, even when the session that goes with it is the more serious leak.
  const challenge = isChallenge(facts, provider);
  if (facts.authorization) {
    return { level: 4, case: "session", possible: false, challenge };
  }
  const siteCookie = facts.cookies.some(
    (name) =>
      !matchesAny(provider.cookies, name) && !matchesAny(consentCookies, name),
  );
  if (siteCookie) {
    return { level: 4, case: "session", possible: true, challenge };
  }
  // The bodies a challenge sends are opaque, so they count as data sent.
  if (challenge) {
    return { level: 4, case: "data-sent", challenge: true };
  }
  // A WebSocket stays open through the edge, and the extension sees only its
  // opening, never the messages that follow in both directions.
  if (
    facts.type === "websocket" ||
    BODY_METHODS.includes(facts.method.toUpperCase())
  ) {
    return { level: 4, case: "data-sent", challenge: false };
  }
  if (facts.type === "main_frame" || facts.type === "sub_frame") {
    // The home page tells little more than the visit of the site, unless a
    // query says what the user looks for.
    const home = facts.path === "/" && facts.queryNames.length === 0;
    return { level: home ? 2 : 3 };
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
  return provider === null ? null : classificationOf(facts, provider, table);
}

// The CNAME step alone, for a request the address and the response left
// without a provider: the other steps would fail again on the same facts.
export function classifyByCname(
  facts: RequestFacts,
  name: string,
  table: ProviderTable,
): Classification | null {
  const position = byCname([name], indexOf(table));
  const provider = position === NONE ? undefined : table.providers[position];
  return provider === undefined
    ? null
    : classificationOf({ ...facts, cnames: [name] }, provider, table);
}

// A supposed provider, named by the canonical name alone when the dynamic
// detection is on. It has no signature, so its decryption is proven only
// over plain HTTP, no cookie is its own and no request is a challenge.
export function classifySupposed(
  facts: RequestFacts,
  provider: string,
  table: ProviderTable,
): Classification {
  return classificationOf(facts, { ...NO_SIGNATURE, id: provider }, table);
}

const NO_SIGNATURE: ProviderEntry = {
  id: "",
  name: "",
  country: "",
  parent: null,
  ranges: { ipv4: [], ipv6: [] },
  headers: [],
  cookies: [],
  siteConnectorCookies: [],
  server: [],
  cname: [],
  challengeHosts: [],
  challengePaths: [],
  challengeHeaders: [],
  challengeQueryNames: [],
};

function classificationOf(
  facts: RequestFacts,
  provider: ProviderEntry,
  table: ProviderTable,
): Classification {
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

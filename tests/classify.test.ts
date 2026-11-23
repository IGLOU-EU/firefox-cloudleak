// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rangesOf } from "../src/core/cidr.js";
import {
  type Classification,
  classifyByCname,
  classifyRequest,
  classifySupposed,
  colourOf,
  type Leak,
  type RequestFacts,
} from "../src/core/classify.js";
import type {
  ProviderEntry,
  ProviderTable,
} from "../src/core/provider-table.js";

// The ranges are given as ranges.txt writes them, and parsed as the build
// parses them.
function provider(
  id: string,
  {
    ranges = [],
    ...signatures
  }: Partial<Omit<ProviderEntry, "ranges">> & { ranges?: string[] } = {},
): ProviderEntry {
  return {
    id,
    name: id,
    country: "US",
    parent: null,
    ranges: rangesOf(ranges),
    headers: [],
    cookies: [],
    siteConnectorCookies: [],
    server: [],
    cname: [],
    challengeHosts: [],
    challengePaths: [],
    challengeHeaders: [],
    challengeQueryNames: [],
    ...signatures,
  };
}

const ALPHA = provider("alpha", {
  ranges: ["192.0.2.0/24", "2001:db8::/32"],
  headers: [
    { name: "x-alpha-id", value: null },
    { name: "x-alpha-cache", value: "HIT*" },
  ],
  cookies: ["__alpha_*", "alpha_clearance"],
  siteConnectorCookies: ["alphabot_*"],
  server: ["AlphaCDN-*"],
  cname: ["cdn.alpha.example"],
  challengeHosts: ["challenge.alpha.example", "*.challenge.alpha.example"],
  challengePaths: ["/alpha-challenge/"],
  challengeHeaders: [
    { name: "x-alpha-mitigated", value: "challenge" },
    { name: "x-alpha-challenge-id", value: null },
  ],
  challengeQueryNames: ["__alpha_chl_*"],
});

const BETA = provider("beta", {
  ranges: ["198.51.100.0/24"],
  headers: [{ name: "x-beta", value: null }],
  cookies: ["beta_session_guard"],
  server: ["beta"],
  cname: ["edge.beta.example"],
});

const TABLE: ProviderTable = {
  providers: [ALPHA, BETA],
  consentCookies: ["consent_*", "_measure"],
};

const ALPHA_IP = "192.0.2.10";
const BETA_IP = "198.51.100.7";
const UNKNOWN_IP = "203.0.113.1";

// A request through no known provider, at the lowest level a provider would
// give it: each test changes only the facts it is about.
function facts(changes: Partial<RequestFacts> = {}): RequestFacts {
  return {
    method: "GET",
    type: "script",
    tls: true,
    host: "www.example.org",
    path: "/app.js",
    queryNames: [],
    ip: UNKNOWN_IP,
    cookies: [],
    authorization: false,
    responseHeaders: [],
    setCookies: [],
    ...changes,
  };
}

function classify(changes: Partial<RequestFacts>): Classification | null {
  return classifyRequest(facts(changes), TABLE);
}

function providerOf(changes: Partial<RequestFacts>): string | null {
  return classify(changes)?.provider ?? null;
}

function provenFor(changes: Partial<RequestFacts>): boolean {
  const result = classify(changes);
  assert.ok(result !== null, "expected a provider");
  return result.proven;
}

function leakOf(changes: Partial<RequestFacts>): Leak {
  const result = classify({ ip: ALPHA_IP, ...changes });
  assert.ok(result !== null, "expected a provider");
  return result.leak;
}

const SESSION: Leak = {
  level: 4,
  case: "session",
  possible: false,
  challenge: false,
};
const SESSION_POSSIBLE: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: false,
};
const SESSION_IN_CHALLENGE: Leak = {
  level: 4,
  case: "session",
  possible: false,
  challenge: true,
};
const SESSION_POSSIBLE_IN_CHALLENGE: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: true,
};
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };
const CHALLENGE: Leak = { level: 4, case: "data-sent", challenge: true };

describe("classifyRequest, the provider", () => {
  it("finds the provider by the response IP", () => {
    assert.equal(providerOf({ ip: ALPHA_IP }), "alpha");
    assert.equal(providerOf({ ip: BETA_IP }), "beta");
  });

  it("finds the provider by an IPv6 response address", () => {
    assert.equal(providerOf({ ip: "2001:db8::1" }), "alpha");
    assert.equal(providerOf({ ip: "2001:DB8:FFFF::1" }), "alpha");
    assert.equal(providerOf({ ip: "2001:db9::1" }), null);
  });

  it("does not match an IPv4-mapped IPv6 address against IPv4 ranges", () => {
    assert.equal(providerOf({ ip: "::ffff:192.0.2.10" }), null);
  });

  it("returns null for a request through no known provider", () => {
    assert.equal(classify({}), null);
    assert.equal(classify({ ip: null }), null);
  });

  it("treats an address it cannot read as no address", () => {
    assert.equal(providerOf({ ip: "" }), null);
    assert.equal(providerOf({ ip: "not an address" }), null);
    assert.equal(providerOf({ ip: "fe80::1%eth0" }), null);
    assert.equal(
      providerOf({
        ip: "garbage",
        responseHeaders: [{ name: "x-alpha-id", value: "1" }],
      }),
      "alpha",
    );
  });

  it("falls back on a header signature, matched by presence", () => {
    assert.equal(
      providerOf({ responseHeaders: [{ name: "x-alpha-id", value: "42" }] }),
      "alpha",
    );
  });

  it("ignores the case of header names", () => {
    assert.equal(
      providerOf({ responseHeaders: [{ name: "X-Alpha-ID", value: "42" }] }),
      "alpha",
    );
  });

  it("matches a header value pattern without regard to case", () => {
    assert.equal(
      providerOf({
        responseHeaders: [{ name: "x-alpha-cache", value: "hit" }],
      }),
      "alpha",
    );
    assert.equal(
      providerOf({
        responseHeaders: [{ name: "x-alpha-cache", value: "HIT, fresh" }],
      }),
      "alpha",
    );
    assert.equal(
      providerOf({
        responseHeaders: [{ name: "x-alpha-cache", value: "MISS" }],
      }),
      null,
    );
  });

  it("falls back on the server header value", () => {
    assert.equal(
      providerOf({
        responseHeaders: [{ name: "Server", value: "AlphaCDN-PAR-12" }],
      }),
      "alpha",
    );
    assert.equal(
      providerOf({ responseHeaders: [{ name: "server", value: "BETA" }] }),
      "beta",
    );
    assert.equal(
      providerOf({ responseHeaders: [{ name: "server", value: "nginx" }] }),
      null,
    );
    assert.equal(
      providerOf({ responseHeaders: [{ name: "server", value: "beta-edge" }] }),
      null,
    );
  });

  it("compares server value patterns with the server header only", () => {
    assert.equal(
      providerOf({ responseHeaders: [{ name: "beta", value: "server" }] }),
      null,
    );
    assert.equal(
      providerOf({ responseHeaders: [{ name: "via", value: "beta" }] }),
      null,
    );
  });

  it("falls back on a cookie the response sets", () => {
    assert.equal(providerOf({ setCookies: ["__alpha_bm"] }), "alpha");
    assert.equal(providerOf({ setCookies: ["ALPHA_CLEARANCE"] }), "alpha");
    assert.equal(providerOf({ setCookies: ["session"] }), null);
  });

  it("never finds a provider by the cookies the request carries", () => {
    assert.equal(providerOf({ cookies: ["alpha_clearance"] }), null);
    assert.equal(providerOf({ cookies: ["alphabot_a"] }), null);
  });

  it("finds a provider by a cookie that a connector at the site may set", () => {
    assert.equal(providerOf({ setCookies: ["alphabot_a"] }), "alpha");
    assert.equal(providerOf({ setCookies: ["ALPHABOT_A"] }), "alpha");
    assert.equal(providerOf({ setCookies: ["alphabot"] }), null);
  });

  it("looks at a connector cookie after the IP and before the CNAME chain", () => {
    assert.equal(
      providerOf({ ip: BETA_IP, setCookies: ["alphabot_a"] }),
      "beta",
    );
    assert.equal(
      providerOf({
        setCookies: ["alphabot_a"],
        cnames: ["site.edge.beta.example"],
      }),
      "alpha",
    );
  });

  // The provider whose signal proves it relayed the response is the one that
  // read it, whatever its place in the table.
  it("prefers the provider shown by a signal to the one a connector cookie names", () => {
    assert.equal(
      providerOf({
        setCookies: ["alphabot_a"],
        responseHeaders: [{ name: "x-beta", value: "1" }],
      }),
      "beta",
    );
  });

  it("finds a provider from the cache, without an address, by its headers", () => {
    assert.equal(
      providerOf({
        ip: null,
        responseHeaders: [{ name: "x-alpha-id", value: "42" }],
      }),
      "alpha",
    );
  });

  it("stops at the IP when it answers, even if another provider's headers match", () => {
    assert.equal(
      providerOf({
        ip: BETA_IP,
        responseHeaders: [{ name: "x-alpha-id", value: "42" }],
      }),
      "beta",
    );
  });

  it("takes the first provider of the table whether its pattern has a wildcard or not", () => {
    const exact = provider("exact", {
      headers: [{ name: "x-alpha-id", value: null }],
      cookies: ["__alpha_id"],
      server: ["AlphaCDN-1"],
      cname: ["alpha.example"],
    });
    const wild = provider("wild", {
      headers: [{ name: "x-alpha-*", value: null }],
      cookies: ["__alpha_*"],
      server: ["AlphaCDN-*"],
      cname: ["example"],
    });
    const orders: [ProviderTable, string][] = [
      [{ ...TABLE, providers: [wild, exact] }, "wild"],
      [{ ...TABLE, providers: [exact, wild] }, "exact"],
    ];
    for (const [table, first] of orders) {
      for (const changes of [
        { responseHeaders: [{ name: "X-Alpha-Id", value: "1" }] },
        { responseHeaders: [{ name: "server", value: "alphacdn-1" }] },
        { setCookies: ["__alpha_id"] },
        { cnames: ["cdn.alpha.example"] },
      ]) {
        assert.equal(
          classifyRequest(facts(changes), table)?.provider,
          first,
          `${first}: ${JSON.stringify(changes)}`,
        );
      }
    }
  });

  it("takes the first provider of the table when several match the same step", () => {
    const overlap = provider("overlap", { ranges: ["192.0.2.0/28"] });
    const table = { ...TABLE, providers: [ALPHA, overlap] };
    assert.equal(
      classifyRequest(facts({ ip: ALPHA_IP }), table)?.provider,
      "alpha",
    );
    const reversed = { ...TABLE, providers: [overlap, ALPHA] };
    assert.equal(
      classifyRequest(facts({ ip: ALPHA_IP }), reversed)?.provider,
      "overlap",
    );
    assert.equal(
      providerOf({
        responseHeaders: [
          { name: "x-beta", value: "1" },
          { name: "x-alpha-id", value: "1" },
        ],
      }),
      "alpha",
    );
  });

  // A provider seen only in Via, first in the table, as a load balancer
  // behind another intermediary that writes no Via of its own.
  const HOP = provider("hop", {
    headers: [
      { name: "via", value: "*1.1 hop" },
      { name: "VIA", value: "*1.1 hop, *" },
    ],
  });
  const WITH_HOP: ProviderTable = { ...TABLE, providers: [HOP, ALPHA, BETA] };
  const HOP_VIA = { name: "Via", value: "1.1 hop" };

  function providerWithHop(changes: Partial<RequestFacts>): string | null {
    return classifyRequest(facts(changes), WITH_HOP)?.provider ?? null;
  }

  it("takes a provider named by another signal before one named only in Via", () => {
    for (const changes of [
      { responseHeaders: [HOP_VIA, { name: "x-beta", value: "1" }] },
      { responseHeaders: [{ name: "server", value: "beta" }, HOP_VIA] },
      { responseHeaders: [HOP_VIA], setCookies: ["beta_session_guard"] },
      {
        responseHeaders: [
          { name: "via", value: "1.1 hop, 1.1 varnish" },
          { name: "x-beta", value: "1" },
        ],
      },
    ]) {
      assert.equal(providerWithHop(changes), "beta", JSON.stringify(changes));
    }
  });

  it("takes a provider named only in Via when no other signal answers, and proves it", () => {
    const changes = { responseHeaders: [HOP_VIA] };
    assert.equal(providerWithHop(changes), "hop");
    assert.equal(classifyRequest(facts(changes), WITH_HOP)?.proven, true);
  });

  it("takes a provider named in Via before a site connector cookie or the CNAME chain", () => {
    assert.equal(
      providerWithHop({
        responseHeaders: [HOP_VIA],
        setCookies: ["alphabot_1"],
      }),
      "hop",
    );
    assert.equal(
      providerWithHop({
        responseHeaders: [HOP_VIA],
        cnames: ["site.edge.beta.example"],
      }),
      "hop",
    );
  });

  it("keeps the order of the table between providers named only in Via", () => {
    const other = provider("other", {
      headers: [{ name: "via", value: "*1.1 other*" }],
    });
    const responseHeaders = [{ name: "via", value: "1.1 hop, 1.1 other" }];
    const orders: [ProviderTable, string][] = [
      [{ ...TABLE, providers: [HOP, other] }, "hop"],
      [{ ...TABLE, providers: [other, HOP] }, "other"],
    ];
    for (const [table, first] of orders) {
      assert.equal(
        classifyRequest(facts({ responseHeaders }), table)?.provider,
        first,
      );
    }
  });

  it("skips a range it cannot read and keeps the others", () => {
    const broken = provider("broken", {
      ranges: ["not a range", "192.0.2.0/24"],
    });
    const table = { ...TABLE, providers: [broken] };
    assert.equal(
      classifyRequest(facts({ ip: ALPHA_IP }), table)?.provider,
      "broken",
    );
  });

  it("falls back on a name of the CNAME chain ending with a provider suffix", () => {
    assert.equal(
      providerOf({ ip: null, cnames: ["www.example.org.cdn.alpha.example"] }),
      "alpha",
    );
    assert.equal(providerOf({ cnames: ["site.edge.beta.example"] }), "beta");
    assert.equal(providerOf({ cnames: ["cdn.alpha.example"] }), "alpha");
  });

  it("takes the first provider of the table when names of the chain match several", () => {
    const chain = ["site.edge.beta.example", "x.cdn.alpha.example"];
    assert.equal(providerOf({ cnames: chain }), "alpha");
    const reversed = { ...TABLE, providers: [BETA, ALPHA] };
    assert.equal(
      classifyRequest(facts({ cnames: chain }), reversed)?.provider,
      "beta",
    );
  });

  it("matches a CNAME suffix on a label boundary only", () => {
    assert.equal(providerOf({ cnames: ["xcdn.alpha.example"] }), null);
    assert.equal(providerOf({ cnames: ["alpha.example"] }), null);
    assert.equal(providerOf({ cnames: ["cdn.alpha.example.org"] }), null);
  });

  it("ignores case when matching a CNAME suffix", () => {
    assert.equal(providerOf({ cnames: ["WWW.CDN.Alpha.Example"] }), "alpha");
  });

  it("finds no provider by CNAME when the chain is empty or absent", () => {
    assert.equal(providerOf({ cnames: [] }), null);
    assert.equal(providerOf({}), null);
  });

  it("does not take the request host for a name of the chain", () => {
    assert.equal(providerOf({ host: "www.cdn.alpha.example" }), null);
  });

  it("looks at the CNAME chain only when neither the IP nor the HTTP signals answer", () => {
    assert.equal(
      providerOf({ ip: BETA_IP, cnames: ["x.cdn.alpha.example"] }),
      "beta",
    );
    assert.equal(
      providerOf({
        responseHeaders: [{ name: "x-beta", value: "1" }],
        cnames: ["x.cdn.alpha.example"],
      }),
      "beta",
    );
  });
});

describe("classifyRequest, the proof of decryption", () => {
  it("is not proven by the IP alone", () => {
    assert.equal(provenFor({ ip: ALPHA_IP }), false);
  });

  it("is proven by a header signature of the provider", () => {
    assert.equal(
      provenFor({
        ip: ALPHA_IP,
        responseHeaders: [{ name: "X-ALPHA-ID", value: "42" }],
      }),
      true,
    );
  });

  it("is proven by the server header value of the provider", () => {
    assert.equal(
      provenFor({
        ip: ALPHA_IP,
        responseHeaders: [{ name: "server", value: "alphacdn-x" }],
      }),
      true,
    );
  });

  it("is proven by a cookie the provider sets", () => {
    assert.equal(provenFor({ ip: ALPHA_IP, setCookies: ["__alpha_bm"] }), true);
  });

  it("is not proven by a header value that does not match the signature", () => {
    assert.equal(
      provenFor({
        ip: ALPHA_IP,
        responseHeaders: [{ name: "x-alpha-cache", value: "MISS" }],
      }),
      false,
    );
  });

  it("is not proven by the provider's cookies sent with the request", () => {
    assert.equal(
      provenFor({ ip: ALPHA_IP, cookies: ["alpha_clearance"] }),
      false,
    );
  });

  it("is not proven by the signal of another provider", () => {
    assert.equal(
      provenFor({
        ip: BETA_IP,
        responseHeaders: [{ name: "x-alpha-id", value: "42" }],
        setCookies: ["__alpha_bm"],
      }),
      false,
    );
  });

  it("is not proven by a CNAME match alone", () => {
    assert.equal(
      provenFor({ ip: null, cnames: ["x.cdn.alpha.example"] }),
      false,
    );
  });

  it("is proven for a provider found by CNAME over plain HTTP", () => {
    assert.equal(
      provenFor({ ip: null, cnames: ["x.cdn.alpha.example"], tls: false }),
      true,
    );
  });

  it("is proven for a plain HTTP request, without any signal", () => {
    assert.equal(provenFor({ ip: ALPHA_IP, tls: false }), true);
  });

  it("is not proven by a cookie that a connector at the site may set", () => {
    assert.equal(provenFor({ setCookies: ["alphabot_a"] }), false);
    assert.equal(
      provenFor({ ip: ALPHA_IP, setCookies: ["alphabot_a"] }),
      false,
    );
  });

  it("is proven beside a connector cookie by another signal of the provider, or by plain HTTP", () => {
    assert.equal(
      provenFor({
        setCookies: ["alphabot_a"],
        responseHeaders: [{ name: "x-alpha-id", value: "42" }],
      }),
      true,
    );
    assert.equal(
      provenFor({ setCookies: ["alphabot_a", "alpha_clearance"] }),
      true,
    );
    assert.equal(provenFor({ setCookies: ["alphabot_a"], tls: false }), true);
  });

  it("is proven when the provider is found by its signal alone", () => {
    assert.equal(
      provenFor({ ip: null, responseHeaders: [{ name: "x-beta", value: "" }] }),
      true,
    );
  });
});

describe("classifyRequest, the level", () => {
  it("gives level 4, session, for an Authorization header", () => {
    assert.deepEqual(leakOf({ authorization: true }), SESSION);
  });

  it("puts Authorization before cookies and body, and keeps the challenge mark", () => {
    assert.deepEqual(
      leakOf({
        authorization: true,
        cookies: ["sid"],
        method: "POST",
        path: "/alpha-challenge/x",
      }),
      SESSION_IN_CHALLENGE,
    );
    assert.deepEqual(
      leakOf({ authorization: true, cookies: ["sid"], method: "POST" }),
      SESSION,
    );
  });

  it("gives level 4, session possible, for any cookie of the site", () => {
    assert.deepEqual(leakOf({ cookies: ["sid"] }), SESSION_POSSIBLE);
    assert.deepEqual(leakOf({ cookies: [""] }), SESSION_POSSIBLE);
  });

  it("ignores the provider's own cookies, whatever their case", () => {
    assert.deepEqual(
      leakOf({ cookies: ["alpha_clearance", "__alpha_bm", "ALPHA_CLEARANCE"] }),
      { level: 2 },
    );
  });

  it("ignores consent and audience-measurement cookies", () => {
    assert.deepEqual(leakOf({ cookies: ["consent_v2", "_measure"] }), {
      level: 2,
    });
    assert.deepEqual(
      leakOf({ type: "main_frame", path: "/article", cookies: ["_MEASURE"] }),
      { level: 3 },
    );
  });

  it("keeps a cookie left after dropping the provider's and the consent ones", () => {
    assert.deepEqual(
      leakOf({ cookies: ["alpha_clearance", "consent_v2", "sid"] }),
      SESSION_POSSIBLE,
    );
  });

  it("counts the connector cookies the request carries as cookies of the site", () => {
    assert.deepEqual(leakOf({ cookies: ["alphabot_a"] }), SESSION_POSSIBLE);
    assert.deepEqual(
      leakOf({ setCookies: ["alphabot_a"], cookies: ["ALPHABOT_A"] }),
      SESSION_POSSIBLE,
    );
  });

  it("does not drop the cookies of another provider", () => {
    assert.deepEqual(
      leakOf({ cookies: ["beta_session_guard"] }),
      SESSION_POSSIBLE,
    );
    assert.deepEqual(leakOf({ ip: BETA_IP, cookies: ["beta_session_guard"] }), {
      level: 2,
    });
  });

  it("does not drop a cookie that only resembles a consent pattern", () => {
    assert.deepEqual(leakOf({ cookies: ["my_consent_x"] }), SESSION_POSSIBLE);
    assert.deepEqual(leakOf({ cookies: ["_measure2"] }), SESSION_POSSIBLE);
  });

  it("raises nothing for an empty cookie list", () => {
    assert.deepEqual(leakOf({ cookies: [] }), { level: 2 });
  });

  it("keeps the session case for a challenge request that carries a session, with the challenge mark", () => {
    assert.deepEqual(
      leakOf({ method: "POST", path: "/alpha-challenge/x", cookies: ["sid"] }),
      SESSION_POSSIBLE_IN_CHALLENGE,
    );
    assert.deepEqual(
      leakOf({ queryNames: ["__alpha_chl_tk"], cookies: ["sid"] }),
      SESSION_POSSIBLE_IN_CHALLENGE,
    );
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "x-alpha-mitigated", value: "challenge" }],
        authorization: true,
      }),
      SESSION_IN_CHALLENGE,
    );
  });

  it("gives level 4, data sent, challenge, for a challenge response header", () => {
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "x-alpha-mitigated", value: "challenge" }],
      }),
      CHALLENGE,
    );
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "X-Alpha-Mitigated", value: "CHALLENGE" }],
      }),
      CHALLENGE,
    );
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "x-alpha-challenge-id", value: "" }],
      }),
      CHALLENGE,
    );
  });

  it("does not take a challenge header with another value for a challenge", () => {
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "x-alpha-mitigated", value: "block" }],
      }),
      { level: 2 },
    );
    assert.deepEqual(
      leakOf({
        responseHeaders: [{ name: "x-alpha-other", value: "challenge" }],
      }),
      { level: 2 },
    );
  });

  it("gives level 4, data sent, challenge, for a challenge query parameter name", () => {
    assert.deepEqual(leakOf({ queryNames: ["__alpha_chl_tk"] }), CHALLENGE);
    assert.deepEqual(
      leakOf({ queryNames: ["page", "__ALPHA_CHL_rt_tk"] }),
      CHALLENGE,
    );
    assert.deepEqual(leakOf({ queryNames: ["__alpha_chl_"] }), CHALLENGE);
  });

  it("compares challenge query names as whole names", () => {
    assert.deepEqual(leakOf({ queryNames: ["x__alpha_chl_tk"] }), {
      level: 2,
    });
    assert.deepEqual(leakOf({ queryNames: ["__alpha_ch"] }), { level: 2 });
  });

  it("marks the verification page and the form that validates the challenge", () => {
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        path: "/",
        queryNames: ["__alpha_chl_tk"],
        responseHeaders: [{ name: "x-alpha-mitigated", value: "challenge" }],
      }),
      CHALLENGE,
    );
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        method: "POST",
        path: "/",
        queryNames: ["__alpha_chl_tk"],
        cookies: ["alpha_clearance"],
      }),
      CHALLENGE,
    );
  });

  it("does not take the challenge header or query name of another provider", () => {
    assert.deepEqual(
      leakOf({
        ip: BETA_IP,
        responseHeaders: [{ name: "x-alpha-mitigated", value: "challenge" }],
      }),
      { level: 2 },
    );
    assert.deepEqual(leakOf({ ip: BETA_IP, queryNames: ["__alpha_chl_tk"] }), {
      level: 2,
    });
  });

  it("gives level 4, data sent, challenge, for a challenge host", () => {
    assert.deepEqual(leakOf({ host: "challenge.alpha.example" }), CHALLENGE);
    assert.deepEqual(leakOf({ host: "eu.challenge.alpha.example" }), CHALLENGE);
    assert.deepEqual(leakOf({ host: "CHALLENGE.Alpha.Example" }), CHALLENGE);
    assert.deepEqual(leakOf({ host: "xchallenge.alpha.example" }), {
      level: 2,
    });
  });

  it("gives level 4, data sent, challenge, for a challenge path prefix", () => {
    assert.deepEqual(leakOf({ path: "/alpha-challenge/" }), CHALLENGE);
    assert.deepEqual(leakOf({ path: "/alpha-challenge/h/b/flow" }), CHALLENGE);
    assert.deepEqual(
      leakOf({ type: "main_frame", path: "/alpha-challenge/page" }),
      CHALLENGE,
    );
  });

  it("compares challenge path prefixes with case, at the start only", () => {
    assert.deepEqual(leakOf({ path: "/ALPHA-CHALLENGE/x" }), { level: 2 });
    assert.deepEqual(leakOf({ path: "/alpha-challenge" }), { level: 2 });
    assert.deepEqual(leakOf({ path: "/x/alpha-challenge/" }), { level: 2 });
  });

  it("does not take the challenge of another provider", () => {
    assert.deepEqual(leakOf({ ip: BETA_IP, host: "challenge.alpha.example" }), {
      level: 2,
    });
  });

  it("puts the challenge before the body", () => {
    assert.deepEqual(
      leakOf({ method: "POST", path: "/alpha-challenge/x" }),
      CHALLENGE,
    );
  });

  it("gives level 4, data sent, to a method that carries a body", () => {
    for (const method of ["POST", "PUT", "PATCH", "patch", "Post"]) {
      assert.deepEqual(leakOf({ method }), DATA_SENT, method);
      assert.deepEqual(
        leakOf({ method, type: "main_frame", path: "/" }),
        DATA_SENT,
        method,
      );
    }
  });

  it("does not infer a body from other methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
      assert.deepEqual(leakOf({ method }), { level: 2 }, method);
    }
  });

  it("gives level 2 to the home page and 3 to other documents", () => {
    assert.deepEqual(leakOf({ type: "main_frame", path: "/" }), { level: 2 });
    assert.deepEqual(leakOf({ type: "main_frame", path: "/loi" }), {
      level: 3,
    });
    assert.deepEqual(leakOf({ type: "main_frame", path: "/index.html" }), {
      level: 3,
    });
    assert.deepEqual(leakOf({ type: "main_frame", path: "" }), { level: 3 });
  });

  it("gives level 3 to the home page with a query", () => {
    assert.deepEqual(
      leakOf({ type: "main_frame", path: "/", queryNames: ["s"] }),
      { level: 3 },
    );
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        path: "/",
        queryNames: ["utm_source", "s"],
      }),
      { level: 3 },
    );
    // "/?=word" has one parameter, whose name is empty.
    assert.deepEqual(
      leakOf({ type: "main_frame", path: "/", queryNames: [""] }),
      { level: 3 },
    );
  });

  it("puts the cookies and the body before the query of the home page", () => {
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        path: "/",
        queryNames: ["s"],
        cookies: ["sid"],
      }),
      SESSION_POSSIBLE,
    );
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        method: "POST",
        path: "/",
        queryNames: ["s"],
      }),
      DATA_SENT,
    );
  });

  it("does not raise a resource other than a document by its query", () => {
    assert.deepEqual(leakOf({ type: "script", path: "/", queryNames: ["v"] }), {
      level: 2,
    });
    assert.deepEqual(leakOf({ type: "image", queryNames: ["w"] }), {
      level: 2,
    });
  });

  it("treats a frame as a document", () => {
    assert.deepEqual(leakOf({ type: "sub_frame", path: "/" }), { level: 2 });
    assert.deepEqual(leakOf({ type: "sub_frame", path: "/widget" }), {
      level: 3,
    });
    assert.deepEqual(
      leakOf({ type: "sub_frame", path: "/", queryNames: ["id"] }),
      { level: 3 },
    );
  });

  it("gives level 3 to an XHR or fetch, home page included", () => {
    assert.deepEqual(leakOf({ type: "xmlhttprequest", path: "/api" }), {
      level: 3,
    });
    assert.deepEqual(leakOf({ type: "xmlhttprequest", path: "/" }), {
      level: 3,
    });
  });

  it("gives level 2 to every other resource type", () => {
    for (const type of [
      "script",
      "stylesheet",
      "image",
      "imageset",
      "font",
      "media",
      "object",
      "other",
    ]) {
      assert.deepEqual(leakOf({ type, path: "/x" }), { level: 2 }, type);
    }
  });

  it("gives level 4, data sent, to a WebSocket, even without a cookie", () => {
    assert.deepEqual(leakOf({ type: "websocket" }), DATA_SENT);
    assert.deepEqual(
      leakOf({ type: "websocket", path: "/", tls: false }),
      DATA_SENT,
    );
    assert.deepEqual(
      leakOf({
        type: "websocket",
        cookies: ["alpha_clearance", "consent_v2"],
      }),
      DATA_SENT,
    );
  });

  it("puts the cookies before the WebSocket", () => {
    assert.deepEqual(
      leakOf({ type: "websocket", cookies: ["sid"] }),
      SESSION_POSSIBLE,
    );
    assert.deepEqual(
      leakOf({ type: "websocket", authorization: true }),
      SESSION,
    );
  });

  it("marks a WebSocket of the challenge as the challenge's", () => {
    assert.deepEqual(
      leakOf({ type: "websocket", host: "challenge.alpha.example" }),
      CHALLENGE,
    );
  });

  it("raises a static resource to level 4 when it carries a cookie", () => {
    assert.deepEqual(
      leakOf({ type: "font", cookies: ["sid"] }),
      SESSION_POSSIBLE,
    );
    assert.deepEqual(
      leakOf({ type: "main_frame", path: "/", cookies: ["sid"] }),
      SESSION_POSSIBLE,
    );
  });

  it("never yields level 1", () => {
    const levels = new Set<number>();
    for (const type of ["main_frame", "sub_frame", "xmlhttprequest", "image"]) {
      for (const path of ["/", "/x"]) {
        for (const tls of [true, false]) {
          levels.add(leakOf({ type, path, tls }).level);
        }
      }
    }
    assert.deepEqual([...levels].sort(), [2, 3]);
  });
});

describe("classifyRequest, the output", () => {
  it("carries the provider id, the proof and the leak, and no URL part", () => {
    const result = classify({
      ip: ALPHA_IP,
      host: "secret-host.example",
      path: "/secret-path",
      queryNames: ["secret_parameter"],
      cookies: ["secret_cookie"],
      responseHeaders: [{ name: "x-alpha-id", value: "secret-value" }],
    });
    assert.deepEqual(result, {
      provider: "alpha",
      proven: true,
      leak: SESSION_POSSIBLE,
    });
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  });
});

describe("classifyRequest, the address ranges", () => {
  it("compares an IPv4 address with both ends of a range and nothing past them", () => {
    assert.equal(providerOf({ ip: "192.0.2.0" }), "alpha");
    assert.equal(providerOf({ ip: "192.0.2.255" }), "alpha");
    assert.equal(providerOf({ ip: "192.0.1.255" }), null);
    assert.equal(providerOf({ ip: "192.0.3.0" }), null);
  });

  it("finds an address in a range of every IPv4 address, and in a range of one", () => {
    const table: ProviderTable = {
      providers: [
        provider("one", { ranges: ["203.0.113.7/32"] }),
        provider("all", { ranges: ["0.0.0.0/0"] }),
      ],
      consentCookies: [],
    };
    const providerAt = (ip: string) =>
      classifyRequest(facts({ ip }), table)?.provider ?? null;
    assert.equal(providerAt("203.0.113.7"), "one");
    assert.equal(providerAt("203.0.113.8"), "all");
    assert.equal(providerAt("255.255.255.255"), "all");
    assert.equal(providerAt("0.0.0.0"), "all");
    assert.equal(providerAt("::1"), null);
  });

  it("reads no address that a leading zero, a missing part or a part above 255 makes doubtful", () => {
    for (const ip of [
      "192.0.2.010",
      "192.0.2.256",
      "192.0.2",
      "192.0.2.1.1",
      "192.0..1",
      "192.0.2.",
      "192.0.2.1 ",
    ]) {
      assert.equal(providerOf({ ip }), null, ip);
    }
  });
});

// A provider whose ranges count how many times they are read, to tell a
// lookup that compares the address from one that does not.
function countingRanges(ranges: string[]): {
  readonly entry: ProviderEntry;
  readonly reads: () => number;
} {
  let reads = 0;
  const parsed = rangesOf(ranges);
  const entry = {
    ...provider("counted", { cname: ["edge.counted.example"] }),
    get ranges() {
      reads += 1;
      return parsed;
    },
  };
  return { entry, reads: () => reads };
}

describe("classifyByCname", () => {
  it("names the provider of the canonical name as the CNAME step of classifyRequest does", () => {
    for (const changes of [
      {},
      { method: "POST" },
      { cookies: ["session"] },
      { tls: false },
      { type: "main_frame", path: "/" },
      { host: "challenge.alpha.example" },
    ]) {
      for (const name of [
        "www.example.org.cdn.alpha.example",
        "EDGE.BETA.EXAMPLE",
        "cdn.alpha.example",
      ]) {
        assert.deepEqual(
          classifyByCname(facts(changes), name, TABLE),
          classifyRequest({ ...facts(changes), cnames: [name] }, TABLE),
        );
      }
    }
  });

  it("finds no provider for a name no provider claims, or one that only resembles a suffix", () => {
    assert.equal(classifyByCname(facts(), "www.example.org", TABLE), null);
    assert.equal(classifyByCname(facts(), "xcdn.alpha.example", TABLE), null);
    assert.equal(classifyByCname(facts(), "", TABLE), null);
  });

  it("looks at the canonical name alone, since the address and the response already named no provider", () => {
    const { entry, reads } = countingRanges(["192.0.2.0/24"]);
    const table: ProviderTable = {
      providers: [BETA, entry],
      consentCookies: [],
    };
    // The first request of a table reads the ranges once, into its index.
    assert.equal(
      classifyRequest(facts({ ip: "192.0.2.7" }), table)?.provider,
      "counted",
    );
    const first = reads();
    assert.ok(first > 0);
    assert.equal(
      classifyByCname(
        facts({
          ip: BETA_IP,
          responseHeaders: [{ name: "x-beta", value: "1" }],
        }),
        "edge.counted.example",
        table,
      )?.provider,
      "counted",
    );
    classifyRequest(facts({ ip: "192.0.2.8" }), table);
    assert.equal(reads(), first);
  });
});

describe("colourOf", () => {
  it("is blue for levels 1 and 2, proven or not", () => {
    assert.equal(colourOf(1, false), "blue");
    assert.equal(colourOf(1, true), "blue");
    assert.equal(colourOf(2, false), "blue");
    assert.equal(colourOf(2, true), "blue");
  });

  it("is orange for levels 3 and 4 not proven", () => {
    assert.equal(colourOf(3, false), "orange");
    assert.equal(colourOf(4, false), "orange");
  });

  it("is red for levels 3 and 4 proven", () => {
    assert.equal(colourOf(3, true), "red");
    assert.equal(colourOf(4, true), "red");
  });
});

describe("classifySupposed", () => {
  it("names the supposed provider and gives the request the level of what it carries", () => {
    assert.deepEqual(
      classifySupposed(facts({ type: "image" }), "b-cdn.net", TABLE),
      { provider: "b-cdn.net", proven: false, leak: { level: 2 } },
    );
    assert.deepEqual(
      classifySupposed(facts({ type: "xmlhttprequest" }), "b-cdn.net", TABLE),
      { provider: "b-cdn.net", proven: false, leak: { level: 3 } },
    );
    assert.deepEqual(
      classifySupposed(facts({ method: "POST" }), "b-cdn.net", TABLE),
      {
        provider: "b-cdn.net",
        proven: false,
        leak: { level: 4, case: "data-sent", challenge: false },
      },
    );
  });

  it("never proves the decryption under TLS, whatever the response carries, and proves it over plain HTTP", () => {
    const signed = facts({
      responseHeaders: [{ name: "x-alpha-id", value: "1" }],
      setCookies: ["__alpha_bm"],
    });
    assert.equal(classifySupposed(signed, "b-cdn.net", TABLE).proven, false);
    assert.equal(
      classifySupposed(facts({ tls: false }), "b-cdn.net", TABLE).proven,
      true,
    );
  });

  it("takes every cookie but those of consent for a possible session, since none is its own", () => {
    assert.deepEqual(
      classifySupposed(facts({ cookies: ["__alpha_bm"] }), "b-cdn.net", TABLE)
        .leak,
      { level: 4, case: "session", possible: true, challenge: false },
    );
    assert.deepEqual(
      classifySupposed(
        facts({ type: "image", cookies: ["consent_choice", "_measure"] }),
        "b-cdn.net",
        TABLE,
      ).leak,
      { level: 2 },
    );
  });
});

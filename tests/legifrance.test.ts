// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The classification of a real visit: Légifrance behind Cloudflare, captured
// in LibreWolf on 2026-11-05 through the anti-bot challenge and the home page.
// The fixture comes from scripts/har-fixture.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { FixtureEntry } from "../scripts/har-fixture.js";
import {
  type Classification,
  classifyRequest,
  colourOf,
  type Leak,
  type RequestFacts,
} from "../src/core/classify.js";
import type { ProviderTable } from "../src/core/provider-table.js";
import { addRequest, NEUTRAL } from "../src/core/tab-state.js";

// data/providers/cloudflare as of 2026-11-05, with the challenge signatures,
// cf_clearance and the consent cookie the data does not hold yet.
const TABLE: ProviderTable = {
  providers: [
    {
      id: "cloudflare",
      name: "Cloudflare",
      country: "US",
      parent: null,
      ranges: [
        "173.245.48.0/20",
        "103.21.244.0/22",
        "103.22.200.0/22",
        "103.31.4.0/22",
        "141.101.64.0/18",
        "108.162.192.0/18",
        "190.93.240.0/20",
        "188.114.96.0/20",
        "197.234.240.0/22",
        "198.41.128.0/17",
        "162.158.0.0/15",
        "104.16.0.0/13",
        "104.24.0.0/14",
        "172.64.0.0/13",
        "131.0.72.0/22",
        "2400:cb00::/32",
        "2606:4700::/32",
        "2803:f800::/32",
        "2405:b500::/32",
        "2405:8100::/32",
        "2a06:98c0::/29",
        "2c0f:f248::/32",
      ],
      headers: [
        { name: "cf-ray", value: null },
        { name: "cf-cache-status", value: null },
        { name: "cf-mitigated", value: "challenge" },
      ],
      cookies: ["__cf_bm", "cf_clearance"],
      server: ["cloudflare"],
      cname: ["cdn.cloudflare.net"],
      challengeHosts: [
        "challenges.cloudflare.com",
        "*.challenges.cloudflare.com",
      ],
      challengePaths: ["/cdn-cgi/challenge-platform/"],
    },
  ],
  consentCookies: ["tarteaucitron"],
};

const FIXTURE = JSON.parse(
  readFileSync(
    new URL("../../tests/fixtures/legifrance-challenge.json", import.meta.url),
    "utf8",
  ),
) as FixtureEntry[];

function factsOf(entry: number): RequestFacts {
  const found = FIXTURE.find((item) => item.entry === entry);
  assert.ok(found !== undefined, `entry ${entry} is not in the fixture`);
  const { entry: _, ...facts } = found;
  return facts;
}

function classified(entry: number): Classification | null {
  return classifyRequest(factsOf(entry), TABLE);
}

function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

const CHALLENGE: Leak = { level: 4, case: "data-sent", challenge: true };
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };
const SESSION_POSSIBLE: Leak = { level: 4, case: "session", possible: true };
const USAGE: Leak = { level: 2 };

function assertEntries(entries: number[], leak: Leak): void {
  for (const entry of entries) {
    assert.deepEqual(
      classified(entry),
      { provider: "cloudflare", proven: true, leak },
      `entry ${entry}`,
    );
  }
}

describe("Légifrance capture", () => {
  it("holds the 78 HTTP requests of the capture, without the two data: URLs", () => {
    assert.equal(FIXTURE.length, 78);
    assert.ok(!FIXTURE.some((item) => item.entry === 54 || item.entry === 55));
  });

  it("finds Cloudflare by IPv4, by IPv6, and by headers when the capture has no address", () => {
    assert.equal(factsOf(1).ip, "141.101.90.107");
    assert.equal(factsOf(9).ip, "2606:4700::6812:1192");
    assert.equal(factsOf(12).ip, null);
    assert.equal(factsOf(13).ip, null);
    for (const entry of [1, 9, 12, 13]) {
      assert.equal(classified(entry)?.provider, "cloudflare", `entry ${entry}`);
    }
  });

  it("classifies the challenge requests, entries 2 to 13, as data sent by the challenge", () => {
    assertEntries([2, 4, ...range(6, 13)], CHALLENGE);
  });

  it("keeps the first home page load and the favicons of the challenge at level 2", () => {
    assertEntries([1, 3, 5], USAGE);
  });

  it("classifies the form the challenge posts to the home page as data sent, without the challenge mark", () => {
    assertEntries([14], DATA_SENT);
  });

  it("keeps the home page and its resources at level 2, cf_clearance being ignored", () => {
    assertEntries(
      range(15, 69).filter((entry) => ![53, 54, 55].includes(entry)),
      USAGE,
    );
  });

  it("finds no provider for the request that got no response", () => {
    assert.equal(classified(53), null);
  });

  it("keeps entry 70 at level 2, tarteaucitron being a consent cookie", () => {
    assert.deepEqual(factsOf(70).cookies, ["cf_clearance", "tarteaucitron"]);
    assertEntries([70], USAGE);
  });

  it("classifies entries 71 to 75 as a possible session, from lf-demo-accueil", () => {
    assert.deepEqual(factsOf(71).cookies, [
      "cf_clearance",
      "tarteaucitron",
      "lf-demo-accueil",
    ]);
    assertEntries(range(71, 75), SESSION_POSSIBLE);
  });

  it("classifies entries 76 to 80 as a possible session, JSESSIONID included", () => {
    assert.ok(factsOf(76).cookies.includes("JSESSIONID"));
    assertEntries(range(76, 80), SESSION_POSSIBLE);
  });

  it("colours every level 4 request red, the decryption being proven", () => {
    for (const item of FIXTURE) {
      const result = classifyRequest(item, TABLE);
      if (result?.leak.level === 4) {
        assert.equal(colourOf(4, result.proven), "red", `entry ${item.entry}`);
      }
    }
  });

  it("turns the tab red at level 4 from the second request on", () => {
    const states = FIXTURE.map((item) => classifyRequest(item, TABLE)).reduce(
      (history, result) => {
        const last = history.at(-1) ?? NEUTRAL;
        history.push(addRequest(last, result));
        return history;
      },
      [] as ReturnType<typeof addRequest>[],
    );
    assert.deepEqual(states[0], { kind: "seen", colour: "blue", level: 2 });
    assert.deepEqual(states[1], { kind: "seen", colour: "red", level: 4 });
    assert.deepEqual(states.at(-1), { kind: "seen", colour: "red", level: 4 });
  });

  it("keeps the tab blue at level 2 over the home page and its resources alone", () => {
    const state = FIXTURE.filter((item) => item.entry >= 15 && item.entry <= 70)
      .map((item) => classifyRequest(item, TABLE))
      .reduce(addRequest, NEUTRAL);
    assert.deepEqual(state, { kind: "seen", colour: "blue", level: 2 });
  });
});

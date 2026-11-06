// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The classification of a real visit: Légifrance behind Cloudflare, captured
// in LibreWolf on 2026-11-05 through the anti-bot challenge and the home page.
// The fixture comes from scripts/har-fixture.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FixtureEntry } from "../scripts/har-fixture.js";
import { loadTable } from "../scripts/providers.js";
import {
  type Classification,
  classifyRequest,
  colourOf,
  type Leak,
  type RequestFacts,
} from "../src/core/classify.js";
import { displayOf, titleText } from "../src/core/display.js";
import {
  addRequest,
  colourOfRequest,
  NEUTRAL,
  type TabState,
} from "../src/core/tab-state.js";
import { getMessageOf } from "./messages.js";

// The colour and level the icon shows for a state.
function shown(state: TabState | undefined) {
  return state?.kind === "seen"
    ? {
        colour: colourOfRequest(state.request),
        level: state.request.leak.level,
        partial: state.partial,
      }
    : state;
}

// The committed data, so that the visit is classified as the extension
// classifies it.
const TABLE = loadTable(
  fileURLToPath(new URL("../../data", import.meta.url)),
).table;

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
const SESSION_POSSIBLE: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: false,
};
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

  it("keeps the names of the query parameters and nothing of their values", () => {
    assert.deepEqual(factsOf(1).queryNames, ["__cf_chl_tk"]);
    assert.deepEqual(factsOf(4).queryNames, ["onload", "render"]);
    assert.deepEqual(factsOf(15).queryNames, []);
    for (const item of FIXTURE) {
      for (const name of item.queryNames) {
        assert.doesNotMatch(name, /[=&]/, `entry ${item.entry}`);
      }
    }
  });

  it("keeps a redirect without the query of its URL", () => {
    const location = factsOf(74).responseHeaders.find(
      (header) => header.name.toLowerCase() === "location",
    );
    assert.equal(
      location?.value,
      "/cdn-cgi/challenge-platform/h/b/scripts/jsd/8340802ab0bb/main.js",
    );
  });

  it("classifies the verification page, entry 1, as data sent by the challenge", () => {
    const facts = factsOf(1);
    assert.equal(facts.type, "main_frame");
    assert.equal(facts.path, "/");
    assert.ok(
      facts.responseHeaders.some(
        (header) =>
          header.name.toLowerCase() === "cf-mitigated" &&
          header.value === "challenge",
      ),
    );
    assertEntries([1], CHALLENGE);
  });

  it("classifies the challenge requests, entries 2 to 13, as data sent by the challenge", () => {
    assertEntries([2, 4, ...range(6, 13)], CHALLENGE);
  });

  it("keeps the favicons loaded during the challenge at level 2", () => {
    assertEntries([3, 5], USAGE);
  });

  it("classifies the form that validates the challenge, entry 14, as data sent by the challenge", () => {
    const facts = factsOf(14);
    assert.equal(facts.method, "POST");
    assert.equal(facts.path, "/");
    assert.deepEqual(facts.queryNames, ["__cf_chl_tk"]);
    assert.deepEqual(facts.cookies, ["cf_clearance"]);
    assertEntries([14], CHALLENGE);
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
    assertEntries(range(71, 73), SESSION_POSSIBLE);
  });

  it("classifies entries 76 to 80 as a possible session, JSESSIONID included", () => {
    assert.ok(factsOf(76).cookies.includes("JSESSIONID"));
    assertEntries([76, 77, 78, 80], SESSION_POSSIBLE);
  });

  it("keeps the possible session on the challenge requests that carry the cookies of the site, with the challenge mark", () => {
    for (const entry of [74, 75, 79]) {
      assert.ok(factsOf(entry).path.startsWith("/cdn-cgi/challenge-platform/"));
    }
    assertEntries([74, 75, 79], {
      level: 4,
      case: "session",
      possible: true,
      challenge: true,
    });
  });

  it("colours every level 4 request red, the decryption being proven", () => {
    for (const item of FIXTURE) {
      const result = classifyRequest(item, TABLE);
      if (result?.leak.level === 4) {
        assert.equal(colourOf(4, result.proven), "red", `entry ${item.entry}`);
      }
    }
  });

  it("turns the tab red at level 4 from the verification page on", () => {
    const states = FIXTURE.map((item) => classifyRequest(item, TABLE)).reduce(
      (history, result) => {
        const last = history.at(-1) ?? NEUTRAL;
        history.push(addRequest(last, result));
        return history;
      },
      [] as TabState[],
    );
    const red = { colour: "red", level: 4, partial: false };
    assert.deepEqual(shown(states[0]), red);
    assert.deepEqual(shown(states.at(-1)), red);
  });

  it("ends on the possible session of the site rather than on the anti-bot requests before it", () => {
    const state = FIXTURE.map((item) => classifyRequest(item, TABLE)).reduce(
      addRequest,
      NEUTRAL,
    );
    assert.deepEqual(state.kind === "seen" ? state.request : state, {
      provider: "cloudflare",
      proven: true,
      leak: { level: 4, case: "session", possible: true, challenge: false },
    });
  });

  it("keeps the tab blue at level 2 over the home page and its resources alone", () => {
    const state = FIXTURE.filter((item) => item.entry >= 15 && item.entry <= 70)
      .map((item) => classifyRequest(item, TABLE))
      .reduce(addRequest, NEUTRAL);
    assert.deepEqual(shown(state), {
      colour: "blue",
      level: 2,
      partial: false,
    });
  });

  it("counts the requests of the visit in the tooltip, then names the possible session of the site", () => {
    const state = FIXTURE.map((item) => classifyRequest(item, TABLE)).reduce(
      addRequest,
      NEUTRAL,
    );
    const title = displayOf(state, TABLE.providers).title;
    assert.equal(
      titleText(title, getMessageOf("fr")),
      "Niveau 4, données personnelles\u00a0: 22 requêtes, déchiffrement prouvé\n" +
        "Niveau 2, usage\u00a0: 55 requêtes\n" +
        "\n" +
        "Session possible\u00a0: les cookies que vous envoyez à ce site passent en clair chez Cloudflare, et l'un d'eux peut porter votre session.",
    );
    assert.equal(
      titleText(title, getMessageOf("en")),
      "Level 4, personal data: 22 requests, decryption proven\n" +
        "Level 2, usage: 55 requests\n" +
        "\n" +
        "Possible session: the cookies you send to this site go through Cloudflare in clear, and one of them may hold your session.",
    );
  });
});

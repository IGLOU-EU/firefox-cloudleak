// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification, Leak } from "../src/core/classify.js";
import {
  categoryOf,
  countRequest,
  emptyCounts,
  type KeptCounts,
  requestKindOf,
  type SeenRequest,
  totalsOf,
} from "../src/core/counts.js";

function request(
  leak: Leak,
  proven: boolean,
  provider = "cloudflare",
): Classification {
  return { provider, proven, leak };
}

function seen(
  classification: Classification,
  method = "GET",
  type = "image",
  privateWindow = false,
): SeenRequest {
  return { classification, method, type, privateWindow };
}

const SESSION: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: false,
};
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };

const SITE = "legifrance.gouv.fr";

function fold(requests: [string, SeenRequest][], since = 0): KeptCounts {
  return requests.reduce(
    (counts, [site, entry]) => countRequest(counts, site, entry),
    emptyCounts(since),
  );
}

describe("emptyCounts", () => {
  it("counts nothing and keeps when the counts started", () => {
    assert.deepEqual(emptyCounts(1_700_000_000_000), {
      since: 1_700_000_000_000,
      sites: {},
    });
  });
});

describe("categoryOf", () => {
  it("is the colour of the request, then its level", () => {
    assert.equal(categoryOf(request({ level: 2 }, true)), "blue2");
    assert.equal(categoryOf(request({ level: 2 }, false)), "blue2");
    assert.equal(categoryOf(request({ level: 3 }, false)), "orange3");
    assert.equal(categoryOf(request({ level: 3 }, true)), "red3");
    assert.equal(categoryOf(request(SESSION, false)), "orange4");
    assert.equal(categoryOf(request(DATA_SENT, true)), "red4");
  });
});

describe("requestKindOf", () => {
  it("joins the method and the request type as Firefox gives them", () => {
    assert.equal(
      requestKindOf(seen(request({ level: 2 }, true), "GET", "image")),
      "GET image",
    );
    assert.equal(
      requestKindOf(
        seen(request({ level: 3 }, true), "POST", "xmlhttprequest"),
      ),
      "POST xmlhttprequest",
    );
    assert.equal(
      requestKindOf(seen(request({ level: 3 }, true), "patch", "fetch")),
      "patch fetch",
    );
  });
});

describe("countRequest", () => {
  it("counts a first request under its site, provider, category and kind", () => {
    const counts = fold(
      [[SITE, seen(request({ level: 3 }, true), "GET", "main_frame")]],
      5,
    );
    assert.deepEqual(counts, {
      since: 5,
      sites: {
        [SITE]: { cloudflare: { red3: { "GET main_frame": 1 } } },
      },
    });
  });

  it("adds up the requests of the same kind, and keeps the others apart", () => {
    const image = seen(request({ level: 2 }, true));
    const counts = fold([
      [SITE, image],
      [SITE, image],
      [SITE, seen(request({ level: 2 }, false), "GET", "script")],
      [SITE, seen(request(SESSION, true), "POST", "xmlhttprequest")],
      [SITE, seen(request({ level: 2 }, true, "akamai"))],
      ["leboncoin.fr", seen(request(DATA_SENT, false, "cloudfront"), "POST")],
    ]);
    assert.deepEqual(counts.sites, {
      [SITE]: {
        cloudflare: {
          blue2: { "GET image": 2, "GET script": 1 },
          red4: { "POST xmlhttprequest": 1 },
        },
        akamai: { blue2: { "GET image": 1 } },
      },
      "leboncoin.fr": {
        cloudfront: { orange4: { "POST image": 1 } },
      },
    });
  });

  it("leaves the counts it is given as they were, and shares the sites it does not touch", () => {
    const before = fold([
      [SITE, seen(request({ level: 2 }, true))],
      ["leboncoin.fr", seen(request({ level: 2 }, true))],
    ]);
    const frozen = JSON.stringify(before);
    const after = countRequest(before, SITE, seen(request({ level: 3 }, true)));
    assert.equal(JSON.stringify(before), frozen);
    assert.equal(after.sites["leboncoin.fr"], before.sites["leboncoin.fr"]);
    assert.notEqual(after.sites[SITE], before.sites[SITE]);
    assert.equal(after.since, before.since);
  });

  it("counts a site of one label, an address and a punycode name like any other", () => {
    const counts = fold([
      ["localhost", seen(request({ level: 2 }, true))],
      ["192.0.2.1", seen(request({ level: 2 }, true))],
      ["[2001:db8::1]", seen(request({ level: 2 }, true))],
      ["xn--mnchen-3ya.de", seen(request({ level: 2 }, true))],
    ]);
    assert.deepEqual(Object.keys(counts.sites), [
      "localhost",
      "192.0.2.1",
      "[2001:db8::1]",
      "xn--mnchen-3ya.de",
    ]);
  });
});

describe("totalsOf", () => {
  const counts = fold([[SITE, seen(request({ level: 2 }, true))]]);

  it("gives the counts of a site", () => {
    assert.deepEqual(totalsOf(counts, SITE), {
      cloudflare: { blue2: { "GET image": 1 } },
    });
  });

  it("is empty for a site that sent nothing through a provider, and for a document without a site", () => {
    assert.deepEqual(totalsOf(counts, "leboncoin.fr"), {});
    assert.deepEqual(totalsOf(counts, null), {});
    assert.deepEqual(totalsOf(emptyCounts(0), SITE), {});
  });
});

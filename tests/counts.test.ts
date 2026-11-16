// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification, Leak } from "../src/core/classify.js";
import {
  categoryOf,
  clearSite,
  countInSite,
  dayOf,
  dropSite,
  emptyCounts,
  type KeptCounts,
  requestKindOf,
  type SeenRequest,
  sinceOf,
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

const SESSION_POSSIBLE: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: false,
};
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };

const SITE = "legifrance.gouv.fr";

// The kept counts with one more request of a site, without changing those
// given, to build the counts the other functions take.
function count(
  counts: KeptCounts,
  site: string,
  entry: SeenRequest,
): KeptCounts {
  return {
    ...counts,
    sites: { ...counts.sites, [site]: countInSite(counts.sites[site], entry) },
  };
}

function fold(requests: [string, SeenRequest][], since = 0): KeptCounts {
  return requests.reduce(
    (counts, [site, entry]) => count(counts, site, entry),
    emptyCounts(since),
  );
}

describe("emptyCounts", () => {
  it("counts nothing, keeps when the counts started, and has no site cleared", () => {
    assert.deepEqual(emptyCounts(1_700_000_000_000), {
      since: 1_700_000_000_000,
      siteSince: {},
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
    assert.equal(categoryOf(request(SESSION_POSSIBLE, false)), "orange4");
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

describe("countInSite", () => {
  it("counts a first request under its provider, category and kind", () => {
    assert.deepEqual(
      countInSite(
        undefined,
        seen(request({ level: 3 }, true), "GET", "main_frame"),
      ),
      { cloudflare: { red3: { "GET main_frame": 1 } } },
    );
  });

  it("adds up the requests of the same kind, and keeps the others apart", () => {
    const image = seen(request({ level: 2 }, true));
    const counts = [
      image,
      image,
      seen(request({ level: 2 }, false), "GET", "script"),
      seen(request(SESSION_POSSIBLE, true), "POST", "xmlhttprequest"),
      seen(request({ level: 2 }, true, "akamai")),
    ].reduce(
      (siteCounts, entry) => countInSite(siteCounts, entry),
      countInSite(undefined, seen(request(DATA_SENT, false, "cloudfront"))),
    );
    assert.deepEqual(counts, {
      cloudfront: { orange4: { "GET image": 1 } },
      cloudflare: {
        blue2: { "GET image": 2, "GET script": 1 },
        red4: { "POST xmlhttprequest": 1 },
      },
      akamai: { blue2: { "GET image": 1 } },
    });
  });

  it("leaves the counts it is given as they were, and shares the providers it does not touch", () => {
    const before = countInSite(
      countInSite(undefined, seen(request({ level: 2 }, true))),
      seen(request({ level: 2 }, true, "akamai")),
    );
    const frozen = JSON.stringify(before);
    const after = countInSite(before, seen(request({ level: 3 }, true)));
    assert.equal(JSON.stringify(before), frozen);
    assert.equal(after["akamai"], before["akamai"]);
    assert.notEqual(after["cloudflare"], before["cloudflare"]);
    assert.deepEqual(after["cloudflare"], {
      blue2: { "GET image": 1 },
      red3: { "GET image": 1 },
    });
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

describe("clearSite", () => {
  const LEBONCOIN = "leboncoin.fr";
  const before = fold(
    [
      [SITE, seen(request({ level: 3 }, true), "GET", "main_frame")],
      [LEBONCOIN, seen(request({ level: 2 }, true))],
    ],
    5,
  );

  it("drops the counts of the site, and starts them again at the moment of the clear", () => {
    const after = clearSite(before, SITE, 900);
    assert.deepEqual(after, {
      since: 5,
      siteSince: { [SITE]: 900 },
      sites: { [LEBONCOIN]: before.sites[LEBONCOIN] },
    });
  });

  it("leaves the counts it is given as they were, and shares the other sites", () => {
    const frozen = JSON.stringify(before);
    const after = clearSite(before, SITE, 900);
    assert.equal(JSON.stringify(before), frozen);
    assert.equal(after.sites[LEBONCOIN], before.sites[LEBONCOIN]);
  });

  it("dates a site that counted nothing yet, and dates a site cleared again from the last clear", () => {
    const once = clearSite(before, "example.org", 900);
    assert.deepEqual(once.siteSince, { "example.org": 900 });
    assert.deepEqual(once.sites, before.sites);
    const twice = clearSite(clearSite(before, SITE, 900), SITE, 1000);
    assert.deepEqual(twice.siteSince, { [SITE]: 1000 });
  });

  it("keeps the date of the other sites cleared before", () => {
    const after = clearSite(clearSite(before, LEBONCOIN, 700), SITE, 900);
    assert.deepEqual(after.siteSince, { [LEBONCOIN]: 700, [SITE]: 900 });
    assert.deepEqual(after.sites, {});
  });

  it("lets a request counted after the clear count from zero, with the date of the clear", () => {
    const after = count(
      clearSite(before, SITE, 900),
      SITE,
      seen(request({ level: 2 }, true)),
    );
    assert.deepEqual(after.sites[SITE], {
      cloudflare: { blue2: { "GET image": 1 } },
    });
    assert.equal(sinceOf(after, SITE), 900);
  });
});

describe("dropSite", () => {
  const LEBONCOIN = "leboncoin.fr";
  const before = clearSite(
    clearSite(
      fold(
        [
          [SITE, seen(request({ level: 3 }, true), "GET", "main_frame")],
          [LEBONCOIN, seen(request({ level: 2 }, true))],
        ],
        5,
      ),
      LEBONCOIN,
      700,
    ),
    "example.org",
    800,
  );
  const counted = count(
    before,
    LEBONCOIN,
    seen(request(SESSION_POSSIBLE, true)),
  );

  it("keeps nothing of the site, neither its counts nor its own start, and leaves the others and the common start", () => {
    const after = dropSite(counted, LEBONCOIN);
    assert.deepEqual(after, {
      since: 5,
      siteSince: { "example.org": 800 },
      sites: { [SITE]: counted.sites[SITE] },
    });
    assert.equal(sinceOf(after, LEBONCOIN), 5);
    assert.deepEqual(totalsOf(after, LEBONCOIN), {});
  });

  it("leaves the counts it is given as they were", () => {
    const frozen = JSON.stringify(counted);
    dropSite(counted, LEBONCOIN);
    assert.equal(JSON.stringify(counted), frozen);
  });

  it("changes nothing of a site it does not know", () => {
    assert.deepEqual(dropSite(counted, "unknown.example"), counted);
  });
});

describe("sinceOf", () => {
  const cleared = clearSite(
    fold([[SITE, seen(request({ level: 2 }, true))]], 5),
    SITE,
    900,
  );

  it("is the moment of its last clear for a site cleared", () => {
    assert.equal(sinceOf(cleared, SITE), 900);
  });

  it("is the start of the counts for a site never cleared, counted or not, and for a document without a site", () => {
    assert.equal(sinceOf(cleared, "leboncoin.fr"), 5);
    assert.equal(sinceOf(cleared, null), 5);
    assert.equal(sinceOf(emptyCounts(5), SITE), 5);
  });
});

describe("dayOf", () => {
  it("keeps the day at its local midnight, whatever the hour", () => {
    const evening = new Date(2026, 10, 7, 21, 34, 5, 678).getTime();
    assert.equal(dayOf(evening), new Date(2026, 10, 7).getTime());
  });

  it("leaves a midnight as it is", () => {
    const midnight = new Date(2026, 10, 7).getTime();
    assert.equal(dayOf(midnight), midnight);
  });
});

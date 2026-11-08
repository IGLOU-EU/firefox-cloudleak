// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addAddress,
  addressOf,
  DEFAULT_SETTINGS,
  fitAddresses,
  keepsFewer,
  recordLimitOf,
  recordsLevel,
  settingsOf,
} from "../src/core/addresses.js";
import type { Classification, LeakLevel } from "../src/core/classify.js";
import type { SeenRequest } from "../src/core/counts.js";
import type { RecordLevel, SiteAddresses } from "../src/core/popup-message.js";

const SECRET = "s3cr3t-value";

describe("addressOf", () => {
  it("keeps the scheme, the host, the path and the names of the query parameters, each value replaced", () => {
    assert.equal(
      addressOf(`https://cdn.example.net/assets/app.css?v=3&token=${SECRET}`),
      "https://cdn.example.net/assets/app.css?v=…&token=…",
    );
  });

  it("keeps a parameter without value as its name, and an empty value empty, since it hides nothing", () => {
    assert.equal(
      addressOf(`https://example.org/s?debug&q=${SECRET}&page=`),
      "https://example.org/s?debug&q=…&page=",
    );
  });

  it("drops a user name and a password written in the URL", () => {
    for (const url of [
      `https://user:${SECRET}@example.org/x?a=1`,
      `https://${SECRET}@example.org/x?a=1`,
      `https://:${SECRET}@example.org/x?a=1`,
      `https://us%40er:p%3Ass@example.org/x?a=1`,
    ]) {
      assert.equal(addressOf(url), "https://example.org/x?a=…", url);
    }
  });

  it("keeps each parameter of a repeated name, in order", () => {
    assert.equal(
      addressOf(`https://example.org/?a=1&b=${SECRET}&a=2&a`),
      "https://example.org/?a=…&b=…&a=…&a",
    );
  });

  it("keeps a name as the URL writes it, encoded, so that it can neither pass for another nor hold a separator", () => {
    assert.equal(
      addressOf(
        `https://example.org/?%74oken=${SECRET}&a%3Db=${SECRET}&a+b=1&caf%C3%A9=2`,
      ),
      "https://example.org/?%74oken=…&a%3Db=…&a+b=…&caf%C3%A9=…",
    );
    // The URL encodes a name typed in Unicode.
    assert.equal(
      addressOf("https://example.org/?café=1"),
      "https://example.org/?caf%C3%A9=…",
    );
  });

  it("replaces a value that holds an equals sign or a semicolon whole", () => {
    assert.equal(
      addressOf(`https://example.org/?a=b=${SECRET}&c=d;e=${SECRET}`),
      "https://example.org/?a=…&c=…",
    );
  });

  it("keeps a parameter whose name is empty, without its value", () => {
    assert.equal(
      addressOf(`https://example.org/?=${SECRET}`),
      "https://example.org/?=…",
    );
  });

  it("writes no query when the URL has none, or only separators", () => {
    for (const url of [
      "https://example.org/path",
      "https://example.org/path?",
      "https://example.org/path?&&",
    ]) {
      assert.equal(addressOf(url), "https://example.org/path", url);
    }
    assert.equal(addressOf("https://example.org"), "https://example.org/");
  });

  it("drops the fragment, and a query written after it", () => {
    assert.equal(
      addressOf(`https://example.org/p?a=1#${SECRET}`),
      "https://example.org/p?a=…",
    );
    assert.equal(
      addressOf(`https://example.org/p#a=${SECRET}?b=${SECRET}`),
      "https://example.org/p",
    );
  });

  it("keeps the WebSocket schemes", () => {
    assert.equal(
      addressOf(`wss://socket.example.net/live?id=${SECRET}`),
      "wss://socket.example.net/live?id=…",
    );
    assert.equal(
      addressOf("ws://example.org:8080/s"),
      "ws://example.org:8080/s",
    );
  });

  it("keeps an IPv6 address with its brackets and its port", () => {
    assert.equal(
      addressOf(`https://[2001:db8::1]:8443/x?y=${SECRET}`),
      "https://[2001:db8::1]:8443/x?y=…",
    );
    assert.equal(addressOf("http://[::1]/"), "http://[::1]/");
  });

  it("keeps the port of a host, and leaves out the default port of the scheme, which the scheme says", () => {
    assert.equal(
      addressOf("https://example.org:8443/a"),
      "https://example.org:8443/a",
    );
    assert.equal(
      addressOf("https://example.org:443/a"),
      "https://example.org/a",
    );
    assert.equal(addressOf("http://example.org:80/a"), "http://example.org/a");
    assert.equal(addressOf("http://192.0.2.1:8080/"), "http://192.0.2.1:8080/");
  });

  it("writes the scheme and the host in lower case, and the path as the URL gives it", () => {
    assert.equal(
      addressOf("HTTPS://WWW.Example.ORG/Some%20Path/../A b"),
      "https://www.example.org/A%20b",
    );
  });

  it("gives nothing for a URL that is not of the web, or not a URL", () => {
    for (const url of [
      "ftp://example.org/file",
      "data:text/plain,secret",
      "blob:https://example.org/1",
      "about:blank",
      "not a url",
      "",
    ]) {
      assert.equal(addressOf(url), null, url);
    }
  });
});

describe("recordsLevel", () => {
  const levels: LeakLevel[] = [1, 2, 3, 4];
  const expected: Record<RecordLevel, LeakLevel[]> = {
    none: [],
    level4: [4],
    level3and4: [3, 4],
  };

  for (const [record, kept] of Object.entries(expected)) {
    it(`takes the levels ${kept.join(" and ") || "of no request"} when set to ${record}`, () => {
      for (const level of levels) {
        assert.equal(
          recordsLevel(record as RecordLevel, level),
          kept.includes(level),
          `level ${level}`,
        );
      }
    });
  }
});

describe("recordLimitOf", () => {
  it("keeps any integer of at least 1, however large", () => {
    for (const limit of [
      1,
      100,
      1000,
      1001,
      5000,
      1_000_000,
      Number.MAX_SAFE_INTEGER,
    ]) {
      assert.equal(recordLimitOf(limit), limit);
    }
  });

  it("refuses a number below 1, a fraction and what is beyond the integers a number holds exactly, rather than bring it near", () => {
    for (const value of [
      0,
      -5,
      0.4,
      2.4,
      2.5,
      Number.MAX_SAFE_INTEGER + 1,
      1e300,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      assert.equal(recordLimitOf(value), null, String(value));
    }
  });

  it("refuses what is no number", () => {
    for (const value of [Number.NaN, "100", null, undefined, {}, [100], true]) {
      assert.equal(recordLimitOf(value), null, String(value));
    }
  });
});

describe("settingsOf", () => {
  it("records nothing and keeps 100 addresses by default", () => {
    assert.deepEqual(DEFAULT_SETTINGS, { record: "none", recordLimit: 100 });
    assert.deepEqual(settingsOf(undefined), DEFAULT_SETTINGS);
  });

  it("keeps stored settings that are valid", () => {
    assert.deepEqual(settingsOf({ record: "level4", recordLimit: 5 }), {
      record: "level4",
      recordLimit: 5,
    });
    assert.deepEqual(settingsOf({ record: "level3and4", recordLimit: 1000 }), {
      record: "level3and4",
      recordLimit: 1000,
    });
    assert.deepEqual(
      settingsOf({ record: "level3and4", recordLimit: 250_000 }),
      { record: "level3and4", recordLimit: 250_000 },
    );
  });

  it("falls back to the default of each setting that is not valid, so that a doubt records nothing", () => {
    assert.deepEqual(settingsOf({ record: "all", recordLimit: 5 }), {
      record: "none",
      recordLimit: 5,
    });
    assert.deepEqual(settingsOf({ record: "level4", recordLimit: "5" }), {
      record: "level4",
      recordLimit: 100,
    });
    for (const recordLimit of [0, 2.5, -1]) {
      assert.deepEqual(settingsOf({ record: "level4", recordLimit }), {
        record: "level4",
        recordLimit: 100,
      });
    }
    for (const value of [null, "level4", 4, []]) {
      assert.deepEqual(settingsOf(value), DEFAULT_SETTINGS, String(value));
    }
  });
});

function seen(
  address: string,
  level: 2 | 3 | 4 = 4,
  provider = "edge",
  proven = true,
  method = "GET",
  type = "xmlhttprequest",
): SeenRequest {
  const classification: Classification = {
    provider,
    proven,
    leak:
      level === 4 ? { level, case: "data-sent", challenge: false } : { level },
  };
  return { classification, method, type, privateWindow: false, address };
}

describe("addAddress", () => {
  it("files an address by provider, category, then method and request type", () => {
    assert.deepEqual(addAddress({}, seen("https://a.example/1"), 100), {
      edge: { red4: { "GET xmlhttprequest": ["https://a.example/1"] } },
    });
    assert.deepEqual(
      addAddress({}, seen("https://a.example/1", 3, "other", false), 100),
      { other: { orange3: { "GET xmlhttprequest": ["https://a.example/1"] } } },
    );
  });

  it("puts the most recently seen first, once each, without any count", () => {
    let addresses: SiteAddresses = {};
    for (const address of ["/1", "/2", "/3", "/2"]) {
      addresses = addAddress(
        addresses,
        seen(`https://a.example${address}`),
        100,
      );
    }
    assert.deepEqual(addresses, {
      edge: {
        red4: {
          "GET xmlhttprequest": [
            "https://a.example/2",
            "https://a.example/3",
            "https://a.example/1",
          ],
        },
      },
    });
  });

  it("changes nothing when the address is already the most recent, so that nothing is written again", () => {
    const addresses = addAddress({}, seen("https://a.example/1"), 100);
    assert.equal(
      addAddress(addresses, seen("https://a.example/1"), 100),
      addresses,
    );
  });

  it("drops the oldest beyond the limit, row by row", () => {
    let addresses: SiteAddresses = addAddress(
      {},
      seen("https://a.example/kept", 4, "edge", true, "POST"),
      2,
    );
    for (const address of ["/1", "/2", "/3"]) {
      addresses = addAddress(addresses, seen(`https://a.example${address}`), 2);
    }
    assert.deepEqual(addresses, {
      edge: {
        red4: {
          "POST xmlhttprequest": ["https://a.example/kept"],
          "GET xmlhttprequest": ["https://a.example/3", "https://a.example/2"],
        },
      },
    });
  });

  it("leaves the addresses given as they are", () => {
    const addresses = addAddress({}, seen("https://a.example/1"), 100);
    const before = JSON.stringify(addresses);
    addAddress(addresses, seen("https://a.example/2"), 100);
    addAddress(addresses, seen("https://a.example/3", 3, "edge", false), 100);
    assert.equal(JSON.stringify(addresses), before);
  });

  it("adds nothing for a request without an address", () => {
    const request = { ...seen("https://a.example/1") };
    delete (request as { address?: string }).address;
    const addresses: SiteAddresses = {};
    assert.equal(addAddress(addresses, request, 100), addresses);
  });
});

const KEPT: SiteAddresses = {
  edge: {
    red4: { "GET xmlhttprequest": ["/4a", "/4b", "/4c"] },
    orange3: { "GET image": ["/3a", "/3b"] },
  },
  other: { red3: { "GET script": ["/3c"] } },
};

describe("fitAddresses", () => {
  it("keeps everything that the settings take", () => {
    assert.deepEqual(
      fitAddresses(KEPT, { record: "level3and4", recordLimit: 3 }),
      KEPT,
    );
  });

  it("keeps only the categories of the levels recorded, and no provider left empty", () => {
    assert.deepEqual(
      fitAddresses(KEPT, { record: "level4", recordLimit: 100 }),
      {
        edge: { red4: { "GET xmlhttprequest": ["/4a", "/4b", "/4c"] } },
      },
    );
    assert.deepEqual(
      fitAddresses(KEPT, { record: "none", recordLimit: 100 }),
      {},
    );
  });

  it("keeps the most recent addresses of each row up to the limit", () => {
    assert.deepEqual(
      fitAddresses(KEPT, { record: "level3and4", recordLimit: 1 }),
      {
        edge: {
          red4: { "GET xmlhttprequest": ["/4a"] },
          orange3: { "GET image": ["/3a"] },
        },
        other: { red3: { "GET script": ["/3c"] } },
      },
    );
  });

  it("leaves the addresses given as they are", () => {
    const before = JSON.stringify(KEPT);
    fitAddresses(KEPT, { record: "level4", recordLimit: 1 });
    assert.equal(JSON.stringify(KEPT), before);
  });
});

describe("keepsFewer", () => {
  const settings = (record: RecordLevel, recordLimit = 100) => ({
    record,
    recordLimit,
  });

  it("says whether an address kept under the old settings is left out by the new ones", () => {
    assert.equal(keepsFewer(settings("level4"), settings("none")), true);
    assert.equal(keepsFewer(settings("level3and4"), settings("none")), true);
    assert.equal(keepsFewer(settings("level3and4"), settings("level4")), true);
    assert.equal(
      keepsFewer(settings("level4", 100), settings("level4", 99)),
      true,
    );
    assert.equal(
      keepsFewer(settings("level3and4", 100), settings("level4", 200)),
      true,
    );
  });

  it("says no when the new settings keep everything the old ones kept", () => {
    assert.equal(keepsFewer(settings("none"), settings("level4", 1)), false);
    assert.equal(keepsFewer(settings("none", 100), settings("none", 1)), false);
    assert.equal(keepsFewer(settings("level4"), settings("level3and4")), false);
    assert.equal(
      keepsFewer(settings("level4", 100), settings("level4", 100)),
      false,
    );
    assert.equal(
      keepsFewer(settings("level4", 100), settings("level4", 500)),
      false,
    );
  });
});

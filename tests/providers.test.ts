// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type DataError,
  formatError,
  formatRangesFile,
  loadProviders,
  loadTable,
  parseConsentCookies,
  parseProviderJson,
  parsePublishedSource,
  parseRangesFile,
  readPublishedList,
} from "../scripts/providers.js";

const VALID_PROVIDER = `{
  "name": "Example CDN",
  "country": "US",
  "parent": { "name": "Example Holding", "country": "FR" },
  "signatures": {
    "headers": [
      { "name": "X-Example-Id", "source": "https://example.com/headers" },
      { "name": "x-example-cache", "value": "HIT*", "source": "observed" }
    ],
    "cookies": [{ "name": "__ex_*", "source": "observed" }],
    "server": [{ "value": "ExampleCDN-*", "source": "observed" }],
    "cname": [{ "suffix": "cdn.example.net", "source": "observed" }],
    "challengeHosts": [
      { "host": "challenge.example.net", "source": "observed" },
      { "host": "*.challenge.example.net", "source": "observed" }
    ],
    "challengePaths": [{ "prefix": "/ex-cgi/challenge/", "source": "observed" }],
    "challengeHeaders": [
      { "name": "X-Example-Mitigated", "value": "challenge", "source": "https://example.com/challenge" },
      { "name": "x-example-challenge-id", "source": "observed" }
    ],
    "challengeQueryNames": [{ "name": "__Ex_Chl_*", "source": "observed" }]
  }
}
`;

const VALID_CONSENT = `{
  "cookies": [
    { "name": "consent_tool", "source": "https://example.com/cookies" },
    { "name": "_Audience_*", "source": "https://example.com/audience" }
  ]
}
`;

const VALID_RANGES = `# Source: https://example.com/ips-v4
# Fetched: 2026-11-05
192.0.2.0/24
2001:DB8::/32
`;

function providerErrors(text: string): DataError[] {
  return parseProviderJson(text, "provider.json").errors;
}

function rangesErrors(text: string): DataError[] {
  return parseRangesFile(text, "ranges.txt").errors;
}

function assertOneError(errors: DataError[], line: number, reason: RegExp) {
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.equal(errors[0]?.line, line, JSON.stringify(errors));
  assert.equal(errors[0]?.field, null, JSON.stringify(errors));
  assert.match(errors[0]?.reason ?? "", reason);
}

function assertOneFieldError(
  errors: DataError[],
  field: string | null,
  reason: RegExp,
) {
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.equal(errors[0]?.field, field, JSON.stringify(errors));
  assert.equal(errors[0]?.line, null, JSON.stringify(errors));
  assert.match(errors[0]?.reason ?? "", reason);
}

describe("parseProviderJson", () => {
  it("reads a complete provider and lowers the case of names", () => {
    const { provider, errors } = parseProviderJson(VALID_PROVIDER, "p");
    assert.deepEqual(errors, []);
    assert.deepEqual(provider, {
      name: "Example CDN",
      country: "US",
      parent: { name: "Example Holding", country: "FR" },
      headers: [
        { name: "x-example-id", value: null },
        { name: "x-example-cache", value: "HIT*" },
      ],
      cookies: ["__ex_*"],
      server: ["ExampleCDN-*"],
      cname: ["cdn.example.net"],
      challengeHosts: ["challenge.example.net", "*.challenge.example.net"],
      challengePaths: ["/ex-cgi/challenge/"],
      challengeHeaders: [
        { name: "x-example-mitigated", value: "challenge" },
        { name: "x-example-challenge-id", value: null },
      ],
      challengeQueryNames: ["__ex_chl_*"],
    });
  });

  it("keeps two path prefixes that differ only by case", () => {
    const text = VALID_PROVIDER.replace(
      '"challengePaths": [{ "prefix": "/ex-cgi/challenge/", "source": "observed" }]',
      '"challengePaths": [{ "prefix": "/Ex/", "source": "a" }, { "prefix": "/ex/", "source": "b" }]',
    );
    const { provider, errors } = parseProviderJson(text, "p");
    assert.deepEqual(errors, []);
    assert.deepEqual(provider?.challengePaths, ["/Ex/", "/ex/"]);
  });

  it("accepts a provider without parent nor signatures", () => {
    const { provider, errors } = parseProviderJson(
      '{ "name": "A", "country": "DE", "signatures": {} }',
      "p",
    );
    assert.deepEqual(errors, []);
    assert.equal(provider?.parent, null);
  });

  it("gives the parser message for a JSON syntax error", () => {
    assertOneFieldError(providerErrors('{\n  "name": "A",\n}'), null, /JSON/);
  });

  it("refuses a value that is not an object", () => {
    assertOneFieldError(providerErrors("[]"), null, /JSON object/);
  });

  const cases: [string, string, string, string, RegExp][] = [
    ["a missing name", '"name": "Example CDN",', "", "name", /required/],
    [
      "an unknown key",
      '"name": "Example CDN",',
      '"name": "Example CDN", "nme": "x",',
      "nme",
      /unknown key/,
    ],
    [
      "a lowercase country",
      '"country": "US",',
      '"country": "us",',
      "country",
      /ISO 3166-1/,
    ],
    [
      "a lowercase parent country",
      '"country": "FR"',
      '"country": "fr"',
      "parent.country",
      /ISO 3166-1/,
    ],
    [
      "a header name with a space",
      '"name": "X-Example-Id"',
      '"name": "X Example"',
      "signatures.headers[0].name",
      /name pattern/,
    ],
    [
      "a pattern made only of wildcards",
      '"value": "HIT*"',
      '"value": "*"',
      "signatures.headers[1].value",
      /only of "\*"/,
    ],
    [
      "a doubled wildcard",
      '"name": "__ex_*"',
      '"name": "__ex_**"',
      "signatures.cookies[0].name",
      /"\*\*"/,
    ],
    [
      "regular expression syntax in a name",
      '"name": "X-Example-Id"',
      '"name": "x-example-(id|ref)"',
      "signatures.headers[0].name",
      /name pattern/,
    ],
    [
      "a header named server",
      '"name": "X-Example-Id"',
      '"name": "Server"',
      "signatures.headers[0].name",
      /signatures\.server/,
    ],
    [
      "a wildcard in a CNAME suffix",
      '"suffix": "cdn.example.net"',
      '"suffix": "*.cdn.example.net"',
      "signatures.cname[0].suffix",
      /domain name/,
    ],
    [
      "a missing source",
      '"value": "ExampleCDN-*", "source": "observed"',
      '"value": "ExampleCDN-*"',
      "signatures.server[0].source",
      /required/,
    ],
    [
      "an empty source",
      '"value": "ExampleCDN-*", "source": "observed"',
      '"value": "ExampleCDN-*", "source": " "',
      "signatures.server[0].source",
      /non-empty string/,
    ],
    [
      "a list that is not an array",
      '"cookies": [{ "name": "__ex_*", "source": "observed" }]',
      '"cookies": { "name": "__ex_*", "source": "observed" }',
      "signatures.cookies",
      /array/,
    ],
    [
      "a duplicate cookie",
      '"cookies": [{ "name": "__ex_*", "source": "observed" }]',
      '"cookies": [{ "name": "__ex_*", "source": "a" }, { "name": "__EX_*", "source": "b" }]',
      "signatures.cookies[1].name",
      /given twice, first at signatures\.cookies\[0\]/,
    ],
    [
      "a server value given twice in another case",
      '"server": [{ "value": "ExampleCDN-*", "source": "observed" }]',
      '"server": [{ "value": "ExampleCDN-*", "source": "a" }, { "value": "examplecdn-*", "source": "b" }]',
      "signatures.server[1].value",
      /given twice, first at signatures\.server\[0\]/,
    ],
    [
      "a challenge host in capitals",
      '"host": "challenge.example.net"',
      '"host": "Challenge.example.net"',
      "signatures.challengeHosts[0].host",
      /host pattern/,
    ],
    [
      "a challenge host written as a URL",
      '"host": "challenge.example.net"',
      '"host": "https://challenge.example.net/"',
      "signatures.challengeHosts[0].host",
      /host pattern/,
    ],
    [
      "a challenge host with an empty label",
      '"host": "challenge.example.net"',
      '"host": "challenge..example.net"',
      "signatures.challengeHosts[0].host",
      /host pattern/,
    ],
    [
      "a challenge host with a doubled wildcard",
      '"host": "*.challenge.example.net"',
      '"host": "**.challenge.example.net"',
      "signatures.challengeHosts[1].host",
      /"\*\*"/,
    ],
    [
      "a challenge host given twice",
      '"host": "*.challenge.example.net"',
      '"host": "challenge.example.net"',
      "signatures.challengeHosts[1].host",
      /given twice, first at signatures\.challengeHosts\[0\]/,
    ],
    [
      "a challenge path without a leading slash",
      '"prefix": "/ex-cgi/challenge/"',
      '"prefix": "ex-cgi/challenge/"',
      "signatures.challengePaths[0].prefix",
      /path prefix/,
    ],
    [
      "a wildcard in a challenge path",
      '"prefix": "/ex-cgi/challenge/"',
      '"prefix": "/ex-cgi/*/challenge/"',
      "signatures.challengePaths[0].prefix",
      /path prefix/,
    ],
    [
      "a query in a challenge path",
      '"prefix": "/ex-cgi/challenge/"',
      '"prefix": "/ex-cgi/challenge?id="',
      "signatures.challengePaths[0].prefix",
      /path prefix/,
    ],
    [
      "a space in a challenge path",
      '"prefix": "/ex-cgi/challenge/"',
      '"prefix": "/ex-cgi/my challenge/"',
      "signatures.challengePaths[0].prefix",
      /path prefix/,
    ],
    [
      "a challenge path without source",
      '"prefix": "/ex-cgi/challenge/", "source": "observed"',
      '"prefix": "/ex-cgi/challenge/"',
      "signatures.challengePaths[0].source",
      /required/,
    ],
    [
      "a challenge header name with a space",
      '"name": "X-Example-Mitigated"',
      '"name": "X Example Mitigated"',
      "signatures.challengeHeaders[0].name",
      /name pattern/,
    ],
    [
      "a challenge header value made only of wildcards",
      '"value": "challenge"',
      '"value": "*"',
      "signatures.challengeHeaders[0].value",
      /only of "\*"/,
    ],
    [
      "a challenge header given twice in another case",
      '"name": "x-example-challenge-id"',
      '"name": "x-example-mitigated", "value": "Challenge"',
      "signatures.challengeHeaders[1].name",
      /given twice, first at signatures\.challengeHeaders\[0\]/,
    ],
    [
      "a challenge header without source",
      '"name": "x-example-challenge-id", "source": "observed"',
      '"name": "x-example-challenge-id"',
      "signatures.challengeHeaders[1].source",
      /required/,
    ],
    [
      "a challenge query name with a space",
      '"name": "__Ex_Chl_*"',
      '"name": "__ex chl"',
      "signatures.challengeQueryNames[0].name",
      /name pattern/,
    ],
    [
      "a challenge query name written with a value",
      '"name": "__Ex_Chl_*"',
      '"name": "__ex_chl_tk=1"',
      "signatures.challengeQueryNames[0].name",
      /name pattern/,
    ],
    [
      "a challenge query name made only of wildcards",
      '"name": "__Ex_Chl_*"',
      '"name": "*"',
      "signatures.challengeQueryNames[0].name",
      /only of "\*"/,
    ],
    [
      "a challenge query name given twice in another case",
      '"challengeQueryNames": [{ "name": "__Ex_Chl_*", "source": "observed" }]',
      '"challengeQueryNames": [{ "name": "__ex_chl_*", "source": "a" }, { "name": "__EX_CHL_*", "source": "b" }]',
      "signatures.challengeQueryNames[1].name",
      /given twice, first at signatures\.challengeQueryNames\[0\]/,
    ],
    [
      "a challenge query name without source",
      '"name": "__Ex_Chl_*", "source": "observed"',
      '"name": "__Ex_Chl_*"',
      "signatures.challengeQueryNames[0].source",
      /required/,
    ],
  ];
  for (const [name, from, to, field, reason] of cases) {
    it(`rejects ${name} and names its field`, () => {
      assert.ok(VALID_PROVIDER.includes(from), from);
      assertOneFieldError(
        providerErrors(VALID_PROVIDER.replace(from, to)),
        field,
        reason,
      );
    });
  }
});

describe("parseConsentCookies", () => {
  function consentErrors(text: string): DataError[] {
    return parseConsentCookies(text, "consent-cookies.json").errors;
  }

  it("reads the patterns and lowers their case", () => {
    const { cookies, errors } = parseConsentCookies(VALID_CONSENT, "c");
    assert.deepEqual(errors, []);
    assert.deepEqual(cookies, ["consent_tool", "_audience_*"]);
  });

  it("gives the parser message for a JSON syntax error", () => {
    assertOneFieldError(consentErrors('{ "cookies": [], }'), null, /JSON/);
  });

  it("refuses a value that is not an object", () => {
    assertOneFieldError(consentErrors("[]"), null, /JSON object/);
  });

  it("requires the list", () => {
    assertOneFieldError(consentErrors("{}"), "cookies", /required/);
  });

  const cases: [string, string, string, string, RegExp][] = [
    [
      "an unknown key",
      '"cookies": [',
      '"note": "x", "cookies": [',
      "note",
      /unknown key/,
    ],
    [
      "a list that is not an array",
      `"cookies": [
    { "name": "consent_tool", "source": "https://example.com/cookies" },
    { "name": "_Audience_*", "source": "https://example.com/audience" }
  ]`,
      '"cookies": { "name": "consent_tool", "source": "a" }',
      "cookies",
      /array/,
    ],
    [
      "an entry without source",
      '"name": "consent_tool", "source": "https://example.com/cookies"',
      '"name": "consent_tool"',
      "cookies[0].source",
      /required/,
    ],
    [
      "a name that is not a cookie name pattern",
      '"name": "consent_tool"',
      '"name": "consent tool"',
      "cookies[0].name",
      /name pattern/,
    ],
    [
      "a pattern made only of wildcards",
      '"name": "_Audience_*"',
      '"name": "*"',
      "cookies[1].name",
      /only of "\*"/,
    ],
    [
      "a pattern given twice in another case",
      '"name": "_Audience_*"',
      '"name": "Consent_Tool"',
      "cookies[1].name",
      /given twice, first at cookies\[0\]/,
    ],
  ];
  for (const [name, from, to, field, reason] of cases) {
    it(`rejects ${name} and names its field`, () => {
      assert.ok(VALID_CONSENT.includes(from), from);
      assertOneFieldError(
        consentErrors(VALID_CONSENT.replace(from, to)),
        field,
        reason,
      );
    });
  }
});

describe("parseRangesFile", () => {
  it("reads the sources, the date and the ranges", () => {
    const result = parseRangesFile(VALID_RANGES, "r");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.sources, ["https://example.com/ips-v4"]);
    assert.equal(result.fetched, "2026-11-05");
    assert.deepEqual(result.ranges, ["192.0.2.0/24", "2001:db8::/32"]);
  });

  it("ignores blank lines and keeps other comments", () => {
    const text = `${VALID_RANGES}\n# Note\n\n198.51.100.0/24\n`;
    const result = parseRangesFile(text, "r");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.comments, ["# Note"]);
  });

  it("accepts a list with no range, for a provider that publishes none", () => {
    const text = `# Source: none, Example CDN publishes no list of its edges
# Fetched: 2026-11-06
# Its only list holds the addresses that reach origin servers.
`;
    const result = parseRangesFile(text, "r");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.ranges, []);
  });

  it("names the line of a malformed range and says why", () => {
    const text = VALID_RANGES.replace("192.0.2.0/24", "192.0.2.1/24");
    assertOneError(rangesErrors(text), 3, /host bits/);
  });

  it("names both lines of a range given twice", () => {
    const text = `${VALID_RANGES}192.0.2.0/24\n`;
    assertOneError(rangesErrors(text), 5, /line 3/);
  });

  it("requires the source of the list", () => {
    const text = VALID_RANGES.replace(
      "# Source: https://example.com/ips-v4\n",
      "",
    );
    assertOneError(rangesErrors(text), 1, /# Source:/);
  });

  it("requires a valid fetch date", () => {
    assertOneError(
      rangesErrors(VALID_RANGES.replace("2026-11-05", "5 Nov 2026")),
      2,
      /YYYY-MM-DD/,
    );
    assertOneError(
      rangesErrors(VALID_RANGES.replace("# Fetched: 2026-11-05\n", "")),
      1,
      /# Fetched:/,
    );
  });
});

describe("formatRangesFile", () => {
  it("writes the header, the comments, then one range per line", () => {
    const text = `# Source: https://example.com/ips-v4
# Source: https://example.com/ips-v6
# Fetched: 2026-11-06
# These are the addresses browsers connect to.
192.0.2.0/24
2001:db8::/32
`;
    const parsed = parseRangesFile(text, "r");
    assert.deepEqual(parsed.errors, []);
    assert.equal(
      formatRangesFile({
        sources: parsed.sources,
        fetched: "2026-11-06",
        comments: parsed.comments,
        ranges: parsed.ranges,
      }),
      text,
    );
  });

  it("keeps the comments when the ranges change", () => {
    const parsed = parseRangesFile(
      "# Source: https://example.com/ips\n# Fetched: 2026-11-05\n# Why.\n192.0.2.0/24\n",
      "r",
    );
    const text = formatRangesFile({
      sources: parsed.sources,
      fetched: "2026-11-06",
      comments: parsed.comments,
      ranges: ["198.51.100.0/24"],
    });
    const again = parseRangesFile(text, "r");
    assert.deepEqual(again.errors, []);
    assert.equal(again.fetched, "2026-11-06");
    assert.deepEqual(again.comments, ["# Why."]);
    assert.deepEqual(again.ranges, ["198.51.100.0/24"]);
  });
});

describe("parsePublishedSource", () => {
  it("reads a published text list", () => {
    assert.deepEqual(parsePublishedSource("https://example.com/ips-v4"), {
      url: "https://example.com/ips-v4",
      service: null,
    });
  });

  it("reads a JSON list and the service whose ranges it keeps", () => {
    assert.deepEqual(
      parsePublishedSource(
        "https://example.com/ip-ranges.json, service EXAMPLE_CDN",
      ),
      { url: "https://example.com/ip-ranges.json", service: "EXAMPLE_CDN" },
    );
  });

  it("leaves a source that is not served over HTTPS to a person", () => {
    assert.equal(
      parsePublishedSource("none, Example CDN publishes no list"),
      null,
    );
    assert.equal(parsePublishedSource("http://example.com/ips"), null);
  });

  it("refuses an HTTPS source it cannot read, rather than skipping it", () => {
    for (const source of [
      "https://example.com/ip-ranges.json, services EXAMPLE_CDN",
      "https://example.com/ip-ranges.json service EXAMPLE_CDN",
      "https://example.com/ip-ranges.json, service ",
      "https://example.com/ip-ranges.json, service example_cdn",
    ]) {
      assert.throws(
        () => parsePublishedSource(source),
        /, service <NAME>/,
        source,
      );
    }
  });
});

describe("readPublishedList", () => {
  const TEXT = { url: "https://example.com/ips-v4", service: null };
  const JSON_LIST = {
    url: "https://example.com/ip-ranges.json",
    service: "EXAMPLE_CDN",
  };
  const AWS_LIKE = JSON.stringify({
    syncToken: "1793927225",
    createDate: "2026-11-06-01-07-05",
    prefixes: [
      { ip_prefix: "192.0.2.0/24", region: "GLOBAL", service: "AMAZON" },
      { ip_prefix: "192.0.2.0/24", region: "GLOBAL", service: "EXAMPLE_CDN" },
      {
        ip_prefix: "198.51.100.0/24",
        region: "GLOBAL",
        service: "EXAMPLE_CDN_ORIGIN_FACING",
      },
      {
        ip_prefix: "203.0.113.0/25",
        region: "eu-west-3",
        service: "EXAMPLE_CDN",
      },
    ],
    ipv6_prefixes: [
      {
        ipv6_prefix: "2001:db8::/32",
        region: "GLOBAL",
        service: "EXAMPLE_CDN",
      },
      {
        ipv6_prefix: "2001:db8:1::/48",
        region: "GLOBAL",
        service: "example_cdn",
      },
    ],
  });

  it("reads a text list, one range per line", () => {
    assert.deepEqual(
      readPublishedList(TEXT, "192.0.2.0/24\n\n  2001:db8::/32  \n"),
      ["192.0.2.0/24", "2001:db8::/32"],
    );
  });

  it("names the line of a malformed range in a text list", () => {
    assert.throws(
      () => readPublishedList(TEXT, "192.0.2.0/24\n192.0.2.1/24\n"),
      /^Error: line 2: .*host bits/,
    );
  });

  it("keeps from a JSON list the IPv4 and IPv6 ranges of its service only", () => {
    assert.deepEqual(readPublishedList(JSON_LIST, AWS_LIKE), [
      "192.0.2.0/24",
      "203.0.113.0/25",
      "2001:db8::/32",
    ]);
  });

  it("names the entry of a malformed range in a JSON list", () => {
    const body = AWS_LIKE.replace("203.0.113.0/25", "203.0.113.1/25");
    assert.throws(
      () => readPublishedList(JSON_LIST, body),
      /^Error: prefixes\[3\]\.ip_prefix: .*host bits/,
    );
  });

  it("refuses a JSON list it cannot read", () => {
    assert.throws(
      () => readPublishedList(JSON_LIST, "192.0.2.0/24\n"),
      /not valid JSON/,
    );
    assert.throws(
      () => readPublishedList(JSON_LIST, '{ "prefixes": [] }'),
      /ipv6_prefixes must be an array/,
    );
    assert.throws(
      () =>
        readPublishedList(
          JSON_LIST,
          '{ "prefixes": [{ "service": "EXAMPLE_CDN" }], "ipv6_prefixes": [] }',
        ),
      /prefixes\[0\]\.ip_prefix: /,
    );
  });

  it("refuses a list that gives no range", () => {
    assert.throws(() => readPublishedList(TEXT, "\n"), /the list is empty/);
    assert.throws(
      () => readPublishedList({ ...JSON_LIST, service: "OTHER_CDN" }, AWS_LIKE),
      /the list is empty/,
    );
  });
});

describe("loadProviders", () => {
  const root = mkdtempSync(join(tmpdir(), "providers-"));
  after(() => rmSync(root, { recursive: true, force: true }));

  function folder(name: string, files: Record<string, string>): string {
    const dir = join(root, name);
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), content);
    }
    return dir;
  }

  it("builds the table from every folder, sorted by id", () => {
    const dir = folder("valid", {
      "zeta/provider.json":
        '{ "name": "Z", "country": "US", "signatures": {} }',
      "alpha-cdn/provider.json": VALID_PROVIDER,
      "alpha-cdn/ranges.txt": VALID_RANGES,
    });
    const { table, errors } = loadProviders(dir);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      table.map((entry) => [entry.id, entry.ranges.length]),
      [
        ["alpha-cdn", 2],
        ["zeta", 0],
      ],
    );
  });

  it("refuses an id outside lowercase letters, digits and hyphens", () => {
    const dir = folder("bad-id", {
      "Example/provider.json": VALID_PROVIDER,
    });
    const { errors } = loadProviders(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.file ?? "", /Example$/);
    assert.match(errors[0]?.reason ?? "", /lowercase/);
  });

  it("refuses an unknown file, such as a misspelled ranges.txt", () => {
    const dir = folder("unknown-file", {
      "example/provider.json": VALID_PROVIDER,
      "example/range.txt": VALID_RANGES,
    });
    const { errors } = loadProviders(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.file ?? "", /range\.txt$/);
  });

  it("requires provider.json", () => {
    const dir = folder("missing", { "example/ranges.txt": VALID_RANGES });
    const { errors } = loadProviders(dir);
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.reason ?? "", /provider\.json/);
  });

  it("reports the errors of every file, each with its file and place", () => {
    const dir = folder("several", {
      "one/provider.json": '{ "name": "", "country": "US", "signatures": {} }',
      "two/provider.json": VALID_PROVIDER,
      "two/ranges.txt": VALID_RANGES.replace("192.0.2.0/24", "192.0.2.0/33"),
    });
    const { errors } = loadProviders(dir);
    assert.deepEqual(
      errors.map((error) => [
        error.file.slice(dir.length + 1),
        error.line,
        error.field,
      ]),
      [
        [join("one", "provider.json"), null, "name"],
        [join("two", "ranges.txt"), 3, null],
      ],
    );
  });

  describe("loadTable", () => {
    it("gives the providers and the consent cookies in one table", () => {
      const dir = folder("table", {
        "providers/example/provider.json": `{
          "name": "Example CDN",
          "country": "US",
          "signatures": {
            "cookies": [{ "name": "__Ex", "source": "observed" }],
            "challengeHosts": [{ "host": "*.challenge.example.net", "source": "observed" }],
            "challengePaths": [{ "prefix": "/ex/", "source": "observed" }],
            "challengeHeaders": [{ "name": "x-ex-mitigated", "value": "challenge", "source": "observed" }],
            "challengeQueryNames": [{ "name": "__ex_chl_*", "source": "observed" }]
          }
        }`,
        "providers/example/ranges.txt": VALID_RANGES,
        "consent-cookies.json": VALID_CONSENT,
      });
      const { table, errors } = loadTable(dir);
      assert.deepEqual(errors, []);
      assert.deepEqual(table, {
        providers: [
          {
            id: "example",
            name: "Example CDN",
            country: "US",
            parent: null,
            ranges: ["192.0.2.0/24", "2001:db8::/32"],
            headers: [],
            cookies: ["__ex"],
            server: [],
            cname: [],
            challengeHosts: ["*.challenge.example.net"],
            challengePaths: ["/ex/"],
            challengeHeaders: [{ name: "x-ex-mitigated", value: "challenge" }],
            challengeQueryNames: ["__ex_chl_*"],
          },
        ],
        consentCookies: ["consent_tool", "_audience_*"],
      });
    });

    it("requires the consent cookie list", () => {
      const dir = folder("no-consent", {
        "providers/example/provider.json": VALID_PROVIDER,
      });
      const { errors } = loadTable(dir);
      assert.equal(errors.length, 1, JSON.stringify(errors));
      assert.match(errors[0]?.file ?? "", /consent-cookies\.json$/);
      assert.match(errors[0]?.reason ?? "", /missing/);
    });

    it("reports the errors of the providers and of the consent list", () => {
      const dir = folder("both-invalid", {
        "providers/example/provider.json": VALID_PROVIDER.replace(
          '"country": "US"',
          '"country": "us"',
        ),
        "consent-cookies.json": VALID_CONSENT.replace(
          '"name": "consent_tool"',
          '"name": "consent tool"',
        ),
      });
      const { errors } = loadTable(dir);
      assert.deepEqual(
        errors.map((error) => [error.file.slice(dir.length + 1), error.field]),
        [
          [join("providers", "example", "provider.json"), "country"],
          ["consent-cookies.json", "cookies[0].name"],
        ],
      );
    });
  });
});

describe("formatError", () => {
  it("writes the line of a ranges.txt error", () => {
    assert.equal(
      formatError({ file: "r.txt", line: 3, field: null, reason: "bad" }),
      "r.txt:3: bad",
    );
  });

  it("writes the field path of a provider.json error", () => {
    assert.equal(
      formatError({
        file: "p.json",
        line: null,
        field: "signatures.headers[2].name",
        reason: "bad",
      }),
      "p.json: signatures.headers[2].name: bad",
    );
  });

  it("writes the file alone when the error concerns the whole file", () => {
    assert.equal(
      formatError({ file: "p.json", line: null, field: null, reason: "bad" }),
      "p.json: bad",
    );
  });
});

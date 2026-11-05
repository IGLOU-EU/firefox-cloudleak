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
  loadProviders,
  parseProviderJson,
  parseRangesFile,
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
    "cname": [{ "suffix": "cdn.example.net", "source": "observed" }]
  }
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
    });
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

describe("parseRangesFile", () => {
  it("reads the sources, the date and the ranges", () => {
    const result = parseRangesFile(VALID_RANGES, "r");
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.sources, ["https://example.com/ips-v4"]);
    assert.equal(result.fetched, "2026-11-05");
    assert.deepEqual(result.ranges, ["192.0.2.0/24", "2001:db8::/32"]);
  });

  it("ignores blank lines and other comments", () => {
    const text = `${VALID_RANGES}\n# Note\n\n198.51.100.0/24\n`;
    assert.deepEqual(parseRangesFile(text, "r").errors, []);
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

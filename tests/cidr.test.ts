// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Cidr,
  cidrContains,
  type IpAddress,
  parseCidr,
  parseIp,
} from "../src/core/cidr.js";

function ip(text: string): IpAddress {
  const parsed = parseIp(text);
  assert.ok(parsed.ok, `expected ${text} to parse`);
  return parsed.value;
}

function cidr(text: string): Cidr {
  const parsed = parseCidr(text);
  assert.ok(parsed.ok, `expected ${text} to parse`);
  return parsed.value;
}

function rejects(parse: (text: string) => { ok: boolean }, text: string) {
  assert.equal(parse(text).ok, false, `expected ${text} to be rejected`);
}

describe("parseIp, IPv4", () => {
  it("reads the four octets", () => {
    assert.deepEqual(ip("104.16.0.1"), { family: 4, value: 0x68100001n });
    assert.deepEqual(ip("0.0.0.0"), { family: 4, value: 0n });
    assert.deepEqual(ip("255.255.255.255"), { family: 4, value: 0xffffffffn });
  });

  for (const text of [
    "",
    "1.2.3",
    "1.2.3.4.5",
    "256.0.0.0",
    "1.2.3.-1",
    "01.2.3.4",
    "1.2.3.4 ",
    " 1.2.3.4",
    "1..3.4",
    "a.b.c.d",
    "1.2.3.4/32",
  ]) {
    it(`rejects ${JSON.stringify(text)}`, () => rejects(parseIp, text));
  }
});

describe("parseIp, IPv6", () => {
  it("reads the full form", () => {
    assert.deepEqual(ip("2001:0db8:0000:0000:0000:0000:0000:0001"), {
      family: 6,
      value: 0x20010db8000000000000000000000001n,
    });
  });

  it("expands the :: shorthand wherever it stands", () => {
    assert.deepEqual(ip("::"), { family: 6, value: 0n });
    assert.deepEqual(ip("::1"), { family: 6, value: 1n });
    assert.deepEqual(ip("2400:cb00::"), {
      family: 6,
      value: 0x2400cb00000000000000000000000000n,
    });
    assert.deepEqual(ip("1:2:3:4:5:6:7::"), {
      family: 6,
      value: 0x00010002000300040005000600070000n,
    });
    assert.deepEqual(ip("::2:3:4:5:6:7:8"), {
      family: 6,
      value: 0x00000002000300040005000600070008n,
    });
  });

  it("ignores the case of hexadecimal digits", () => {
    assert.deepEqual(ip("2400:CB00::"), ip("2400:cb00::"));
  });

  it("reads a trailing dotted IPv4 part", () => {
    assert.deepEqual(ip("::ffff:192.0.2.1"), {
      family: 6,
      value: 0x00000000000000000000ffffc0000201n,
    });
  });

  for (const text of [
    ":::",
    "1::2::3",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7:8::",
    "12345::",
    "g::",
    ":1::",
    "1::2:",
    "fe80::1%eth0",
    "::ffff:256.0.0.1",
    "::1.2.3.4:5",
    "1:2:3:4:5:6:7:1.2.3.4",
    " ::1",
  ]) {
    it(`rejects ${JSON.stringify(text)}`, () => rejects(parseIp, text));
  }
});

describe("parseCidr", () => {
  it("reads IPv4 and IPv6 networks", () => {
    assert.deepEqual(cidr("173.245.48.0/20"), {
      family: 4,
      network: 0xadf53000n,
      prefixLength: 20,
    });
    assert.deepEqual(cidr("2400:cb00::/32"), {
      family: 6,
      network: 0x2400cb00000000000000000000000000n,
      prefixLength: 32,
    });
  });

  it("accepts the shortest and the longest prefixes", () => {
    assert.equal(cidr("0.0.0.0/0").prefixLength, 0);
    assert.equal(cidr("::/0").prefixLength, 0);
    assert.equal(cidr("1.2.3.4/32").prefixLength, 32);
    assert.equal(cidr("::1/128").prefixLength, 128);
  });

  const cases: [string, string][] = [
    ["173.245.48.0", "missing prefix length"],
    ["173.245.48.0/", "prefix length"],
    ["/24", "IP address"],
    ["1.2.3.0/33", "between 0 and 32"],
    ["::/129", "between 0 and 128"],
    ["1.2.3.0/-1", "prefix length"],
    ["1.2.3.0/08", "prefix length"],
    ["1.2.3.0/24/1", "prefix length"],
    ["173.245.48.1/20", "host bits"],
    ["2400:cb00::1/32", "host bits"],
    ["300.0.0.0/8", "IP address"],
  ];
  for (const [text, reason] of cases) {
    it(`rejects ${JSON.stringify(text)} and says why`, () => {
      const parsed = parseCidr(text);
      assert.equal(parsed.ok, false);
      assert.ok(
        !parsed.ok && parsed.reason.includes(reason),
        `${text}: ${!parsed.ok && parsed.reason}`,
      );
    });
  }
});

describe("cidrContains", () => {
  it("includes both ends of an IPv4 range and nothing past them", () => {
    const range = cidr("173.245.48.0/20");
    assert.equal(cidrContains(range, ip("173.245.48.0")), true);
    assert.equal(cidrContains(range, ip("173.245.63.255")), true);
    assert.equal(cidrContains(range, ip("173.245.47.255")), false);
    assert.equal(cidrContains(range, ip("173.245.64.0")), false);
  });

  it("includes both ends of an IPv6 range and nothing past them", () => {
    const range = cidr("2400:cb00::/32");
    assert.equal(cidrContains(range, ip("2400:cb00::")), true);
    assert.equal(
      cidrContains(range, ip("2400:cb00:ffff:ffff:ffff:ffff:ffff:ffff")),
      true,
    );
    assert.equal(
      cidrContains(range, ip("2400:caff:ffff:ffff:ffff:ffff:ffff:ffff")),
      false,
    );
    assert.equal(cidrContains(range, ip("2400:cb01::")), false);
  });

  it("matches a single address with the longest prefix", () => {
    assert.equal(cidrContains(cidr("1.2.3.4/32"), ip("1.2.3.4")), true);
    assert.equal(cidrContains(cidr("1.2.3.4/32"), ip("1.2.3.5")), false);
    assert.equal(cidrContains(cidr("::1/128"), ip("::1")), true);
    assert.equal(cidrContains(cidr("::1/128"), ip("::2")), false);
  });

  it("matches every address of its family with a zero prefix", () => {
    assert.equal(cidrContains(cidr("0.0.0.0/0"), ip("255.255.255.255")), true);
    assert.equal(cidrContains(cidr("::/0"), ip("ffff::")), true);
  });

  it("never matches across families", () => {
    assert.equal(cidrContains(cidr("0.0.0.0/0"), ip("::")), false);
    assert.equal(cidrContains(cidr("::/0"), ip("0.0.0.0")), false);
    assert.equal(cidrContains(cidr("1.2.3.0/24"), ip("::ffff:1.2.3.4")), false);
  });
});

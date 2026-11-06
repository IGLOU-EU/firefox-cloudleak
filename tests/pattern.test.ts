// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesPattern } from "../src/core/pattern.js";

function matches(pattern: string, text: string): void {
  assert.equal(
    matchesPattern(pattern, text),
    true,
    `expected ${JSON.stringify(pattern)} to match ${JSON.stringify(text)}`,
  );
}

function differs(pattern: string, text: string): void {
  assert.equal(
    matchesPattern(pattern, text),
    false,
    `expected ${JSON.stringify(pattern)} not to match ${JSON.stringify(text)}`,
  );
}

describe("matchesPattern", () => {
  it("matches a pattern without wildcard only as the whole text", () => {
    matches("cf-ray", "cf-ray");
    differs("cf-ray", "cf-ray2");
    differs("cf-ray", "xcf-ray");
    differs("cf-ray", "cf-ra");
    differs("cf-ray", "");
  });

  it("ignores case on both sides", () => {
    matches("cf-ray", "CF-Ray");
    matches("CF-RAY", "cf-ray");
    matches("BunnyCDN-*", "bunnycdn-de1-123");
  });

  it("lets * match any run of characters, the empty one included", () => {
    matches("incap_ses_*", "incap_ses_123_456");
    matches("incap_ses_*", "incap_ses_");
    matches(
      "*.challenges.cloudflare.com",
      "brunhild.challenges.cloudflare.com",
    );
    matches("*.example.com", "a.b.example.com");
    matches("__uzm*", "__uzma");
    matches("a*c", "ac");
    matches("a*c", "abbbc");
    matches("*", "");
    matches("*", "anything");
  });

  it("does not let * match across the literal parts it sits between", () => {
    differs("*.challenges.cloudflare.com", "challenges.cloudflare.com");
    differs("incap_ses_*", "incap_se");
    differs("a*c", "abcd");
    differs("a*c", "cba");
  });

  it("finds a match that needs the first * to give characters back", () => {
    matches("a*b*c", "aXbYbZc");
    matches("*ab", "aab");
    matches("*a*a*a", "aaa");
    differs("*a*a*a", "aa");
    matches("HIT*", "HIT from edge");
  });

  it("treats every other character as literal, so no pattern acts as a regular expression", () => {
    differs("a.c", "abc");
    matches("a.c", "a.c");
    differs("a?c", "abc");
    differs("[ab]", "a");
    matches("[ab]", "[AB]");
    differs("a+", "aa");
    differs("^a$", "a");
    differs("a\\*", "ab");
  });

  it("matches an empty pattern only to the empty text", () => {
    matches("", "");
    differs("", "a");
  });
});

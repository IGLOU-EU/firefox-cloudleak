// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSupposed,
  type SuffixList,
  supposedOf,
  withoutSupposed,
} from "../src/core/supposed.js";

// A few rules of the public suffix list, the private section included.
const SUFFIXES = [
  "com",
  "net",
  "org",
  "fr",
  "io",
  "uk",
  "co.uk",
  "gouv.fr",
  "b-cdn.net",
  "azurewebsites.net",
  "github.io",
  "jp",
  "co.jp",
  "tokyo.jp",
  "chiyoda.tokyo.jp",
  "us-west-2.elb.amazonaws.com",
  "s3.amazonaws.com",
];

function suffixOf(name: string): string | null {
  const labels = name.split(".");
  for (let from = 0; from < labels.length; from += 1) {
    const candidate = labels.slice(from).join(".");
    if (SUFFIXES.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

const LIST: SuffixList = {
  suffix: suffixOf,
  domain: (name) => {
    const suffix = suffixOf(name);
    if (suffix === null || suffix === name) {
      return null;
    }
    const labels = name.split(".");
    return labels.slice(-(suffix.split(".").length + 1)).join(".");
  },
};

describe("isSupposed", () => {
  it("tells a domain name from the id of a provider of the data", () => {
    assert.equal(isSupposed("b-cdn.net"), true);
    assert.equal(isSupposed("cloudflare"), false);
    assert.equal(isSupposed("ovhcloud-cdn"), false);
  });
});

describe("supposedOf", () => {
  it("names the last two labels of a canonical name that leaves the host", () => {
    assert.equal(
      supposedOf("www.example.org", "edge.cdn-example.net", LIST),
      "cdn-example.net",
    );
    assert.equal(
      supposedOf("www.example.org", "a.b.c.cdn-example.net", LIST),
      "cdn-example.net",
    );
  });

  it("reads the name without regard to case or to a final dot", () => {
    assert.equal(
      supposedOf("www.example.org", "EDGE.CDN-Example.NET.", LIST),
      "cdn-example.net",
    );
  });

  it("gathers the names of a hosting suffix of the private section, and those above it, under one provider", () => {
    assert.equal(
      supposedOf("www.example.org", "example.b-cdn.net", LIST),
      "b-cdn.net",
    );
    assert.equal(
      supposedOf("www.example.org", "lb.us-west-2.elb.amazonaws.com", LIST),
      "amazonaws.com",
    );
    assert.equal(
      supposedOf("www.example.org", "bucket.s3.amazonaws.com", LIST),
      "amazonaws.com",
    );
  });

  it("adds a label under a country code while what is taken is a known suffix", () => {
    assert.equal(
      supposedOf("www.example.org", "edge.cdn.amazon.co.jp", LIST),
      "amazon.co.jp",
    );
    assert.equal(
      supposedOf("www.example.org", "lb.host.co.uk", LIST),
      "host.co.uk",
    );
    assert.equal(
      supposedOf("www.example.org", "a.b.shop.chiyoda.tokyo.jp", LIST),
      "shop.chiyoda.tokyo.jp",
    );
    // A hosting suffix under a country code cannot be told from one of the
    // registry, so its customer stays in the name.
    assert.equal(
      supposedOf("www.example.org", "example.github.io", LIST),
      "example.github.io",
    );
    assert.equal(
      supposedOf("www.example.org", "edge.cdn.example.fr", LIST),
      "example.fr",
    );
  });

  it("supposes nothing for a name that stays within the domain of the host", () => {
    assert.equal(supposedOf("www.example.org", "www.example.org", LIST), null);
    assert.equal(supposedOf("www.example.org", "lb.example.org", LIST), null);
    assert.equal(supposedOf("WWW.Example.org", "lb.example.org", LIST), null);
    assert.equal(supposedOf("example.org", "example.org", LIST), null);
    assert.equal(
      supposedOf("www.amazon.co.jp", "edge.amazon.co.jp", LIST),
      null,
    );
  });

  it("supposes nothing for a host that already belongs to the provider", () => {
    assert.equal(
      supposedOf("app.azurewebsites.net", "waws.azurewebsites.net", LIST),
      null,
    );
    assert.equal(
      supposedOf(
        "bucket.s3.amazonaws.com",
        "s3-w.us-east-1.amazonaws.com",
        LIST,
      ),
      null,
    );
  });

  it("does not take a host that only resembles the provider for one of its hosts", () => {
    assert.equal(
      supposedOf("xcdn-example.net", "edge.cdn-example.net", LIST),
      "cdn-example.net",
    );
  });

  it("supposes nothing for a name the list knows no domain for", () => {
    assert.equal(supposedOf("www.example.org", "nas.lan", LIST), null);
    assert.equal(supposedOf("www.example.org", "co.uk", LIST), null);
    assert.equal(supposedOf("www.example.org", "localhost", LIST), null);
    assert.equal(supposedOf("www.example.org", "", LIST), null);
  });
});

describe("withoutSupposed", () => {
  it("drops the supposed providers and keeps the others as they are", () => {
    const alpha = { blue2: { "GET image": 1 } };
    assert.deepEqual(
      withoutSupposed({
        alpha,
        "b-cdn.net": alpha,
        "example.github.io": alpha,
      }),
      { alpha },
    );
  });

  it("gives back what holds no supposed provider, unchanged and uncopied", () => {
    const counts = { alpha: 1, beta: 2 };
    assert.equal(withoutSupposed(counts), counts);
    const empty = {};
    assert.equal(withoutSupposed(empty), empty);
  });

  it("never changes what it is given", () => {
    const counts = { alpha: 1, "b-cdn.net": 2 };
    withoutSupposed(counts);
    assert.deepEqual(counts, { alpha: 1, "b-cdn.net": 2 });
  });
});

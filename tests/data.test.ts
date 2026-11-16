// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The committed data, read as the build reads it, classifies the requests its
// sources describe.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTable, parseRangesFile } from "../scripts/providers.js";
import { parseCidr, parseIp } from "../src/core/cidr.js";
import {
  classifyRequest,
  type Leak,
  type RequestFacts,
} from "../src/core/classify.js";

const DATA = fileURLToPath(new URL("../../data", import.meta.url));
const { table, errors } = loadTable(DATA);

const CLOUDFLARE_IP = "104.16.0.1";

// A script fetched from an address no provider publishes: each test changes
// only the facts it is about.
function facts(changes: Partial<RequestFacts>): RequestFacts {
  return {
    method: "GET",
    type: "script",
    tls: true,
    host: "www.example.org",
    path: "/app.js",
    queryNames: [],
    ip: "192.0.2.1",
    cookies: [],
    authorization: false,
    responseHeaders: [],
    setCookies: [],
    ...changes,
  };
}

// The same script loaded through a Cloudflare edge, at level 2.
function leakOf(changes: Partial<RequestFacts>): Leak | null {
  const result = classifyRequest(
    facts({ ip: CLOUDFLARE_IP, ...changes }),
    table,
  );
  assert.equal(result?.provider, "cloudflare");
  return result?.leak ?? null;
}

// The same script, with only the signal a test is about.
function classify(changes: Partial<RequestFacts>) {
  return classifyRequest(facts(changes), table);
}

const CHALLENGE: Leak = { level: 4, case: "data-sent", challenge: true };
const SESSION_POSSIBLE: Leak = {
  level: 4,
  case: "session",
  possible: true,
  challenge: false,
};

describe("the committed data", () => {
  it("loads without error", () => {
    assert.deepEqual(errors, []);
  });

  it("marks the requests of Turnstile to subdomains of dnstest.dev as Cloudflare's challenge", () => {
    assert.deepEqual(leakOf({ host: "a1b2c3.dnstest.dev" }), CHALLENGE);
    assert.deepEqual(leakOf({ host: "dnstest.dev" }), { level: 2 });
    assert.deepEqual(leakOf({ host: "dnstest.dev.example.org" }), {
      level: 2,
    });
  });

  it("marks Cloudflare's verification page by its response header", () => {
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        path: "/",
        responseHeaders: [{ name: "cf-mitigated", value: "challenge" }],
      }),
      CHALLENGE,
    );
  });

  it("marks the requests that carry a parameter of Cloudflare's challenge", () => {
    assert.deepEqual(
      leakOf({
        type: "main_frame",
        method: "POST",
        path: "/",
        queryNames: ["__cf_chl_tk"],
      }),
      CHALLENGE,
    );
    assert.deepEqual(leakOf({ queryNames: ["__cf_chl_rt_tk"] }), CHALLENGE);
    assert.deepEqual(leakOf({ queryNames: ["__cf_future_tk"] }), CHALLENGE);
    assert.deepEqual(leakOf({ queryNames: ["__cf_bm"] }), { level: 2 });
    assert.deepEqual(leakOf({ queryNames: ["__cf_something"] }), { level: 2 });
    assert.deepEqual(leakOf({ queryNames: ["cf_chl_tk"] }), { level: 2 });
    assert.deepEqual(leakOf({ queryNames: ["__cfx"] }), { level: 2 });
  });

  it("keeps the request at the level of its type for the cookies of known consent and measurement tools", () => {
    for (const name of [
      "tarteaucitron",
      "axeptio_cookies",
      "didomi_token",
      "euconsent-v2",
      "OptanonConsent",
      "OptanonConsent_1a2b3c",
      "OptanonAlertBoxClosed",
      "OptanonAlertBoxClosed_1a2b3c",
      "eupubconsent-v2",
      "eupubconsent-v2_1",
      "mtm_consent",
      "mtm_cookie_consent",
      "mtm_consent_removed",
      "_pk_id.1.a1b2",
      "_pk_ses.1.a1b2",
      "_pk_ref.12.ffff",
      "_pk_cvar.1.a1b2",
      "_pk_hsr.1.a1b2",
      "_pk_testcookie",
      "_pk_uid",
      "_ga",
      "_ga_ABC123XYZ",
    ]) {
      assert.deepEqual(leakOf({ cookies: [name] }), { level: 2 }, name);
    }
  });

  describe("CloudFront", () => {
    it("recognises the edges that served leboncoin.fr on 2026-11-06 by their address, without proof", () => {
      for (const ip of [
        "52.85.118.25",
        "52.85.118.80",
        "18.161.97.114",
        "3.175.86.25",
      ]) {
        assert.deepEqual(
          classify({ ip }),
          { provider: "cloudfront", proven: false, leak: { level: 2 } },
          ip,
        );
      }
    });

    it("proves the decryption by the headers CloudFront adds to its responses", () => {
      for (const header of [
        { name: "X-Amz-Cf-Id", value: "SOX4xwn4XV6Q4rgb7XiVGOHms_BGlTAC4K==" },
        { name: "x-amz-cf-pop", value: "MRS53-P5" },
        {
          name: "Via",
          value: "1.1 1026589cc7887e7a0dc7827b4.cloudfront.net (CloudFront)",
        },
        {
          name: "via",
          value: "1.1 abc.cloudfront.net (CloudFront), 1.1 proxy",
        },
        { name: "X-Cache", value: "Hit from cloudfront" },
        { name: "x-cache", value: "FunctionGeneratedResponse from cloudfront" },
        { name: "Server", value: "CloudFront" },
      ]) {
        assert.deepEqual(
          classify({ responseHeaders: [header] }),
          { provider: "cloudfront", proven: true, leak: { level: 2 } },
          header.name,
        );
      }
    });

    it("takes no other value of via, x-cache or server for CloudFront", () => {
      for (const header of [
        { name: "via", value: "1.1 varnish" },
        { name: "via", value: "1.1 example.net (CloudFront)" },
        { name: "x-cache", value: "HIT" },
        { name: "server", value: "AmazonS3" },
      ]) {
        assert.equal(
          classify({ responseHeaders: [header] }),
          null,
          header.value,
        );
      }
    });

    it("recognises a distribution by the last name of its CNAME chain", () => {
      assert.equal(
        classify({ cnames: ["d111111abcdef8.cloudfront.net"] })?.provider,
        "cloudfront",
      );
      assert.equal(classify({ cnames: ["dcloudfront.net"] }), null);
    });

    it("leaves the edge addresses of other providers to them", () => {
      assert.equal(classify({ ip: CLOUDFLARE_IP })?.provider, "cloudflare");
    });
  });

  describe("Fastly", () => {
    it("proves the decryption of the jQuery that Chorus Pro loaded on 2026-11-06", () => {
      assert.deepEqual(
        classify({
          host: "code.jquery.com",
          path: "/jquery-3.6.4.min.js",
          ip: "2a04:4e42::411",
          responseHeaders: [
            { name: "server", value: "nginx" },
            { name: "via", value: "1.1 varnish, 1.1 varnish" },
            {
              name: "x-served-by",
              value: "cache-lga21953-LGA, cache-par-lfpb1150080-PAR",
            },
            { name: "x-cache", value: "HIT, HIT" },
            { name: "x-timer", value: "S1793984558.304123,VS0,VE0" },
          ],
        }),
        { provider: "fastly", proven: true, leak: { level: 2 } },
      );
    });

    it("recognises the edge of the Pinterest images of 2026-11-06 by its address, without proof", () => {
      assert.deepEqual(
        classify({
          type: "image",
          host: "i.pinimg.com",
          path: "/236x/a.jpg",
          ip: "146.75.120.84",
          responseHeaders: [{ name: "x-cdn", value: "fastly" }],
        }),
        { provider: "fastly", proven: false, leak: { level: 2 } },
      );
    });

    it("proves the decryption by each header Fastly adds to its responses", () => {
      for (const header of [
        { name: "X-Served-By", value: "cache-par-lfpb1150080-PAR" },
        { name: "x-timer", value: "S1793984558.304123,VS0,VE12" },
      ]) {
        assert.deepEqual(
          classify({ responseHeaders: [header] }),
          { provider: "fastly", proven: true, leak: { level: 2 } },
          header.name,
        );
      }
    });

    // Other caches send these names, or these values, too.
    it("takes no other value of x-served-by or x-timer, and no x-cache, for Fastly", () => {
      for (const header of [
        { name: "x-served-by", value: "web-01" },
        { name: "x-timer", value: "12ms" },
        { name: "x-cache", value: "MISS" },
        { name: "x-cache-hits", value: "3" },
        { name: "via", value: "1.1 varnish" },
      ]) {
        assert.equal(
          classify({ responseHeaders: [header] }),
          null,
          `${header.name}: ${header.value}`,
        );
      }
    });

    it("recognises a service by the last name of its CNAME chain", () => {
      for (const name of [
        "dualstack.pinterest.map.fastly.net",
        "j.sni.global.fastly.net",
      ]) {
        assert.equal(classify({ cnames: [name] })?.provider, "fastly", name);
      }
      assert.equal(classify({ cnames: ["notfastly.net"] }), null);
    });
  });

  describe("OVHcloud CDN", () => {
    // The headers every response of auth.service-public.gouv.fr carried on
    // 2026-11-06, besides x-cacheable.
    const POP = [
      { name: "x-cdn-pop", value: "rbx" },
      { name: "x-cdn-pop-ip", value: "51.68.15.224/27" },
    ];
    const LOGIN = {
      host: "auth.service-public.gouv.fr",
      ip: "46.105.199.93",
      cookies: ["SP_SESSION", "TS015ce0c6"],
    };

    it("proves the decryption of the login form of service-public.gouv.fr on 2026-11-06", () => {
      assert.deepEqual(
        classify({
          ...LOGIN,
          type: "main_frame",
          method: "POST",
          path: "/realms/service-public/login-actions/authenticate",
          cookies: [
            "AUTH_SESSION_ID",
            "KC_AUTH_SESSION_HASH",
            "KC_RESTART",
            "SP_RGPD_OREJIME",
            "SP_SESSION",
            "TS015ce0c6",
          ],
          responseHeaders: [
            ...POP,
            { name: "x-cacheable", value: "Not cacheable: uncacheable" },
          ],
        }),
        { provider: "ovhcloud-cdn", proven: true, leak: SESSION_POSSIBLE },
      );
    });

    it("proves the decryption of the resources of that page it served from its cache", () => {
      assert.deepEqual(
        classify({
          ...LOGIN,
          path: "/resources/xz97u/login/service-public/js/require.js",
          responseHeaders: [
            ...POP,
            { name: "x-cacheable", value: "Matched cache" },
          ],
        }),
        { provider: "ovhcloud-cdn", proven: true, leak: SESSION_POSSIBLE },
      );
    });

    it("proves the decryption by each header OVHcloud documents for its CDN", () => {
      for (const header of [
        { name: "X-CDN-Pop-IP", value: "51.68.15.224/27" },
        { name: "X-Cacheable", value: "Matched cache" },
        { name: "x-cacheable", value: "Cacheable" },
        {
          name: "x-cacheable",
          value: "Not cacheable: no cache headers from backend",
        },
      ]) {
        assert.deepEqual(
          classify({ responseHeaders: [header] }),
          { provider: "ovhcloud-cdn", proven: true, leak: { level: 2 } },
          `${header.name}: ${header.value}`,
        );
      }
    });

    it("takes no other value of x-cacheable for OVHcloud's CDN", () => {
      for (const value of ["YES", "NO:Not Cacheable", "HIT"]) {
        assert.equal(
          classify({ responseHeaders: [{ name: "x-cacheable", value }] }),
          null,
          value,
        );
      }
    });

    // OVHcloud's network also carries ordinary servers, such as that of
    // www.data.gouv.fr on 2026-11-06.
    it("never recognises OVHcloud's CDN by an address alone", () => {
      for (const ip of ["46.105.199.93", "37.59.183.92"]) {
        assert.equal(classify({ ip }), null, ip);
      }
    });
  });

  describe("Radware", () => {
    // The redirection that opened the personal area of impots.gouv.fr on
    // 2026-11-06, from an address of Celeste, with no other sign of Radware.
    const IMPOTS = {
      type: "main_frame",
      host: "cfspart-idp.impots.gouv.fr",
      path: "/oauth2/authorize",
      ip: "145.242.11.213",
      cookies: [
        "ctxcfs",
        "fidgfippartpdata",
        "__uzma",
        "__uzmb",
        "__uzmc",
        "__uzmd",
        "__uzme",
        "cfsotp",
        "SL_ClassKey",
        "fidgfippart",
      ],
      responseHeaders: [
        { name: "server", value: "Apache" },
        { name: "via", value: "dpapusa206" },
      ],
      setCookies: ["__uzmc", "__uzmd"],
    };

    it("names Radware on the personal area of impots.gouv.fr, without proof, as its Bot Manager cookies alone show", () => {
      assert.deepEqual(classify(IMPOTS), {
        provider: "radware",
        proven: false,
        leak: SESSION_POSSIBLE,
      });
    });

    it("names Radware by the uzmx cookie of www.caf.fr, without proof", () => {
      assert.deepEqual(
        classify({
          type: "main_frame",
          host: "www.caf.fr",
          path: "/",
          cnames: ["www.caf.fr.radwarecloud.net"],
          setCookies: ["uzmx"],
        }),
        { provider: "radware", proven: false, leak: { level: 2 } },
      );
    });

    it("counts the Bot Manager cookies the browser sends as cookies of the site", () => {
      for (const name of ["__uzma", "__uzmf", "uzmx"]) {
        assert.deepEqual(
          classify({ setCookies: ["__uzmc"], cookies: [name] }),
          { provider: "radware", proven: false, leak: SESSION_POSSIBLE },
          name,
        );
      }
    });
  });

  it("never takes a cookie of the site that only resembles them for consent or measurement", () => {
    for (const name of [
      "_pk_session",
      "_pk_sid",
      "_pk_idx",
      "_pk_id",
      "OptanonConsentSession",
      "OptanonAlertBoxClosedX",
      "_gax",
      "ga",
      "tarteaucitron_session",
      "mtm_consent_session",
    ]) {
      assert.deepEqual(leakOf({ cookies: [name] }), SESSION_POSSIBLE, name);
    }
  });
});

// Each provider's ranges as ranges.txt writes them.
function rangeTexts(): [string, string[]][] {
  return table.providers.map(({ id }) => {
    const path = join(DATA, "providers", id, "ranges.txt");
    return [
      id,
      existsSync(path)
        ? parseRangesFile(readFileSync(path, "utf8"), path).ranges
        : [],
    ];
  });
}

// An IPv4 address read as the classification read it before the build
// parsed the ranges: split, each part checked by a regular expression, and
// the whole a BigInt.
function referenceIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9][0-9]*)$/.test(part) || Number(part) > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

// The provider of an address as the classification found it then: every
// range read from its text, and the address compared with each as BigInts.
function referenceProviderOf(
  ip: string,
  texts: readonly [string, string[]][],
): string | null {
  const family = ip.includes(":") ? 6 : 4;
  const parsedIp = parseIp(ip);
  const address =
    family === 4
      ? referenceIpv4(ip)
      : parsedIp.ok
        ? parsedIp.value.value
        : null;
  if (address === null) {
    return null;
  }
  const width = family === 4 ? 32n : 128n;
  for (const [id, ranges] of texts) {
    for (const text of ranges) {
      const [network = "", prefix = ""] = text.split("/");
      if ((family === 4) === network.includes(":")) {
        continue;
      }
      const range = parseCidr(text);
      const start =
        family === 4 ? referenceIpv4(network) : range.ok && range.value.network;
      assert.ok(typeof start === "bigint", text);
      const hostBits = width - BigInt(prefix);
      if (address >> hostBits === start >> hostBits) {
        return id;
      }
    }
  }
  return null;
}

function ipv4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => (value >> shift) & 0xffn).join(".");
}

function ipv6Text(value: bigint): string {
  return [7n, 6n, 5n, 4n, 3n, 2n, 1n, 0n]
    .map((group) => ((value >> (group * 16n)) & 0xffffn).toString(16))
    .join(":");
}

// Both ends of each range and the addresses just outside, the IPv4 ones also
// as IPv4 addresses mapped in IPv6, addresses drawn across the IPv4 space,
// and texts that are not addresses.
function addressesToCompare(texts: readonly [string, string[]][]): string[] {
  const addresses: string[] = [];
  for (const [, ranges] of texts) {
    for (const text of ranges) {
      const range = parseCidr(text);
      assert.ok(range.ok, text);
      const { family, network, prefixLength } = range.value;
      const width = family === 4 ? 32n : 128n;
      const last = network + (1n << (width - BigInt(prefixLength))) - 1n;
      const top = (1n << width) - 1n;
      const ends = [network, network + 1n, last, network - 1n, last + 1n];
      for (const value of ends.filter((end) => end >= 0n && end <= top)) {
        if (family === 4) {
          addresses.push(ipv4Text(value), `::ffff:${ipv4Text(value)}`);
        } else {
          addresses.push(ipv6Text(value));
        }
      }
    }
  }
  let seed = 0x2f7b85f;
  for (let drawn = 0; drawn < 2000; drawn += 1) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    addresses.push(ipv4Text(BigInt(seed)));
  }
  addresses.push(
    "",
    "01.2.3.4",
    "104.16.0.010",
    "104.16.0",
    "104.16.0.1.1",
    "104.16..1",
    "104.16.0.256",
    " 104.16.0.1",
    "104.16.0.1 ",
    "2400:cb00::1%eth0",
    "2400:cb00:::1",
    "garbage",
  );
  return addresses;
}

describe("the address ranges of the committed data", () => {
  it("give every address the provider that the ranges read from their text give it", () => {
    const texts = rangeTexts();
    const addresses = addressesToCompare(texts);
    assert.ok(addresses.length > 4000, `${addresses.length} addresses`);
    let found = 0;
    for (const ip of addresses) {
      const expected = referenceProviderOf(ip, texts);
      assert.equal(classify({ ip })?.provider ?? null, expected, ip);
      found += expected === null ? 0 : 1;
    }
    // Both outcomes are compared, not only addresses of no provider.
    assert.ok(found > 1000, `${found} addresses of a provider`);
  });
});

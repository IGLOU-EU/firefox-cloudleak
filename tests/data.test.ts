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

  // Each value was measured on 2026-11-16 on a site the provider serves, as
  // its provider.json says: a response header or cookie proves that the
  // provider relayed the response, and the last name of a CNAME chain names
  // it without proof.
  describe("the CDN and reverse proxy providers added on 2026-11-16", () => {
    const signals: Record<
      string,
      { headers?: [string, string][]; setCookies?: string[]; cnames?: string[] }
    > = {
      advancedhosting: {
        headers: [
          ["x-cdn-host-id", "DS9615"],
          ["x-cdn-host-id", "AH1747,DS9615"],
        ],
        cnames: ["cdn52130432.ahacdn.me"],
      },
      "alibaba-cloud": {
        headers: [
          ["eagleid", "2b6dd6b217948661283423161e"],
          ["ali-swift-global-savetime", "1794866093"],
          ["server", "ESA"],
        ],
        setCookies: ["acw_tc"],
        cnames: [
          "ww1.sinaimg.cn.w.alikunlun.com",
          "www.163.com.w.kunluncan.com",
        ],
      },
      "azure-front-door": {
        headers: [
          [
            "x-azure-ref",
            "20261116T215526Z-16f555b7d86fvg8fhC1BCNz0gc00000001c000000000313h",
          ],
        ],
        setCookies: ["ASLBSA"],
        cnames: ["mr-a03.tm-azurefd.net"],
      },
      belugacdn: {
        headers: [
          ["x-beluga-trace", "00ea8fa7-a1b9-432d-a95b-aeda0bb22f4d"],
          ["server", "NuCDN"],
        ],
        cnames: ["docs.belugacdn.com.i.belugacdn.com", "edge.nucdn.co"],
      },
      bunny: {
        headers: [
          ["cdn-pullzone", "1614968"],
          ["server", "BunnyCDN-FR1-1319"],
        ],
        cnames: ["bsky.b-cdn.net"],
      },
      byteplus: {
        headers: [["x-bdcdn-cache-status", "TCP_MISS,TCP_MISS,TCP_MISS"]],
        cnames: ["edge-hls.doppiocdn.org.bplslb.com"],
      },
      cachefly: {
        headers: [
          ["cf4ttl", "31536000.000"],
          ["server", "CFS 0215"],
        ],
        cnames: ["odcom.cachefly.net"],
      },
      cdn77: {
        headers: [
          ["x-77-cache", "HIT"],
          ["server", "CDN77-Turbo"],
        ],
        cnames: ["1004834818.rsc.cdn77.org"],
      },
      cdnetworks: {
        headers: [
          ["x-ws-request-id", "6afb7a09_PSfgblPAR1ai68_54712-7494"],
          ["server", "PWS/8.3.1.0.8"],
        ],
        cnames: ["clkempgz7nw7f7.qtlcdn.com"],
      },
      cdnsun: {
        headers: [["server", "CDNsun Edge"]],
        cnames: ["p8dfed2087646c7cc7184cf098901216c.p.cdn-sun.net"],
      },
      cdnvideo: {
        cnames: ["lavlattvef.a.trbcdn.net", "m-data.cdnvideo.ru"],
      },
      "ddos-guard": {
        headers: [["server", "ddos-guard"]],
        setCookies: ["__ddg1_"],
      },
      edgenext: {
        headers: [
          ["x-cc-via", "i2315409_c27809[M,41],i1935955_c23471[M,194]"],
          ["x-ser", "i2020957_c24821, i2315653_c27595"],
        ],
        cnames: ["89f45538.edgenext.com.cname.edgenextcname.com"],
      },
      "f5-distributed-cloud": {
        headers: [
          ["x-volterra-location", "pa4-par"],
          ["server", "volt-adc"],
        ],
        cnames: ["ves-io-414092f7-c275-48e6-929a-869d1fc2028f.ac.vh.ves.io"],
      },
      gcore: {
        headers: [["x-id-fe", "pa5-hw-edge-gc16"]],
        cnames: ["cl-glbce66526.gcdn.co"],
      },
      keycdn: {
        headers: [["server", "keycdn"]],
        cnames: ["p-frpa00.kxcdn.com"],
      },
      "kingsoft-cloud": {
        headers: [["x-cache-status", "MISS from KS-CLOUD-XG-FOREIGN-12-03"]],
        cnames: ["k1.gslb.ksyuncdn.com"],
      },
      link11: {
        headers: [["x-l11-trace", "ffm7-lb1"]],
        setCookies: ["rbzid"],
        cnames: ["fire-prod-link11-4193.straussgroupajo5.d1.rbzdns.com"],
      },
      medianova: {
        headers: [
          ["x-mnrequest-id", "96a1616d4c84e1d721b1f90ca470bfde"],
          ["server", "MNCDN-174140"],
        ],
        cnames: ["dsm.mncdn.com"],
      },
      myra: {
        headers: [["server", "myracloud"]],
        cnames: ["www-dkb-de.ax4z.com"],
      },
      netlify: {
        headers: [
          ["cache-status", '"Netlify Edge"; hit; ttl=31517509'],
          ["server", "Netlify"],
        ],
        cnames: ["babel-v7.netlify.app", "netlify.netlifyglobalcdn.com"],
      },
      sucuri: {
        headers: [
          ["x-sucuri-id", "19002"],
          ["server", "Sucuri/Cloudproxy"],
        ],
      },
      "tata-cdn": {
        headers: [["x-tata-request-id", "92dff8ba4bebfc7ecea75fa34d0178c0"]],
        cnames: ["live-b.bitgravity.com"],
      },
      "tencent-cloud": {
        headers: [
          ["eo-log-uuid", "11285419925066184674"],
          ["eo-cache-status", "HIT"],
        ],
        cnames: ["36d62c2e.ovslegodl.sched.ovscdns.com"],
      },
      vercel: {
        headers: [
          ["x-vercel-id", "cdg1::66qlk-1794866616494-3de8b1e41e98"],
          ["server", "Vercel"],
        ],
        cnames: [
          "2afb4f808650c82c.vercel-dns-013.com",
          "7db0c515ced5a8a7.vercel-dns.com",
        ],
      },
    };

    for (const [
      id,
      { headers = [], setCookies = [], cnames = [] },
    ] of Object.entries(signals)) {
      it(`proves ${id} by each measured signal and names it by its CNAME`, () => {
        for (const [name, value] of headers) {
          assert.deepEqual(
            classify({ responseHeaders: [{ name, value }] }),
            { provider: id, proven: true, leak: { level: 2 } },
            `${name}: ${value}`,
          );
        }
        for (const name of setCookies) {
          assert.deepEqual(
            classify({ setCookies: [name] }),
            { provider: id, proven: true, leak: { level: 2 } },
            name,
          );
        }
        for (const name of cnames) {
          assert.deepEqual(
            classify({ cnames: [name] }),
            { provider: id, proven: false, leak: { level: 2 } },
            name,
          );
        }
      });
    }

    it("recognises the edges in the published lists by their address, without proof", () => {
      for (const [ip, provider] of [
        ["143.244.56.53", "bunny"],
        ["2400:52e0:1e02::1073:1", "bunny"],
        ["205.234.175.175", "cachefly"],
        ["150.171.109.81", "azure-front-door"],
        ["13.107.246.61", "azure-front-door"],
      ] as const) {
        assert.deepEqual(
          classify({ ip }),
          { provider, proven: false, leak: { level: 2 } },
          ip,
        );
      }
    });

    it("takes no common value of a header that a provider bounds by its value", () => {
      for (const [name, value] of [
        ["x-cache-status", "HIT"],
        ["x-cache-status", "MISS from nginx"],
        ["cache-status", "ExampleCache; hit"],
        ["x-cdn-host-id", "web1"],
        ["x-ser", "web-01"],
        ["server", "nginx"],
        ["server", "Apache"],
        ["server", "kws"],
      ] as const) {
        assert.equal(
          classify({ responseHeaders: [{ name, value }] }),
          null,
          `${name}: ${value}`,
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

interface ReferenceRange {
  readonly id: string;
  readonly family: 4 | 6;
  readonly start: bigint;
  readonly hostBits: bigint;
}

// Every range read from its text as the classification read it then, once
// for all the addresses compared.
function referenceRanges(
  texts: readonly [string, string[]][],
): ReferenceRange[] {
  return texts.flatMap(([id, ranges]) =>
    ranges.map((text) => {
      const [network = "", prefix = ""] = text.split("/");
      const family = network.includes(":") ? 6 : 4;
      const range = parseCidr(text);
      const start =
        family === 4 ? referenceIpv4(network) : range.ok && range.value.network;
      assert.ok(typeof start === "bigint", text);
      const width = family === 4 ? 32n : 128n;
      return { id, family, start, hostBits: width - BigInt(prefix) };
    }),
  );
}

// The provider of an address as the classification found it then: the
// address compared with each range as BigInts.
function referenceProviderOf(
  ip: string,
  ranges: readonly ReferenceRange[],
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
  for (const range of ranges) {
    if (
      range.family === family &&
      address >> range.hostBits === range.start >> range.hostBits
    ) {
      return range.id;
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
    const ranges = referenceRanges(texts);
    let found = 0;
    for (const ip of addresses) {
      const expected = referenceProviderOf(ip, ranges);
      assert.equal(classify({ ip })?.provider ?? null, expected, ip);
      found += expected === null ? 0 : 1;
    }
    // Both outcomes are compared, not only addresses of no provider.
    assert.ok(found > 1000, `${found} addresses of a provider`);
  });

  // The classification takes the first provider whose ranges hold the
  // address, so an address in the ranges of two providers would go to the one
  // whose folder sorts first. Sorted by their start, a range overlaps an
  // earlier one only if it starts before the furthest end seen so far.
  it("never give one address to two providers", () => {
    const ranges = rangeTexts().flatMap(([id, texts]) =>
      texts.map((text) => {
        const range = parseCidr(text);
        assert.ok(range.ok, text);
        const { family, network, prefixLength } = range.value;
        const width = family === 4 ? 32n : 128n;
        const end = network + (1n << (width - BigInt(prefixLength))) - 1n;
        return { id, text, family, start: network, end };
      }),
    );
    ranges.sort((a, b) =>
      a.family !== b.family
        ? a.family - b.family
        : a.start < b.start
          ? -1
          : a.start > b.start
            ? 1
            : 0,
    );
    let furthest: (typeof ranges)[number] | undefined;
    for (const range of ranges) {
      if (
        furthest !== undefined &&
        furthest.family === range.family &&
        range.start <= furthest.end
      ) {
        assert.equal(
          range.id,
          furthest.id,
          `${range.text} of ${range.id} overlaps ${furthest.text} of ${furthest.id}`,
        );
      }
      if (
        furthest === undefined ||
        furthest.family !== range.family ||
        range.end > furthest.end
      ) {
        furthest = range;
      }
    }
  });
});

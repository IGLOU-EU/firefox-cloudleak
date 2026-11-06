// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The committed data, read as the build reads it, classifies the requests its
// sources describe.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTable } from "../scripts/providers.js";
import {
  classifyRequest,
  type Leak,
  type RequestFacts,
} from "../src/core/classify.js";

const { table, errors } = loadTable(
  fileURLToPath(new URL("../../data", import.meta.url)),
);

const CLOUDFLARE_IP = "104.16.0.1";

// A script loaded through a Cloudflare edge, at level 2: each test changes
// only the facts it is about.
function leakOf(changes: Partial<RequestFacts>): Leak | null {
  const result = classifyRequest(
    {
      method: "GET",
      type: "script",
      tls: true,
      host: "www.example.org",
      path: "/app.js",
      queryNames: [],
      ip: CLOUDFLARE_IP,
      cookies: [],
      authorization: false,
      responseHeaders: [],
      setCookies: [],
      ...changes,
    },
    table,
  );
  assert.equal(result?.provider, "cloudflare");
  return result?.leak ?? null;
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
    // A script fetched from an address no provider publishes: each test adds
    // only the signal it is about.
    function classify(changes: Partial<RequestFacts>) {
      return classifyRequest(
        {
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
        },
        table,
      );
    }

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

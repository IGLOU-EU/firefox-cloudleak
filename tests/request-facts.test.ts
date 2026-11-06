// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  leftTheBrowser,
  requestSideOf,
  responseSideOf,
} from "../src/core/request-facts.js";

const SECRET = "s3cr3t-value";

function request(url: string, headers: { name: string; value?: string }[]) {
  return { url, method: "GET", type: "script", requestHeaders: headers };
}

describe("requestSideOf", () => {
  it("keeps the method, the type, the host, the path and TLS from the scheme", () => {
    assert.deepEqual(
      requestSideOf({
        url: "https://www.example.org/a/b.js",
        method: "POST",
        type: "xmlhttprequest",
      }),
      {
        method: "POST",
        type: "xmlhttprequest",
        tls: true,
        host: "www.example.org",
        path: "/a/b.js",
        queryNames: [],
        cookies: [],
        authorization: false,
      },
    );
    assert.equal(requestSideOf(request("http://example.org/", []))?.tls, false);
    assert.equal(requestSideOf(request("wss://example.org/s", []))?.tls, true);
    assert.equal(requestSideOf(request("ws://example.org/s", []))?.tls, false);
  });

  it("lowers the host and keeps the brackets of an IPv6 address", () => {
    assert.equal(
      requestSideOf(request("https://WWW.Example.ORG/", []))?.host,
      "www.example.org",
    );
    assert.equal(
      requestSideOf(request("https://[2001:db8::1]:8443/", []))?.host,
      "[2001:db8::1]",
    );
  });

  it("keeps the names of the query parameters, never their values", () => {
    const side = requestSideOf(
      request(
        `https://example.org/?q=${SECRET}&page&__cf_chl_tk=${SECRET}`,
        [],
      ),
    );
    assert.deepEqual(side?.queryNames, ["q", "page", "__cf_chl_tk"]);
    assert.equal(side?.path, "/");
    assert.ok(!JSON.stringify(side).includes(SECRET));
  });

  it("decodes the names as a form would, and keeps a name it cannot decode as it is", () => {
    assert.deepEqual(
      requestSideOf(request("https://example.org/?a%20b=1&c+d=2&%E0=3", []))
        ?.queryNames,
      ["a b", "c d", "%E0"],
    );
  });

  it("skips the empty parts of the query and ignores the fragment", () => {
    assert.deepEqual(
      requestSideOf(request("https://example.org/?&a=1&&b=2&#c=3", []))
        ?.queryNames,
      ["a", "b"],
    );
    assert.deepEqual(
      requestSideOf(request("https://example.org/?", []))?.queryNames,
      [],
    );
  });

  it("keeps the cookie names and drops every value", () => {
    const side = requestSideOf(
      request("https://example.org/", [
        {
          name: "Cookie",
          value: `session=${SECRET}; _ga=${SECRET};theme=dark`,
        },
      ]),
    );
    assert.deepEqual(side?.cookies, ["session", "_ga", "theme"]);
    assert.ok(!JSON.stringify(side).includes(SECRET));
    assert.ok(!JSON.stringify(side).includes("dark"));
  });

  it("reads the cookie header whatever its case and however many times it comes", () => {
    assert.deepEqual(
      requestSideOf(
        request("https://example.org/", [
          { name: "cookie", value: "a=1" },
          { name: "COOKIE", value: "b=2" },
        ]),
      )?.cookies,
      ["a", "b"],
    );
  });

  it("gives an empty name to a cookie without a name, so that its value is not taken for one", () => {
    const side = requestSideOf(
      request("https://example.org/", [
        { name: "Cookie", value: `${SECRET}; a=1; ; =${SECRET}` },
      ]),
    );
    assert.deepEqual(side?.cookies, ["", "a", ""]);
    assert.ok(!JSON.stringify(side).includes(SECRET));
  });

  it("keeps only the presence of Authorization, never its value", () => {
    const side = requestSideOf(
      request("https://example.org/", [
        { name: "authorization", value: `Bearer ${SECRET}` },
      ]),
    );
    assert.equal(side?.authorization, true);
    assert.ok(!JSON.stringify(side).includes(SECRET));
    assert.equal(
      requestSideOf(
        request("https://example.org/", [{ name: "X-Auth", value: SECRET }]),
      )?.authorization,
      false,
    );
  });

  it("keeps no other request header", () => {
    const side = requestSideOf(
      request("https://example.org/", [
        { name: "Referer", value: `https://example.org/${SECRET}` },
        { name: "User-Agent", value: SECRET },
      ]),
    );
    assert.ok(!JSON.stringify(side).includes(SECRET));
  });

  it("refuses a URL it cannot read and a scheme that is not HTTP or WebSocket", () => {
    assert.equal(requestSideOf(request("not a url", [])), null);
    assert.equal(requestSideOf(request("ftp://example.org/", [])), null);
    assert.equal(requestSideOf(request("data:text/plain,a", [])), null);
  });
});

describe("responseSideOf", () => {
  it("keeps the address and the response headers but Set-Cookie", () => {
    assert.deepEqual(
      responseSideOf({
        ip: "104.16.0.1",
        responseHeaders: [
          { name: "server", value: "cloudflare" },
          { name: "cf-ray", value: "8a1b-CDG" },
        ],
      }),
      {
        ip: "104.16.0.1",
        responseHeaders: [
          { name: "server", value: "cloudflare" },
          { name: "cf-ray", value: "8a1b-CDG" },
        ],
        setCookies: [],
      },
    );
  });

  it("gives no address when Firefox gives none", () => {
    assert.equal(responseSideOf({}).ip, null);
    assert.equal(responseSideOf({ ip: undefined }).ip, null);
  });

  it("keeps a header given as binary by its name only", () => {
    assert.deepEqual(
      responseSideOf({ responseHeaders: [{ name: "x-bin" }] }).responseHeaders,
      [{ name: "x-bin", value: "" }],
    );
  });

  it("reduces Set-Cookie to the cookie names, one per line, whatever the case of the header", () => {
    const side = responseSideOf({
      responseHeaders: [
        {
          name: "Set-Cookie",
          value: `__cf_bm=${SECRET}; path=/; HttpOnly\ncf_clearance=${SECRET}\n\nsid=${SECRET};Secure`,
        },
        { name: "set-cookie", value: `other=${SECRET}` },
      ],
    });
    assert.deepEqual(side.setCookies, [
      "__cf_bm",
      "cf_clearance",
      "sid",
      "other",
    ]);
    assert.deepEqual(side.responseHeaders, []);
    assert.ok(!JSON.stringify(side).includes(SECRET));
  });

  it("gives an empty name to a cookie set without a name", () => {
    const side = responseSideOf({
      responseHeaders: [{ name: "Set-Cookie", value: `${SECRET}; path=/` }],
    });
    assert.deepEqual(side.setCookies, [""]);
    assert.ok(!JSON.stringify(side).includes(SECRET));
  });
});

describe("leftTheBrowser", () => {
  it("says a response served by the browser cache alone sent nothing out", () => {
    assert.equal(leftTheBrowser({ fromCache: true }), false);
    assert.equal(leftTheBrowser({ fromCache: true, ip: undefined }), false);
  });

  it("counts a revalidated response from the cache, which reached the server", () => {
    assert.equal(leftTheBrowser({ fromCache: true, ip: "104.16.0.1" }), true);
  });

  it("counts a response from the network, even without an address", () => {
    assert.equal(leftTheBrowser({ fromCache: false, ip: "104.16.0.1" }), true);
    assert.equal(leftTheBrowser({ fromCache: false }), true);
    assert.equal(leftTheBrowser({}), true);
  });
});

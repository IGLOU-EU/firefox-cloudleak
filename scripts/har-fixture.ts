// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Turns a HAR capture into a test fixture of request facts. A capture holds
// cookie values, request bodies and challenge tokens, and a fixture is
// committed, so only what the classification reads is copied.
//
// Usage: node build/scripts/har-fixture.js <capture.har> <fixture.json>,
// then npm run format.

import { readFileSync, writeFileSync } from "node:fs";
import type { RequestFacts } from "../src/core/classify.js";

interface HarHeader {
  name: string;
  value: string;
}

interface HarEntry {
  request: { method: string; url: string; headers: HarHeader[] };
  response: { headers: HarHeader[] };
  serverIPAddress?: string;
}

export interface FixtureEntry extends RequestFacts {
  // The entry number in the capture, counted from 1, which is how the
  // analysis of the capture names its requests.
  entry: number;
}

// A HAR has no webRequest type. Sec-Fetch-Dest is set by the browser from the
// same request destination, so the type is derived from it.
const TYPES: Record<string, string> = {
  document: "main_frame",
  iframe: "sub_frame",
  frame: "sub_frame",
  empty: "xmlhttprequest",
  script: "script",
  style: "stylesheet",
  image: "image",
  font: "font",
  audio: "media",
  video: "media",
};

// These values are tokens of the challenge the capturing browser solved, tied
// to that browser, so they stay out of a committed file.
function isOpaqueToken(name: string): boolean {
  return name.startsWith("cf-chl-") || name === "www-authenticate";
}

// A pair without "=" is a value with an empty name, as browsers read it, so
// the value never passes for a name.
function cookieName(pair: string): string {
  const equals = pair.indexOf("=");
  return equals === -1 ? "" : pair.slice(0, equals).trim();
}

function values(headers: HarHeader[], name: string): string[] {
  return headers
    .filter((header) => header.name.toLowerCase() === name)
    .map((header) => header.value);
}

function toFacts(entry: HarEntry, index: number): FixtureEntry | null {
  const url = new URL(entry.request.url);
  // A data: URL has no server behind it, so no provider sees it.
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return null;
  }
  const request = entry.request.headers;
  const response = entry.response.headers;
  return {
    entry: index + 1,
    method: entry.request.method,
    type: TYPES[values(request, "sec-fetch-dest")[0] ?? ""] ?? "other",
    tls: url.protocol === "https:" || url.protocol === "wss:",
    host: url.hostname,
    path: url.pathname,
    ip: entry.serverIPAddress || null,
    cookies: values(request, "cookie")
      .flatMap((value) => value.split(";"))
      .filter((pair) => pair.trim() !== "")
      .map(cookieName),
    authorization: values(request, "authorization").length > 0,
    responseHeaders: response
      .filter((header) => header.name.toLowerCase() !== "set-cookie")
      .map(({ name, value }) => ({
        name,
        value: isOpaqueToken(name.toLowerCase()) ? "redacted" : value,
      })),
    setCookies: values(response, "set-cookie")
      .flatMap((value) => value.split("\n"))
      .map((line) => cookieName(line.split(";")[0] ?? "")),
  };
}

const [harPath, fixturePath] = process.argv.slice(2);
if (harPath === undefined || fixturePath === undefined) {
  console.error("Usage: har-fixture <capture.har> <fixture.json>");
  process.exit(2);
}
const har = JSON.parse(readFileSync(harPath, "utf8")) as {
  log: { entries: HarEntry[] };
};
const fixture = har.log.entries.map(toFacts).filter((entry) => entry !== null);
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`Wrote ${fixture.length} request(s) to ${fixturePath}.`);

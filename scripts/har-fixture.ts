// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Turns a HAR capture into a test fixture of request facts. A capture holds
// cookie values, request bodies, query values and challenge tokens, and a
// fixture is committed, so only what the classification reads is copied.
//
// Usage: node build/scripts/har-fixture.js <capture.har> <fixture.json>,
// then npm run format.

import { readFileSync, writeFileSync } from "node:fs";
import type { RequestFacts } from "../src/core/classify.js";
import { requestSideOf, responseSideOf } from "../src/core/request-facts.js";

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

// A redirect names a URL, whose query can hold what the user typed or a
// token, so only the part before the query is kept.
function responseValue(name: string, value: string): string {
  if (isOpaqueToken(name)) {
    return "redacted";
  }
  return name === "location" ? (value.split(/[?#]/)[0] ?? "") : value;
}

// The facts are read as the extension reads them, so that the fixture holds
// what the classification would be given.
function toFacts(entry: HarEntry, index: number): FixtureEntry | null {
  const destination = entry.request.headers.find(
    (header) => header.name.toLowerCase() === "sec-fetch-dest",
  );
  const request = requestSideOf({
    url: entry.request.url,
    method: entry.request.method,
    type: TYPES[destination?.value ?? ""] ?? "other",
    requestHeaders: entry.request.headers,
  });
  // A data: URL has no server behind it, so no provider sees it.
  if (request === null) {
    return null;
  }
  const response = responseSideOf({
    ip: entry.serverIPAddress || null,
    responseHeaders: entry.response.headers,
  });
  return {
    entry: index + 1,
    ...request,
    ...response,
    responseHeaders: response.responseHeaders.map(({ name, value }) => ({
      name,
      value: responseValue(name.toLowerCase(), value),
    })),
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

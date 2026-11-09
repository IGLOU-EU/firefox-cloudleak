// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Ranges } from "./cidr.js";

// The table the build generates from data/ and the extension loads. The build
// must produce exactly this shape, so the classification and the data agree.

export interface ProviderTable {
  providers: ProviderEntry[];
  consentCookies: string[]; // cookie name patterns of known consent and audience-measurement cookies
}

export interface ProviderEntry {
  id: string;
  name: string;
  country: string;
  parent: { name: string; country: string } | null;
  ranges: Ranges; // parsed by the build from the CIDR ranges of ranges.txt
  headers: { name: string; value: string | null }[]; // name pattern, value pattern or null (presence)
  cookies: string[]; // cookie name patterns set or used by the provider itself
  siteConnectorCookies: string[]; // cookie name patterns a connector installed at the site may also set
  server: string[]; // `server` header value patterns
  cname: string[]; // CNAME suffixes, no wildcard
  challengeHosts: string[]; // host patterns of the provider's anti-bot challenge
  challengePaths: string[]; // path prefixes of the challenge, compared to the URL path
  challengeHeaders: { name: string; value: string | null }[]; // response headers of the challenge, as in headers
  challengeQueryNames: string[]; // URL query parameter name patterns of the challenge
}

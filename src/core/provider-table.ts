// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

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
  ranges: string[]; // CIDR
  headers: { name: string; value: string | null }[]; // name pattern, value pattern or null (presence)
  cookies: string[]; // cookie name patterns set or used by the provider itself
  server: string[]; // `server` header value patterns
  cname: string[]; // CNAME suffixes, no wildcard
  challengeHosts: string[]; // host patterns of the provider's anti-bot challenge
  challengePaths: string[]; // path prefixes of the challenge, compared to the URL path
}

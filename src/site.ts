// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { WEB_SCHEMES } from "./core/request-facts.js";

// The WebExtension types stop at Firefox 143, while Firefox gives the
// registrable domain of a host from 153 on (browser-compat-data,
// webextensions.api.publicSuffix), read from its own public suffix list,
// private section included, which every version of Firefox refreshes
// (ext-publicSuffix.js and nsEffectiveTLDService.cpp, Firefox 159.0.1).
declare global {
  namespace browser.publicSuffix {
    interface DomainOptions {
      readonly encoding?: "punycode" | "display";
      readonly allowIPAddress?: boolean;
      readonly allowPlainSuffix?: boolean;
      readonly allowUnknownSuffix?: boolean;
    }
    function getDomain(
      hostname: string,
      options?: DomainOptions,
    ): string | null;
  }
}

// The site of a document is its registrable domain, so that the pages of a
// site count together whatever their subdomain, and two sites of one host of
// the private section, such as two GitHub Pages, count apart. An address, a
// host without a known suffix and a host that is itself a suffix are sites of
// their own, as a user expects of a local network. Firefox refuses a host no
// URL should give, such as one with an empty label: it is kept as it is
// rather than lose its counts. The key stays in punycode, as the URL gives
// it, stable and comparable.
export function siteOf(hostname: string): string {
  try {
    return (
      browser.publicSuffix.getDomain(hostname, {
        allowIPAddress: true,
        allowPlainSuffix: true,
        allowUnknownSuffix: true,
      }) ?? hostname
    );
  } catch {
    return hostname;
  }
}

// The host as the URL gives it, in punycode, with the brackets of an IPv6
// address, which Firefox's registrable domain accepts.
export function siteOfUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  return hostname === "" ? null : siteOf(hostname);
}

// What the user names a site by: a host, a host and its port, or the address
// of a page. Reduced as the URL of a committed document is, so that it gives
// the site the pages of that host count under. URL reads a host and its port
// as a scheme and a path, so text whose first colon is followed by a digit,
// or that has none, is taken for a host. Of the text, only the scheme and the
// host are read, and only the site goes further.
export function siteOfTyped(text: string): string | null {
  const typed = text.trim();
  const scheme = /^([a-z][a-z\d+.-]*):(?!\d)/i.exec(typed)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return siteOfUrl(`http://${typed}`);
  }
  return WEB_SCHEMES.has(scheme) ? siteOfUrl(typed) : null;
}

// The site is kept in punycode, and Firefox writes it in Unicode where no
// character could pass for one of another script (publicSuffix
// DomainEncoding). The call throws on a name it cannot read, which is then
// shown as it came.
export function siteText(site: string): string {
  try {
    return (
      browser.publicSuffix.getDomain(site, {
        encoding: "display",
        allowIPAddress: true,
        allowPlainSuffix: true,
        allowUnknownSuffix: true,
      }) ?? site
    );
  } catch {
    return site;
  }
}

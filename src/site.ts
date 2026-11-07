// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

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

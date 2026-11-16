// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// A supposed provider: a third party the dynamic detection names from the
// canonical name of a host alone, when no known provider claims the request.
// Its id is a domain name, which holds a dot, while the id of a provider of
// data/ never does (CONTRIBUTING.md, "Provider data").

export function isSupposed(provider: string): boolean {
  return provider.includes(".");
}

// What Firefox's public suffix list says of a name, private section
// included: its registrable domain and its known suffix, each null when the
// list gives none.
export interface SuffixList {
  readonly domain: (name: string) => string | null;
  readonly suffix: (name: string) => string | null;
}

// The supposed provider a canonical name gives for a host, or null when the
// name stays within what the host belongs to, or when the list knows no
// suffix for it, as for a name of a local network.
//
// The provider is the last two labels of the name, which gather every name
// of one company whatever the list says of them: us-west-2.elb.amazonaws.com
// and s3.amazonaws.com are both amazonaws.com, where the registrable domain
// would give one provider for each region or customer, the list holding such
// names in its private section, which Firefox has no way to leave out. Under
// a country code, of two letters, the last two labels may be a suffix of the
// registry (co.uk, co.jp): a label is then added for as long as what is
// taken is itself a known suffix, so that x.amazon.co.jp is amazon.co.jp.
export function supposedOf(
  host: string,
  canonicalName: string,
  list: SuffixList,
): string | null {
  const name = canonicalName.toLowerCase().replace(/\.$/, "");
  // Neither an address, nor a suffix alone, nor a name without known suffix.
  if (list.domain(name) === null) {
    return null;
  }
  const labels = name.split(".");
  const countryCode = (labels.at(-1) ?? "").length === 2;
  let taken = 2;
  while (
    countryCode &&
    taken < labels.length &&
    list.suffix(labels.slice(-taken).join(".")) ===
      labels.slice(-taken).join(".")
  ) {
    taken += 1;
  }
  const provider = labels.slice(-taken).join(".");
  if (!isSupposed(provider)) {
    return null;
  }
  const asked = host.toLowerCase();
  return asked === provider || asked.endsWith(`.${provider}`) ? null : provider;
}

// What is kept by provider, without the supposed ones. What is given is
// never changed, and comes back as it is when it holds none.
export function withoutSupposed<T>(byProvider: {
  readonly [provider: string]: T;
}): { readonly [provider: string]: T } {
  const providers = Object.keys(byProvider);
  if (!providers.some(isSupposed)) {
    return byProvider;
  }
  return Object.fromEntries(
    Object.entries(byProvider).filter(([provider]) => !isSupposed(provider)),
  );
}

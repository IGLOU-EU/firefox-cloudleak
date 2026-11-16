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
// The registrable domain alone would split a hosting provider that has its
// suffix in the private section into one provider for each of its customers
// (customer.b-cdn.net), and Firefox has no way to leave that section out. So
// a known suffix of several labels under a generic top-level domain, of more
// than two letters, is the provider itself: there, such suffixes are those
// hosting providers register. Under a country code, they are mostly those of
// the registry (co.uk), and the registrable domain stays.
export function supposedOf(
  host: string,
  canonicalName: string,
  list: SuffixList,
): string | null {
  const name = canonicalName.toLowerCase().replace(/\.$/, "");
  const domain = list.domain(name);
  if (domain === null || !isSupposed(domain)) {
    return null;
  }
  const suffix = list.suffix(name);
  const provider =
    suffix !== null && /\.[^.]{3,}$/.test(suffix) ? suffix : domain;
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

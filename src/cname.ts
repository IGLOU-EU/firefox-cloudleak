// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { parseIp } from "./core/cidr.js";

// Kept for the life of the event page only, so that a host is resolved once
// per wake-up at most.
const names = new Map<string, Promise<string | null>>();

// Resolved through Firefox's own resolver, never bypassing its cache, so the
// answer comes from the same DNS settings as the request itself. Firefox
// gives only the last name of the CNAME chain.
export function canonicalNameOf(host: string): Promise<string | null> {
  const known = names.get(host);
  if (known !== undefined) {
    return known;
  }
  if (host.startsWith("[") || parseIp(host).ok) {
    return Promise.resolve(null);
  }
  const name = browser.dns.resolve(host, ["canonical_name"]).then(
    (record) => record.canonicalName || null,
    (error: unknown) => {
      // Kept like an answer until the page is suspended, and the next wake-up
      // asks again. Behind a SOCKS proxy that resolves names itself, every
      // call fails (NS_ERROR_UNKNOWN_PROXY_HOST, ext-dns.js, Firefox
      // 159.0.1), and asking again at each request would cost a round trip
      // to Firefox and a log line each time.
      console.error(`Cloud Leak: DNS resolution failed: ${String(error)}`);
      return null;
    },
  );
  names.set(host, name);
  return name;
}

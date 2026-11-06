// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { parseIp } from "./core/cidr.js";

// A resolver can fail for a while only, after a network change or a timeout,
// and a host would then go unclassified until the page is suspended. Behind
// a SOCKS proxy that resolves names itself, every call fails
// (NS_ERROR_UNKNOWN_PROXY_HOST, ext-dns.js, Firefox 159.0.1), and a minute
// keeps that case to one round trip to Firefox and one log line per host and
// minute.
const FAILURE_KEPT_MS = 60_000;

interface Known {
  readonly name: Promise<string | null>;
  // The host is asked again from this time on: never for an answer, nor for
  // a resolution still under way, which the requests of the host share.
  readonly until: number;
}

// Kept for the life of the event page only, so that a host is resolved once
// per wake-up at most, or about once a minute while its resolution fails.
const names = new Map<string, Known>();

// Resolved through Firefox's own resolver, never bypassing its cache, so the
// answer comes from the same DNS settings as the request itself. Firefox
// gives only the last name of the CNAME chain. The time is the time stamp of
// the request's event, the clock the tabs follow too, which a test sets.
export function canonicalNameOf(
  host: string,
  now: number,
): Promise<string | null> {
  const known = names.get(host);
  if (known !== undefined && now < known.until) {
    return known.name;
  }
  if (host.startsWith("[") || parseIp(host).ok) {
    return Promise.resolve(null);
  }
  const name: Promise<string | null> = browser.dns
    .resolve(host, ["canonical_name"])
    .then(
      (record) => record.canonicalName || null,
      (error: unknown) => {
        console.error(`Cloud Leak: DNS resolution failed: ${String(error)}`);
        names.set(host, { name, until: now + FAILURE_KEPT_MS });
        return null;
      },
    );
  names.set(host, { name, until: Number.POSITIVE_INFINITY });
  return name;
}

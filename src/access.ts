// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// In Manifest V3 the user can withdraw the access to all sites and then grant
// it site by site. Read at each wake-up and after each change, and kept as a
// plain value so that a navigation reads it without waiting.
let allSites = false;

export function hasAllSites(): boolean {
  return allSites;
}

// permissions.contains answers from the granted permissions, not from the
// manifest, by inclusion of match patterns (ext-permissions.js, Firefox
// 159.0.1).
export async function readAccess(): Promise<void> {
  try {
    allSites = await browser.permissions.contains({ origins: ["*://*/*"] });
  } catch (error: unknown) {
    // Not knowing is not having access: the tab then says its view is
    // partial rather than claim it saw everything.
    allSites = false;
    console.error(`Cloud Leak: permissions not read: ${String(error)}`);
  }
}

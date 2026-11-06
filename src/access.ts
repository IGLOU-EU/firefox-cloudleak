// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// In Manifest V3 the user can withdraw the access to all sites and then grant
// it site by site. Asked once per wake-up, and again after each change.
let allSites: Promise<boolean> | null = null;

export function hasAllSites(): Promise<boolean> {
  allSites ??= browser.permissions
    .contains({ origins: ["*://*/*"] })
    .catch((error: unknown) => {
      // Not knowing is not having access: the tab then says it is not
      // observed rather than claim it saw everything.
      allSites = null;
      console.error(`Cloud Leak: permissions not read: ${String(error)}`);
      return false;
    });
  return allSites;
}

export function forgetAccess(): void {
  allSites = null;
}

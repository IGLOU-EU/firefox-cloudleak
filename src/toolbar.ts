// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { Display, Icon } from "./core/display.js";

const ICONS: Record<Icon, string> = {
  neutral: "/icons/neutral.svg",
  blue: "/icons/blue.svg",
  orange: "/icons/orange.svg",
  red: "/icons/red.svg",
  "not-observed": "/icons/not-observed.svg",
};

// The same for every state: a badge in the colour of the state would melt
// into the cloud it covers.
export function setBadgeColours(): void {
  report(browser.action.setBadgeBackgroundColor({ color: "#15141a" }));
  report(browser.action.setBadgeTextColor({ color: "#ffffff" }));
}

// Firefox clears the values of a tab when it shows a new document, so the
// caller renders again after each change of the tab's status.
export function render(tabId: number, display: Display): void {
  const title = display.title
    .map((part) =>
      browser.i18n.getMessage(
        part.message,
        part.provider === null ? undefined : [part.provider],
      ),
    )
    .join(" ");
  report(browser.action.setIcon({ tabId, path: ICONS[display.icon] }));
  report(browser.action.setBadgeText({ tabId, text: display.badge }));
  report(browser.action.setTitle({ tabId, title }));
}

// A tab can close between the event and the call, so a failure is reported
// and never stops the next update.
export function report(call: Promise<unknown>): void {
  call.catch((error: unknown) => {
    console.error(`Cloud Leak: ${String(error)}`);
  });
}

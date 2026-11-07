// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { type Display, type Icon, titleText } from "./core/display.js";

export const ICONS: Record<Icon, string> = {
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

interface Sent {
  readonly icon: string;
  readonly badge: string;
  readonly title: string;
}

// Each value set repaints the button in the browser's own process
// (ext-browserAction.js, Firefox 159.0.1), and most bursts of requests change
// only the counts of the tooltip, so a value is sent only when it changed.
const sent = new Map<number, Sent>();

// Firefox clears the values of a tab when it shows a new document, and the
// tab's status turns to "loading" right after, so the caller renders
// everything again then. The tooltip keeps its line breaks: Firefox styles
// tooltips with white-space: pre-wrap (xul.css) and breaks a line in the
// tooltip of this same button for its own "Permission needed"
// (originControls.ftl), both in Firefox 159.0.1.
export function render(
  tabId: number,
  display: Display,
  everything: boolean,
): void {
  const next: Sent = {
    icon: ICONS[display.icon],
    badge: display.badge,
    title: titleText(display.title, (message, substitutions) =>
      browser.i18n.getMessage(message, [...substitutions]),
    ),
  };
  const last = everything ? undefined : sent.get(tabId);
  sent.set(tabId, next);
  if (next.icon !== last?.icon) {
    report(browser.action.setIcon({ tabId, path: next.icon }));
  }
  if (next.badge !== last?.badge) {
    report(browser.action.setBadgeText({ tabId, text: next.badge }));
  }
  if (next.title !== last?.title) {
    report(browser.action.setTitle({ tabId, title: next.title }));
  }
}

export function forgetSent(tabId: number): void {
  sent.delete(tabId);
}

// A tab can close between the event and the call, so a failure is reported
// and never stops the next update.
export function report(call: Promise<unknown>): void {
  call.catch((error: unknown) => {
    console.error(`Cloud Leak: ${String(error)}`);
  });
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What the pages of the extension, the popup, the preferences and the map,
// share: their elements, their texts and the questions they ask the event
// page.

import type { TitleLine } from "./core/display.js";
import type { PopupRequest } from "./core/popup-message.js";

export function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`the page has no element "${id}"`);
  }
  return found;
}

export function text(line: TitleLine): string {
  return browser.i18n.getMessage(line.message, [...line.substitutions]);
}

// Every fixed text of the page comes from _locales, in the language of the
// browser.
export function writeLabels(): void {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const target of Array.from(
    document.querySelectorAll<HTMLElement>("[data-message]"),
  )) {
    target.textContent = browser.i18n.getMessage(
      target.dataset["message"] ?? "",
    );
  }
}

// The answer comes from the extension's own event page, in the shape the
// contract of core/popup-message.ts gives it.
export async function ask<T>(request: PopupRequest): Promise<T> {
  return (await browser.runtime.sendMessage(request)) as T;
}

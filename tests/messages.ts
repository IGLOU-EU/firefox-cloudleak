// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Message {
  readonly message: string;
  readonly description?: string;
  readonly placeholders?: Record<string, { readonly content: string }>;
}

const ROOT = fileURLToPath(new URL("../../_locales/", import.meta.url));

// The messages of the popup page, apart from those of the tooltip, so that
// the check of the locales knows every message in use.
export const POPUP_MESSAGES: readonly string[] = [
  "popupPage",
  "popupUnit",
  "popupSite",
  "popupSitePrivate",
  "popupBrowserPage",
  "popupUnknownSite",
  "popupNothingBrowser",
  "popupNothingSite",
  "popupMap",
  "popupIgnoreSite",
  "popupUnignoreSite",
  "popupClearSite",
  "popupIgnore",
  "popupClear",
  "popupCancel",
  "popupIgnoreSiteQuestion",
  "popupClearSiteQuestion",
  "popupClearSiteQuestionPrivate",
  "popupIgnored",
  "popupIgnoredText",
  "popupWatchedAgain",
  "popupPreferences",
  "level1",
  "level2",
  "level3",
  "level4",
  "decryptionProven",
  "decryptionUnproven",
];

// The messages of the preferences page.
export const OPTIONS_MESSAGES: readonly string[] = [
  "optionsIgnoredSites",
  "optionsIgnoredText",
  "optionsRemove",
  "optionsRemoveSite",
  "optionsEmpty",
  "optionsAddSite",
  "optionsAdd",
  "optionsHelp",
  "optionsPreview",
  "optionsRefused",
  "optionsAlready",
];

export function messagesOf(locale: string): Record<string, Message> {
  return JSON.parse(
    readFileSync(`${ROOT}${locale}/messages.json`, "utf8"),
  ) as Record<string, Message>;
}

// Fills a message as browser.i18n.getMessage does: each $NAME$ takes the
// content of its placeholder, whose $1 takes the first substitution. A
// missing message fails, where Firefox would show an empty string.
export function getMessageOf(
  locale: string,
): (name: string, substitutions: readonly string[]) => string {
  const messages = messagesOf(locale);
  return (name, substitutions) => {
    const entry = messages[name];
    if (entry === undefined) {
      throw new Error(`${locale}: no message ${name}`);
    }
    return entry.message
      .replace(
        /\$([A-Za-z0-9_@]+)\$/g,
        (_, key: string) =>
          entry.placeholders?.[key.toLowerCase()]?.content ?? "",
      )
      .replace(
        /\$([1-9])/g,
        (_, index: string) => substitutions[Number(index) - 1] ?? "",
      );
  };
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Message {
  readonly message: string;
  readonly placeholders?: Record<string, { readonly content: string }>;
}

const ROOT = fileURLToPath(new URL("../../_locales/", import.meta.url));

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

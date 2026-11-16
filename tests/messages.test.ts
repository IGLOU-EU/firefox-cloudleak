// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCALES, messagesOf } from "./messages.js";

// What every message holds, whichever page shows it. That none is left unused
// is checked with the tooltip, in display.test.ts, and which messages take
// which placeholder by the test of each page.
describe("the messages of every locale", () => {
  const names = [
    ...new Set(LOCALES.flatMap(({ messages }) => Object.keys(messages))),
  ];

  it("exist in every locale, each with a message and a description", () => {
    for (const { locale, messages } of LOCALES) {
      for (const name of names) {
        assert.ok(messages[name]?.message, `${locale}: ${name}`);
        assert.ok(messages[name]?.description, `${locale}: ${name}`);
      }
    }
  });

  it("hold no line break, the lines being put together by the code", () => {
    for (const { locale, messages } of LOCALES) {
      for (const name of names) {
        assert.doesNotMatch(
          messages[name]?.message ?? "",
          /\n/,
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("have the same placeholders in each locale, each written in the message", () => {
    const [en, fr] = LOCALES;
    for (const name of names) {
      const placeholders = (entry: typeof en) =>
        Object.entries(entry?.messages[name]?.placeholders ?? {}).map(
          ([key, value]) => `${key}=${value.content}`,
        );
      assert.deepEqual(placeholders(fr), placeholders(en), name);
      for (const { locale, messages } of LOCALES) {
        const entry = messages[name];
        const written = [
          ...(entry?.message ?? "").matchAll(/\$([A-Z]+)\$/g),
        ].map((match) => (match[1] ?? "").toLowerCase());
        assert.deepEqual(
          written.sort(),
          Object.keys(entry?.placeholders ?? {}).sort(),
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("put a no-break space before a colon, a question mark or a closing guillemet, and after an opening one, in French", () => {
    const fr = messagesOf("fr");
    for (const name of names) {
      const text = fr[name]?.message ?? "";
      assert.doesNotMatch(text, /[^\u00a0][:?»]/u, name);
      assert.doesNotMatch(text, /«[^\u00a0]/u, name);
    }
  });

  it("hold neither an em dash nor a semicolon in French", () => {
    const fr = messagesOf("fr");
    for (const name of names) {
      assert.doesNotMatch(fr[name]?.message ?? "", /[\u2014;]/u, name);
    }
  });
});

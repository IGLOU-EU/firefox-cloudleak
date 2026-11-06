// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Classification, Leak } from "../src/core/classify.js";
import { type Display, displayOf } from "../src/core/display.js";
import {
  addRequest,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "akamai", name: "Akamai" },
];

function seen(leak: Leak, proven: boolean, provider = "cloudflare"): TabState {
  const request: Classification = { provider, proven, leak };
  return addRequest(NEUTRAL, request);
}

function show(state: TabState): Display {
  return displayOf(state, PROVIDERS);
}

const SESSION: Leak = {
  level: 4,
  case: "session",
  possible: false,
  challenge: false,
};
const SESSION_POSSIBLE: Leak = { ...SESSION, possible: true };
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };

describe("displayOf", () => {
  it("shows the neutral and not observed states without a badge", () => {
    assert.deepEqual(show(NEUTRAL), {
      icon: "neutral",
      badge: "",
      title: [{ message: "titleNeutral", provider: null }],
    });
    assert.deepEqual(show(NOT_OBSERVED), {
      icon: "not-observed",
      badge: "",
      title: [{ message: "titleNotObserved", provider: null }],
    });
  });

  it("gives the colour of the most serious request to the icon and its level to the badge", () => {
    assert.equal(show(seen({ level: 2 }, true)).icon, "blue");
    assert.equal(show(seen({ level: 2 }, false)).icon, "blue");
    assert.equal(show(seen({ level: 3 }, false)).icon, "orange");
    assert.equal(show(seen({ level: 3 }, true)).icon, "red");
    assert.equal(show(seen(DATA_SENT, false)).icon, "orange");
    assert.equal(show(seen(DATA_SENT, true)).icon, "red");
    assert.equal(show(seen({ level: 2 }, true)).badge, "2");
    assert.equal(show(seen({ level: 3 }, true)).badge, "3");
    assert.equal(show(seen(SESSION, false)).badge, "4");
  });

  it("names the level, the case and the proof, with the name of the provider", () => {
    const cases: [TabState, string][] = [
      [seen({ level: 2 }, false), "titleLevel2"],
      [seen({ level: 2 }, true), "titleLevel2"],
      [seen({ level: 3 }, false), "titleLevel3Unproven"],
      [seen({ level: 3 }, true), "titleLevel3Proven"],
      [seen(DATA_SENT, false), "titleLevel4DataSentUnproven"],
      [seen(DATA_SENT, true), "titleLevel4DataSentProven"],
      [seen(SESSION, false), "titleLevel4SessionUnproven"],
      [seen(SESSION, true), "titleLevel4SessionProven"],
      [seen(SESSION_POSSIBLE, false), "titleLevel4SessionPossibleUnproven"],
      [seen(SESSION_POSSIBLE, true), "titleLevel4SessionPossibleProven"],
    ];
    for (const [state, message] of cases) {
      assert.deepEqual(
        show(state).title,
        [{ message, provider: "Cloudflare" }],
        message,
      );
    }
    assert.deepEqual(show(seen({ level: 3 }, false, "akamai")).title, [
      { message: "titleLevel3Unproven", provider: "Akamai" },
    ]);
  });

  it("adds the anti-bot mark to a request of the anti-bot machinery, whatever its case", () => {
    assert.deepEqual(
      show(seen({ level: 4, case: "data-sent", challenge: true }, true)).title,
      [
        { message: "titleLevel4DataSentProven", provider: "Cloudflare" },
        { message: "titleAntiBot", provider: "Cloudflare" },
      ],
    );
    assert.deepEqual(
      show(seen({ ...SESSION_POSSIBLE, challenge: true }, true)).title,
      [
        { message: "titleLevel4SessionPossibleProven", provider: "Cloudflare" },
        { message: "titleAntiBot", provider: "Cloudflare" },
      ],
    );
  });

  it("says when the view is partial, after the mark", () => {
    const state = markPartial(
      seen({ level: 4, case: "data-sent", challenge: true }, true),
    );
    assert.deepEqual(show(state), {
      icon: "red",
      badge: "4",
      title: [
        { message: "titleLevel4DataSentProven", provider: "Cloudflare" },
        { message: "titleAntiBot", provider: "Cloudflare" },
        { message: "titlePartial", provider: null },
      ],
    });
  });

  it("falls back on the identifier of a provider missing from the table", () => {
    assert.deepEqual(show(seen({ level: 3 }, true, "unknown")).title, [
      { message: "titleLevel3Proven", provider: "unknown" },
    ]);
  });
});

describe("the tooltip messages", () => {
  const root = fileURLToPath(new URL("../../_locales/", import.meta.url));
  const locales = ["en", "fr"].map((locale) => ({
    locale,
    messages: JSON.parse(
      readFileSync(`${root}${locale}/messages.json`, "utf8"),
    ) as Record<
      string,
      { message: string; placeholders?: Record<string, unknown> }
    >,
  }));
  const used = [
    "titleNeutral",
    "titleNotObserved",
    "titleLevel2",
    "titleLevel3Unproven",
    "titleLevel3Proven",
    "titleLevel4DataSentUnproven",
    "titleLevel4DataSentProven",
    "titleLevel4SessionUnproven",
    "titleLevel4SessionProven",
    "titleLevel4SessionPossibleUnproven",
    "titleLevel4SessionPossibleProven",
    "titleAntiBot",
    "titlePartial",
  ];
  const withProvider = used.filter(
    (name) =>
      !["titleNeutral", "titleNotObserved", "titlePartial"].includes(name),
  );

  it("exist in every locale, and the same in each", () => {
    const [en, fr] = locales;
    assert.deepEqual(
      Object.keys(fr?.messages ?? {}).sort(),
      Object.keys(en?.messages ?? {}).sort(),
    );
    for (const { locale, messages } of locales) {
      for (const name of used) {
        assert.ok(messages[name]?.message, `${locale}: ${name}`);
      }
    }
  });

  it("put the provider name where a provider is given, and nowhere else", () => {
    for (const { locale, messages } of locales) {
      for (const name of used) {
        const entry = messages[name];
        const expected = withProvider.includes(name);
        assert.equal(
          entry?.message.includes("$PROVIDER$"),
          expected,
          `${locale}: ${name}`,
        );
        assert.equal(
          entry?.placeholders?.["provider"] !== undefined,
          expected,
          `${locale}: ${name}`,
        );
      }
    }
  });
});

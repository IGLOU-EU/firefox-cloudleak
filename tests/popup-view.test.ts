// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Classification,
  Colour,
  Leak,
  LeakLevel,
} from "../src/core/classify.js";
import { line } from "../src/core/display.js";
import type { PopupData, SiteCounts } from "../src/core/popup-message.js";
import {
  cleared,
  type PopupView,
  type Row,
  viewOf,
} from "../src/core/popup-view.js";
import {
  addRequest,
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";
import { messagesOf, POPUP_MESSAGES } from "./messages.js";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "akamai", name: "Akamai" },
];
const SINCE = 1_762_516_800_000;
const dateOf = (sinceMs: number) => `date ${sinceMs}`;
const noDate = () => {
  throw new Error("no date in a private window");
};

const SESSION: Leak = {
  level: 4,
  case: "session",
  possible: false,
  challenge: false,
};

function request(
  leak: Leak,
  proven: boolean,
  provider = "cloudflare",
): Classification {
  return { provider, proven, leak };
}

function times(count: number, item: Classification): Classification[] {
  return Array.from({ length: count }, () => item);
}

function fold(requests: Classification[]): TabState {
  return requests.reduce(addRequest, NEUTRAL);
}

function data(changes: Partial<PopupData> = {}): PopupData {
  return {
    state: NEUTRAL,
    page: "site",
    site: "site.example",
    privateWindow: false,
    since: SINCE,
    totals: {},
    ...changes,
  };
}

function view(changes: Partial<PopupData> = {}): PopupView {
  return viewOf(data(changes), PROVIDERS, dateOf);
}

function row(
  colour: Colour,
  level: LeakLevel,
  proven: boolean | null,
  count: number,
): Row {
  return {
    colour,
    level,
    label: line(`level${level}`),
    proof:
      proven === null
        ? null
        : line(proven ? "decryptionProven" : "decryptionUnproven"),
    count,
  };
}

// Three levels on one page, the counts of a few visits of the site.
const PAGE = fold([
  ...times(2, request({ level: 2 }, true)),
  request({ level: 3 }, false),
  ...times(3, request(SESSION, true)),
]);
const TOTALS: SiteCounts = {
  cloudflare: {
    blue2: { "GET script": 5, "GET image": 7 },
    red4: { "POST xmlhttprequest": 1, "GET main_frame": 2 },
    orange3: { "GET xmlhttprequest": 4 },
    red3: { "GET main_frame": 1 },
  },
};

describe("the header of the popup", () => {
  it("takes the cloud of the state, and passes the site on as it came", () => {
    assert.equal(view({ state: NEUTRAL }).icon, "neutral");
    assert.equal(view({ state: NOT_OBSERVED }).icon, "not-observed");
    assert.equal(view({ state: PAGE }).icon, "red");
    assert.equal(view().site, "site.example");
    assert.equal(view({ site: null }).site, null);
  });
});

describe("the page section of the popup", () => {
  it("lists the counts of the tab from the most serious, with the cloud of each category", () => {
    assert.deepEqual(view({ state: PAGE }).page?.rows, [
      row("red", 4, true, 3),
      row("orange", 3, false, 1),
      row("blue", 2, null, 2),
    ]);
  });

  it("says what the tooltip says once the counts are rows, and sets the partial view apart", () => {
    const page = view({ state: markMissed(markPartial(PAGE)) }).page;
    assert.deepEqual(page?.lines, [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
    ]);
    assert.deepEqual(page?.partial, [
      line("titlePartial"),
      line("titleMissed"),
    ]);
  });

  it("says why there is nothing to count", () => {
    assert.deepEqual(view({ state: NEUTRAL }).page, {
      rows: [],
      lines: [line("titleNeutral")],
      partial: [],
    });
    assert.deepEqual(view({ state: markPartial(NEUTRAL) }).page, {
      rows: [],
      lines: [line("titleNeutral")],
      partial: [line("titlePartial")],
    });
    assert.deepEqual(view({ state: NOT_OBSERVED }).page, {
      rows: [],
      lines: [line("titleNotObserved")],
      partial: [],
    });
  });

  it("is left out for a page of the browser with nothing to say, and kept where its state says something", () => {
    assert.equal(view({ site: null, state: NEUTRAL }).page, null);
    assert.deepEqual(
      view({ site: null, state: markPartial(NEUTRAL) }).page?.partial,
      [line("titlePartial")],
    );
    assert.deepEqual(
      view({ site: null, state: fold([request({ level: 2 }, false)]) }).page
        ?.rows,
      [row("blue", 2, null, 1)],
    );
  });
});

describe("the site section of the popup", () => {
  it("is titled with the date the counts started, as the date is formatted", () => {
    assert.deepEqual(view().totals?.title, line("popupSite", `date ${SINCE}`));
  });

  it("is titled with the private session in a private window, without asking for a date", () => {
    const totals = viewOf(
      data({ privateWindow: true }),
      PROVIDERS,
      noDate,
    ).totals;
    assert.deepEqual(totals?.title, line("popupSitePrivate"));
  });

  it("is left out for a page of the browser", () => {
    assert.equal(view({ site: null, totals: TOTALS }).totals, null);
  });

  it("has no provider when nothing of the site went through one", () => {
    assert.deepEqual(view({ totals: {} }).totals?.providers, []);
  });

  it("sums the requests of a category over their methods and types, and orders the categories as the icon does", () => {
    assert.deepEqual(view({ totals: TOTALS }).totals?.providers, [
      {
        name: "Cloudflare",
        rows: [
          row("red", 4, true, 3),
          row("red", 3, true, 1),
          row("orange", 3, false, 4),
          row("blue", 2, null, 12),
        ],
      },
    ]);
  });

  it("names a provider from the table, and by its id when the table does not know it", () => {
    const totals: SiteCounts = {
      akamai: { blue2: { "GET script": 1 } },
      "cdn-x": { blue2: { "GET script": 1 } },
    };
    assert.deepEqual(
      view({ totals }).totals?.providers.map((entry) => entry.name),
      ["Akamai", "cdn-x"],
    );
  });

  it("orders the providers by their most serious category, then by name", () => {
    const totals: SiteCounts = {
      akamai: { blue2: { "GET script": 1 } },
      cloudflare: { orange4: { "GET xmlhttprequest": 1 } },
      "cdn-x": { red3: { "GET main_frame": 1 } },
      beta: { blue2: { "GET script": 9 } },
      alpha: { blue2: { "GET script": 1 } },
    };
    assert.deepEqual(
      view({ totals }).totals?.providers.map((entry) => entry.name),
      ["cdn-x", "Cloudflare", "Akamai", "alpha", "beta"],
    );
  });

  it("leaves out a category without request, and a provider without category", () => {
    const totals: SiteCounts = {
      cloudflare: { red4: {}, blue2: { "GET script": 0 } },
      akamai: {},
    };
    assert.deepEqual(view({ totals }).totals?.providers, []);
  });

  it("leaves out a category it does not know rather than guess it", () => {
    const totals = JSON.parse(
      '{"cloudflare":{"purple9":{"GET script":1},"blue2":{"GET script":1}}}',
    ) as SiteCounts;
    assert.deepEqual(view({ totals }).totals?.providers, [
      { name: "Cloudflare", rows: [row("blue", 2, null, 1)] },
    ]);
  });
});

describe("the question of clear all", () => {
  it("names the date the kept counts started", () => {
    assert.deepEqual(
      view().question,
      line("popupClearQuestion", `date ${SINCE}`),
    );
  });

  it("sets the private session apart in a private window", () => {
    assert.deepEqual(
      viewOf(data({ privateWindow: true }), PROVIDERS, noDate).question,
      line("popupClearQuestionPrivate"),
    );
  });
});

describe("cleared", () => {
  it("empties the totals and takes the start of the new period", () => {
    assert.deepEqual(cleared(data({ totals: TOTALS }), 5), {
      ...data(),
      totals: {},
      since: 5,
    });
  });

  it("leaves the data of a private window as it is, whose counts are the session's", () => {
    const before = data({ privateWindow: true, since: 0, totals: TOTALS });
    assert.equal(cleared(before, 5), before);
  });
});

describe("the popup messages", () => {
  const locales = ["en", "fr"].map((locale) => ({
    locale,
    messages: messagesOf(locale),
  }));
  const withDate = ["popupSite", "popupClearQuestion"];

  it("exist in every locale", () => {
    for (const { locale, messages } of locales) {
      for (const name of POPUP_MESSAGES) {
        assert.ok(messages[name]?.message, `${locale}: ${name}`);
      }
    }
  });

  it("cover every message the view produces", () => {
    const views = [
      view({ state: PAGE, totals: TOTALS }),
      viewOf(data({ privateWindow: true }), PROVIDERS, noDate),
      view({ site: null }),
    ];
    const produced = new Set<string>();
    for (const entry of views) {
      const rows = [
        ...(entry.page?.rows ?? []),
        ...(entry.totals?.providers.flatMap((provider) => provider.rows) ?? []),
      ];
      for (const item of rows) {
        produced.add(item.label.message);
        if (item.proof !== null) {
          produced.add(item.proof.message);
        }
      }
      if (entry.totals !== null) {
        produced.add(entry.totals.title.message);
      }
      produced.add(entry.question.message);
    }
    assert.ok(produced.size >= 8);
    for (const name of produced) {
      assert.ok(POPUP_MESSAGES.includes(name), name);
    }
  });

  it("put the date where a date is given, and nowhere else", () => {
    for (const { locale, messages } of locales) {
      for (const name of POPUP_MESSAGES) {
        const entry = messages[name];
        const expected = withDate.includes(name);
        assert.equal(
          entry?.message.includes("$DATE$"),
          expected,
          `${locale}: ${name}`,
        );
        assert.equal(
          entry?.placeholders?.["date"] !== undefined,
          expected,
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("hold no line break", () => {
    for (const { locale, messages } of locales) {
      for (const name of POPUP_MESSAGES) {
        assert.doesNotMatch(
          messages[name]?.message ?? "",
          /\n/,
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("put a no-break space before a colon or a question mark in French", () => {
    const fr = messagesOf("fr");
    for (const name of POPUP_MESSAGES) {
      const text = fr[name]?.message ?? "";
      assert.doesNotMatch(text, /[^\u00a0][:?]/u, name);
    }
  });
});

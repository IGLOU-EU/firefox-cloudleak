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
  IGNORED,
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";
import { getMessageOf, LOCALES, POPUP_MESSAGES } from "./messages.js";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "akamai", name: "Akamai" },
];
const SINCE = 1_762_516_800_000;
const dateOf = (sinceMs: number) => `date ${sinceMs}`;
const noDate = () => {
  throw new Error("no date in a private window");
};
const siteOf = (site: string) => `shown ${site}`;

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
    ignored: false,
    ...changes,
  };
}

function view(changes: Partial<PopupData> = {}): PopupView {
  return viewOf(data(changes), PROVIDERS, dateOf, siteOf);
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
    assert.deepEqual(view().header, { kind: "site", site: "site.example" });
  });

  it("names a page of the browser, reader view included, which has no site", () => {
    assert.deepEqual(view({ page: "browser", site: null }).header, {
      kind: "browser-page",
    });
    assert.deepEqual(view({ page: "reader", site: null }).header, {
      kind: "browser-page",
    });
  });

  it("says the site of a website is unknown when the extension does not know it", () => {
    assert.deepEqual(view({ page: "site", site: null }).header, {
      kind: "unknown-site",
    });
  });
});

describe("the notice that there is nothing to count", () => {
  it("shows for a page of the browser whose state has nothing to say", () => {
    assert.equal(view({ page: "browser", site: null }).notice, true);
    assert.equal(view({ page: "reader", site: null }).notice, true);
  });

  it("never shows beside counts or messages", () => {
    for (const state of [markMissed(NEUTRAL), markPartial(NEUTRAL), PAGE]) {
      const shown = view({ page: "browser", site: null, state });
      assert.notEqual(shown.page, null);
      assert.equal(shown.notice, false);
    }
    assert.equal(view({ page: "site", site: null }).notice, false);
    assert.equal(view({ state: NEUTRAL }).notice, false);
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
    const browser = { page: "browser", site: null } as const;
    assert.equal(view({ ...browser, state: NEUTRAL }).page, null);
    assert.equal(view({ page: "reader", site: null }).page, null);
    assert.deepEqual(
      view({ ...browser, state: markPartial(NEUTRAL) }).page?.partial,
      [line("titlePartial")],
    );
    assert.deepEqual(
      view({ ...browser, state: fold([request({ level: 2 }, false)]) }).page
        ?.rows,
      [row("blue", 2, null, 1)],
    );
  });

  it("says what the tab saw of a website whose site is unknown, as of any website", () => {
    assert.deepEqual(view({ site: null, state: NEUTRAL }).page, {
      rows: [],
      lines: [line("titleNeutral")],
      partial: [],
    });
    assert.deepEqual(view({ site: null, state: markMissed(NEUTRAL) }).page, {
      rows: [],
      lines: [line("titleNeutral")],
      partial: [line("titleMissed")],
    });
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
      siteOf,
    ).totals;
    assert.deepEqual(totals?.title, line("popupSitePrivate"));
  });

  it("is left out for a page of the browser, and for a website whose site is unknown", () => {
    assert.equal(
      view({ page: "browser", site: null, totals: TOTALS }).totals,
      null,
    );
    assert.equal(view({ site: null, totals: TOTALS }).totals, null);
  });

  it("has no provider when nothing of the site went through one", () => {
    assert.deepEqual(view({ totals: {} }).totals?.providers, []);
  });

  it("sums the requests of a category over their methods and types, and orders the categories as the icon does", () => {
    assert.deepEqual(view({ totals: TOTALS }).totals?.providers, [
      {
        name: "Cloudflare",
        supposed: false,
        rows: [
          row("red", 4, true, 3),
          row("red", 3, true, 1),
          row("orange", 3, false, 4),
          row("blue", 2, null, 12),
        ],
      },
    ]);
  });

  it("marks a supposed provider, named by its domain, and no other", () => {
    const totals: SiteCounts = {
      akamai: { blue2: { "GET script": 1 } },
      "cdn-x": { blue2: { "GET script": 1 } },
      "b-cdn.net": { orange3: { "GET xmlhttprequest": 1 } },
    };
    assert.deepEqual(
      view({ totals }).totals?.providers.map((entry) => [
        entry.name,
        entry.supposed,
      ]),
      [
        ["b-cdn.net", true],
        ["Akamai", false],
        ["cdn-x", false],
      ],
    );
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
      {
        name: "Cloudflare",
        supposed: false,
        rows: [row("blue", 2, null, 1)],
      },
    ]);
  });
});

describe("the question of the clear of the site", () => {
  it("names the site as the header shows it, and the date its counts started", () => {
    assert.deepEqual(
      view().clearQuestion,
      line("popupClearSiteQuestion", "shown site.example", `date ${SINCE}`),
    );
  });

  it("names the site and the private session in a private window, without asking for a date", () => {
    assert.deepEqual(
      viewOf(data({ privateWindow: true }), PROVIDERS, noDate, siteOf)
        .clearQuestion,
      line("popupClearSiteQuestionPrivate", "shown site.example"),
    );
  });

  it("is left out without a site, since there is nothing to clear", () => {
    assert.equal(view({ page: "browser", site: null }).clearQuestion, null);
    assert.equal(view({ page: "reader", site: null }).clearQuestion, null);
    assert.equal(view({ page: "site", site: null }).clearQuestion, null);
    assert.equal(
      viewOf(
        data({ privateWindow: true, site: null }),
        PROVIDERS,
        noDate,
        siteOf,
      ).clearQuestion,
      null,
    );
  });

  it("is left out for an ignored site, which keeps nothing to clear", () => {
    assert.equal(view({ ignored: true, state: IGNORED }).clearQuestion, null);
  });
});

describe("the question of ignoring the site", () => {
  it("names the site as the header shows it, and says its counts go", () => {
    assert.deepEqual(
      view().ignoreQuestion,
      line("popupIgnoreSiteQuestion", "shown site.example"),
    );
  });

  it("is left out in a private window, so that no site visited in private enters the list kept on disk", () => {
    assert.equal(
      viewOf(data({ privateWindow: true }), PROVIDERS, noDate, siteOf)
        .ignoreQuestion,
      null,
    );
  });

  it("is left out without a site, and for a site already ignored", () => {
    assert.equal(view({ page: "browser", site: null }).ignoreQuestion, null);
    assert.equal(view({ page: "reader", site: null }).ignoreQuestion, null);
    assert.equal(view({ page: "site", site: null }).ignoreQuestion, null);
    assert.equal(view({ ignored: true, state: IGNORED }).ignoreQuestion, null);
  });
});

describe("the buttons of the footer", () => {
  // Ignore, stop ignoring and clear, in the order of the footer.
  const buttons = (shown: PopupView) => [
    shown.ignoreQuestion !== null,
    shown.unignore,
    shown.clearQuestion !== null,
  ];
  const privately = (changes: Partial<PopupData>) =>
    viewOf(
      data({ privateWindow: true, ...changes }),
      PROVIDERS,
      noDate,
      siteOf,
    );

  it("ignore and clear a site", () => {
    assert.deepEqual(buttons(view({ state: PAGE })), [true, false, true]);
  });

  it("only clear a site in a private window", () => {
    assert.deepEqual(buttons(privately({ state: PAGE })), [false, false, true]);
  });

  it("offer nothing without a site", () => {
    for (const page of ["browser", "reader", "site"] as const) {
      assert.deepEqual(buttons(view({ page, site: null })), [
        false,
        false,
        false,
      ]);
      assert.deepEqual(buttons(privately({ page, site: null })), [
        false,
        false,
        false,
      ]);
    }
  });

  it("only stop ignoring an ignored site, in a private window too, since that writes no site visited in private", () => {
    const ignored = { ignored: true, state: IGNORED } as const;
    assert.deepEqual(buttons(view(ignored)), [false, true, false]);
    assert.deepEqual(buttons(privately(ignored)), [false, true, false]);
  });

  it("offer nothing to stop ignoring without a site to name", () => {
    assert.deepEqual(buttons(view({ ignored: true, site: null })), [
      false,
      false,
      false,
    ]);
  });
});

describe("the popup of an ignored site", () => {
  it("keeps the neutral cloud and the site, says it is ignored, and shows neither the page nor its totals", () => {
    for (const state of [IGNORED, PAGE]) {
      const shown = view({ ignored: true, state, totals: TOTALS });
      assert.equal(shown.icon, "neutral");
      assert.deepEqual(shown.header, { kind: "site", site: "site.example" });
      assert.equal(shown.ignored, true);
      assert.equal(shown.page, null);
      assert.equal(shown.totals, null);
      assert.equal(shown.notice, false);
      assert.equal(shown.watchedAgain, false);
    }
  });

  it("is not ignored without the word of the event page", () => {
    assert.equal(view({ state: IGNORED }).ignored, false);
    assert.equal(view().ignored, false);
  });
});

describe("the site watched again", () => {
  const again = (changes: Partial<PopupData>) =>
    viewOf(data(changes), PROVIDERS, dateOf, siteOf, true);

  it("is said once the popup stopped ignoring the site, beside what the tab and the site show", () => {
    const shown = again({ state: markMissed(NEUTRAL) });
    assert.equal(shown.watchedAgain, true);
    assert.equal(shown.ignored, false);
    assert.notEqual(shown.page, null);
    assert.notEqual(shown.totals, null);
  });

  it("is not said otherwise, nor while the event page still says the site is ignored, nor without a site", () => {
    assert.equal(view().watchedAgain, false);
    assert.equal(again({ ignored: true, state: IGNORED }).watchedAgain, false);
    assert.equal(again({ page: "site", site: null }).watchedAgain, false);
  });
});

describe("cleared", () => {
  it("empties the totals and takes the new start of the counts of the site", () => {
    assert.deepEqual(cleared(data({ totals: TOTALS }), 5), {
      ...data(),
      totals: {},
      since: 5,
    });
  });

  it("empties the totals of a private window, which has no start", () => {
    const before = data({ privateWindow: true, since: 0, totals: TOTALS });
    assert.deepEqual(cleared(before, 0), { ...before, totals: {} });
  });
});

describe("the popup messages", () => {
  const withDate = ["popupSite", "popupClearSiteQuestion"];
  const withSite = [
    "popupIgnoreSiteQuestion",
    "popupClearSiteQuestion",
    "popupClearSiteQuestionPrivate",
  ];

  it("cover every message the view produces", () => {
    const views = [
      view({ state: PAGE, totals: TOTALS }),
      viewOf(data({ privateWindow: true }), PROVIDERS, noDate, siteOf),
      view({ site: null }),
      view({ page: "browser", site: null }),
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
      for (const question of [entry.clearQuestion, entry.ignoreQuestion]) {
        if (question !== null) {
          produced.add(question.message);
        }
      }
    }
    assert.ok(produced.size >= 8);
    for (const name of produced) {
      assert.ok(POPUP_MESSAGES.includes(name), name);
    }
  });

  it("put the date where a date is given, and nowhere else", () => {
    for (const { locale, messages } of LOCALES) {
      for (const name of POPUP_MESSAGES) {
        assert.equal(
          messages[name]?.placeholders?.["date"] !== undefined,
          withDate.includes(name),
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("put the site where a site is given, and nowhere else, before the date", () => {
    for (const { locale, messages } of LOCALES) {
      for (const name of POPUP_MESSAGES) {
        assert.equal(
          messages[name]?.placeholders?.["site"]?.content,
          withSite.includes(name) ? "$1" : undefined,
          `${locale}: ${name}`,
        );
      }
      assert.equal(
        messages["popupClearSiteQuestion"]?.placeholders?.["date"]?.content,
        "$2",
        locale,
      );
      assert.equal(
        messages["popupSite"]?.placeholders?.["date"]?.content,
        "$1",
        locale,
      );
    }
  });

  it("ask to clear the site shown, kept or of the private session", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.equal(fr("popupClearSite", []), "Purger");
    assert.equal(en("popupClearSite", []), "Clear");
    assert.equal(
      fr("popupClearSiteQuestion", ["bücher.example", "7 novembre 2026"]),
      "Purger les statistiques de bücher.example gardées depuis le 7 novembre 2026\u00a0?",
    );
    assert.equal(
      en("popupClearSiteQuestion", ["bücher.example", "November 7, 2026"]),
      "Clear the counts of bücher.example kept since November 7, 2026?",
    );
    assert.equal(
      fr("popupClearSiteQuestionPrivate", ["bücher.example"]),
      "Purger les statistiques de bücher.example dans cette session privée\u00a0?",
    );
    assert.equal(
      en("popupClearSiteQuestionPrivate", ["bücher.example"]),
      "Clear the counts of bücher.example in this private session?",
    );
    assert.equal(fr("popupClear", []), "Purger");
    assert.equal(fr("popupCancel", []), "Annuler");
  });

  it("ask to ignore the site shown, and say its counts go", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.equal(fr("popupIgnoreSite", []), "Ignorer");
    assert.equal(en("popupIgnoreSite", []), "Ignore");
    assert.equal(
      fr("popupIgnoreSiteQuestion", ["bücher.example"]),
      "Ignorer bücher.example et purger ses statistiques\u00a0?",
    );
    assert.equal(
      en("popupIgnoreSiteQuestion", ["bücher.example"]),
      "Ignore bücher.example and erase its counts?",
    );
    assert.equal(fr("popupIgnore", []), "Ignorer");
    assert.equal(en("popupIgnore", []), "Ignore");
  });

  it("say a site is ignored, and that it is watched again", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.equal(fr("popupUnignoreSite", []), "Ne plus ignorer");
    assert.equal(en("popupUnignoreSite", []), "Stop ignoring");
    assert.equal(fr("popupIgnored", []), "Site ignoré");
    assert.equal(en("popupIgnored", []), "Ignored site");
    assert.equal(
      fr("popupIgnoredText", []),
      "Cloud Leak ne regarde pas les requêtes de ce site et n'en compte aucune.",
    );
    assert.equal(
      en("popupIgnoredText", []),
      "Cloud Leak does not look at the requests of this site and counts none of them.",
    );
    assert.equal(
      fr("popupWatchedAgain", []),
      "Ce site est de nouveau regardé, à partir du prochain chargement de la page.",
    );
    assert.equal(
      en("popupWatchedAgain", []),
      "This site is watched again, from the next load of the page.",
    );
  });

  it("name the preferences", () => {
    assert.equal(getMessageOf("fr")("popupPreferences", []), "Préférences");
    assert.equal(getMessageOf("en")("popupPreferences", []), "Preferences");
  });
});

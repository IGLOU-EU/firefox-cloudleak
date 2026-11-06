// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification, Leak } from "../src/core/classify.js";
import {
  type Display,
  displayOf,
  type TitleLine,
  titleText,
} from "../src/core/display.js";
import {
  addRequest,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";
import { getMessageOf, messagesOf } from "./messages.js";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "akamai", name: "Akamai" },
];

function request(
  leak: Leak,
  proven: boolean,
  provider = "cloudflare",
): Classification {
  return { provider, proven, leak };
}

function seen(leak: Leak, proven: boolean, provider = "cloudflare"): TabState {
  return addRequest(NEUTRAL, request(leak, proven, provider));
}

function times(count: number, item: Classification): Classification[] {
  return Array.from({ length: count }, () => item);
}

function fold(requests: Classification[], start = NEUTRAL): TabState {
  return requests.reduce(addRequest, start);
}

function show(state: TabState): Display {
  return displayOf(state, PROVIDERS);
}

function line(message: string, ...substitutions: string[]): TitleLine {
  return { message, substitutions };
}

const SESSION: Leak = {
  level: 4,
  case: "session",
  possible: false,
  challenge: false,
};
const SESSION_POSSIBLE: Leak = { ...SESSION, possible: true };
const DATA_SENT: Leak = { level: 4, case: "data-sent", challenge: false };
const CHALLENGE: Leak = { level: 4, case: "data-sent", challenge: true };

describe("displayOf", () => {
  it("shows the neutral and not observed states without a badge", () => {
    assert.deepEqual(show(NEUTRAL), {
      icon: "neutral",
      badge: "",
      title: [[line("titleNeutral")]],
    });
    assert.deepEqual(show(NOT_OBSERVED), {
      icon: "not-observed",
      badge: "",
      title: [[line("titleNotObserved")]],
    });
  });

  it("keeps the neutral icon on a partial view where nothing was seen, and says the view is partial", () => {
    assert.deepEqual(show(markPartial(NEUTRAL)), {
      icon: "neutral",
      badge: "",
      title: [[line("titleNeutral"), line("titlePartial")]],
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

  it("names the case and the proof of the most serious request, with the name of the provider", () => {
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
        show(state).title[1],
        [line(message, "Cloudflare")],
        message,
      );
    }
    assert.deepEqual(show(seen({ level: 3 }, false, "akamai")).title[1], [
      line("titleLevel3Unproven", "Akamai"),
    ]);
  });

  it("counts the requests of each level first, one line per level and proof, from the most serious", () => {
    const state = fold([
      ...times(40, request({ level: 2 }, true)),
      request({ level: 3 }, false, "akamai"),
      ...times(12, request(SESSION_POSSIBLE, true)),
      request({ level: 2 }, false),
      request(DATA_SENT, false, "akamai"),
      request(DATA_SENT, false, "akamai"),
    ]);
    assert.deepEqual(show(state).title, [
      [
        line("countLevel4ProvenMany", "12"),
        line("countLevel4UnprovenMany", "2"),
        line("countLevel3UnprovenOne"),
        line("countLevel2Many", "41"),
      ],
      [line("titleLevel4SessionPossibleProven", "Cloudflare")],
    ]);
  });

  it("uses the message for one request when the count is one", () => {
    assert.deepEqual(show(seen({ level: 2 }, true)).title[0], [
      line("countLevel2One"),
    ]);
    assert.deepEqual(show(seen({ level: 3 }, true)).title[0], [
      line("countLevel3ProvenOne"),
    ]);
    assert.deepEqual(show(seen(SESSION, false)).title[0], [
      line("countLevel4UnprovenOne"),
    ]);
  });

  it("adds the anti-bot mark to a request of the anti-bot machinery, whatever its case", () => {
    assert.deepEqual(show(seen(CHALLENGE, true)).title[1], [
      line("titleLevel4DataSentProven", "Cloudflare"),
      line("titleAntiBot", "Cloudflare"),
    ]);
    assert.deepEqual(
      show(seen({ ...SESSION_POSSIBLE, challenge: true }, true)).title[1],
      [
        line("titleLevel4SessionPossibleProven", "Cloudflare"),
        line("titleAntiBot", "Cloudflare"),
      ],
    );
  });

  it("says when the view is partial, after the mark", () => {
    assert.deepEqual(show(markPartial(seen(CHALLENGE, true))), {
      icon: "red",
      badge: "4",
      title: [
        [line("countLevel4ProvenOne")],
        [
          line("titleLevel4DataSentProven", "Cloudflare"),
          line("titleAntiBot", "Cloudflare"),
          line("titlePartial"),
        ],
      ],
    });
  });

  it("falls back on the identifier of a provider missing from the table", () => {
    assert.deepEqual(show(seen({ level: 3 }, true, "unknown")).title[1], [
      line("titleLevel3Proven", "unknown"),
    ]);
  });
});

describe("titleText", () => {
  const echo = (name: string, substitutions: readonly string[]) =>
    [name, ...substitutions].join(" ");

  it("puts each line on its own line and a blank line between the counts and the message", () => {
    assert.equal(
      titleText(
        [
          [line("a", "1"), line("b")],
          [line("c", "X"), line("d")],
        ],
        echo,
      ),
      "a 1\nb\n\nc X\nd",
    );
    assert.equal(titleText([[line("a")]], echo), "a");
  });
});

describe("the tooltip messages", () => {
  const locales = ["en", "fr"].map((locale) => ({
    locale,
    messages: messagesOf(locale),
  }));
  const counts = ["2", "3Proven", "3Unproven", "4Proven", "4Unproven"].flatMap(
    (grade) => [`countLevel${grade}One`, `countLevel${grade}Many`],
  );
  const withProvider = [
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
  ];
  const plain = ["titleNeutral", "titleNotObserved", "titlePartial"];
  const used = [...plain, ...withProvider, ...counts];

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

  it("put the count in the message for several requests, and write one out in the message for one", () => {
    for (const { locale, messages } of locales) {
      for (const name of counts) {
        const entry = messages[name];
        const many = name.endsWith("Many");
        assert.equal(
          entry?.message.includes("$COUNT$"),
          many,
          `${locale}: ${name}`,
        );
        assert.equal(
          entry?.placeholders?.["count"] !== undefined,
          many,
          `${locale}: ${name}`,
        );
        if (!many) {
          assert.match(entry?.message ?? "", /\b1 /u, `${locale}: ${name}`);
        }
      }
    }
  });

  it("hold no line break, the lines being put together by the code", () => {
    for (const { locale, messages } of locales) {
      for (const name of used) {
        assert.doesNotMatch(
          messages[name]?.message ?? "",
          /\n/,
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("put a no-break space before a colon in French", () => {
    const fr = messagesOf("fr");
    for (const name of used) {
      const text = fr[name]?.message ?? "";
      assert.doesNotMatch(text, /[^\u00a0]:/u, name);
    }
  });
});

describe("the tooltip text", () => {
  const fr = getMessageOf("fr");
  const en = getMessageOf("en");
  const text = (state: TabState, message: typeof fr) =>
    titleText(show(state).title, message);

  const multiLevel = fold([
    ...times(40, request({ level: 2 }, true)),
    ...times(3, request({ level: 3 }, false, "akamai")),
    ...times(12, request(SESSION_POSSIBLE, true)),
  ]);

  it("reads, for a tab at three levels", () => {
    assert.equal(
      text(multiLevel, fr),
      "Niveau 4, données personnelles\u00a0: 12 requêtes, déchiffrement prouvé\n" +
        "Niveau 3, lecture\u00a0: 3 requêtes, déchiffrement non prouvé\n" +
        "Niveau 2, usage\u00a0: 40 requêtes\n" +
        "\n" +
        "Session possible\u00a0: les cookies que vous envoyez à ce site passent en clair chez Cloudflare, et l'un d'eux peut porter votre session.",
    );
    assert.equal(
      text(multiLevel, en),
      "Level 4, personal data: 12 requests, decryption proven\n" +
        "Level 3, reading: 3 requests, decryption not proven\n" +
        "Level 2, usage: 40 requests\n" +
        "\n" +
        "Possible session: the cookies you send to this site go through Cloudflare in clear, and one of them may hold your session.",
    );
  });

  it("reads, for a partial view where nothing was seen", () => {
    assert.equal(
      text(markPartial(NEUTRAL), fr),
      "Aucune requête vue dans cet onglet ne passe par un intermédiaire connu.\n" +
        "Vue partielle\u00a0: l'extension n'a pas accès à tous les sites, elle ne montre que ce qu'elle a vu.",
    );
    assert.equal(
      text(markPartial(NEUTRAL), en),
      "No request seen in this tab goes through a known intermediary.\n" +
        "Partial view: the extension does not have access to every site, so it shows only what it saw.",
    );
  });

  it("reads, for an anti-bot request on a partial view", () => {
    const state = markPartial(
      fold([request(CHALLENGE, true), request({ level: 2 }, true)]),
    );
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 1 requête, déchiffrement prouvé\n" +
        "Niveau 2, usage\u00a0: 1 requête\n" +
        "\n" +
        "Données envoyées\u00a0: ce que votre navigateur envoie passe en clair chez Cloudflare.\n" +
        "Anti-robot\u00a0: la requête la plus grave vient de la protection anti-robot de Cloudflare, pas du site visité.\n" +
        "Vue partielle\u00a0: l'extension n'a pas accès à tous les sites, elle ne montre que ce qu'elle a vu.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 1 request, decryption proven\n" +
        "Level 2, usage: 1 request\n" +
        "\n" +
        "Data sent: what your browser sends goes through Cloudflare in clear.\n" +
        "Anti-bot: the most serious request belongs to the anti-bot protection of Cloudflare, not to the site you visit.\n" +
        "Partial view: the extension does not have access to every site, so it shows only what it saw.",
    );
  });

  it("reads, for a single request without proof", () => {
    const state = seen(DATA_SENT, false, "akamai");
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 1 requête, déchiffrement non prouvé\n" +
        "\n" +
        "Données envoyées\u00a0: ce que votre navigateur envoie passe par Akamai, peut-être en clair.",
    );
  });

  it("reads, for a site out of reach", () => {
    assert.equal(
      text(NOT_OBSERVED, fr),
      "Site non observé\u00a0: l'accès à ce site a été retiré à l'extension, elle ne peut rien en dire.",
    );
  });
});

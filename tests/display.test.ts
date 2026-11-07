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
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";
import { getMessageOf, messagesOf } from "./messages.js";

const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare" },
  { id: "akamai", name: "Akamai" },
  { id: "cloudfront", name: "Amazon CloudFront" },
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
const CHALLENGE_SESSION: Leak = { ...SESSION_POSSIBLE, challenge: true };

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

  it("keeps the neutral icon where nothing was seen and requests were missed, and says why the view is partial", () => {
    assert.deepEqual(show(markMissed(NEUTRAL)), {
      icon: "neutral",
      badge: "",
      title: [[line("titleNeutral"), line("titleMissed")]],
    });
    assert.deepEqual(show(markPartial(markMissed(NEUTRAL))).title, [
      [line("titleNeutral"), line("titlePartial"), line("titleMissed")],
    ]);
  });

  it("gives the colour of the most serious request to the icon", () => {
    assert.equal(show(seen({ level: 2 }, true)).icon, "blue");
    assert.equal(show(seen({ level: 2 }, false)).icon, "blue");
    assert.equal(show(seen({ level: 3 }, false)).icon, "orange");
    assert.equal(show(seen({ level: 3 }, true)).icon, "red");
    assert.equal(show(seen(DATA_SENT, false)).icon, "orange");
    assert.equal(show(seen(DATA_SENT, true)).icon, "red");
  });

  it("counts in the badge the requests at the colour and level of the icon, and no others", () => {
    const red4 = fold([
      ...times(40, request({ level: 2 }, true)),
      ...times(3, request({ level: 3 }, true)),
      ...times(7, request(DATA_SENT, false)),
      ...times(12, request(SESSION_POSSIBLE, true)),
      request(CHALLENGE, true, "akamai"),
    ]);
    assert.equal(show(red4).icon, "red");
    assert.equal(show(red4).badge, "13");
    const red3 = fold([
      ...times(5, request(SESSION, false)),
      ...times(2, request({ level: 3 }, true)),
    ]);
    assert.equal(show(red3).icon, "red");
    assert.equal(show(red3).badge, "2");
    const orange4 = fold([
      ...times(4, request({ level: 3 }, false)),
      ...times(6, request(DATA_SENT, false)),
    ]);
    assert.equal(show(orange4).badge, "6");
  });

  it("counts together the proven and unproven requests of a level whose colour does not depend on the proof", () => {
    const blue2 = fold([
      ...times(2, request({ level: 2 }, true)),
      ...times(3, request({ level: 2 }, false)),
    ]);
    assert.equal(show(blue2).icon, "blue");
    assert.equal(show(blue2).badge, "5");
  });

  it("writes the count in the badge from 1 to 99, and a plus above", () => {
    const at = (count: number) =>
      show(fold(times(count, request({ level: 3 }, true)))).badge;
    assert.equal(at(1), "1");
    assert.equal(at(9), "9");
    assert.equal(at(10), "10");
    assert.equal(at(99), "99");
    assert.equal(at(100), "+");
    assert.equal(at(1000), "+");
  });

  it("says what the provider of the most serious request sees, in the message of its colour", () => {
    const cases: [TabState, string][] = [
      [seen({ level: 2 }, false), "titleBlue"],
      [seen({ level: 2 }, true), "titleBlue"],
      [seen({ level: 3 }, false), "titleOrange"],
      [seen({ level: 3 }, true), "titleRed"],
      [seen(DATA_SENT, false), "titleOrange"],
      [seen(DATA_SENT, true), "titleRed"],
    ];
    for (const [state, message] of cases) {
      assert.deepEqual(
        show(state).title[1],
        [line(message, "Cloudflare")],
        message,
      );
    }
    assert.deepEqual(show(seen({ level: 3 }, false, "akamai")).title[1], [
      line("titleOrange", "Akamai"),
    ]);
  });

  it("adds a line when the tab saw a session, stated where its decryption was proven and in the conditional otherwise", () => {
    assert.deepEqual(show(seen(SESSION, true)).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
    ]);
    assert.deepEqual(show(seen(SESSION_POSSIBLE, true)).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
    ]);
    assert.deepEqual(show(seen(SESSION_POSSIBLE, false, "akamai")).title[1], [
      line("titleOrange", "Akamai"),
      line("titleSessionUnproven"),
    ]);
  });

  it("keeps the session line in the conditional on a red tab whose sessions were all unproven", () => {
    const state = fold([request(SESSION, false), request({ level: 3 }, true)]);
    assert.equal(show(state).icon, "red");
    assert.deepEqual(show(state).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionUnproven"),
    ]);
  });

  it("adds the session line whichever request is the most serious", () => {
    const state = fold([
      request(SESSION_POSSIBLE, true),
      request(DATA_SENT, true, "akamai"),
    ]);
    assert.deepEqual(show(state).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
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
      [line("titleRed", "Cloudflare"), line("titleSessionProven")],
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

  it("adds a line when the tab saw an anti-bot request, after the session, whichever request is the most serious", () => {
    assert.deepEqual(show(seen(CHALLENGE, true)).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleAntiBotProven"),
    ]);
    assert.deepEqual(show(seen(CHALLENGE_SESSION, true)).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
      line("titleAntiBotProven"),
    ]);
    const site = fold([
      request(CHALLENGE, true),
      request(SESSION_POSSIBLE, true),
    ]);
    assert.deepEqual(
      site.kind === "seen" && site.request.leak,
      SESSION_POSSIBLE,
    );
    assert.deepEqual(show(site).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleSessionProven"),
      line("titleAntiBotProven"),
    ]);
  });

  it("puts the anti-bot line in the conditional where no anti-bot request was proven read", () => {
    assert.deepEqual(show(seen(CHALLENGE, false)).title[1], [
      line("titleOrange", "Cloudflare"),
      line("titleAntiBotUnproven"),
    ]);
    const red = fold([request(CHALLENGE, false), request({ level: 3 }, true)]);
    assert.deepEqual(show(red).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleAntiBotUnproven"),
    ]);
  });

  it("says when the view is partial, after the anti-bot line", () => {
    assert.deepEqual(show(markPartial(seen(CHALLENGE, true))), {
      icon: "red",
      badge: "1",
      title: [
        [line("countLevel4ProvenOne")],
        [
          line("titleRed", "Cloudflare"),
          line("titleAntiBotProven"),
          line("titlePartial"),
        ],
      ],
    });
  });

  it("says when requests were missed, after the partial view, each with its own reason", () => {
    assert.deepEqual(show(markMissed(seen(CHALLENGE, true))).title[1], [
      line("titleRed", "Cloudflare"),
      line("titleAntiBotProven"),
      line("titleMissed"),
    ]);
    assert.deepEqual(
      show(markMissed(markPartial(seen({ level: 3 }, true)))).title[1],
      [
        line("titleRed", "Cloudflare"),
        line("titlePartial"),
        line("titleMissed"),
      ],
    );
    assert.equal(show(markMissed(seen({ level: 3 }, false))).icon, "orange");
    assert.equal(show(markMissed(seen({ level: 3 }, false))).badge, "1");
  });

  it("falls back on the identifier of a provider missing from the table", () => {
    assert.deepEqual(show(seen({ level: 3 }, true, "unknown")).title[1], [
      line("titleRed", "unknown"),
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
  const withProvider = ["titleBlue", "titleOrange", "titleRed"];
  const plain = [
    "titleNeutral",
    "titleNotObserved",
    "titleSessionProven",
    "titleSessionUnproven",
    "titleAntiBotProven",
    "titleAntiBotUnproven",
    "titlePartial",
    "titleMissed",
  ];
  const used = [...plain, ...withProvider, ...counts];

  it("exist in every locale, and the same in each, with no message left unused", () => {
    const [en, fr] = locales;
    assert.deepEqual(
      Object.keys(fr?.messages ?? {}).sort(),
      Object.keys(en?.messages ?? {}).sort(),
    );
    assert.deepEqual(
      Object.keys(en?.messages ?? {}).sort(),
      ["extensionName", "extensionDescription", ...used].sort(),
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

  it("reads, for a tab at three levels", () => {
    const state = fold([
      ...times(40, request({ level: 2 }, true)),
      ...times(3, request({ level: 3 }, false, "akamai")),
      ...times(12, request(SESSION_POSSIBLE, true)),
    ]);
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 12 requêtes, déchiffrement prouvé\n" +
        "Niveau 3, lecture\u00a0: 3 requêtes, déchiffrement non prouvé\n" +
        "Niveau 2, usage\u00a0: 40 requêtes\n" +
        "\n" +
        "Cloudflare voit en clair tout ce que cette page échange avec le site\u00a0: adresses, pages, cookies et formulaires.\n" +
        "Des cookies ou un jeton de connexion en font partie, ils peuvent suffire à ouvrir votre compte.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 12 requests, decryption proven\n" +
        "Level 3, reading: 3 requests, decryption not proven\n" +
        "Level 2, usage: 40 requests\n" +
        "\n" +
        "Cloudflare sees in clear everything this page exchanges with the site: web addresses, pages, cookies and forms.\n" +
        "Cookies or a login token are part of it, and they can be enough to get into your account.",
    );
  });

  // Like leboncoin: the page carries cookies of the site, and its calls an
  // Authorization header, all through CloudFront, which signs its responses.
  it("reads, for a tab logged in through CloudFront", () => {
    const state = fold([
      request(SESSION_POSSIBLE, true, "cloudfront"),
      ...times(30, request({ level: 2 }, true, "cloudfront")),
      ...times(22, request(SESSION, true, "cloudfront")),
    ]);
    assert.equal(show(state).icon, "red");
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 23 requêtes, déchiffrement prouvé\n" +
        "Niveau 2, usage\u00a0: 30 requêtes\n" +
        "\n" +
        "Amazon CloudFront voit en clair tout ce que cette page échange avec le site\u00a0: adresses, pages, cookies et formulaires.\n" +
        "Des cookies ou un jeton de connexion en font partie, ils peuvent suffire à ouvrir votre compte.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 23 requests, decryption proven\n" +
        "Level 2, usage: 30 requests\n" +
        "\n" +
        "Amazon CloudFront sees in clear everything this page exchanges with the site: web addresses, pages, cookies and forms.\n" +
        "Cookies or a login token are part of it, and they can be enough to get into your account.",
    );
  });

  it("reads, for a tab through Akamai without proof", () => {
    const state = fold([
      request(SESSION_POSSIBLE, false, "akamai"),
      ...times(12, request({ level: 2 }, false, "akamai")),
    ]);
    assert.equal(show(state).icon, "orange");
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 1 requête, déchiffrement non prouvé\n" +
        "Niveau 2, usage\u00a0: 12 requêtes\n" +
        "\n" +
        "Cette page passe par Akamai, qui voit peut-être en clair tout ce qu'elle échange avec le site.\n" +
        "Des cookies ou un jeton de connexion en feraient partie, ils pourraient suffire à ouvrir votre compte.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 1 request, decryption not proven\n" +
        "Level 2, usage: 12 requests\n" +
        "\n" +
        "This page goes through Akamai, which may see in clear everything it exchanges with the site.\n" +
        "Cookies or a login token would be part of it, and they could be enough to get into your account.",
    );
  });

  it("reads, for a tab of public resources only", () => {
    const state = fold(times(8, request({ level: 2 }, true)));
    assert.equal(show(state).icon, "blue");
    assert.equal(
      text(state, fr),
      "Niveau 2, usage\u00a0: 8 requêtes\n" +
        "\n" +
        "Cloudflare sert des ressources publiques de cette page\u00a0: il sait que vous la visitez, et quand.",
    );
    assert.equal(
      text(state, en),
      "Level 2, usage: 8 requests\n" +
        "\n" +
        "Cloudflare serves public resources of this page: it knows you are visiting it, and when.",
    );
  });

  it("reads, for an anti-bot request without proof", () => {
    const state = seen(CHALLENGE, false);
    assert.equal(
      text(state, fr),
      "Niveau 4, données personnelles\u00a0: 1 requête, déchiffrement non prouvé\n" +
        "\n" +
        "Cette page passe par Cloudflare, qui voit peut-être en clair tout ce qu'elle échange avec le site.\n" +
        "Une partie de ces échanges viendrait de sa protection anti-robot.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 1 request, decryption not proven\n" +
        "\n" +
        "This page goes through Cloudflare, which may see in clear everything it exchanges with the site.\n" +
        "Part of these exchanges would come from its anti-bot protection.",
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

  it("reads, for a page whose requests the extension partly missed", () => {
    const state = markMissed(fold([request({ level: 2 }, true)]));
    assert.equal(
      text(state, fr),
      "Niveau 2, usage\u00a0: 1 requête\n" +
        "\n" +
        "Cloudflare sert des ressources publiques de cette page\u00a0: il sait que vous la visitez, et quand.\n" +
        "Vue partielle\u00a0: l'extension n'a pas vu toutes les requêtes de cette page, par exemple celles que sert un service worker, elle ne montre que ce qu'elle a vu.",
    );
    assert.equal(
      text(state, en),
      "Level 2, usage: 1 request\n" +
        "\n" +
        "Cloudflare serves public resources of this page: it knows you are visiting it, and when.\n" +
        "Partial view: the extension did not see every request of this page, such as those a service worker serves, so it shows only what it saw.",
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
        "Cloudflare voit en clair tout ce que cette page échange avec le site\u00a0: adresses, pages, cookies et formulaires.\n" +
        "Une partie de ces échanges vient de sa protection anti-robot.\n" +
        "Vue partielle\u00a0: l'extension n'a pas accès à tous les sites, elle ne montre que ce qu'elle a vu.",
    );
    assert.equal(
      text(state, en),
      "Level 4, personal data: 1 request, decryption proven\n" +
        "Level 2, usage: 1 request\n" +
        "\n" +
        "Cloudflare sees in clear everything this page exchanges with the site: web addresses, pages, cookies and forms.\n" +
        "Part of these exchanges comes from its anti-bot protection.\n" +
        "Partial view: the extension does not have access to every site, so it shows only what it saw.",
    );
  });

  it("reads, for a site out of reach", () => {
    assert.equal(
      text(NOT_OBSERVED, fr),
      "Site non observé\u00a0: l'accès à ce site a été retiré à l'extension, elle ne peut rien en dire.",
    );
  });
});

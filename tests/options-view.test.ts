// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { line } from "../src/core/display.js";
import { noteOf, rowsOf } from "../src/core/options-view.js";
import { getMessageOf, messagesOf, OPTIONS_MESSAGES } from "./messages.js";

const shown = (site: string) =>
  site === "xn--bcher-kva.de" ? "bücher.de" : `shown ${site}`;

describe("the list of the ignored sites", () => {
  it("writes each site as the header of the popup does, in the order of what is read, and names it on its button", () => {
    assert.deepEqual(
      rowsOf(["twitch.tv", "xn--bcher-kva.de", "youtube.com"], shown),
      [
        {
          site: "xn--bcher-kva.de",
          text: "bücher.de",
          remove: line("optionsRemoveSite", "bücher.de"),
        },
        {
          site: "twitch.tv",
          text: "shown twitch.tv",
          remove: line("optionsRemoveSite", "shown twitch.tv"),
        },
        {
          site: "youtube.com",
          text: "shown youtube.com",
          remove: line("optionsRemoveSite", "shown youtube.com"),
        },
      ],
    );
  });

  it("has no row when no site is ignored", () => {
    assert.deepEqual(rowsOf([], shown), []);
  });
});

describe("the line under the field", () => {
  const sites = ["twitch.tv"];

  it("says how to name a site while nothing is typed", () => {
    assert.deepEqual(noteOf("", null, sites, shown), { kind: "help" });
    assert.deepEqual(noteOf(" \t ", null, sites, shown), { kind: "help" });
  });

  it("shows the site the text gives, as the list will show it", () => {
    assert.deepEqual(
      noteOf(
        "https://www.xn--bcher-kva.de/buch?id=1",
        "xn--bcher-kva.de",
        sites,
        shown,
      ),
      { kind: "preview", site: "bücher.de" },
    );
  });

  it("refuses a text that names no site, and shows it back as it reads once trimmed", () => {
    assert.deepEqual(noteOf("  twitch tv ", null, sites, shown), {
      kind: "refused",
      line: line("optionsRefused", "twitch tv"),
    });
  });

  it("says when the site the text gives is already ignored", () => {
    assert.deepEqual(noteOf("www.twitch.tv", "twitch.tv", sites, shown), {
      kind: "already",
      line: line("optionsAlready", "shown twitch.tv"),
    });
  });
});

describe("the messages of the preferences", () => {
  const locales = ["en", "fr"].map((locale) => ({
    locale,
    messages: messagesOf(locale),
  }));
  const withSite = ["optionsRemoveSite", "optionsAlready"];
  const withText = ["optionsRefused"];

  it("exist in every locale", () => {
    for (const { locale, messages } of locales) {
      for (const name of OPTIONS_MESSAGES) {
        assert.ok(messages[name]?.message, `${locale}: ${name}`);
        assert.ok(messages[name]?.description, `${locale}: ${name}`);
      }
    }
  });

  it("put the site where a site is given, the typed text where it is given, and nothing else", () => {
    for (const { locale, messages } of locales) {
      for (const name of OPTIONS_MESSAGES) {
        const entry = messages[name];
        for (const [key, names] of [
          ["site", withSite],
          ["text", withText],
        ] as const) {
          const expected = names.includes(name);
          assert.equal(
            entry?.message.includes(`$${key.toUpperCase()}$`),
            expected,
            `${locale}: ${name}`,
          );
          assert.equal(
            entry?.placeholders?.[key]?.content,
            expected ? "$1" : undefined,
            `${locale}: ${name}`,
          );
        }
      }
    }
  });

  it("read as written", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.equal(fr("optionsIgnoredSites", []), "Sites ignorés");
    assert.equal(en("optionsIgnoredSites", []), "Ignored sites");
    assert.equal(
      fr("optionsIgnoredText", []),
      "Cloud Leak ne regarde pas les requêtes de ces sites et n'en compte aucune.",
    );
    assert.equal(fr("optionsRemove", []), "Retirer");
    assert.equal(en("optionsRemove", []), "Remove");
    assert.equal(fr("optionsRemoveSite", ["bücher.de"]), "Retirer bücher.de");
    assert.equal(en("optionsRemoveSite", ["bücher.de"]), "Remove bücher.de");
    assert.equal(
      fr("optionsEmpty", []),
      "Aucun site n'est ignoré. Ajoutez-en un ci-dessous, ou cliquez sur Ignorer dans la fenêtre de Cloud Leak.",
    );
    assert.equal(fr("optionsAddSite", []), "Ajouter un site");
    assert.equal(fr("optionsAdd", []), "Ajouter");
    assert.equal(en("optionsAdd", []), "Add");
    assert.equal(
      fr("optionsHelp", []),
      "Un domaine ou une adresse, réduit à son site (www.twitch.tv donne twitch.tv). Ses statistiques sont purgées.",
    );
    assert.equal(fr("optionsPreview", []), "Sera ajouté\u00a0:");
    assert.equal(en("optionsPreview", []), "Will be added:");
    assert.equal(
      fr("optionsRefused", ["twitch tv"]),
      "Aucun site ne correspond à «\u00a0twitch tv\u00a0». Saisissez un domaine, comme twitch.tv.",
    );
    assert.equal(
      en("optionsRefused", ["twitch tv"]),
      "No site matches “twitch tv”. Type a domain, such as twitch.tv.",
    );
    assert.equal(
      fr("optionsAlready", ["twitch.tv"]),
      "twitch.tv est déjà ignoré.",
    );
    assert.equal(
      en("optionsAlready", ["twitch.tv"]),
      "twitch.tv is already ignored.",
    );
  });

  it("name the button of the popup as the popup does", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.ok(fr("optionsEmpty", []).includes(fr("popupIgnoreSite", [])));
    assert.ok(en("optionsEmpty", []).includes(en("popupIgnoreSite", [])));
  });

  it("hold no line break", () => {
    for (const { locale, messages } of locales) {
      for (const name of OPTIONS_MESSAGES) {
        assert.doesNotMatch(
          messages[name]?.message ?? "",
          /\n/,
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("put a no-break space before a colon, a question mark or a closing guillemet, and after an opening one, in French", () => {
    const fr = messagesOf("fr");
    for (const name of OPTIONS_MESSAGES) {
      const text = fr[name]?.message ?? "";
      assert.doesNotMatch(text, /[^\u00a0][:?»]/u, name);
      assert.doesNotMatch(text, /«[^\u00a0]/u, name);
    }
  });

  it("hold neither an em dash nor a semicolon in French", () => {
    const fr = messagesOf("fr");
    for (const name of OPTIONS_MESSAGES) {
      assert.doesNotMatch(fr[name]?.message ?? "", /[\u2014;]/u, name);
    }
  });
});

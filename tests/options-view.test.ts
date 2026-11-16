// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { line } from "../src/core/display.js";
import {
  limitOf,
  noteOf,
  recordViewOf,
  rowsOf,
} from "../src/core/options-view.js";
import { getMessageOf, LOCALES, OPTIONS_MESSAGES } from "./messages.js";

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

describe("the section of the recording", () => {
  it("shows the limit while the choice records something, and asks nothing while the choice is the one kept", () => {
    assert.deepEqual(recordViewOf("none", "none"), {
      asking: false,
      limit: false,
    });
    assert.deepEqual(recordViewOf("level4", "level4"), {
      asking: false,
      limit: true,
    });
    assert.deepEqual(recordViewOf("level3and4", "level3and4"), {
      asking: false,
      limit: true,
    });
  });

  it("asks before going back to none from either level, and hides the limit while it asks", () => {
    for (const kept of ["level4", "level3and4"] as const) {
      assert.deepEqual(recordViewOf(kept, "none"), {
        asking: true,
        limit: false,
      });
    }
  });

  it("asks nothing when the choice records more, or other levels", () => {
    assert.deepEqual(recordViewOf("none", "level4"), {
      asking: false,
      limit: true,
    });
    assert.deepEqual(recordViewOf("level3and4", "level4"), {
      asking: false,
      limit: true,
    });
    assert.deepEqual(recordViewOf("level4", "level3and4"), {
      asking: false,
      limit: true,
    });
  });
});

describe("the limit typed", () => {
  it("takes an integer of at least 1, with no maximum", () => {
    for (const [typed, limit] of [
      ["1", 1],
      ["100", 100],
      ["1000", 1000],
      ["1001", 1001],
      ["250000", 250_000],
      [" 42 ", 42],
      ["007", 7],
      [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ] as const) {
      assert.equal(limitOf(typed), limit, typed);
    }
  });

  it("refuses an empty field, 0, a negative number, a fraction, a number beyond the integers a number holds exactly, and what is no number", () => {
    for (const typed of [
      "",
      "   ",
      "0",
      "00",
      "-5",
      "2.5",
      "1,5",
      "1e3",
      "+12",
      "12 000",
      "9007199254740993",
      "abc",
      "Infinity",
    ]) {
      assert.equal(limitOf(typed), null, typed);
    }
  });
});

describe("the messages of the preferences", () => {
  const withSite = ["optionsRemoveSite", "optionsAlready"];
  const withText = ["optionsRefused"];

  it("put the site where a site is given, the typed text where it is given, and nothing else", () => {
    for (const { locale, messages } of LOCALES) {
      for (const name of OPTIONS_MESSAGES) {
        for (const [key, names] of [
          ["site", withSite],
          ["text", withText],
        ] as const) {
          assert.equal(
            messages[name]?.placeholders?.[key]?.content,
            names.includes(name) ? "$1" : undefined,
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

  it("read as written, for the recording of addresses", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    const read: [string, string, string][] = [
      ["optionsRecord", "Enregistrer les adresses", "Record addresses"],
      [
        "optionsRecordText",
        "Les adresses des requêtes des niveaux choisis sont gardées sur cet ordinateur, sans les valeurs de leurs paramètres, et peuvent révéler ce que vous avez fait sur un site\u00a0: dans le doute, laissez sur «\u00a0Aucune\u00a0».",
        "The addresses of the requests of the chosen levels are kept on this computer, without the values of their parameters, and can reveal what you did on a site: when in doubt, leave it on “None”.",
      ],
      ["optionsRecordNone", "Aucune", "None"],
      [
        "optionsRecordLevel4",
        "Niveau 4 seulement, données personnelles",
        "Level 4 only, personal data",
      ],
      [
        "optionsRecordLevel3and4",
        "Niveaux 3 et 4, lecture et données personnelles",
        "Levels 3 and 4, reading and personal data",
      ],
      [
        "optionsRecordPrivate",
        "Rien n'est enregistré en fenêtre privée.",
        "Nothing is recorded in a private window.",
      ],
      [
        "optionsRecordQuestion",
        "Purger les adresses gardées\u00a0?",
        "Clear the kept addresses?",
      ],
      ["optionsPurge", "Purger", "Clear"],
      ["optionsCancel", "Annuler", "Cancel"],
      [
        "optionsRecordPurged",
        "Les adresses gardées sont purgées.",
        "The kept addresses are cleared.",
      ],
      ["optionsLimit", "Limite par ligne", "Limit per row"],
      [
        "optionsLimitHelp",
        "Le nombre d'adresses à conserver pour chaque site, par type de requête et par méthode rencontrée.",
        "The number of addresses to keep for each site, by request type and by method seen.",
      ],
      [
        "optionsLimitError",
        "Saisissez un nombre entier d'au moins 1.",
        "Type a whole number of at least 1.",
      ],
    ];
    for (const [name, french, english] of read) {
      assert.equal(fr(name, []), french, name);
      assert.equal(en(name, []), english, name);
    }
  });

  it("name the choice of none in the text that advises it, and clear as the popup and the map do", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    for (const message of [fr, en]) {
      assert.ok(
        message("optionsRecordText", []).includes(
          message("optionsRecordNone", []),
        ),
      );
      assert.equal(message("optionsPurge", []), message("mapPurge", []));
      assert.equal(message("optionsCancel", []), message("mapCancel", []));
    }
  });

  it("name the button of the popup as the popup does", () => {
    const fr = getMessageOf("fr");
    const en = getMessageOf("en");
    assert.ok(fr("optionsEmpty", []).includes(fr("popupIgnoreSite", [])));
    assert.ok(en("optionsEmpty", []).includes(en("popupIgnoreSite", [])));
  });
});

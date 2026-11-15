// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The view of the map, on the sets of sites of the validated mock-up: what
// the mock-up says its own code shows of them is what is expected here, in
// the French texts it validated.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTable } from "../scripts/providers.js";
import {
  type Column,
  columnOf,
  type Filters,
  flagOf,
  formatsOf,
  type GroupRow,
  headerOf,
  heightOf,
  highlightOf,
  type LimitRow,
  type MapFormats,
  NO_FILTER,
  type Panel,
  type PreparedMap,
  panelOf,
  placesOf,
  prepare,
  type SiteRecord,
  type SiteRow,
  selectionOf,
  toggled,
  toolsOf,
  withoutLimit,
} from "../src/core/map-view.js";
import type { MapData, SiteCounts } from "../src/core/popup-message.js";
import { htmlOf } from "./dom.js";
import {
  COMMON_START,
  day,
  largeSample,
  PROVIDERS,
  privateSample,
  smallSample,
} from "./map-sample.js";
import { getMessageOf, MAP_MESSAGES, messagesOf } from "./messages.js";

// Every message the view asks for, to check that each is known.
const asked = new Set<string>();
const french = getMessageOf("fr");
const FR: MapFormats = formatsOf(
  "fr",
  (name, substitutions) => {
    asked.add(name);
    return french(name, substitutions);
  },
  (site) => (site === "xn--bcher-kva.example" ? "bücher.example" : site),
);

const LARGE = prepare(largeSample(), PROVIDERS, FR);
const SMALL = prepare(smallSample(), PROVIDERS, FR);
const PRIVATE = prepare(privateSample(), PROVIDERS, FR);

const FIXED = {
  sitesHeading: "Sites, du plus grave au moins grave",
  unit: "requêtes",
  providersHeading: "Fournisseurs",
  search: "Chercher un site",
};

function filters(changes: Partial<Filters>): Filters {
  return { ...NO_FILTER, ...changes };
}

function counts(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function siteRows(column: Column): SiteRow[] {
  return column.rows.filter((row): row is SiteRow => row.kind === "site");
}

function groupRows(column: Column): GroupRow[] {
  return column.rows.filter((row): row is GroupRow => row.kind === "group");
}

function headings(column: Column): string[] {
  return column.rows.flatMap((row) =>
    row.kind === "heading" ? [row.text] : [],
  );
}

function overview(map: PreparedMap, column: Column, chosen: Filters) {
  const panel = panelOf(map, column, chosen, null);
  assert.equal(panel.kind, "overview");
  return panel;
}

// The rows of a list of the overview, by value.
function rowsOf(
  panel: Extract<Panel, { kind: "overview" }>,
  index: number,
): Record<string, LimitRow> {
  return Object.fromEntries(
    (panel.sections[index]?.rows ?? []).map((row) => [row.value, row]),
  );
}

function blueSite(provider: string, count: number): SiteCounts {
  return { [provider]: { blue2: { "GET script": count } } };
}

function data(
  sites: Record<string, SiteCounts>,
  changes: Partial<MapData> = {},
): MapData {
  return {
    privateWindow: false,
    since: COMMON_START,
    siteSince: {},
    sites,
    ...changes,
  };
}

describe("the flag of a provider", () => {
  it("is the pair of regional indicator symbols of its country code", () => {
    assert.equal(flagOf("US"), "\u{1f1fa}\u{1f1f8}");
    assert.equal(flagOf("FR"), "\u{1f1eb}\u{1f1f7}");
    assert.equal(flagOf("IL"), "\u{1f1ee}\u{1f1f1}");
  });

  it("is nothing for a code that is not two capitals", () => {
    for (const code of ["", "U", "us", "USA", "U1", "ÉT"]) {
      assert.equal(flagOf(code), "", code);
    }
  });

  it("is the one of each provider, beside its name", () => {
    const label = placesOf(SMALL, SMALL.whole, 700).providers.find(
      (entry) => entry.provider.id === "radware",
    );
    assert.equal(label?.name, "\u{1f1ee}\u{1f1f1} Radware");
  });
});

describe("the column of the map", () => {
  it("ranks the sites from the most serious to the least, under a heading for the category of their most serious request", () => {
    const column = SMALL.whole;
    assert.deepEqual(headings(column), [
      "Niveau 4, déchiffrement prouvé",
      "Niveau 3, déchiffrement prouvé",
      "Niveau 4, déchiffrement non prouvé",
      "Niveau 2",
    ]);
    assert.deepEqual(
      column.rows.map((row) =>
        row.kind === "site" ? row.site.site : row.kind,
      ),
      [
        "heading",
        "legifrance.gouv.fr",
        "ameli.fr",
        "leboncoin.fr",
        "interieur.gouv.fr",
        "service-public.gouv.fr",
        "inpi.fr",
        "franceconnect.gouv.fr",
        "heading",
        "impots.gouv.fr",
        "heading",
        "caf.fr",
        "heading",
        "chorus-pro.gouv.fr",
      ],
    );
    assert.deepEqual(
      column.rows.map((row) => row.slot),
      column.rows.map((_, index) => index),
    );
    assert.equal(heightOf(column), 32 + 14 * 24 + 12);
  });

  it("counts a site in its total requests, all providers together", () => {
    const legifrance = siteRows(SMALL.whole)[0];
    assert.equal(legifrance?.site.total, 1511);
    assert.equal(
      legifrance?.site.title,
      "legifrance.gouv.fr : 1 511 requêtes, la plus grave au niveau 4, données personnelles, déchiffrement prouvé",
    );
  });

  it("links a site to each provider once, at the most serious category of the pair", () => {
    const impots = siteRows(SMALL.whole).find(
      (row) => row.site.site === "impots.gouv.fr",
    );
    assert.deepEqual(
      impots?.links.map((link) => [link.provider, link.worst, link.total]),
      [
        ["akamai", "red3", 141],
        ["radware", "orange4", 18],
      ],
    );
    assert.equal(
      impots?.links[1]?.title,
      "impots.gouv.fr par Radware : 18 requêtes, au plus niveau 4, données personnelles, déchiffrement non prouvé",
    );
  });

  it("draws the most serious links last, on top of the others", () => {
    const ranks = LARGE.whole.links.map((link) =>
      ["blue2", "orange3", "orange4", "red3", "red4"].indexOf(link.category),
    );
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
    );
    assert.equal(LARGE.whole.links.at(-1)?.category, "red4");
  });

  it("counts what the mock-up counts on its 900 sites", () => {
    const column = LARGE.whole;
    assert.equal(column.sites, 900);
    assert.equal(column.requests, 54727);
    assert.equal(column.filtered, false);
    assert.deepEqual(counts(column.byCategory), {
      red4: 59,
      red3: 26,
      orange4: 32,
      orange3: 17,
      blue2: 787,
    });
    assert.deepEqual(counts(column.byCountry), { US: 851, FR: 37, IL: 18 });
    assert.deepEqual(counts(column.byProvider), {
      cloudflare: 511,
      fastly: 190,
      cloudfront: 177,
      akamai: 125,
      imperva: 37,
      "ovhcloud-cdn": 37,
      radware: 18,
    });
    assert.equal(column.rows.length, 161);
    assert.equal(heightOf(column), 3908);
  });

  it("gathers the blue sites through the same providers into one row past three", () => {
    const groups = groupRows(LARGE.whole);
    assert.deepEqual(
      groups.map((row) => `${row.sites.length} ${row.key}`),
      [
        "334 g:cloudflare",
        "100 g:cloudfront",
        "78 g:fastly",
        "74 g:akamai",
        "54 g:cloudflare+fastly",
        "31 g:cloudflare+cloudfront",
        "16 g:ovhcloud-cdn",
        "16 g:akamai+cloudflare",
        "13 g:cloudfront+fastly",
        "12 g:imperva",
        "10 g:akamai+cloudflare+fastly",
        "10 g:cloudflare+cloudfront+fastly",
        "6 g:akamai+fastly",
        "4 g:radware",
      ],
    );
    const [cloudflare] = groups;
    assert.equal(
      `${cloudflare?.label}${cloudflare?.suffix}`,
      "334 sites, niveau 2",
    );
    assert.equal(cloudflare?.title, "334 sites tout bleus, par Cloudflare");
    assert.deepEqual(cloudflare?.providers, ["cloudflare"]);
    // Three blue sites or fewer through the same providers keep a row each.
    const alone = siteRows(LARGE.whole).filter(
      (row) => row.site.worst === "blue2",
    );
    assert.ok(alone.length > 0);
    for (const row of alone) {
      const same = alone.filter(
        (other) => other.site.together === row.site.together,
      );
      assert.ok(same.length <= 3, row.site.together);
    }
  });

  it("gives a site of a group the row of its group", () => {
    const [cloudflare] = groupRows(LARGE.whole);
    const site = cloudflare?.sites[0]?.site ?? "";
    assert.equal(LARGE.whole.rowOf.get(site), "g:cloudflare");
  });
});

describe("the search", () => {
  it("keeps the sites whose name holds the text, whatever its case, and says where", () => {
    const column = columnOf(LARGE, filters({ text: " LAC " }));
    assert.equal(column.sites, 17);
    assert.equal(column.filtered, true);
    for (const row of siteRows(column)) {
      assert.ok(row.site.name.includes("lac"), row.site.name);
      const start = row.site.name.indexOf("lac");
      assert.deepEqual(row.match, { start, end: start + 3 });
    }
    assert.equal(
      toolsOf(LARGE, column, filters({ text: "lac" })).shown,
      "17 sites sur 900",
    );
  });

  it("keeps the accents, and reads the name as Firefox shows it, never in punycode", () => {
    const map = prepare(
      data({
        "xn--bcher-kva.example": blueSite("cloudflare", 3),
        "cafe.example": blueSite("cloudflare", 2),
      }),
      PROVIDERS,
      FR,
    );
    const shown = (text: string) =>
      siteRows(columnOf(map, filters({ text }))).map((row) => row.site.name);
    assert.deepEqual(shown("bü"), ["bücher.example"]);
    assert.deepEqual(shown("BÜCHER"), ["bücher.example"]);
    assert.deepEqual(shown("xn--"), []);
    assert.deepEqual(shown("café"), []);
    assert.deepEqual(shown("cafe"), ["cafe.example"]);
  });

  it("recounts a row of gathered sites on those it keeps, and opens it into its sites at three or fewer", () => {
    const sites: Record<string, SiteCounts> = {};
    for (const name of ["x1", "x2", "x3", "x4", "y12", "y13", "z99"]) {
      sites[`${name}.test`] = blueSite("cloudflare", 10);
    }
    const map = prepare(data(sites), PROVIDERS, FR);
    const [whole] = groupRows(map.whole);
    assert.equal(`${whole?.label}${whole?.suffix}`, "7 sites, niveau 2");
    const four = filters({ text: "x" });
    const column = columnOf(map, four);
    const [group] = groupRows(column);
    assert.equal(`${group?.label}${group?.suffix}`, "4 sites sur 7, niveau 2");
    assert.equal(group?.title, "4 sites sur 7 tout bleus, par Cloudflare");
    assert.equal(
      placesOf(map, column, 700).providers[0]?.sites,
      "4 sites sur 7",
    );
    const panel = panelOf(map, column, four, "g:cloudflare");
    assert.equal(panel.kind === "group" && panel.name, "4 sites sur 7");
    const three = columnOf(map, filters({ text: "1" }));
    assert.deepEqual(groupRows(three), []);
    assert.deepEqual(
      siteRows(three).map((row) => row.site.site),
      ["x1.test", "y12.test", "y13.test"],
    );
    assert.deepEqual(headings(three), ["Niveau 2"]);
  });

  it("says when it keeps no site", () => {
    const column = columnOf(LARGE, filters({ text: "zzz" }));
    assert.deepEqual(column.rows, []);
    assert.equal(column.sites, 0);
    assert.equal(
      overview(LARGE, column, filters({ text: "zzz" })).line,
      "0 site sur 900, 0 fournisseur, 0 requête.",
    );
  });
});

describe("the limits", () => {
  it("keep the links to the provider, and the sites that keep one, ranked as before", () => {
    const chosen = filters({ provider: "fastly" });
    const column = columnOf(LARGE, chosen);
    assert.equal(column.sites, 190);
    assert.equal(column.requests, 7497);
    assert.deepEqual(counts(column.byProvider), { fastly: 190 });
    for (const link of column.links) {
      assert.equal(link.provider, "fastly");
    }
    // A site red through another provider stays with the red ones, and its
    // link to Fastly keeps its own category.
    const red = siteRows(column).filter((row) =>
      row.site.worst.startsWith("red"),
    );
    assert.ok(
      red.some((row) => row.links.every((link) => link.worst === "blue2")),
    );
  });

  it("keep, under a category, the sites with a link of that category, a red site included by its blue link", () => {
    const column = columnOf(LARGE, filters({ category: "blue2" }));
    assert.equal(column.sites, 787);
    assert.equal(
      siteRows(column).filter((row) => row.site.worst !== "blue2").length,
      20,
    );
    for (const link of column.links) {
      assert.equal(link.category, "blue2");
    }
    const impots = (category: "red3" | "orange4") =>
      siteRows(columnOf(SMALL, filters({ category }))).find(
        (row) => row.site.site === "impots.gouv.fr",
      );
    assert.deepEqual(
      impots("red3")?.links.map((link) => link.provider),
      ["akamai"],
    );
    assert.deepEqual(
      impots("orange4")?.links.map((link) => link.provider),
      ["radware"],
    );
    assert.equal(impots("orange4")?.site.worst, "red3");
  });

  it("apply the category to the links the country keeps", () => {
    const column = columnOf(
      LARGE,
      filters({ country: "FR", category: "red4" }),
    );
    assert.equal(column.sites, 12);
    assert.deepEqual(counts(column.byProvider), { "ovhcloud-cdn": 12 });
  });

  it("combine with each other and with the search", () => {
    const chosen = filters({
      provider: "cloudflare",
      category: "red4",
      text: "fr",
    });
    const column = columnOf(LARGE, chosen);
    assert.equal(column.sites, 13);
    assert.deepEqual(counts(column.byCategory), { red4: 13 });
    for (const row of siteRows(column)) {
      assert.ok(row.site.name.includes("fr"));
      assert.deepEqual(
        row.links.map((link) => [link.provider, link.worst]),
        [["cloudflare", "red4"]],
      );
    }
    const tools = toolsOf(LARGE, column, chosen);
    assert.deepEqual(
      tools.chips.map((chip) => [chip.list, chip.label, chip.remove]),
      [
        ["provider", "Cloudflare", "Retirer la limite Cloudflare"],
        ["category", "Niveau 4, prouvé", "Retirer la limite Niveau 4, prouvé"],
      ],
    );
    assert.equal(tools.shown, "13 sites sur 900");
    const panel = overview(LARGE, column, chosen);
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(rowsOf(panel, 0)).map(([key, row]) => [key, row.count]),
      ),
      { red4: "13", red3: "9", orange4: "4", orange3: "3", blue2: "241" },
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(rowsOf(panel, 2)).map(([key, row]) => [key, row.count]),
      ),
      {
        cloudflare: "13",
        fastly: "3",
        cloudfront: "5",
        akamai: "4",
        imperva: "8",
        "ovhcloud-cdn": "12",
        radware: "0",
      },
    );
  });

  it("show as chips, the country by its name and flag", () => {
    const chosen = filters({ country: "IL" });
    const [chip] = toolsOf(LARGE, columnOf(LARGE, chosen), chosen).chips;
    assert.deepEqual(chip, {
      list: "country",
      icon: { kind: "flag", flag: "\u{1f1ee}\u{1f1f1}", title: null },
      label: "Israël",
      remove: "Retirer la limite Israël",
    });
    assert.deepEqual(toolsOf(LARGE, LARGE.whole, NO_FILTER), {
      chips: [],
      shown: null,
    });
  });

  it("are one per list: another row of the list replaces the limit, the same row removes it", () => {
    const fastly = toggled(NO_FILTER, "provider", "fastly");
    assert.equal(fastly.provider, "fastly");
    const cloudflare = toggled(fastly, "provider", "cloudflare");
    assert.equal(cloudflare.provider, "cloudflare");
    const both = toggled(cloudflare, "category", "red4");
    assert.deepEqual(both, {
      ...NO_FILTER,
      provider: "cloudflare",
      category: "red4",
    });
    assert.deepEqual(toggled(both, "provider", "cloudflare"), {
      ...NO_FILTER,
      category: "red4",
    });
    assert.equal(toggled(NO_FILTER, "category", "purple9").category, null);
    assert.deepEqual(withoutLimit(both, "category"), cloudflare);
  });
});

describe("the overview", () => {
  it("counts the whole without filter, under its title", () => {
    const panel = overview(LARGE, LARGE.whole, NO_FILTER);
    assert.equal(panel.heading.title, "Ensemble");
    assert.equal(panel.line, "900 sites, 7 fournisseurs, 54 727 requêtes.");
    assert.deepEqual(panel.notes, [
      "Un clic sur un site, un fournisseur ou un lien en donne le détail.",
      "Un clic sur une ligne ci-dessous limite la carte à ses sites, un second clic retire la limite.",
    ]);
    assert.deepEqual(
      panel.sections.map((section) => [
        section.heading.title,
        section.heading.unit,
        section.note,
      ]),
      [
        [
          "Selon les liens",
          "sites",
          "Un site compte dans la catégorie de chacun de ses liens, la somme dépasse donc le nombre de sites.",
        ],
        [
          "Par pays du droit",
          "sites",
          "Un site compte dans le pays de chacun de ses fournisseurs.",
        ],
        ["Par fournisseur", "sites", null],
      ],
    );
    assert.deepEqual(
      panel.sections[0]?.rows.map((row) => [
        row.label,
        row.proof,
        row.count,
        row.icon,
      ]),
      [
        [
          "Niveau 4, données personnelles",
          "déchiffrement prouvé",
          "59",
          { kind: "cloud", colour: "red" },
        ],
        [
          "Niveau 3, lecture",
          "déchiffrement prouvé",
          "26",
          { kind: "cloud", colour: "red" },
        ],
        [
          "Niveau 4, données personnelles",
          "déchiffrement non prouvé",
          "32",
          { kind: "cloud", colour: "orange" },
        ],
        [
          "Niveau 3, lecture",
          "déchiffrement non prouvé",
          "17",
          { kind: "cloud", colour: "orange" },
        ],
        ["Niveau 2, usage", null, "787", { kind: "cloud", colour: "blue" }],
      ],
    );
    assert.deepEqual(
      panel.sections[1]?.rows.map((row) => [row.label, row.count]),
      [
        ["États-Unis", "851"],
        ["France", "37"],
        ["Israël", "18"],
      ],
    );
    assert.deepEqual(
      panel.sections[2]?.rows.map((row) => [row.label, row.bold, row.count]),
      [
        ["Cloudflare", true, "511"],
        ["Fastly", true, "190"],
        ["Amazon CloudFront", true, "177"],
        ["Akamai", true, "125"],
        ["Imperva", true, "37"],
        ["OVHcloud CDN", true, "37"],
        ["Radware", true, "18"],
      ],
    );
    const imperva = rowsOf(panel, 2)["imperva"];
    assert.deepEqual(imperva?.icon, {
      kind: "flag",
      flag: "\u{1f1fa}\u{1f1f8}",
      title:
        "Imperva, soumis au droit des États-Unis, maison mère Thales, en France",
    });
    for (const section of panel.sections) {
      for (const row of section.rows) {
        assert.deepEqual(
          [row.zero, row.pressed, row.disabled],
          [false, false, false],
        );
      }
    }
  });

  it("counts under a limit what a click on each row would keep, the limit of its own list set aside", () => {
    const chosen = filters({ provider: "fastly" });
    const panel = overview(LARGE, columnOf(LARGE, chosen), chosen);
    assert.equal(panel.heading.title, "Sites affichés");
    assert.equal(
      panel.line,
      "190 sites sur 900, 1 fournisseur, 7 497 requêtes.",
    );
    const providers = rowsOf(panel, 2);
    assert.equal(providers["cloudflare"]?.count, "511");
    assert.equal(providers["fastly"]?.count, "190");
    assert.equal(providers["fastly"]?.pressed, true);
    assert.equal(providers["cloudflare"]?.pressed, false);
    const countries = rowsOf(panel, 1);
    assert.equal(countries["US"]?.count, "190");
    for (const country of ["FR", "IL"]) {
      assert.deepEqual(
        [
          countries[country]?.count,
          countries[country]?.zero,
          countries[country]?.disabled,
        ],
        ["0", true, true],
        country,
      );
    }
    const categories = rowsOf(panel, 0);
    assert.deepEqual(
      [
        categories["orange3"]?.count,
        categories["orange3"]?.zero,
        categories["orange3"]?.disabled,
      ],
      ["0", true, true],
    );
    assert.deepEqual(
      panel.sections.map((section) => section.rows.map((row) => row.value)),
      overview(LARGE, LARGE.whole, NO_FILTER).sections.map((section) =>
        section.rows.map((row) => row.value),
      ),
    );
  });

  it("keeps the active row clickable at zero, so that its limit can be removed", () => {
    const chosen = filters({ provider: "fastly", country: "FR" });
    const column = columnOf(LARGE, chosen);
    assert.equal(column.sites, 0);
    const france = rowsOf(overview(LARGE, column, chosen), 1)["FR"];
    assert.deepEqual(
      [france?.count, france?.zero, france?.pressed, france?.disabled],
      ["0", true, true, false],
    );
  });
});

describe("the providers of the map", () => {
  it("keep the place they have without filter, and under a filter close up from the top, without those left without a link", () => {
    const places = placesOf(LARGE, LARGE.whole, 690);
    assert.deepEqual(
      places.providers.map((label) => label.provider.id),
      LARGE.order,
    );
    const step = Math.max(48, (690 - 10 - 44) / 7);
    assert.deepEqual(
      places.providers.map((label) => label.y),
      LARGE.order.map((_, index) => 44 + step * (index + 0.5)),
    );
    assert.equal(places.providers[0]?.sites.endsWith(" sites"), true);
    const fastly = columnOf(LARGE, filters({ provider: "fastly" }));
    const limited = placesOf(LARGE, fastly, 690);
    assert.deepEqual(
      limited.providers.map((label) => [
        label.provider.id,
        label.y,
        label.sites,
      ]),
      [["fastly", 44 + step * 0.5, "190 sites"]],
    );
  });

  it("name the law each is subject to, and the parent company under another law", () => {
    assert.equal(
      SMALL.provider.get("cloudflare")?.title,
      "Cloudflare, soumis au droit des États-Unis",
    );
    assert.equal(
      SMALL.provider.get("ovhcloud-cdn")?.title,
      "OVHcloud CDN, soumis au droit de la France",
    );
    assert.equal(
      SMALL.provider.get("radware")?.title,
      "Radware, soumis au droit d'Israël",
    );
    assert.equal(
      SMALL.provider.get("imperva")?.title,
      "Imperva, soumis au droit des États-Unis, maison mère Thales, en France",
    );
  });

  it("name a provider this version no longer knows by its id, without a flag", () => {
    const map = prepare(
      data({ "a.example": blueSite("gone", 2) }),
      PROVIDERS,
      FR,
    );
    const gone = map.provider.get("gone");
    assert.deepEqual(
      [gone?.name, gone?.flag, gone?.country, gone?.title],
      ["gone", "", "", "gone"],
    );
    assert.equal(placesOf(map, map.whole, 600).providers[0]?.name, "gone");
    assert.deepEqual(overview(map, map.whole, NO_FILTER).sections[1]?.rows, []);
  });
});

describe("the panel of a site", () => {
  it("gives its requests by provider, category, method and type, with its own date when it has one", () => {
    const panel = panelOf(SMALL, SMALL.whole, NO_FILTER, "s:ameli.fr");
    assert.equal(panel.kind, "site");
    if (panel.kind !== "site") {
      return;
    }
    assert.deepEqual(panel.icon, { kind: "cloud", colour: "red" });
    assert.equal(panel.name, "ameli.fr");
    assert.deepEqual(panel.heading, {
      title: "Ce site depuis le 10 novembre 2026",
      unit: "requêtes",
    });
    assert.equal(panel.note, "Purgé seul, ce site a sa propre date.");
    const [cloudflare] = panel.providers;
    assert.deepEqual(
      [
        cloudflare?.choice.key,
        cloudflare?.choice.label,
        cloudflare?.choice.count,
        cloudflare?.choice.title,
      ],
      [
        "f:cloudflare",
        "Cloudflare",
        "513",
        "Cloudflare, soumis au droit des États-Unis",
      ],
    );
    assert.deepEqual(
      cloudflare?.lines.map((line) => [
        line.colour,
        line.label,
        line.proof,
        line.count,
      ]),
      [
        [
          "red",
          "Niveau 4, données personnelles",
          "déchiffrement prouvé",
          "203",
        ],
        ["blue", "Niveau 2, usage", null, "310"],
      ],
    );
    assert.deepEqual(
      cloudflare?.lines[0]?.details.map(
        (detail) => `${detail.kind} ${detail.count}`,
      ),
      [
        "GET script 58",
        "GET image 49",
        "GET XHR 44",
        "GET style 19",
        "POST XHR 12",
        "GET police 12",
        "GET document 9",
      ],
    );
  });

  it("dates a site never cleared from the common start, and a blue one by its point", () => {
    const panel = panelOf(
      SMALL,
      SMALL.whole,
      NO_FILTER,
      "s:chorus-pro.gouv.fr",
    );
    assert.equal(
      panel.kind === "site" && panel.heading.title,
      "Depuis le 7 novembre 2026",
    );
    assert.equal(panel.kind === "site" && panel.note, null);
    assert.deepEqual(panel.kind === "site" && panel.icon, { kind: "point" });
  });

  it("names a request type it has no name for as Firefox does", () => {
    const map = prepare(
      data({
        "a.example": {
          cloudflare: { blue2: { "GET beacon": 2, "GET websocket": 1 } },
        },
      }),
      PROVIDERS,
      FR,
    );
    const panel = panelOf(map, map.whole, NO_FILTER, "s:a.example");
    assert.deepEqual(
      panel.kind === "site" &&
        panel.providers[0]?.lines[0]?.details.map((detail) => detail.kind),
      ["GET beacon", "GET WebSocket"],
    );
  });

  it("is opened from its link, and from its row in the panel of its provider", () => {
    assert.equal(selectionOf("l:impots.gouv.fr|radware"), "s:impots.gouv.fr");
    assert.equal(selectionOf("l:[2001:db8::1]|edge"), "s:[2001:db8::1]");
    assert.equal(
      selectionOf("lg:cloudflare+fastly|fastly"),
      "g:cloudflare+fastly",
    );
    assert.equal(selectionOf("f:fastly"), "f:fastly");
    assert.equal(selectionOf("s:inpi.fr"), "s:inpi.fr");
  });
});

describe("the addresses of a row of the panel of a site", () => {
  // vm.home.arpa of the mock-up: of Cloudflare, "GET style" of level 4 has
  // seven addresses kept, and no row of level 2 has any.
  const STYLES = [
    "https://vm-tunnel.example.net/ui/css/dashboard.css?build=…",
    "https://cdn.example.net/assets/print.css?v=…",
    "https://static.example.com/build/2026-11-04/assets/vendor/codemirror/addon/fold/foldgutter.min.css?v=…&lang=…&token=…&session=…",
    "https://cdn.example.net/assets/app.css?v=…&token=…",
    "https://cdn.example.net/fonts/inter/inter.css",
    "https://static.example.com/widgets/calendar/v3/calendar.min.css?locale=…&tz=…",
    "https://cdn.example.net/assets/theme/dark.css?v=…&token=…",
  ];
  const VM = data({
    "vm.home.arpa": {
      cloudflare: {
        red4: { "GET stylesheet": 7, "GET script": 2 },
        blue2: { "GET font": 3, "GET image": 3, "GET stylesheet": 2 },
      },
      fastly: { blue2: { "GET image": 28 } },
    },
  });
  const KEPT: SiteRecord = {
    site: "vm.home.arpa",
    addresses: { cloudflare: { red4: { "GET stylesheet": STYLES } } },
    limit: 100,
  };
  const ROW = "cloudflare|red4|GET stylesheet";

  function sitePanel(
    prepared: PreparedMap,
    record: SiteRecord | null,
    unfolded: ReadonlySet<string> = new Set(),
  ) {
    const panel = panelOf(
      prepared,
      prepared.whole,
      NO_FILTER,
      "s:vm.home.arpa",
      record,
      unfolded,
    );
    assert.equal(panel.kind, "site");
    return panel as Extract<Panel, { kind: "site" }>;
  }

  // Each row of the panel, with whether it unfolds.
  function rows(panel: Extract<Panel, { kind: "site" }>): string[] {
    return panel.providers.flatMap((provider) =>
      provider.lines.flatMap((line) =>
        line.details.map(
          (detail) =>
            `${line.colour} ${detail.kind} ${detail.count}${detail.addresses === null ? "" : " ▸"}`,
        ),
      ),
    );
  }

  function row(panel: Extract<Panel, { kind: "site" }>, key = ROW) {
    return panel.providers
      .flatMap((provider) => provider.lines)
      .flatMap((line) => line.details)
      .find((detail) => detail.addresses?.key === key)?.addresses;
  }

  it("unfolds only the rows that have addresses kept, and leaves the others as they are", () => {
    const map = prepare(VM, PROVIDERS, FR);
    assert.deepEqual(rows(sitePanel(map, KEPT)), [
      "red GET style 7 ▸",
      "red GET script 2",
      "blue GET police 3",
      "blue GET image 3",
      "blue GET style 2",
      "blue GET image 28",
    ]);
  });

  it("unfolds nothing before the event page gives the addresses, nor with the addresses of another site", () => {
    const map = prepare(VM, PROVIDERS, FR);
    for (const record of [null, { ...KEPT, site: "other.example" }]) {
      assert.ok(
        rows(sitePanel(map, record)).every((text) => !text.endsWith("▸")),
      );
    }
  });

  it("unfolds nothing in a private window, whatever it is given", () => {
    const map = prepare(
      { ...VM, privateWindow: true, since: 0 },
      PROVIDERS,
      FR,
    );
    assert.ok(rows(sitePanel(map, KEPT)).every((text) => !text.endsWith("▸")));
  });

  it("unfolds nothing for a row whose list is empty, or a row the counts do not have", () => {
    const map = prepare(VM, PROVIDERS, FR);
    const panel = sitePanel(map, {
      ...KEPT,
      addresses: {
        cloudflare: {
          red4: { "GET stylesheet": [], "POST xmlhttprequest": ["https://a/"] },
        },
        akamai: { red4: { "GET image": ["https://b/"] } },
      },
    });
    assert.ok(rows(panel).every((text) => !text.endsWith("▸")));
  });

  it("is folded until the row is named unfolded, and folds again once it is not", () => {
    const map = prepare(VM, PROVIDERS, FR);
    assert.equal(row(sitePanel(map, KEPT))?.open, false);
    assert.equal(row(sitePanel(map, KEPT, new Set([ROW])))?.open, true);
    assert.equal(
      row(sitePanel(map, KEPT, new Set(["cloudflare|blue2|GET stylesheet"])))
        ?.open,
      false,
    );
  });

  it("lists the addresses in alphabetical order, whole, the scheme included", () => {
    const map = prepare(VM, PROVIDERS, FR);
    assert.deepEqual(row(sitePanel(map, KEPT))?.addresses, [
      "https://cdn.example.net/assets/app.css?v=…&token=…",
      "https://cdn.example.net/assets/print.css?v=…",
      "https://cdn.example.net/assets/theme/dark.css?v=…&token=…",
      "https://cdn.example.net/fonts/inter/inter.css",
      "https://static.example.com/build/2026-11-04/assets/vendor/codemirror/addon/fold/foldgutter.min.css?v=…&lang=…&token=…&session=…",
      "https://static.example.com/widgets/calendar/v3/calendar.min.css?locale=…&tz=…",
      "https://vm-tunnel.example.net/ui/css/dashboard.css?build=…",
    ]);
    // The list the event page gave is left as it came.
    assert.equal(
      STYLES[0],
      "https://vm-tunnel.example.net/ui/css/dashboard.css?build=…",
    );
  });

  it("counts them under the list as the mock-up writes it, and names the limit once it is reached", () => {
    const map = prepare(VM, PROVIDERS, FR);
    const note = (kept: readonly string[], limit: number) =>
      row(
        sitePanel(map, {
          ...KEPT,
          addresses: { cloudflare: { red4: { "GET stylesheet": kept } } },
          limit,
        }),
      )?.note;
    assert.equal(
      note(STYLES, 100),
      "7 adresses gardées. Un clic en copie une.",
    );
    assert.equal(
      note(STYLES.slice(0, 1), 100),
      "1 adresse gardée. Un clic la copie.",
    );
    assert.equal(
      note(STYLES, 7),
      "7 adresses gardées, la limite réglée dans les préférences. Un clic en copie une.",
    );
    assert.equal(
      note(STYLES.slice(0, 1), 1),
      "1 adresse gardée, la limite réglée dans les préférences. Un clic la copie.",
    );
    const thousand = Array.from(
      { length: 1000 },
      (_, index) => `https://api.example.com/v2/listings/${index}/views`,
    );
    assert.equal(
      note(thousand, 1000),
      "1\u202f000 adresses gardées, la limite réglée dans les préférences. Un clic en copie une.",
    );
  });

  it("says what a click on an address does", () => {
    const map = prepare(VM, PROVIDERS, FR);
    assert.deepEqual(sitePanel(map, KEPT).copy, {
      copied: "Copiée",
      failed: "Copie impossible",
      announced: "Adresse copiée",
    });
  });
});

describe("the panel of a provider", () => {
  it("names its law, its parent company, and lists its sites from the most serious link", () => {
    const panel = panelOf(SMALL, SMALL.whole, NO_FILTER, "f:imperva");
    assert.equal(panel.kind, "provider");
    if (panel.kind !== "provider") {
      return;
    }
    assert.equal(panel.flag, "\u{1f1fa}\u{1f1f8}");
    assert.equal(panel.name, "Imperva");
    assert.deepEqual(panel.texts, [
      "Soumis au droit : États-Unis \u{1f1fa}\u{1f1f8}",
      "Maison mère : Thales, France \u{1f1eb}\u{1f1f7}",
    ]);
    assert.equal(panel.note, "Statistiques depuis le 7 novembre 2026.");
    assert.deepEqual(panel.worst.heading, {
      title: "Selon la requête la plus grave",
      unit: "sites",
    });
    assert.deepEqual(
      panel.worst.lines.map((line) => [line.colour, line.count]),
      [["red", "1"]],
    );
    assert.deepEqual(panel.sites.heading, {
      title: "Son site",
      unit: "requêtes",
    });
    assert.deepEqual(
      panel.sites.choices.map((choice) => [
        choice.key,
        choice.icon,
        choice.count,
      ]),
      [["s:franceconnect.gouv.fr", { kind: "cloud", colour: "red" }, "44"]],
    );
  });

  it("counts its sites by the category of their link to it", () => {
    const panel = panelOf(LARGE, LARGE.whole, NO_FILTER, "f:cloudflare");
    assert.equal(
      panel.kind === "provider" && panel.sites.heading.title,
      "Ses 511 sites",
    );
    assert.equal(panel.kind === "provider" && panel.texts.length, 1);
    const sites = panel.kind === "provider" ? panel.sites.choices : [];
    assert.equal(sites.length, 511);
    assert.deepEqual(sites.at(-1)?.icon, { kind: "point" });
  });
});

describe("the panel of a row of gathered sites", () => {
  it("lists its sites, all blue, and their providers", () => {
    const panel = panelOf(LARGE, LARGE.whole, NO_FILTER, "g:cloudflare");
    assert.equal(panel.kind, "group");
    if (panel.kind !== "group") {
      return;
    }
    assert.equal(panel.name, "334 sites");
    assert.equal(panel.text, "Tous en niveau 2, par Cloudflare.");
    assert.deepEqual(panel.heading, {
      title: "Depuis le 7 novembre 2026",
      unit: "requêtes",
    });
    assert.equal(panel.choices.length, 334);
    assert.deepEqual(panel.choices[0]?.icon, { kind: "point" });
    const two = panelOf(LARGE, LARGE.whole, NO_FILTER, "g:cloudflare+fastly");
    assert.match(
      two.kind === "group" ? two.text : "",
      /^Tous en niveau 2, par (Cloudflare et Fastly|Fastly et Cloudflare)\.$/,
    );
  });

  it("is the one the filters leave, recounted", () => {
    const chosen = filters({ text: "lac" });
    const panel = panelOf(
      LARGE,
      columnOf(LARGE, chosen),
      chosen,
      "g:cloudflare",
    );
    assert.equal(panel.kind === "group" && panel.name, "6 sites sur 334");
  });
});

describe("a selection the map no longer shows", () => {
  it("gives the overview", () => {
    const fastly = filters({ provider: "fastly" });
    const column = columnOf(LARGE, fastly);
    for (const selection of [
      "s:gone.example",
      "f:gone",
      "g:radware",
      "g:nothing",
      "x:y",
    ]) {
      const panel = panelOf(LARGE, column, fastly, selection);
      assert.equal(panel.kind, "overview", selection);
    }
  });
});

describe("the highlight of a selection", () => {
  it("lights a site, its providers and its links", () => {
    const highlight = highlightOf(SMALL.whole, "s:impots.gouv.fr");
    assert.equal(highlight.chosen, "s:impots.gouv.fr");
    assert.deepEqual([...highlight.active].sort(), [
      "f:akamai",
      "f:radware",
      "l:impots.gouv.fr|akamai",
      "l:impots.gouv.fr|radware",
      "s:impots.gouv.fr",
    ]);
  });

  it("lights the row of the group of a site in a group", () => {
    const [cloudflare] = groupRows(LARGE.whole);
    const site = cloudflare?.sites[0]?.site ?? "";
    const highlight = highlightOf(LARGE.whole, `s:${site}`);
    assert.equal(highlight.chosen, "g:cloudflare");
    assert.ok(highlight.active.has("lg:cloudflare|cloudflare"));
    assert.ok(highlight.active.has("f:cloudflare"));
  });

  it("lights a provider, its rows and its links", () => {
    const highlight = highlightOf(SMALL.whole, "f:radware");
    assert.equal(highlight.chosen, "f:radware");
    assert.deepEqual([...highlight.active].sort(), [
      "f:radware",
      "l:caf.fr|radware",
      "l:impots.gouv.fr|radware",
      "s:caf.fr",
      "s:impots.gouv.fr",
    ]);
  });

  it("lights nothing for a site the column does not show", () => {
    const column = columnOf(SMALL, filters({ text: "caf" }));
    assert.deepEqual(highlightOf(column, "s:inpi.fr"), {
      active: new Set(),
      chosen: null,
    });
    assert.deepEqual(highlightOf(column, null), {
      active: new Set(),
      chosen: null,
    });
  });
});

describe("the header of the map", () => {
  it("dates the kept counts and says how many sites and providers they hold", () => {
    assert.deepEqual(headerOf(LARGE), {
      ...FIXED,
      subtitle:
        "Statistiques gardées depuis le 7 novembre 2026, 900 sites, 7 fournisseurs",
      question:
        "Purger toutes les statistiques gardées depuis le 7 novembre 2026 ?",
      empty: null,
      scope: "Sans les fenêtres privées ni les sites ignorés.",
    });
  });

  it("hides the purge when nothing is kept, and says so with the new start", () => {
    const empty = prepare(data({}, { since: day(5, 12) }), PROVIDERS, FR);
    assert.deepEqual(headerOf(empty), {
      ...FIXED,
      subtitle: "Statistiques gardées depuis le 5 décembre 2026",
      question: null,
      empty: "Aucune statistique gardée depuis le 5 décembre 2026.",
      scope: "Sans les fenêtres privées ni les sites ignorés.",
    });
  });

  it("keeps out a site cleared alone with nothing since, and a category this version does not know", () => {
    const map = prepare(
      data({
        "cleared.example": {},
        "empty.example": { cloudflare: {} },
        "future.example": { cloudflare: { blue1: { "GET image": 4 } } },
        "both.example": {
          cloudflare: {
            blue1: { "GET image": 4 },
            red4: { "GET main_frame": 1 },
          },
        },
      }),
      PROVIDERS,
      FR,
    );
    assert.deepEqual(
      map.sites.map((site) => site.site),
      ["both.example"],
    );
    assert.equal(map.sites[0]?.total, 1);
    assert.equal(
      headerOf(map).subtitle,
      "Statistiques gardées depuis le 7 novembre 2026, 1 site, 1 fournisseur",
    );
  });
});

describe("the map of a private window", () => {
  it("names the private session in place of a date", () => {
    assert.deepEqual(headerOf(PRIVATE), {
      ...FIXED,
      subtitle:
        "Statistiques de cette session privée, 36 sites, 4 fournisseurs",
      question: "Purger toutes les statistiques de cette session privée ?",
      empty: null,
      scope: "Cette session privée seulement, sans les sites ignorés.",
    });
    const empty = prepare(
      data({}, { privateWindow: true, since: 0 }),
      PROVIDERS,
      FR,
    );
    assert.deepEqual(headerOf(empty), {
      ...FIXED,
      subtitle: "Statistiques de cette session privée",
      question: null,
      empty: "Aucune statistique dans cette session privée.",
      scope: "Cette session privée seulement, sans les sites ignorés.",
    });
  });

  it("titles a site, a provider and a group by the private session, and dates none", () => {
    const site = panelOf(PRIVATE, PRIVATE.whole, NO_FILTER, "s:leboncoin.fr");
    assert.deepEqual(site.kind === "site" && site.heading, {
      title: "Ce site, cette session privée",
      unit: "requêtes",
    });
    assert.equal(site.kind === "site" && site.note, null);
    const provider = panelOf(PRIVATE, PRIVATE.whole, NO_FILTER, "f:cloudflare");
    assert.equal(
      provider.kind === "provider" && provider.note,
      "Statistiques de cette session privée.",
    );
    const group = panelOf(PRIVATE, PRIVATE.whole, NO_FILTER, "g:cloudflare");
    assert.deepEqual(group.kind === "group" && group.heading, {
      title: "Cette session privée",
      unit: "requêtes",
    });
  });

  it("dates no site even when the event page gives a start", () => {
    const map = prepare(
      data(
        { "a.example": blueSite("cloudflare", 2) },
        { privateWindow: true, since: 0, siteSince: { "a.example": 0 } },
      ),
      PROVIDERS,
      FR,
    );
    assert.equal(map.sites[0]?.since, null);
  });

  it("counts what the mock-up counts of its private session", () => {
    assert.equal(PRIVATE.whole.sites, 36);
    assert.equal(PRIVATE.whole.requests, 712);
    assert.deepEqual(counts(PRIVATE.whole.byProvider), {
      cloudflare: 23,
      cloudfront: 8,
      fastly: 11,
      akamai: 2,
    });
  });
});

describe("the map messages", () => {
  const locales = ["en", "fr"].map((locale) => ({
    locale,
    messages: messagesOf(locale),
  }));
  const shared = [
    "helpOpen",
    "helpTitle",
    "helpClose",
    "popupSite",
    "popupSitePrivate",
    "level2",
    "level3",
    "level4",
    "decryptionProven",
    "decryptionUnproven",
  ];
  const { table } = loadTable(
    fileURLToPath(new URL("../../data", import.meta.url)),
  );
  const countries = new Set(
    table.providers.flatMap((entry) => [
      entry.country,
      ...(entry.parent === null ? [] : [entry.parent.country]),
    ]),
  );
  const labels = [
    ...htmlOf("map/map.html").matchAll(/data-message="([^"]+)"/g),
  ].map((match) => match[1] ?? "");

  it("exist in every locale", () => {
    for (const { locale, messages } of locales) {
      for (const name of MAP_MESSAGES) {
        assert.ok(messages[name]?.message, `${locale}: ${name}`);
      }
    }
  });

  it("give the law and the place of every country of the data", () => {
    for (const { locale, messages } of locales) {
      for (const country of countries) {
        assert.ok(
          messages[`mapLawOf${country}`]?.message,
          `${locale}: ${country}`,
        );
        assert.ok(
          messages[`mapIn${country}`]?.message,
          `${locale}: ${country}`,
        );
      }
    }
  });

  it("are each written by the page, asked by the view, or the forms of a country", () => {
    // The chip of each category, and the name of each request type.
    for (const category of [
      "red4",
      "red3",
      "orange4",
      "orange3",
      "blue2",
    ] as const) {
      toolsOf(LARGE, LARGE.whole, filters({ category }));
    }
    const types = [
      "main_frame",
      "sub_frame",
      "xmlhttprequest",
      "script",
      "image",
      "stylesheet",
      "font",
      "media",
      "websocket",
      "other",
    ];
    const every = prepare(
      data({
        "a.example": {
          cloudflare: {
            blue2: Object.fromEntries(types.map((type) => [`GET ${type}`, 1])),
          },
        },
      }),
      PROVIDERS,
      FR,
    );
    for (const [kept, limit] of [
      [["https://a.example/1"], 5],
      [["https://a.example/1", "https://a.example/2"], 5],
      [["https://a.example/1"], 1],
      [["https://a.example/1", "https://a.example/2"], 2],
    ] as const) {
      panelOf(every, every.whole, NO_FILTER, "s:a.example", {
        site: "a.example",
        addresses: { cloudflare: { blue2: { "GET script": kept } } },
        limit,
      });
    }
    for (const name of [...asked, ...labels]) {
      assert.ok(MAP_MESSAGES.includes(name) || shared.includes(name), name);
    }
    const countryForms = [...countries].flatMap((country) => [
      `mapLawOf${country}`,
      `mapIn${country}`,
    ]);
    assert.deepEqual(
      [...new Set([...asked, ...labels, ...countryForms])]
        .filter((name) => !shared.includes(name))
        .sort(),
      [...MAP_MESSAGES].sort(),
    );
  });

  it("have the same placeholders in each locale, each written in the message", () => {
    const [en, fr] = locales;
    for (const name of MAP_MESSAGES) {
      const names = (entry: typeof en) =>
        Object.entries(entry?.messages[name]?.placeholders ?? {}).map(
          ([key, value]) => `${key}=${value.content}`,
        );
      assert.deepEqual(names(fr), names(en), name);
      for (const { locale, messages } of locales) {
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

  it("put the count in the singular too, which 0 takes in French", () => {
    for (const { locale, messages } of locales) {
      for (const name of MAP_MESSAGES.filter((entry) =>
        /(One|Many)$/.test(entry),
      )) {
        assert.ok(
          messages[name]?.message.includes("$COUNT$"),
          `${locale}: ${name}`,
        );
      }
    }
  });

  it("hold no line break", () => {
    for (const { locale, messages } of locales) {
      for (const name of MAP_MESSAGES) {
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
    for (const name of MAP_MESSAGES) {
      assert.doesNotMatch(fr[name]?.message ?? "", /[^\u00a0][:?]/u, name);
    }
  });

  it("hold neither an em dash nor a semicolon in French", () => {
    const fr = messagesOf("fr");
    for (const name of MAP_MESSAGES) {
      assert.doesNotMatch(fr[name]?.message ?? "", /[\u2014;]/u, name);
    }
  });

  it("read in English", () => {
    const en = getMessageOf("en");
    const EN = formatsOf("en", en, (site) => site);
    const map = prepare(largeSample(), PROVIDERS, EN);
    assert.equal(
      headerOf(map).subtitle,
      "Counts kept since November 7, 2026, 900 sites, 7 providers",
    );
    const chosen = filters({ provider: "fastly" });
    const column = columnOf(map, chosen);
    assert.equal(
      overview(map, column, chosen).line,
      "190 sites of 900, 1 provider, 7,497 requests.",
    );
    assert.equal(
      map.provider.get("imperva")?.title,
      "Imperva, subject to the law of the United States, parent company Thales, in France",
    );
    assert.equal(
      overview(
        map,
        columnOf(map, filters({ text: "zzz" })),
        filters({ text: "zzz" }),
      ).line,
      "0 sites of 900, 0 providers, 0 requests.",
    );
  });
});

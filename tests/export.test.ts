// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayOf } from "../src/core/counts.js";
import {
  exportFileOf,
  exportNameOf,
  exportTextOf,
} from "../src/core/export.js";
import type { ExportData } from "../src/core/popup-message.js";

// Local days, as the counts keep their starts, and a moment of a day.
function day(month: number, date: number): number {
  return new Date(2026, month - 1, date).getTime();
}
const NOW = new Date(2026, 10, 24, 18, 42, 7).getTime();

// The keys come in no order, as storage gives them.
const DATA: ExportData = {
  privateWindow: false,
  since: day(11, 7),
  siteSince: { "zeta.example": day(11, 20), "alpha.example": day(11, 12) },
  sites: {
    "zeta.example": {
      edge: {
        red4: { "GET xmlhttprequest": 2, "GET script": 1 },
        blue2: { "GET image": 5 },
      },
    },
    "alpha.example": {
      "b-cdn.net": { orange3: { "POST xmlhttprequest": 1 } },
      edge: { blue2: { "GET font": 3 } },
    },
  },
  addresses: {
    "zeta.example": {
      edge: {
        red4: {
          "GET xmlhttprequest": [
            "https://api.zeta.example/me?token=…",
            "https://api.zeta.example/cart",
          ],
        },
      },
    },
  },
};

describe("the export file", () => {
  it("holds the version, the day of the export, the starts, the counts and the addresses, its keys in order at every depth", () => {
    assert.equal(
      exportTextOf(exportFileOf(DATA, "1.2.3", NOW)),
      `{
  "format": 1,
  "version": "1.2.3",
  "exported": "2026-11-24",
  "privateWindow": false,
  "since": "2026-11-07",
  "siteSince": {
    "alpha.example": "2026-11-12",
    "zeta.example": "2026-11-20"
  },
  "sites": {
    "alpha.example": {
      "b-cdn.net": {
        "orange3": {
          "POST xmlhttprequest": 1
        }
      },
      "edge": {
        "blue2": {
          "GET font": 3
        }
      }
    },
    "zeta.example": {
      "edge": {
        "blue2": {
          "GET image": 5
        },
        "red4": {
          "GET script": 1,
          "GET xmlhttprequest": 2
        }
      }
    }
  },
  "addresses": {
    "zeta.example": {
      "edge": {
        "red4": {
          "GET xmlhttprequest": [
            "https://api.zeta.example/me?token=…",
            "https://api.zeta.example/cart"
          ]
        }
      }
    }
  }
}
`,
    );
  });

  it("holds an empty list of addresses when none is kept", () => {
    const file = exportFileOf({ ...DATA, addresses: {} }, "1.2.3", NOW);
    assert.deepEqual(file.addresses, {});
    assert.match(exportTextOf(file), /\n {2}"addresses": \{\}\n\}\n$/);
  });

  it("leaves out a site cleared alone with nothing counted since, with its own start and its addresses", () => {
    const file = exportFileOf(
      {
        ...DATA,
        siteSince: { ...DATA.siteSince, "cleared.example": day(11, 23) },
        sites: {
          ...DATA.sites,
          "cleared.example": {},
          "emptied.example": { edge: { red4: {} } },
        },
        addresses: {
          ...DATA.addresses,
          "cleared.example": {
            edge: { red4: { "GET xmlhttprequest": ["https://x.example/"] } },
          },
        },
      },
      "1.2.3",
      NOW,
    );
    assert.deepEqual(Object.keys(file.sites), [
      "alpha.example",
      "zeta.example",
    ]);
    assert.deepEqual(Object.keys(file.siteSince), [
      "alpha.example",
      "zeta.example",
    ]);
    assert.deepEqual(Object.keys(file.addresses), ["zeta.example"]);
  });

  it("says a private window, without a start, and holds the counts of the private session as they come", () => {
    const file = exportFileOf(
      {
        privateWindow: true,
        since: 0,
        siteSince: {},
        sites: { "alpha.example": DATA.sites["alpha.example"] ?? {} },
        addresses: {},
      },
      "1.2.3",
      NOW,
    );
    assert.deepEqual(file, {
      format: 1,
      version: "1.2.3",
      exported: "2026-11-24",
      privateWindow: true,
      since: null,
      siteSince: {},
      sites: {
        "alpha.example": {
          "b-cdn.net": { orange3: { "POST xmlhttprequest": 1 } },
          edge: { blue2: { "GET font": 3 } },
        },
      },
      addresses: {},
    });
  });

  it("dates each start by its local day, as the counts keep it", () => {
    const start = dayOf(new Date(2026, 0, 5, 23, 59).getTime());
    const file = exportFileOf(
      { ...DATA, since: start, siteSince: {} },
      "1.2.3",
      new Date(2026, 0, 6, 0, 0, 1).getTime(),
    );
    assert.equal(file.since, "2026-01-05");
    assert.equal(file.exported, "2026-01-06");
  });
});

describe("the name of the export file", () => {
  it("is cloud-leak and the local day of the export, its month and day on two digits", () => {
    assert.equal(exportNameOf(NOW), "cloud-leak-2026-11-24.json");
    assert.equal(
      exportNameOf(new Date(2027, 0, 5, 0, 0, 0).getTime()),
      "cloud-leak-2027-01-05.json",
    );
    assert.equal(
      exportNameOf(new Date(2026, 11, 31, 23, 59, 59).getTime()),
      "cloud-leak-2026-12-31.json",
    );
  });
});

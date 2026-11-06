// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification } from "../src/core/classify.js";
import {
  EMPTY_RECORD,
  foldRequest,
  HIDDEN_SITE,
  markHiddenSite,
  markPartialView,
  startNavigation,
  type TabRecord,
} from "../src/core/tab-record.js";
import { markPartial, NEUTRAL, NOT_OBSERVED } from "../src/core/tab-state.js";

const RED_3: Classification = {
  provider: "cloudflare",
  proven: true,
  leak: { level: 3 },
};
const BLUE_2: Classification = { ...RED_3, leak: { level: 2 } };

function seen(navigation: string, request: Classification, partial = false) {
  const level = request.leak.level;
  const tallies = [
    { level, proven: level <= 2 ? null : request.proven, count: 1 },
  ];
  return { navigation, state: { kind: "seen", request, tallies, partial } };
}

describe("startNavigation", () => {
  it("starts a tab over on a new top-level navigation", () => {
    const record = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false),
      "1",
      RED_3,
    );
    assert.deepEqual(startNavigation(record, "2", false), {
      navigation: "2",
      state: NEUTRAL,
    });
  });

  it("starts a tab over neutral with a partial view while the extension lacks the access to all sites", () => {
    const record = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false),
      "1",
      RED_3,
    );
    assert.deepEqual(startNavigation(record, "2", true), {
      navigation: "2",
      state: markPartial(NEUTRAL),
    });
    assert.deepEqual(markPartial(NEUTRAL), { kind: "neutral", partial: true });
  });

  it("keeps the tab across the redirects of the same navigation", () => {
    const record = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false),
      "1",
      RED_3,
    );
    assert.equal(startNavigation(record, "1", false), record);
  });
});

describe("foldRequest", () => {
  it("folds the requests of the current navigation", () => {
    const record = startNavigation(EMPTY_RECORD, "1", false);
    assert.deepEqual(foldRequest(record, "1", BLUE_2), seen("1", BLUE_2));
    assert.equal(foldRequest(record, "1", null), record);
  });

  it("ignores a request sent before the current navigation, which belongs to the page left", () => {
    const record = startNavigation(
      foldRequest(EMPTY_RECORD, "", BLUE_2),
      "2",
      false,
    );
    assert.equal(foldRequest(record, "1", RED_3), record);
    assert.equal(foldRequest(record, "", RED_3), record);
  });

  it("folds into a tab seen for the first time, such as one open before the extension", () => {
    assert.deepEqual(foldRequest(EMPTY_RECORD, "", BLUE_2), seen("", BLUE_2));
  });
});

describe("markHiddenSite", () => {
  it("starts a tab over as not observed when it shows a site the extension cannot see", () => {
    const record: TabRecord = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false),
      "1",
      RED_3,
    );
    assert.deepEqual(markHiddenSite(record), {
      navigation: HIDDEN_SITE,
      state: NOT_OBSERVED,
    });
  });

  it("keeps what the tab saw since, on the same hidden site, and keeps the view partial", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    const after = foldRequest(hidden, HIDDEN_SITE, BLUE_2);
    assert.deepEqual(after, seen(HIDDEN_SITE, BLUE_2, true));
    assert.deepEqual(markHiddenSite(after), after);
  });

  it("lets a later navigation the extension sees start the tab over", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    assert.deepEqual(startNavigation(hidden, "3", false), {
      navigation: "3",
      state: NEUTRAL,
    });
  });
});

describe("markPartialView", () => {
  it("makes the view of the current navigation partial, and keeps what it saw", () => {
    const record = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false),
      "1",
      RED_3,
    );
    assert.deepEqual(markPartialView(record), seen("1", RED_3, true));
  });

  it("keeps a tab where nothing was seen neutral, with a partial view", () => {
    assert.deepEqual(
      markPartialView(startNavigation(EMPTY_RECORD, "1", false)),
      {
        navigation: "1",
        state: { kind: "neutral", partial: true },
      },
    );
    assert.deepEqual(markPartialView(EMPTY_RECORD), {
      navigation: "",
      state: { kind: "neutral", partial: true },
    });
  });

  it("leaves a tab not observed, or already partial, as it is", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    assert.equal(markPartialView(hidden), hidden);
    const partial = markPartialView(startNavigation(EMPTY_RECORD, "1", false));
    assert.equal(markPartialView(partial), partial);
  });

  it("lets the next navigation start over with the view the permissions give", () => {
    const partial = markPartialView(startNavigation(EMPTY_RECORD, "1", false));
    assert.deepEqual(startNavigation(partial, "2", false), {
      navigation: "2",
      state: NEUTRAL,
    });
  });
});

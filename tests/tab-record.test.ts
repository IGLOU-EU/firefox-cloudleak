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
  startNavigation,
  type TabRecord,
} from "../src/core/tab-record.js";
import { NEUTRAL, NOT_OBSERVED } from "../src/core/tab-state.js";

const RED_3: Classification = {
  provider: "cloudflare",
  proven: true,
  leak: { level: 3 },
};
const BLUE_2: Classification = { ...RED_3, leak: { level: 2 } };

function seen(navigation: string, request: Classification, partial = false) {
  return { navigation, state: { kind: "seen", request, partial } };
}

describe("startNavigation", () => {
  it("starts a tab over on a new top-level navigation", () => {
    const record = foldRequest(startNavigation(EMPTY_RECORD, "1"), "1", RED_3);
    assert.deepEqual(startNavigation(record, "2"), {
      navigation: "2",
      state: NEUTRAL,
    });
  });

  it("keeps the tab across the redirects of the same navigation", () => {
    const record = foldRequest(startNavigation(EMPTY_RECORD, "1"), "1", RED_3);
    assert.equal(startNavigation(record, "1"), record);
  });
});

describe("foldRequest", () => {
  it("folds the requests of the current navigation", () => {
    const record = startNavigation(EMPTY_RECORD, "1");
    assert.deepEqual(foldRequest(record, "1", BLUE_2), seen("1", BLUE_2));
    assert.equal(foldRequest(record, "1", null), record);
  });

  it("ignores a request sent before the current navigation, which belongs to the page left", () => {
    const record = startNavigation(foldRequest(EMPTY_RECORD, "", BLUE_2), "2");
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
      startNavigation(EMPTY_RECORD, "1"),
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
    assert.deepEqual(startNavigation(hidden, "3"), {
      navigation: "3",
      state: NEUTRAL,
    });
  });
});

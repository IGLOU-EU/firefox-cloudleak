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
import {
  addRequest,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";

function request(leak: Leak, proven: boolean): Classification {
  return { provider: "alpha", proven, leak };
}

const BLUE_2 = request({ level: 2 }, true);
const BLUE_2_UNPROVEN = request({ level: 2 }, false);
const ORANGE_3 = request({ level: 3 }, false);
const ORANGE_4 = request(
  { level: 4, case: "session", possible: true, challenge: false },
  false,
);
const RED_3 = request({ level: 3 }, true);
const RED_4 = request({ level: 4, case: "data-sent", challenge: true }, true);

function fold(requests: (Classification | null)[], start = NEUTRAL): TabState {
  return requests.reduce(addRequest, start);
}

function seen(colour: Colour, level: LeakLevel, partial = false): TabState {
  return { kind: "seen", colour, level, partial };
}

describe("addRequest", () => {
  it("stays neutral while no request goes through a known provider", () => {
    assert.deepEqual(fold([]), NEUTRAL);
    assert.deepEqual(fold([null, null]), NEUTRAL);
  });

  it("takes the colour and level of the first request seen", () => {
    assert.deepEqual(fold([BLUE_2]), seen("blue", 2));
    assert.deepEqual(fold([BLUE_2_UNPROVEN]), seen("blue", 2));
    assert.deepEqual(fold([ORANGE_4]), seen("orange", 4));
    assert.deepEqual(fold([RED_3]), seen("red", 3));
  });

  it("orders red before orange before blue, whatever the level", () => {
    assert.deepEqual(fold([ORANGE_4, RED_3]), seen("red", 3));
    assert.deepEqual(fold([RED_3, ORANGE_4]), seen("red", 3));
    assert.deepEqual(fold([BLUE_2, ORANGE_3]), seen("orange", 3));
    assert.deepEqual(fold([ORANGE_3, BLUE_2]), seen("orange", 3));
  });

  it("orders by level number within a colour", () => {
    assert.deepEqual(fold([ORANGE_3, ORANGE_4]), seen("orange", 4));
    assert.deepEqual(fold([ORANGE_4, ORANGE_3]), seen("orange", 4));
    assert.deepEqual(fold([RED_3, RED_4, RED_3]), seen("red", 4));
  });

  it("is not lowered by a later, less serious request or by a request through no provider", () => {
    assert.deepEqual(fold([RED_4, BLUE_2, null, ORANGE_4]), seen("red", 4));
  });

  it("follows the most serious request seen on a tab it does not fully observe, and says the view is partial", () => {
    assert.deepEqual(fold([BLUE_2], NOT_OBSERVED), seen("blue", 2, true));
    assert.deepEqual(fold([RED_4, BLUE_2], NOT_OBSERVED), seen("red", 4, true));
    assert.deepEqual(
      fold([BLUE_2, ORANGE_3, null], NOT_OBSERVED),
      seen("orange", 3, true),
    );
  });

  it("stays not observed while it sees no request through a known provider", () => {
    assert.deepEqual(fold([], NOT_OBSERVED), NOT_OBSERVED);
    assert.deepEqual(fold([null, null], NOT_OBSERVED), NOT_OBSERVED);
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    addRequest(state, RED_4);
    assert.deepEqual(state, seen("blue", 2));
    addRequest(NEUTRAL, RED_4);
    assert.deepEqual(NEUTRAL, { kind: "neutral" });
    addRequest(NOT_OBSERVED, RED_4);
    assert.deepEqual(NOT_OBSERVED, { kind: "not-observed" });
  });
});

describe("markPartial", () => {
  it("makes a tab where nothing was seen not observed", () => {
    assert.deepEqual(markPartial(NEUTRAL), NOT_OBSERVED);
    assert.deepEqual(markPartial(NOT_OBSERVED), NOT_OBSERVED);
  });

  it("keeps the most serious request seen and says the view is partial", () => {
    assert.deepEqual(markPartial(fold([RED_3])), seen("red", 3, true));
    assert.deepEqual(
      markPartial(markPartial(fold([BLUE_2]))),
      seen("blue", 2, true),
    );
  });

  it("keeps the view partial whatever request comes next", () => {
    const partial = markPartial(fold([ORANGE_3]));
    assert.deepEqual(fold([RED_4], partial), seen("red", 4, true));
    assert.deepEqual(fold([BLUE_2, null], partial), seen("orange", 3, true));
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    markPartial(state);
    assert.deepEqual(state, seen("blue", 2));
    markPartial(NEUTRAL);
    assert.deepEqual(NEUTRAL, { kind: "neutral" });
  });
});

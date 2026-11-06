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
const ORANGE_4 = request({ level: 4, case: "session", possible: true }, false);
const RED_3 = request({ level: 3 }, true);
const RED_4 = request({ level: 4, case: "data-sent", challenge: true }, true);

function fold(requests: (Classification | null)[], start = NEUTRAL): TabState {
  return requests.reduce(addRequest, start);
}

function seen(colour: Colour, level: LeakLevel): TabState {
  return { kind: "seen", colour, level };
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

  it("keeps a site the extension cannot observe as not observed", () => {
    assert.deepEqual(fold([RED_4, BLUE_2], NOT_OBSERVED), NOT_OBSERVED);
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    addRequest(state, RED_4);
    assert.deepEqual(state, seen("blue", 2));
    addRequest(NEUTRAL, RED_4);
    assert.deepEqual(NEUTRAL, { kind: "neutral" });
  });
});

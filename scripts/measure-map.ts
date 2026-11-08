// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Times the view of the map on the 900 sites of its mock-up, in Node: what
// the page computes at each keystroke before it draws, and once for each
// answer of the event page. The owner holds a keystroke of the whole page,
// drawing included, under 100 ms, below which an answer feels immediate. A
// time is printed, never judged here, since it depends on the machine.

import { performance } from "node:perf_hooks";
import {
  columnOf,
  type Filters,
  formatsOf,
  NO_FILTER,
  type PreparedMap,
  panelOf,
  placesOf,
  prepare,
  toolsOf,
} from "../src/core/map-view.js";
import { largeSample, PROVIDERS } from "../tests/map-sample.js";
import { getMessageOf } from "../tests/messages.js";

// The keystrokes the mock-up timed, three passes of them.
const KEYSTROKES = ["l", "la", "lac", "la", "l", "", "v", "ve", "vel", "velo"];
const PASSES = 3;
// The height of the column in a tab of 1280 by 800 pixels.
const VIEW_HEIGHT = 640;

const formats = formatsOf("fr", getMessageOf("fr"), (site) => site);
const data = largeSample();

function summary(label: string, times: readonly number[]): string {
  const sorted = [...times].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  const high = sorted[Math.ceil((sorted.length - 1) / 2)] ?? 0;
  return `${label}: median ${((low + high) / 2).toFixed(2)} ms, from ${(sorted[0] ?? 0).toFixed(2)} to ${(sorted.at(-1) ?? 0).toFixed(2)} ms`;
}

const prepared: number[] = [];
let map: PreparedMap = prepare(data, PROVIDERS, formats);
for (let pass = 0; pass < PASSES; pass += 1) {
  const start = performance.now();
  map = prepare(data, PROVIDERS, formats);
  prepared.push(performance.now() - start);
}

function keystrokes(limits: Filters): number[] {
  const times: number[] = [];
  for (let pass = 0; pass < PASSES; pass += 1) {
    for (const text of KEYSTROKES) {
      const start = performance.now();
      const filters = { ...limits, text };
      const column = columnOf(map, filters);
      placesOf(map, column, VIEW_HEIGHT);
      toolsOf(map, column, filters);
      panelOf(map, column, filters, null);
      times.push(performance.now() - start);
    }
  }
  return times;
}

console.log(`${map.sites.length} sites, ${map.providers.length} providers`);
console.log(summary("each answer of the event page", prepared));
console.log(summary("each keystroke without limit", keystrokes(NO_FILTER)));
console.log(
  summary(
    "each keystroke under Cloudflare and level 4, proven",
    keystrokes({ ...NO_FILTER, provider: "cloudflare", category: "red4" }),
  ),
);

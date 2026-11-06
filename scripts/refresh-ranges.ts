// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Refreshes ranges.txt from the lists that providers publish. It runs on the
// development machine only: the extension never downloads anything, and new
// ranges reach users with a new version.

import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRangesFile,
  type PublishedList,
  parsePublishedSource,
  parseRangesFile,
  readPublishedList,
} from "./providers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const providersDir = join(root, "data", "providers");
const today = new Date().toISOString().slice(0, 10);

async function fetchList(list: PublishedList): Promise<string[]> {
  try {
    const response = await fetch(list.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return readPublishedList(list, await response.text());
  } catch (error) {
    throw new Error(`${list.url}, ${(error as Error).message}`);
  }
}

let failed = false;
for (const id of readdirSync(providersDir).sort()) {
  const path = join(providersDir, id, "ranges.txt");
  let current: string;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  const { sources, comments, ranges: before } = parseRangesFile(current, path);
  try {
    // A source that is not a published list, such as a hand-made list, is
    // left for a person to update.
    const lists = sources
      .map(parsePublishedSource)
      .filter((list) => list !== null);
    if (lists.length === 0 || lists.length !== sources.length) {
      console.log(`${id}: skipped, its sources are not all published lists`);
      continue;
    }
    const after = (await Promise.all(lists.map(fetchList))).flat();
    const text = formatRangesFile({
      sources,
      fetched: today,
      comments,
      ranges: after,
    });
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
    const added = after.filter((r) => !before.includes(r.toLowerCase()));
    const removed = before.filter(
      (r) => !after.some((a) => a.toLowerCase() === r),
    );
    console.log(
      `${id}: ${after.length} range(s), ${added.length} added, ${removed.length} removed`,
    );
  } catch (error) {
    failed = true;
    console.error(`${id}: not refreshed, ${(error as Error).message}`);
  }
}
if (failed) {
  process.exit(1);
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Refreshes ranges.txt from the lists that providers publish. It runs on the
// development machine only: the extension never downloads anything, and new
// ranges reach users with a new version.

import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCidr } from "../src/core/cidr.js";
import { parseRangesFile } from "./providers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const providersDir = join(root, "data", "providers");
const today = new Date().toISOString().slice(0, 10);

async function fetchList(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const ranges: string[] = [];
  for (const [index, raw] of (await response.text()).split("\n").entries()) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    const range = parseCidr(line);
    if (!range.ok) {
      throw new Error(`${url}, line ${index + 1}: ${range.reason}`);
    }
    ranges.push(line);
  }
  if (ranges.length === 0) {
    throw new Error(`${url}: the list is empty`);
  }
  return ranges;
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
  // Only lists served over HTTPS are refreshed. Any other source, such as a
  // hand-made list, is left for a person to update.
  const { sources, ranges: before } = parseRangesFile(current, path);
  const urls = sources.filter((source) => source.startsWith("https://"));
  if (urls.length === 0 || urls.length !== sources.length) {
    console.log(`${id}: skipped, its sources are not all published lists`);
    continue;
  }
  try {
    const after = (await Promise.all(urls.map(fetchList))).flat();
    const lines = [
      ...urls.map((url) => `# Source: ${url}`),
      `# Fetched: ${today}`,
      ...after,
      "",
    ];
    writeFileSync(`${path}.tmp`, lines.join("\n"));
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

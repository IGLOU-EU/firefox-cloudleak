// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The compiled extension the adapter tests drive, in build/extension/, and
// the provider table they give it. The test files run in parallel, so the
// table is written whole and swapped into place, never truncated under a
// reader.

import { renameSync, writeFileSync } from "node:fs";
import type {
  ProviderEntry,
  ProviderTable,
} from "../src/core/provider-table.js";

export const EDGE: ProviderEntry = {
  id: "edge",
  name: "Edge",
  country: "US",
  parent: null,
  ranges: ["192.0.2.0/24"],
  headers: [{ name: "x-edge", value: null }],
  cookies: [],
  siteConnectorCookies: [],
  server: [],
  cname: ["edge.example.net"],
  challengeHosts: [],
  challengePaths: [],
  challengeHeaders: [],
  challengeQueryNames: [],
};

export const TABLE: ProviderTable = { providers: [EDGE], consentCookies: [] };

const extension = new URL("../extension/", import.meta.url);

export function writeTable(): void {
  const staging = new URL(`providers.${process.pid}.js`, extension);
  writeFileSync(staging, `export default ${JSON.stringify(TABLE)};\n`);
  renameSync(staging, new URL("providers.js", extension));
}

export async function importModule<T>(file: string): Promise<T> {
  return (await import(new URL(file, extension).href)) as T;
}

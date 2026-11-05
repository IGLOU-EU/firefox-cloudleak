// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Completes dist/, where the compiler has already written the extension code,
// with the files Firefox loads as they are and the generated provider table.

import { cpSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatError, loadProviders } from "./providers.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = `${root}dist/`;

const { table, errors } = loadProviders(`${root}data/providers`);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(formatError(error).replace(root, ""));
  }
  console.error(`Provider data is invalid: ${errors.length} error(s).`);
  process.exit(1);
}

// A module rather than a JSON file, so the event page has the table as soon
// as it runs, without waiting on a read at every wake-up.
writeFileSync(
  `${dist}providers.js`,
  [
    "// SPDX-License-Identifier: GPL-3.0-or-later",
    "// Copyright (C) 2026 Adrien Kara",
    "// Generated from data/providers by the build. Do not edit.",
    `export default ${JSON.stringify(table)};`,
    "",
  ].join("\n"),
);

for (const path of ["manifest.json", "_locales", "LICENSE"]) {
  cpSync(`${root}${path}`, `${dist}${path}`, { recursive: true });
}

console.log(`Built dist/ with ${table.length} provider(s).`);

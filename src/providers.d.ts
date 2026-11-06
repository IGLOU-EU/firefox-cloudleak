// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The build writes providers.js next to the compiled code, from data/.
import type { ProviderTable } from "./core/provider-table.js";

declare const table: ProviderTable;
export default table;

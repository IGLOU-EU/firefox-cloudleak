// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseCidr } from "../src/core/cidr.js";

// An error names the line in ranges.txt and the field path in provider.json,
// so the person fixing the data finds the place without searching.
export interface DataError {
  file: string;
  line: number | null;
  field: string | null;
  reason: string;
}

export interface Company {
  name: string;
  country: string;
}

export interface Provider extends Company {
  parent: Company | null;
  headers: { name: string; value: string | null }[];
  cookies: string[];
  server: string[];
  cname: string[];
}

// The generated table holds only what the extension uses. The sources stay
// in the data folder, which is where they are read and checked.
export interface ProviderEntry extends Provider {
  id: string;
  ranges: string[];
}

export const PROVIDER_FILES = ["provider.json", "ranges.txt", "logo.svg"];

// The id names the folder, so the file system already forbids two equal ids.
// Lowercase only keeps it so on file systems that ignore case.
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COUNTRY = /^[A-Z]{2}$/;
// RFC 9110 token characters, which covers header and cookie names.
const NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const VALUE_PATTERN = /^[\x20-\x7e]+$/;
const DOMAIN =
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Report = (field: string, reason: string) => void;
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

// Every character but "*" is literal, so no pattern can act as a regular
// expression. These rules only catch patterns that cannot be what was meant.
function patternProblem(pattern: string): string | null {
  if (pattern.trim() !== pattern) {
    return "starts or ends with a space";
  }
  if (/^\**$/.test(pattern)) {
    return 'is made only of "*", which would match anything';
  }
  if (pattern.includes("**")) {
    return 'contains "**", write a single "*"';
  }
  return null;
}

function readObject(
  value: unknown,
  path: string,
  keys: { required: string[]; optional: string[] },
  report: Report,
): JsonObject | null {
  if (!isObject(value)) {
    report(path, "must be an object");
    return null;
  }
  for (const key of keys.required) {
    if (!Object.hasOwn(value, key)) {
      report(fieldPath(path, key), "is required");
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.required.includes(key) && !keys.optional.includes(key)) {
      report(fieldPath(path, key), "is an unknown key");
    }
  }
  return value;
}

function readString(
  value: unknown,
  path: string,
  report: Report,
): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    report(path, "must be a non-empty string");
    return null;
  }
  return value;
}

function readCompany(
  object: JsonObject,
  path: string,
  report: Report,
): Company | null {
  const name = readString(object["name"], fieldPath(path, "name"), report);
  const countryPath = fieldPath(path, "country");
  const country = readString(object["country"], countryPath, report);
  if (country !== null && !COUNTRY.test(country)) {
    report(
      countryPath,
      'must be an ISO 3166-1 alpha-2 code in capitals, such as "US"',
    );
    return null;
  }
  return name === null || country === null ? null : { name, country };
}

interface Field {
  key: string;
  kind: "name" | "value" | "domain";
  optional: boolean;
}

function fieldProblem(field: Field, value: string): string | null {
  if (field.kind === "domain") {
    return DOMAIN.test(value)
      ? null
      : `"${value}" is not a lowercase domain name, write the suffix without "*" or a leading dot`;
  }
  if (field.kind === "name" && !NAME_PATTERN.test(value)) {
    return `"${value}" is not a valid name pattern: only letters, digits, the characters !#$%&'+-.^_\`|~ and the "*" wildcard are allowed`;
  }
  if (field.kind === "value" && !VALUE_PATTERN.test(value)) {
    return `"${value}" may only hold printable ASCII characters`;
  }
  const problem = patternProblem(value);
  return problem === null ? null : `"${value}" ${problem}`;
}

function readSignatures(
  value: unknown,
  path: string,
  fields: Field[],
  report: Report,
): (string | null)[][] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    report(path, "must be an array");
    return [];
  }
  const seen = new Map<string, string>();
  const result: (string | null)[][] = [];
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    const entry = readObject(
      item,
      itemPath,
      {
        required: [
          ...fields.filter((f) => !f.optional).map((f) => f.key),
          "source",
        ],
        optional: fields.filter((f) => f.optional).map((f) => f.key),
      },
      report,
    );
    if (entry === null) {
      continue;
    }
    readString(entry["source"], fieldPath(itemPath, "source"), report);
    const values: (string | null)[] = [];
    let valid = true;
    for (const field of fields) {
      const keyPath = fieldPath(itemPath, field.key);
      const text = readString(entry[field.key], keyPath, report);
      if (entry[field.key] === undefined) {
        values.push(null);
        valid &&= field.optional;
        continue;
      }
      const problem = text === null ? null : fieldProblem(field, text);
      if (problem !== null) {
        report(keyPath, problem);
      }
      if (text === null || problem !== null) {
        valid = false;
      }
      values.push(field.kind === "name" ? (text?.toLowerCase() ?? null) : text);
    }
    if (!valid) {
      continue;
    }
    const firstPath = fieldPath(itemPath, fields[0]?.key ?? "");
    if (path === "signatures.headers" && values[0] === "server") {
      report(
        firstPath,
        'the "server" header goes in signatures.server, with a value',
      );
      continue;
    }
    const key = JSON.stringify(values);
    const first = seen.get(key);
    if (first !== undefined) {
      report(firstPath, `is given twice, first at ${first}`);
      continue;
    }
    seen.set(key, itemPath);
    result.push(values);
  }
  return result;
}

export function parseProviderJson(
  text: string,
  file: string,
): { provider: Provider | null; errors: DataError[] } {
  const errors: DataError[] = [];
  const report: Report = (field, reason) =>
    errors.push({ file, line: null, field, reason });
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    errors.push({
      file,
      line: null,
      field: null,
      reason: (error as Error).message,
    });
    return { provider: null, errors };
  }
  if (!isObject(root)) {
    errors.push({
      file,
      line: null,
      field: null,
      reason: "the provider must be a JSON object",
    });
    return { provider: null, errors };
  }
  readObject(
    root,
    "",
    { required: ["name", "country", "signatures"], optional: ["parent"] },
    report,
  );
  const company = readCompany(root, "", report);
  const parentObject =
    root["parent"] === undefined
      ? null
      : readObject(
          root["parent"],
          "parent",
          { required: ["name", "country"], optional: [] },
          report,
        );
  const parent = parentObject && readCompany(parentObject, "parent", report);

  const signatures =
    root["signatures"] === undefined
      ? null
      : readObject(
          root["signatures"],
          "signatures",
          { required: [], optional: ["headers", "cookies", "server", "cname"] },
          report,
        );
  const name = (key: string): Field => ({ key, kind: "name", optional: false });
  const headers = readSignatures(
    signatures?.["headers"],
    "signatures.headers",
    [name("name"), { key: "value", kind: "value", optional: true }],
    report,
  );
  const cookies = readSignatures(
    signatures?.["cookies"],
    "signatures.cookies",
    [name("name")],
    report,
  );
  const server = readSignatures(
    signatures?.["server"],
    "signatures.server",
    [{ key: "value", kind: "value", optional: false }],
    report,
  );
  const cname = readSignatures(
    signatures?.["cname"],
    "signatures.cname",
    [{ key: "suffix", kind: "domain", optional: false }],
    report,
  );

  if (errors.length > 0 || company === null) {
    return { provider: null, errors };
  }
  const only = (rows: (string | null)[][]) => rows.map((row) => row[0] ?? "");
  return {
    provider: {
      ...company,
      parent,
      headers: headers.map(([header, value]) => ({
        name: header ?? "",
        value: value ?? null,
      })),
      cookies: only(cookies),
      server: only(server),
      cname: only(cname),
    },
    errors,
  };
}

export interface RangesFile {
  sources: string[];
  fetched: string | null;
  ranges: string[];
  errors: DataError[];
}

export function parseRangesFile(text: string, file: string): RangesFile {
  const result: RangesFile = {
    sources: [],
    fetched: null,
    ranges: [],
    errors: [],
  };
  const report = (reason: string, line: number) =>
    result.errors.push({ file, line, field: null, reason });
  const seen = new Map<string, number>();
  let fetchedLine = false;
  for (const [index, raw] of text.split("\n").entries()) {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    if (line.startsWith("#")) {
      const header = /^#\s*(Source|Fetched):\s*(.*)$/.exec(line);
      const value = header?.[2]?.trim() ?? "";
      if (header?.[1] === "Source" && value !== "") {
        result.sources.push(value);
      } else if (header?.[1] === "Fetched") {
        fetchedLine = true;
        const date = new Date(`${value}T00:00:00Z`);
        if (
          !DATE.test(value) ||
          Number.isNaN(date.getTime()) ||
          date.toISOString().slice(0, 10) !== value
        ) {
          report(`"# Fetched:" must give a date as YYYY-MM-DD`, lineNumber);
        } else if (result.fetched !== null) {
          report(`"# Fetched:" is given twice`, lineNumber);
        } else {
          result.fetched = value;
        }
      }
      continue;
    }
    const range = parseCidr(line);
    if (!range.ok) {
      report(range.reason, lineNumber);
      continue;
    }
    const { family, network, prefixLength } = range.value;
    const key = `${family}/${network}/${prefixLength}`;
    const first = seen.get(key);
    if (first !== undefined) {
      report(`"${line}" is given twice, first on line ${first}`, lineNumber);
      continue;
    }
    seen.set(key, lineNumber);
    result.ranges.push(line.toLowerCase());
  }
  if (result.sources.length === 0) {
    report(`a "# Source:" line must say where the list comes from`, 1);
  }
  if (!fetchedLine) {
    report(`a "# Fetched:" line must give the date of the list`, 1);
  }
  return result;
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function fileError(file: string, reason: string): DataError {
  return { file, line: null, field: null, reason };
}

export function loadProviders(dir: string): {
  table: ProviderEntry[];
  errors: DataError[];
} {
  const table: ProviderEntry[] = [];
  const errors: DataError[] = [];
  for (const id of readdirSync(dir).sort()) {
    const folder = join(dir, id);
    if (!statSync(folder).isDirectory() || !ID.test(id)) {
      errors.push(
        fileError(
          folder,
          "a provider is a folder named by its id, in lowercase letters, digits and hyphens",
        ),
      );
      continue;
    }
    for (const file of readdirSync(folder).sort()) {
      if (!PROVIDER_FILES.includes(file)) {
        errors.push(
          fileError(
            join(folder, file),
            `unknown file, a provider folder holds only ${PROVIDER_FILES.join(", ")}`,
          ),
        );
      }
    }
    const jsonPath = join(folder, "provider.json");
    const json = readIfPresent(jsonPath);
    if (json === null) {
      errors.push(fileError(folder, "provider.json is missing"));
      continue;
    }
    const { provider, errors: providerErrors } = parseProviderJson(
      json,
      jsonPath,
    );
    errors.push(...providerErrors);
    const rangesPath = join(folder, "ranges.txt");
    const rangesText = readIfPresent(rangesPath);
    const ranges =
      rangesText === null ? null : parseRangesFile(rangesText, rangesPath);
    errors.push(...(ranges?.errors ?? []));
    if (provider !== null && (ranges === null || ranges.errors.length === 0)) {
      table.push({ id, ...provider, ranges: ranges?.ranges ?? [] });
    }
  }
  return { table, errors };
}

export function formatError(error: DataError): string {
  if (error.line !== null) {
    return `${error.file}:${error.line}: ${error.reason}`;
  }
  if (error.field !== null) {
    return `${error.file}: ${error.field}: ${error.reason}`;
  }
  return `${error.file}: ${error.reason}`;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Submits the version of a tag to the listed channel of addons.mozilla.org,
// as the pipeline of the tag does. With --dry-run, it builds and writes
// everything, shows what it would send and sends nothing.
//
//   npm run release -- <tag> <output folder> [--dry-run]
//
// The package is built as the reviewers of addons.mozilla.org rebuild it: from
// the source archive of the tag, unpacked in an empty folder, by npm ci and
// npm run build. The notes come from amo/ of the working tree, which in the
// pipeline is the tag itself.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NOTE_LOCALES,
  readReleaseNotes,
  reviewerNotes,
  versionMetadata,
  versionOfTag,
} from "./amo.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

// Neither npm nor web-ext asks the registry whether it has a newer version of
// itself, which keeps a dry run free of any request.
const env = {
  ...process.env,
  NO_UPDATE_NOTIFIER: "1",
  npm_config_update_notifier: "false",
};

function run(command: string, args: string[], cwd = root): void {
  try {
    execFileSync(command, args, { cwd, env, stdio: "inherit" });
  } catch {
    // The command has already said why on the inherited output.
    throw new Error(`${command} ${args[0]} failed`);
  }
}

function output(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
  }).trim();
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(root, file), "utf8")) as T;
}

function describeFile(file: string): string {
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  return `${basename(file)}  ${statSync(file).size} bytes  sha256 ${sha256}`;
}

function release(tag: string, out: string, dryRun: boolean): void {
  const manifest = readJson<{
    version: string;
    browser_specific_settings: { gecko: { id: string } };
  }>("manifest.json");
  const version = versionOfTag(tag, manifest.version);
  const id = manifest.browser_specific_settings.gecko.id;
  const name = `${readJson<{ name: string }>("package.json").name}-${version}`;

  if (
    !dryRun &&
    (!process.env["WEB_EXT_API_KEY"] || !process.env["WEB_EXT_API_SECRET"])
  ) {
    throw new Error(
      "WEB_EXT_API_KEY or WEB_EXT_API_SECRET is not set: protected CI/CD variables only reach the pipeline of a protected tag (pattern v*)",
    );
  }

  const releaseNotes = readReleaseNotes(
    join(root, "amo", "release-notes"),
    version,
  );
  const approvalNotes = reviewerNotes(
    readFileSync(join(root, "amo", "reviewer-notes.txt"), "utf8"),
    { version, node: process.versions.node, npm: output("npm", ["--version"]) },
  );

  // As the manual releases did: a version is an annotated tag.
  if (output("git", ["cat-file", "-t", tag]) !== "tag") {
    throw new Error(
      `${tag} is not an annotated tag: tag with git tag -a or -s`,
    );
  }

  mkdirSync(out, { recursive: true });
  const work = join(out, "work");
  rmSync(work, { recursive: true, force: true });
  try {
    const sources = join(out, `${name}-src.zip`);
    run("git", [
      "archive",
      "--format=zip",
      `--prefix=${name}/`,
      "-o",
      sources,
      tag,
    ]);
    run("unzip", ["-q", sources, "-d", work]);
    const tree = join(work, name);
    // A dry run takes the packages from the npm cache only, so that it sends
    // nothing, not even to the registry.
    run(
      "npm",
      ["ci", "--no-audit", "--no-fund", ...(dryRun ? ["--offline"] : [])],
      tree,
    );
    run("npm", ["run", "build"], tree);
    const xpi = join(out, `${name}.xpi`);
    copyFileSync(join(tree, "web-ext-artifacts", `${name}.xpi`), xpi);

    const metadata = join(out, "amo-metadata.json");
    writeFileSync(
      metadata,
      `${JSON.stringify(versionMetadata(releaseNotes, approvalNotes), null, 2)}\n`,
    );

    // web-ext sign packages --source-dir itself, with the same rules as
    // web-ext build: the package it sends holds the files of the one kept
    // here. It does not wait for the approval, which can take a day, and
    // would fail the job once its wait runs out.
    const sign = [
      "sign",
      "--channel",
      "listed",
      "--source-dir",
      join(tree, "dist"),
      "--artifacts-dir",
      out,
      "--amo-metadata",
      metadata,
      "--upload-source-code",
      sources,
      "--approval-timeout",
      "0",
    ];
    const webExt = join(tree, "node_modules", ".bin", "web-ext");

    // Shown in both modes, so that the log of the job keeps what was sent.
    console.log(
      [
        "",
        `${dryRun ? "Dry run of the submission" : "Submission"} of ${tag} to addons.mozilla.org.`,
        `Add-on ${id}, version ${version}, channel listed.`,
        "",
        `Files, in ${out}:`,
        `  ${describeFile(xpi)}`,
        "    the package, which web-ext sign makes again from the same dist/",
        `  ${describeFile(sources)}`,
        "    the source archive of the tag, sent with the version",
        `  ${basename(metadata)}`,
        "    the fields of the version: its release notes and the notes for the reviewers",
        ...NOTE_LOCALES.flatMap((locale) => [
          "",
          `Release notes, ${locale}:`,
          releaseNotes[locale],
        ]),
        "",
        "Notes for the reviewers:",
        approvalNotes,
        "",
        `${dryRun ? "Would run" : "Runs"}, with WEB_EXT_API_KEY and WEB_EXT_API_SECRET from the environment:`,
        `  web-ext ${sign.join(" ")}`,
        "",
      ].join("\n"),
    );
    if (dryRun) {
      console.log("Dry run: nothing was sent.");
      return;
    }
    run(webExt, sign);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [tag, out, ...rest] = args.filter((arg) => arg !== "--dry-run");
if (tag === undefined || out === undefined || rest.length > 0) {
  console.error("usage: npm run release -- <tag> <output folder> [--dry-run]");
  process.exit(2);
}
try {
  release(tag, resolve(out), dryRun);
} catch (error) {
  // A stack trace says nothing to whoever opens a red pipeline.
  console.error((error as Error).message);
  process.exit(1);
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// What a version sends to addons.mozilla.org besides its package and its
// sources: the release notes of the listing and the notes for the reviewers,
// read from amo/, and the check that the tag names the version of the
// manifest.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The languages of the release notes, under the codes addons.mozilla.org gives
// them: en-US, the default locale of the listing, and French.
export const NOTE_LOCALES = ["en-US", "fr"] as const;
export type NoteLocale = (typeof NOTE_LOCALES)[number];
export type ReleaseNotes = Record<NoteLocale, string>;

// addons-server holds the release notes of each language and the notes for
// the reviewers to 3000 characters (max_length of Version.release_notes and
// Version.approval_notes), counted as Python counts them, by code point.
export const NOTES_MAX_LENGTH = 3000;

// vX.Y.Z and nothing else, without leading zeros.
const VERSION_TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;

// The version a tag publishes, which must be the one of the manifest: a
// package whose number contradicts its tag is a release nobody can trace back
// to a commit.
export function versionOfTag(tag: string, manifestVersion: string): string {
  const version = VERSION_TAG.exec(tag)?.[1];
  if (version === undefined) {
    throw new Error(
      `tag "${tag}" is not a version tag: it reads vX.Y.Z, such as v1.2.0`,
    );
  }
  if (version !== manifestVersion) {
    throw new Error(
      `tag ${tag} against manifest.json ${manifestVersion}: raise the version in manifest.json, commit, and tag that commit`,
    );
  }
  return version;
}

function lengthOf(text: string): number {
  return [...text].length;
}

export function releaseNotesFile(
  dir: string,
  version: string,
  locale: NoteLocale,
): string {
  return join(dir, `${version}.${locale}.md`);
}

// The release notes of a version, one file per language, all of them
// required: a version without its notes is not submitted. Every problem is
// reported at once.
export function readReleaseNotes(dir: string, version: string): ReleaseNotes {
  const notes: Partial<ReleaseNotes> = {};
  const problems: string[] = [];
  for (const locale of NOTE_LOCALES) {
    const file = releaseNotesFile(dir, version, locale);
    if (!existsSync(file)) {
      problems.push(`${file} is missing`);
      continue;
    }
    const text = readFileSync(file, "utf8").trim();
    const length = lengthOf(text);
    if (length === 0) {
      problems.push(`${file} is empty`);
    } else if (length > NOTES_MAX_LENGTH) {
      problems.push(
        `${file} runs to ${length} characters, over ${NOTES_MAX_LENGTH}`,
      );
    } else {
      notes[locale] = text;
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the release notes of ${version} are not ready, they go in the commit of the version:\n${problems.join("\n")}`,
    );
  }
  return notes as ReleaseNotes;
}

// What the build of a version is made with, which the notes for the reviewers
// name, since they rebuild it and compare.
export interface BuildFacts {
  version: string;
  node: string;
  npm: string;
}

export function reviewerNotes(template: string, facts: BuildFacts): string {
  const text = template
    .replaceAll("{version}", facts.version)
    .replaceAll("{node}", facts.node)
    .replaceAll("{npm}", facts.npm)
    .trim();
  const length = lengthOf(text);
  if (length > NOTES_MAX_LENGTH) {
    throw new Error(
      `the notes for the reviewers run to ${length} characters, over ${NOTES_MAX_LENGTH}`,
    );
  }
  return text;
}

// The fields web-ext sign adds to the version it creates (--amo-metadata),
// named as in the Version Create request of the add-ons API v5. None at the
// top level, where it would rewrite the listing at every version.
export function versionMetadata(
  releaseNotes: ReleaseNotes,
  approvalNotes: string,
): { version: { release_notes: ReleaseNotes; approval_notes: string } } {
  return {
    version: { release_notes: releaseNotes, approval_notes: approvalNotes },
  };
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  NOTES_MAX_LENGTH,
  readReleaseNotes,
  reviewerNotes,
  versionMetadata,
  versionOfTag,
} from "../scripts/amo.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const root = mkdtempSync(join(tmpdir(), "amo-"));
after(() => rmSync(root, { recursive: true, force: true }));

// A folder of release notes, each file written under its name.
function notes(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdirSync(dir);
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

describe("the version of a tag", () => {
  it("is the tag without its v when the manifest has the same", () => {
    assert.equal(versionOfTag("v1.2.0", "1.2.0"), "1.2.0");
    assert.equal(versionOfTag("v0.10.3", "0.10.3"), "0.10.3");
  });

  it("stops the release when the manifest has another, naming both", () => {
    assert.throws(
      () => versionOfTag("v1.2.0", "1.1.0"),
      /tag v1\.2\.0 against manifest\.json 1\.1\.0/,
    );
  });

  it("refuses a tag that is not vX.Y.Z", () => {
    for (const tag of [
      "1.2.0",
      "v1.2",
      "v1.2.0.1",
      "v1.2.0-rc.1",
      "v1.2.0+build",
      "v01.2.0",
      "V1.2.0",
      "release-1.2.0",
      "",
    ]) {
      assert.throws(() => versionOfTag(tag, "1.2.0"), /not a version tag/, tag);
    }
  });
});

describe("the release notes of a version", () => {
  it("are read in English and French, without the blank lines around them", () => {
    const dir = notes("both", {
      "1.2.0.en-US.md": "- First change.\n- Second change.\n\n",
      "1.2.0.fr.md": "\n- Premier changement.\n",
      "1.1.0.en-US.md": "Another version.\n",
    });
    assert.deepEqual(readReleaseNotes(dir, "1.2.0"), {
      "en-US": "- First change.\n- Second change.",
      fr: "- Premier changement.",
    });
  });

  it("stop the release when the version has none, naming each missing file", () => {
    const dir = notes("none", { "1.1.0.en-US.md": "x", "1.1.0.fr.md": "x" });
    assert.throws(
      () => readReleaseNotes(dir, "1.2.0"),
      (error: Error) =>
        error.message.includes(join(dir, "1.2.0.en-US.md")) &&
        error.message.includes(join(dir, "1.2.0.fr.md")),
    );
  });

  it("stop the release when one language is missing", () => {
    const dir = notes("english-only", { "1.2.0.en-US.md": "Changes." });
    assert.throws(
      () => readReleaseNotes(dir, "1.2.0"),
      (error: Error) =>
        error.message.includes(`${join(dir, "1.2.0.fr.md")} is missing`) &&
        !error.message.includes("en-US"),
    );
  });

  it("take no file under another name for a language", () => {
    const dir = notes("other-names", {
      "1.2.0.en.md": "Changes.",
      "1.2.0.fr.md": "Changements.",
    });
    assert.throws(
      () => readReleaseNotes(dir, "1.2.0"),
      /1\.2\.0\.en-US\.md is missing/,
    );
  });

  it("stop the release when a file holds only blank lines", () => {
    const dir = notes("blank", {
      "1.2.0.en-US.md": "Changes.",
      "1.2.0.fr.md": " \n\n",
    });
    assert.throws(
      () => readReleaseNotes(dir, "1.2.0"),
      /1\.2\.0\.fr\.md is empty/,
    );
  });

  it("hold up to the limit of addons.mozilla.org, counted in characters", () => {
    // 3000 accented letters and 3000 emoji: 6000 and 12000 bytes, and the
    // emoji 6000 UTF-16 units, but 3000 characters each.
    const dir = notes("at-limit", {
      "1.2.0.en-US.md": "é".repeat(NOTES_MAX_LENGTH),
      "1.2.0.fr.md": "🙂".repeat(NOTES_MAX_LENGTH),
    });
    assert.equal(
      [...readReleaseNotes(dir, "1.2.0").fr].length,
      NOTES_MAX_LENGTH,
    );
  });

  it("stop the release one character over the limit", () => {
    const dir = notes("over-limit", {
      "1.2.0.en-US.md": "a".repeat(NOTES_MAX_LENGTH + 1),
      "1.2.0.fr.md": "Changements.",
    });
    assert.throws(
      () => readReleaseNotes(dir, "1.2.0"),
      /1\.2\.0\.en-US\.md runs to 3001 characters, over 3000/,
    );
  });
});

describe("the notes for the reviewers", () => {
  const facts = { version: "1.2.0", node: "24.14.0", npm: "11.9.0" };

  it("name the package of the version and what built it, wherever the template asks", () => {
    assert.equal(
      reviewerNotes(
        "web-ext-artifacts/firefox-cloudleak-{version}.xpi\nNode {node}, npm {npm}, again {version}\n",
        facts,
      ),
      "web-ext-artifacts/firefox-cloudleak-1.2.0.xpi\nNode 24.14.0, npm 11.9.0, again 1.2.0",
    );
  });

  it("hold up to the limit once filled, whatever the length of the template", () => {
    // The template runs over the limit, the notes it gives do not.
    const template = `${"a".repeat(NOTES_MAX_LENGTH - "1.0.0".length)}{version}`;
    assert.equal(
      reviewerNotes(template, { ...facts, version: "1.0.0" }).length,
      NOTES_MAX_LENGTH,
    );
    assert.throws(
      () => reviewerNotes(template, { ...facts, version: "1.0.10" }),
      /run to 3001 characters, over 3000/,
    );
  });
});

describe("the fields of the version", () => {
  it("are the release notes and the notes for the reviewers inside version, and nothing at the top level", () => {
    assert.deepEqual(
      versionMetadata({ "en-US": "Changes.", fr: "Changements." }, "Build."),
      {
        version: {
          release_notes: { "en-US": "Changes.", fr: "Changements." },
          approval_notes: "Build.",
        },
      },
    );
  });
});

describe("the committed notes", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "manifest.json"), "utf8"),
  ) as { version: string };

  it("hold the release notes of the version of the manifest, which its tag submits", () => {
    readReleaseNotes(join(ROOT, "amo", "release-notes"), manifest.version);
  });

  it("give the reviewers the package of the version", () => {
    const text = reviewerNotes(
      readFileSync(join(ROOT, "amo", "reviewer-notes.txt"), "utf8"),
      { version: manifest.version, node: "24.14.0", npm: "11.9.0" },
    );
    assert.match(
      text,
      new RegExp(
        `web-ext-artifacts/firefox-cloudleak-${manifest.version.replaceAll(".", "\\.")}\\.xpi`,
      ),
    );
    assert.doesNotMatch(text, /\{(version|node|npm)\}/);
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The preferences page, compiled with the extension into build/extension/,
// driven by a stand-in for Firefox's browser object and for the DOM of
// options.html.

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { IgnoredData, PopupRequest } from "../src/core/popup-message.js";
import { importModule } from "./built-extension.js";
import { type Element, find, htmlOf, installPage, settled } from "./dom.js";
import { OPTIONS_MESSAGES } from "./messages.js";

const HTML = htmlOf("options/options.html");

interface Site {
  siteOfTyped(text: string): string | null;
}

// The registrable domain of the hosts of these tests, and the display form
// of their sites, as Firefox would give them.
function getDomain(
  host: string,
  options?: { readonly encoding?: string },
): string | null {
  if (options?.encoding === "display") {
    return host === "xn--bcher-kva.de" ? "bücher.de" : host;
  }
  return host.split(".").slice(-2).join(".");
}

interface Options {
  // The sites the event page holds as ignored.
  readonly sites?: readonly string[];
  // Whether the event page names no site for any text.
  readonly refuse?: boolean;
  readonly failing?: Error;
}

interface Opened {
  readonly sent: PopupRequest[];
  readonly root: Element;
  element(id: string): Element;
  // Each row as its text, its button and the accessible name of its button.
  rows(): string[][];
  type(text: string): void;
  // How many times the page kept the form from being sent.
  submit(): number;
}

let opened = 0;

async function open(options: Options = {}): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const root = installPage(HTML);
  let held = [...(options.sites ?? [])].sort();
  (globalThis as Record<string, unknown>)["browser"] = {
    runtime: {
      // The event page reduces the text as the page does, by the same code.
      sendMessage: async (request: PopupRequest): Promise<IgnoredData> => {
        sent.push(request);
        if (options.failing !== undefined) {
          throw options.failing;
        }
        const { siteOfTyped } = await importModule<Site>("site.js");
        switch (request.kind) {
          case "ignoreSite": {
            const site = options.refuse ? null : siteOfTyped(request.host);
            if (site !== null && !held.includes(site)) {
              held = [...held, site].sort();
            }
            return { sites: held, site };
          }
          case "unignoreSite":
            held = held.filter((site) => site !== request.site);
            return { sites: held, site: request.site };
          case "ignoredSites":
            return { sites: held, site: null };
          default:
            throw new Error(`unexpected ${request.kind}`);
        }
      },
    },
    i18n: {
      getMessage: (name: string, substitutions: string[] = []) =>
        [name, ...substitutions].join(" "),
      getUILanguage: () => "fr",
    },
    publicSuffix: { getDomain },
  };
  opened += 1;
  // A module runs once per URL, so each page gets its own.
  await importModule(`options.js?${opened}`);
  await settled();
  const element = (id: string): Element => find(root, id);
  return {
    sent,
    root,
    element,
    rows: () =>
      element("sites").children.map((row) => [
        ...row.children.map((part) => part.textContent),
        row.children[1]?.attributes.get("aria-label") ?? "",
      ]),
    type: (text) => {
      element("typed").value = text;
      element("typed").dispatch("input");
    },
    submit: () => {
      let kept = 0;
      element("add").dispatch("submit", {
        preventDefault: () => {
          kept += 1;
        },
      });
      return kept;
    },
  };
}

// Which of the help, the preview and the error the line under the field
// shows, and what it says: of the preview, the site after its fixed label.
function note(page: Opened): string[] {
  return [
    ["help", "help"],
    ["preview", "preview-site"],
    ["error", "error"],
  ].flatMap(([id = "", said = ""]) =>
    page.element(id).hidden ? [] : [id, page.element(said).textContent],
  );
}

describe("the preferences page", () => {
  it("asks the event page for the ignored sites, and lists them as the popup writes them, in the order of what is read", async () => {
    const page = await open({
      sites: ["twitch.tv", "xn--bcher-kva.de", "youtube.com"],
    });
    assert.deepEqual(page.sent, [{ kind: "ignoredSites" }]);
    assert.equal(page.root.lang, "fr");
    assert.equal(page.element("sites").hidden, false);
    assert.equal(page.element("empty").hidden, true);
    assert.deepEqual(page.rows(), [
      ["bücher.de", "optionsRemove", "optionsRemoveSite bücher.de"],
      ["twitch.tv", "optionsRemove", "optionsRemoveSite twitch.tv"],
      ["youtube.com", "optionsRemove", "optionsRemoveSite youtube.com"],
    ]);
    assert.deepEqual(note(page), ["help", "optionsHelp"]);
  });

  it("writes every fixed label from its message, each known to the locales", async () => {
    const page = await open();
    const labels = [...page.root.all()].filter(
      (entry) => entry.dataset["message"] !== undefined,
    );
    assert.ok(labels.length >= 7);
    for (const label of labels) {
      const message = label.dataset["message"] ?? "";
      assert.ok(OPTIONS_MESSAGES.includes(message), message);
      assert.equal(label.textContent, message);
    }
  });

  it("says how to ignore a site when none is ignored", async () => {
    const page = await open();
    assert.equal(page.element("sites").hidden, true);
    assert.equal(page.element("empty").hidden, false);
    assert.deepEqual(page.rows(), []);
  });

  it("removes a site at once, by the name the event page gave it, and lists what the event page answers", async () => {
    const page = await open({ sites: ["twitch.tv", "xn--bcher-kva.de"] });
    page.element("sites").children[0]?.children[1]?.click();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "unignoreSite", site: "xn--bcher-kva.de" },
    ]);
    assert.deepEqual(page.rows(), [
      ["twitch.tv", "optionsRemove", "optionsRemoveSite twitch.tv"],
    ]);
    page.element("sites").children[0]?.children[1]?.click();
    await settled();
    assert.equal(page.element("sites").hidden, true);
    assert.equal(page.element("empty").hidden, false);
  });

  it("shows the site a text gives while it is typed, without sending it", async () => {
    const page = await open();
    page.type("https://www.xn--bcher-kva.de/buch?id=1");
    assert.deepEqual(note(page), ["preview", "bücher.de"]);
    assert.equal(page.element("typed").attributes.get("aria-invalid"), "false");
    page.type("www.twitch.tv");
    assert.deepEqual(note(page), ["preview", "twitch.tv"]);
    page.type("");
    assert.deepEqual(note(page), ["help", "optionsHelp"]);
    assert.deepEqual(page.sent, [{ kind: "ignoredSites" }]);
  });

  it("adds the site of the text on the event page's word, empties the field, and lists the answer", async () => {
    const page = await open({ sites: ["youtube.com"] });
    page.type("https://www.twitch.tv/directory");
    assert.equal(page.submit(), 1);
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "ignoreSite", host: "https://www.twitch.tv/directory" },
    ]);
    assert.deepEqual(page.rows(), [
      ["twitch.tv", "optionsRemove", "optionsRemoveSite twitch.tv"],
      ["youtube.com", "optionsRemove", "optionsRemoveSite youtube.com"],
    ]);
    assert.equal(page.element("typed").value, "");
    assert.deepEqual(note(page), ["help", "optionsHelp"]);
  });

  it("refuses a text that names no site, sends nothing, and keeps it to be corrected", async () => {
    const page = await open();
    page.type("twitch tv");
    assert.deepEqual(note(page), ["error", "optionsRefused twitch tv"]);
    assert.equal(page.element("typed").attributes.get("aria-invalid"), "true");
    assert.equal(page.submit(), 1);
    await settled();
    assert.deepEqual(page.sent, [{ kind: "ignoredSites" }]);
    assert.equal(page.element("typed").value, "twitch tv");
    assert.deepEqual(note(page), ["error", "optionsRefused twitch tv"]);
  });

  it("refuses what the event page refuses, whatever the page made of it", async () => {
    const page = await open({ refuse: true });
    page.type("twitch.tv");
    assert.deepEqual(note(page), ["preview", "twitch.tv"]);
    page.submit();
    await settled();
    assert.deepEqual(page.sent.slice(1), [
      { kind: "ignoreSite", host: "twitch.tv" },
    ]);
    assert.equal(page.element("typed").value, "twitch.tv");
    assert.deepEqual(note(page), ["error", "optionsRefused twitch.tv"]);
    assert.deepEqual(page.rows(), []);
  });

  it("sends nothing for an empty field, and goes on saying how to name a site", async () => {
    const page = await open();
    page.type("   ");
    page.submit();
    await settled();
    assert.deepEqual(page.sent, [{ kind: "ignoredSites" }]);
    assert.deepEqual(note(page), ["help", "optionsHelp"]);
    assert.equal(page.element("typed").attributes.get("aria-invalid"), "false");
  });

  it("says when the site of the text is already ignored, and no longer once it is removed", async () => {
    const page = await open({ sites: ["twitch.tv"] });
    page.type("www.twitch.tv");
    assert.deepEqual(note(page), ["error", "optionsAlready twitch.tv"]);
    assert.equal(page.element("typed").attributes.get("aria-invalid"), "false");
    page.element("sites").children[0]?.children[1]?.click();
    await settled();
    assert.deepEqual(note(page), ["preview", "twitch.tv"]);
  });

  it("reports an event page that does not answer, and keeps what was typed", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        failing: new Error("Receiving end does not exist"),
      });
      assert.equal(errors.mock.callCount(), 1);
      assert.match(
        String(errors.mock.calls[0]?.arguments[0]),
        /^Cloud Leak: .*Receiving end/,
      );
      page.type("twitch.tv");
      page.submit();
      await settled();
      assert.equal(errors.mock.callCount(), 2);
      assert.equal(page.element("typed").value, "twitch.tv");
    } finally {
      errors.mock.restore();
    }
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The preferences page, compiled with the extension into build/extension/,
// driven by a stand-in for Firefox's browser object and for the DOM of
// options.html.

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type {
  IgnoredData,
  PopupRequest,
  Settings,
} from "../src/core/popup-message.js";
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
  // The settings the event page keeps.
  readonly settings?: Settings;
  // Whether the event page fails to change the settings.
  readonly settingsFail?: boolean;
}

// What the page asks the event page as it opens.
const LOADED: PopupRequest[] = [{ kind: "ignoredSites" }, { kind: "settings" }];

interface Opened {
  readonly sent: PopupRequest[];
  readonly root: Element;
  element(id: string): Element;
  // Each row as its text, its button and the accessible name of its button.
  rows(): string[][];
  type(text: string): void;
  // How many times the page kept the form from being sent.
  submit(): number;
  // The user chooses a level with its radio button.
  pick(id: string): void;
  // The user types a limit, then leaves the field.
  typeLimit(text: string): void;
  leaveLimit(): void;
  // Which radio button is checked, and what of the section is in view.
  record(): {
    checked: string[];
    question: boolean;
    limit: boolean;
    purged: boolean;
    error: boolean;
  };
}

let opened = 0;

async function open(options: Options = {}): Promise<Opened> {
  const sent: PopupRequest[] = [];
  const root = installPage(HTML);
  let held = [...(options.sites ?? [])].sort();
  let settings: Settings = options.settings ?? {
    record: "none",
    recordLimit: 100,
    dynamic: false,
  };
  (globalThis as Record<string, unknown>)["browser"] = {
    runtime: {
      // The event page reduces the text as the page does, by the same code.
      sendMessage: async (
        request: PopupRequest,
      ): Promise<IgnoredData | Settings> => {
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
          case "settings":
            return settings;
          case "setSettings":
            if (options.settingsFail) {
              throw new Error("storage failed");
            }
            settings = {
              record: request.record,
              recordLimit: request.recordLimit,
              dynamic: request.dynamic,
            };
            return settings;
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
    pick: (id) => {
      for (const radio of RADIOS) {
        element(radio).checked = radio === id;
      }
      element(id).dispatch("change");
    },
    typeLimit: (text) => {
      element("limit").value = text;
      element("limit").dispatch("input");
    },
    leaveLimit: () => element("limit").dispatch("change"),
    record: () => ({
      checked: RADIOS.filter((radio) => element(radio).checked),
      question: !element("record-question").hidden,
      limit: !element("record-limit").hidden,
      purged: !element("record-purged").hidden,
      error: !element("limit-error").hidden,
    }),
  };
}

const RADIOS = ["record-none", "record-level4", "record-level3and4"];

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
    assert.deepEqual(page.sent, LOADED);
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
    assert.deepEqual(page.sent.slice(LOADED.length), [
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
    assert.deepEqual(page.sent, LOADED);
  });

  it("adds the site of the text on the event page's word, empties the field, and lists the answer", async () => {
    const page = await open({ sites: ["youtube.com"] });
    page.type("https://www.twitch.tv/directory");
    assert.equal(page.submit(), 1);
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
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
    assert.deepEqual(page.sent, LOADED);
    assert.equal(page.element("typed").value, "twitch tv");
    assert.deepEqual(note(page), ["error", "optionsRefused twitch tv"]);
  });

  it("refuses what the event page refuses, whatever the page made of it", async () => {
    const page = await open({ refuse: true });
    page.type("twitch.tv");
    assert.deepEqual(note(page), ["preview", "twitch.tv"]);
    page.submit();
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
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
    assert.deepEqual(page.sent, LOADED);
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
      assert.equal(errors.mock.callCount(), 2);
      for (const call of errors.mock.calls) {
        assert.match(String(call.arguments[0]), /^Cloud Leak: .*Receiving end/);
      }
      assert.equal(page.element("record").hidden, true);
      page.type("twitch.tv");
      page.submit();
      await settled();
      assert.equal(errors.mock.callCount(), 3);
      assert.equal(page.element("typed").value, "twitch.tv");
    } finally {
      errors.mock.restore();
    }
  });
});

describe("the recording of addresses in the preferences", () => {
  it("shows the level the event page keeps, records nothing by default, and hides the limit until something is recorded", async () => {
    const page = await open();
    assert.equal(page.element("record").hidden, false);
    assert.deepEqual(page.record(), {
      checked: ["record-none"],
      question: false,
      limit: false,
      purged: false,
      error: false,
    });
    assert.equal(page.element("limit").value, "100");
  });

  it("applies a level at once, with the limit kept, and shows the limit", async () => {
    const page = await open();
    page.pick("record-level4");
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
      {
        kind: "setSettings",
        record: "level4",
        recordLimit: 100,
        dynamic: false,
      },
    ]);
    assert.deepEqual(page.record(), {
      checked: ["record-level4"],
      question: false,
      limit: true,
      purged: false,
      error: false,
    });
    page.pick("record-level3and4");
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length + 1), [
      {
        kind: "setSettings",
        record: "level3and4",
        recordLimit: 100,
        dynamic: false,
      },
    ]);
    assert.deepEqual(page.record().checked, ["record-level3and4"]);
  });

  it("asks before going back to none, hides the limit meanwhile, and changes nothing before the answer", async () => {
    const page = await open({
      settings: { record: "level3and4", recordLimit: 40, dynamic: false },
    });
    assert.deepEqual(page.record().checked, ["record-level3and4"]);
    assert.equal(page.element("limit").value, "40");
    page.pick("record-none");
    await settled();
    assert.deepEqual(page.sent, LOADED);
    assert.deepEqual(page.record(), {
      checked: ["record-none"],
      question: true,
      limit: false,
      purged: false,
      error: false,
    });
  });

  it("goes back to the level kept when the question is cancelled, and sends nothing", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 100, dynamic: false },
    });
    page.pick("record-none");
    page.element("record-cancel").click();
    await settled();
    assert.deepEqual(page.sent, LOADED);
    assert.deepEqual(page.record(), {
      checked: ["record-level4"],
      question: false,
      limit: true,
      purged: false,
      error: false,
    });
  });

  it("goes back to none once the user confirms, and says the addresses are cleared until the next choice", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 30, dynamic: false },
    });
    page.pick("record-none");
    page.element("record-purge").click();
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
      { kind: "setSettings", record: "none", recordLimit: 30, dynamic: false },
    ]);
    assert.deepEqual(page.record(), {
      checked: ["record-none"],
      question: false,
      limit: false,
      purged: true,
      error: false,
    });
    page.pick("record-level4");
    await settled();
    assert.equal(page.record().purged, false);
  });

  it("drops the question when the level kept is chosen again, without sending it", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 100, dynamic: false },
    });
    page.pick("record-none");
    page.pick("record-level4");
    await settled();
    assert.deepEqual(page.sent, LOADED);
    assert.deepEqual(page.record(), {
      checked: ["record-level4"],
      question: false,
      limit: true,
      purged: false,
      error: false,
    });
  });

  it("asks nothing when the recording is already off", async () => {
    const page = await open();
    page.pick("record-level4");
    await settled();
    page.pick("record-none");
    await settled();
    assert.equal(page.record().question, true);
    page.element("record-purge").click();
    await settled();
    page.pick("record-none");
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
      {
        kind: "setSettings",
        record: "level4",
        recordLimit: 100,
        dynamic: false,
      },
      { kind: "setSettings", record: "none", recordLimit: 100, dynamic: false },
    ]);
    assert.equal(page.record().question, false);
  });

  it("keeps a limit with no maximum once the user leaves the field, not at each keystroke", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 100, dynamic: false },
    });
    for (const typed of ["2", "25", "250000"]) {
      page.typeLimit(typed);
      assert.equal(page.record().error, false, typed);
    }
    await settled();
    assert.deepEqual(page.sent, LOADED);
    page.leaveLimit();
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
      {
        kind: "setSettings",
        record: "level4",
        recordLimit: 250_000,
        dynamic: false,
      },
    ]);
    assert.equal(page.element("limit-help").hidden, false);
    assert.equal(page.element("limit").attributes.get("aria-invalid"), "false");
    page.leaveLimit();
    await settled();
    assert.equal(page.sent.length, LOADED.length + 1);
  });

  it("refuses a limit that is not an integer of at least 1, says so in place of the help, and keeps nothing", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 100, dynamic: false },
    });
    for (const typed of ["", "0", "-4", "2.5", "1e3", "abc"]) {
      page.typeLimit(typed);
      assert.equal(page.record().error, true, typed);
      assert.equal(page.element("limit-help").hidden, true, typed);
      assert.equal(
        page.element("limit").attributes.get("aria-invalid"),
        "true",
        typed,
      );
      page.leaveLimit();
    }
    await settled();
    assert.deepEqual(page.sent, LOADED);
    page.typeLimit("1");
    assert.equal(page.record().error, false);
  });

  it("shows again what the event page keeps when a change fails, and reports it", async () => {
    const errors = mock.method(console, "error", () => {});
    try {
      const page = await open({
        settings: { record: "level4", recordLimit: 100, dynamic: false },
        settingsFail: true,
      });
      page.pick("record-level3and4");
      await settled();
      assert.deepEqual(page.record().checked, ["record-level4"]);
      page.typeLimit("7");
      page.leaveLimit();
      await settled();
      assert.equal(page.element("limit").value, "100");
      page.pick("record-none");
      page.element("record-purge").click();
      await settled();
      assert.deepEqual(page.record(), {
        checked: ["record-level4"],
        question: false,
        limit: true,
        purged: false,
        error: false,
      });
      assert.equal(errors.mock.callCount(), 3);
      for (const call of errors.mock.calls) {
        assert.match(String(call.arguments[0]), /^Cloud Leak: .*storage/);
      }
    } finally {
      errors.mock.restore();
    }
  });

  it("shows the dynamic detection as the event page keeps it, off by default", async () => {
    const off = await open();
    assert.equal(off.element("dynamic").hidden, false);
    assert.equal(off.element("dynamic-on").checked, false);
    assert.equal(off.element("dynamic-purged").hidden, true);
    const on = await open({
      settings: { record: "none", recordLimit: 100, dynamic: true },
    });
    assert.equal(on.element("dynamic-on").checked, true);
  });

  it("turns the dynamic detection on and off at once, and says the supposed providers are purged only after it is turned off", async () => {
    const page = await open({
      settings: { record: "level4", recordLimit: 30, dynamic: false },
    });
    const box = page.element("dynamic-on");
    box.checked = true;
    box.dispatch("change");
    await settled();
    assert.equal(box.checked, true);
    assert.equal(page.element("dynamic-purged").hidden, true);
    box.checked = false;
    box.dispatch("change");
    await settled();
    assert.deepEqual(page.sent.slice(LOADED.length), [
      { kind: "setSettings", record: "level4", recordLimit: 30, dynamic: true },
      {
        kind: "setSettings",
        record: "level4",
        recordLimit: 30,
        dynamic: false,
      },
    ]);
    assert.equal(box.checked, false);
    assert.equal(page.element("dynamic-purged").hidden, false);
    // The recording is left as it was.
    assert.deepEqual(page.record().checked, ["record-level4"]);
    page.pick("record-level3and4");
    await settled();
    assert.equal(page.element("dynamic-purged").hidden, true);
  });

  it("shows the dynamic detection as kept again when its change fails", async () => {
    const page = await open({ settingsFail: true });
    const box = page.element("dynamic-on");
    box.checked = true;
    box.dispatch("change");
    await settled();
    assert.equal(box.checked, false);
  });
});

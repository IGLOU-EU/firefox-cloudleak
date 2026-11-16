// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The preferences page, options.html, which Firefox shows in the tab of the
// extension in about:addons. It asks the event page for the ignored sites and
// the settings, and puts them into the page through the view of
// core/options-view.ts.

import {
  type FieldNote,
  type IgnoredRow,
  limitOf,
  noteOf,
  recordViewOf,
  rowsOf,
} from "./core/options-view.js";
import type {
  IgnoredData,
  RecordLevel,
  Settings,
} from "./core/popup-message.js";
import { ask, element, text, writeLabels } from "./page.js";
import { siteOfTyped, siteText } from "./site.js";
import { report } from "./toolbar.js";

// As the event page last gave them, in punycode.
let sites: readonly string[] = [];

function field(): HTMLInputElement {
  return element("typed") as HTMLInputElement;
}

function rowOf(row: IgnoredRow): HTMLElement {
  const item = document.createElement("li");
  const name = document.createElement("span");
  name.className = "site";
  name.textContent = row.text;
  const remove = document.createElement("button");
  remove.setAttribute("type", "button");
  remove.setAttribute("aria-label", text(row.remove));
  remove.textContent = browser.i18n.getMessage("optionsRemove");
  remove.addEventListener("click", () => report(unignore(row.site)));
  item.append(name, remove);
  return item;
}

function renderSites(answer: IgnoredData): void {
  sites = answer.sites;
  const rows = rowsOf(sites, siteText);
  const list = element("sites");
  list.hidden = rows.length === 0;
  list.replaceChildren(...rows.map(rowOf));
  element("empty").hidden = rows.length > 0;
}

function renderNote(note: FieldNote): void {
  element("help").hidden = note.kind !== "help";
  element("preview").hidden = note.kind !== "preview";
  element("preview-site").textContent =
    note.kind === "preview" ? note.site : "";
  const error = element("error");
  const wrong = note.kind === "already" || note.kind === "refused";
  error.hidden = !wrong;
  error.textContent = wrong ? text(note.line) : "";
  field().setAttribute("aria-invalid", String(note.kind === "refused"));
}

// Reduced in the page at each change, by the code the event page reduces it
// with, so that what is typed goes to the event page only once it is added.
function typedNote(): FieldNote {
  const typed = field().value;
  return noteOf(typed, siteOfTyped(typed), sites, siteText);
}

async function load(): Promise<void> {
  renderSites(await ask<IgnoredData>({ kind: "ignoredSites" }));
  renderNote(typedNote());
}

// Nothing is lost by watching a site again, so the page asks nothing.
async function unignore(site: string): Promise<void> {
  renderSites(await ask<IgnoredData>({ kind: "unignoreSite", site }));
  renderNote(typedNote());
}

// The event page reduces the text again, and its answer is the one kept. A
// text it refuses stays in the field, to be corrected.
async function add(): Promise<void> {
  const typed = field().value;
  if (siteOfTyped(typed) === null) {
    renderNote(noteOf(typed, null, sites, siteText));
    return;
  }
  const answer = await ask<IgnoredData>({ kind: "ignoreSite", host: typed });
  renderSites(answer);
  if (answer.site === null) {
    renderNote(noteOf(typed, null, sites, siteText));
    return;
  }
  field().value = "";
  renderNote(typedNote());
}

// The radio button of each level.
const LEVELS: readonly (readonly [RecordLevel, string])[] = [
  ["none", "record-none"],
  ["level4", "record-level4"],
  ["level3and4", "record-level3and4"],
];

// As the event page last kept them, and the level the radio buttons show,
// which is none while the question before a purge waits. Null until the
// event page gives them.
let kept: Settings | null = null;
let chosen: RecordLevel = "none";

function limitField(): HTMLInputElement {
  return element("limit") as HTMLInputElement;
}

function renderRecord(settings: Settings, purged: boolean): void {
  const view = recordViewOf(settings.record, chosen);
  for (const [level, id] of LEVELS) {
    (element(id) as HTMLInputElement).checked = level === chosen;
  }
  element("record-question").hidden = !view.asking;
  element("record-limit").hidden = !view.limit;
  element("record-purged").hidden = !purged;
  element("record").hidden = false;
}

function renderLimit(): void {
  const valid = limitOf(limitField().value) !== null;
  element("limit-help").hidden = !valid;
  element("limit-error").hidden = valid;
  limitField().setAttribute("aria-invalid", String(!valid));
}

function dynamicBox(): HTMLInputElement {
  return element("dynamic-on") as HTMLInputElement;
}

// The box shows what the event page kept, and the notice says the supposed
// providers are purged right after the detection is turned off.
function renderDynamic(settings: Settings, purged: boolean): void {
  dynamicBox().checked = settings.dynamic;
  element("dynamic-purged").hidden = !purged;
  element("dynamic").hidden = false;
}

function show(settings: Settings, purged: boolean, dropped = false): void {
  kept = settings;
  chosen = settings.record;
  renderRecord(settings, purged);
  renderDynamic(settings, dropped);
}

async function loadSettings(): Promise<void> {
  const settings = await ask<Settings>({ kind: "settings" });
  limitField().value = String(settings.recordLimit);
  renderLimit();
  show(settings, false);
}

// The page shows what the event page kept, and what it kept before when the
// change fails, the limit included.
async function keep(
  previous: Settings,
  next: Settings,
  purging: boolean,
  dropping = false,
): Promise<void> {
  try {
    show(
      await ask<Settings>({ kind: "setSettings", ...next }),
      purging,
      dropping,
    );
  } catch (error: unknown) {
    limitField().value = String(previous.recordLimit);
    renderLimit();
    show(previous, false);
    throw error;
  }
}

// Going back to none purges the kept addresses, so the page asks first and
// changes nothing before the answer. Any other choice applies at once.
function choose(level: RecordLevel): void {
  if (kept === null) {
    return;
  }
  chosen = level;
  if (level === kept.record || recordViewOf(kept.record, level).asking) {
    renderRecord(kept, false);
    return;
  }
  report(keep(kept, { ...kept, record: level }, false));
}

function purge(): void {
  if (kept !== null) {
    report(keep(kept, { ...kept, record: "none" }, true));
  }
}

function cancel(): void {
  if (kept !== null) {
    show(kept, false);
  }
}

// Turning the dynamic detection off purges at once what the supposed
// providers left, which the line under the box says beforehand, so the page
// asks nothing.
function toggleDynamic(): void {
  if (kept === null) {
    return;
  }
  const dynamic = dynamicBox().checked;
  if (dynamic !== kept.dynamic) {
    report(keep(kept, { ...kept, dynamic }, false, !dynamic));
  }
}

// Kept once the user leaves the field or steps it, not at each keystroke:
// typing 250 would pass through 2, and a lower limit drops at once the
// addresses beyond it.
function changeLimit(): void {
  const limit = limitOf(limitField().value);
  if (kept === null || limit === null || limit === kept.recordLimit) {
    return;
  }
  report(keep(kept, { ...kept, recordLimit: limit }, false));
}

writeLabels();
field().addEventListener("input", () => renderNote(typedNote()));
// The page sends no form anywhere: Enter in the field adds, as the button does.
element("add").addEventListener("submit", (event) => {
  event.preventDefault();
  report(add());
});
for (const [level, id] of LEVELS) {
  element(id).addEventListener("change", () => choose(level));
}
element("record-purge").addEventListener("click", purge);
element("record-cancel").addEventListener("click", cancel);
dynamicBox().addEventListener("change", toggleDynamic);
limitField().addEventListener("input", renderLimit);
limitField().addEventListener("change", changeLimit);
report(load());
report(loadSettings());

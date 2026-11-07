// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The preferences page, options.html, which Firefox shows in the tab of the
// extension in about:addons. It asks the event page for the ignored sites and
// puts them into the page through the view of core/options-view.ts.

import {
  type FieldNote,
  type IgnoredRow,
  noteOf,
  rowsOf,
} from "./core/options-view.js";
import type { IgnoredData } from "./core/popup-message.js";
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

writeLabels();
field().addEventListener("input", () => renderNote(typedNote()));
// The page sends no form anywhere: Enter in the field adds, as the button does.
element("add").addEventListener("submit", (event) => {
  event.preventDefault();
  report(add());
});
report(load());

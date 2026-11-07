// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The page of the toolbar button, popup.html. It asks the event page what the
// active tab shows and puts the answer into the page through the view of
// core/popup-view.ts, which decides everything that is shown.

import type { TitleLine } from "./core/display.js";
import type {
  ClearedData,
  PopupData,
  PopupRequest,
} from "./core/popup-message.js";
import {
  cleared,
  type PopupView,
  type ProviderRows,
  type Row,
  viewOf,
} from "./core/popup-view.js";
import table from "./providers.js";
import { siteText } from "./site.js";
import { ICONS, report } from "./toolbar.js";

const language = browser.i18n.getUILanguage();
const dates = new Intl.DateTimeFormat(language, { dateStyle: "long" });
const numbers = new Intl.NumberFormat(language);

let data: PopupData | null = null;

function text(line: TitleLine): string {
  return browser.i18n.getMessage(line.message, [...line.substitutions]);
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`popup.html has no element "${id}"`);
  }
  return found;
}

// The cloud says what the text beside it says, so it reads as nothing more.
function cloudOf(row: Row): HTMLElement {
  const image = document.createElement("img");
  image.setAttribute("src", ICONS[row.colour]);
  image.setAttribute("alt", "");
  image.setAttribute("width", "16");
  image.setAttribute("height", "16");
  return image;
}

function rowOf(row: Row): HTMLElement {
  const line = document.createElement("div");
  line.className = "row";
  const label = document.createElement("span");
  label.textContent = text(row.label);
  if (row.proof !== null) {
    const proof = document.createElement("span");
    proof.className = "proof";
    proof.textContent = text(row.proof);
    label.append(proof);
  }
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = numbers.format(row.count);
  line.append(cloudOf(row), label, count);
  return line;
}

function providerOf(entry: ProviderRows): HTMLElement[] {
  const name = document.createElement("p");
  name.className = "provider";
  name.textContent = entry.name;
  return [name, ...entry.rows.map(rowOf)];
}

function paragraphsOf(lines: readonly TitleLine[]): HTMLElement[] {
  return lines.map((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text(line);
    return paragraph;
  });
}

function render(view: PopupView): void {
  element("state").setAttribute("src", ICONS[view.icon]);
  const site = element("site");
  site.hidden = view.site === null;
  site.textContent = view.site === null ? "" : siteText(view.site);
  element("browser-page").hidden = view.site !== null;
  element("browser-notice").hidden = view.site !== null;

  element("page").hidden = view.page === null;
  if (view.page !== null) {
    element("page-unit").hidden = view.page.rows.length === 0;
    element("page-rows").replaceChildren(...view.page.rows.map(rowOf));
    element("page-lines").replaceChildren(...paragraphsOf(view.page.lines));
    const partial = element("page-partial");
    partial.hidden = view.page.partial.length === 0;
    partial.replaceChildren(...paragraphsOf(view.page.partial));
  }

  element("totals").hidden = view.totals === null;
  if (view.totals !== null) {
    const empty = view.totals.providers.length === 0;
    element("totals-title").textContent = text(view.totals.title);
    element("totals-unit").hidden = empty;
    element("totals-empty").hidden = !empty;
    element("totals-rows").replaceChildren(
      ...view.totals.providers.flatMap(providerOf),
    );
  }

  element("question").textContent = text(view.question);
}

function show(): void {
  if (data !== null) {
    render(viewOf(data, table.providers, (since) => dates.format(since)));
  }
}

// The answer comes from the extension's own event page, in the shape the
// contract of core/popup-message.ts gives it.
async function ask<T>(request: PopupRequest): Promise<T> {
  return (await browser.runtime.sendMessage(request)) as T;
}

async function open(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    throw new Error("no active tab");
  }
  data = await ask<PopupData>({
    kind: "popup",
    tabId: tab.id,
    privateWindow: tab.incognito,
  });
  show();
}

// A popup cannot open a dialog, so the footer itself becomes the question.
function askToConfirm(asking: boolean): void {
  element("footer").hidden = asking;
  element("confirmation").hidden = !asking;
}

async function clear(): Promise<void> {
  const { since } = await ask<ClearedData>({ kind: "clear" });
  if (data !== null) {
    data = cleared(data, since);
  }
  show();
  askToConfirm(false);
}

document.documentElement.lang = language;
for (const target of Array.from(
  document.querySelectorAll<HTMLElement>("[data-message]"),
)) {
  target.textContent = browser.i18n.getMessage(target.dataset["message"] ?? "");
}
element("clear-all").addEventListener("click", () => askToConfirm(true));
element("cancel").addEventListener("click", () => askToConfirm(false));
element("clear").addEventListener("click", () => report(clear()));
report(open());

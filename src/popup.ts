// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The page of the toolbar button, popup.html. It asks the event page what the
// active tab shows and puts the answer into the page through the view of
// core/popup-view.ts, which decides everything that is shown.

import type { TitleLine } from "./core/display.js";
import type {
  ClearedData,
  IgnoredData,
  PopupData,
} from "./core/popup-message.js";
import {
  cleared,
  type PopupView,
  type ProviderRows,
  type Row,
  viewOf,
} from "./core/popup-view.js";
import { ask, element, text, writeLabels } from "./page.js";
import table from "./providers.js";
import { siteText } from "./site.js";
import { ICONS, report } from "./toolbar.js";

const language = browser.i18n.getUILanguage();
const dates = new Intl.DateTimeFormat(language, { dateStyle: "long" });
const numbers = new Intl.NumberFormat(language);

// The tab the popup opened on, asked about again once its site is ignored or
// watched again.
let tab: { readonly tabId: number; readonly privateWindow: boolean } | null =
  null;
let data: PopupData | null = null;
let watchedAgain = false;

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
  const { header } = view;
  const site = element("site");
  site.hidden = header.kind !== "site";
  site.textContent = header.kind === "site" ? siteText(header.site) : "";
  element("unknown-site").hidden = header.kind !== "unknown-site";
  element("browser-page").hidden = header.kind !== "browser-page";
  element("browser-notice").hidden = !view.notice;
  element("ignored").hidden = !view.ignored;
  element("watched-again").hidden = !view.watchedAgain;

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

  element("ignore-site").hidden = view.ignoreQuestion === null;
  element("ignore-question").textContent =
    view.ignoreQuestion === null ? "" : text(view.ignoreQuestion);
  element("unignore-site").hidden = !view.unignore;
  element("clear-site").hidden = view.clearQuestion === null;
  element("clear-question").textContent =
    view.clearQuestion === null ? "" : text(view.clearQuestion);
}

function show(): void {
  if (data !== null) {
    render(
      viewOf(
        data,
        table.providers,
        (since) => dates.format(since),
        siteText,
        watchedAgain,
      ),
    );
  }
}

async function load(): Promise<void> {
  if (tab !== null) {
    data = await ask<PopupData>({ kind: "popup", ...tab });
    show();
  }
}

async function open(): Promise<void> {
  const [active] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (active?.id === undefined) {
    throw new Error("no active tab");
  }
  tab = { tabId: active.id, privateWindow: active.incognito };
  await load();
}

// A popup cannot open a dialog, so the footer itself becomes the question.
// Firefox scrolls a popup taller than 600 pixels, which would leave the
// question, at its foot, out of view.
function askToConfirm(asking: "clear" | "ignore" | null): void {
  element("footer").hidden = asking !== null;
  const clearing = element("clear-confirmation");
  const ignoring = element("ignore-confirmation");
  clearing.hidden = asking !== "clear";
  ignoring.hidden = asking !== "ignore";
  if (asking !== null) {
    (asking === "clear" ? clearing : ignoring).scrollIntoView({
      block: "nearest",
    });
  }
}

// What a clear takes depends on the site and the window, which the answer of
// the event page gives: without it, the popup cannot say which counts would
// go.
async function clear(): Promise<void> {
  const shown = data;
  if (shown !== null && shown.site !== null) {
    const { since } = await ask<ClearedData>({
      kind: "clearSite",
      site: shown.site,
      privateWindow: shown.privateWindow,
    });
    data = cleared(shown, since);
  }
  show();
  askToConfirm(null);
}

// Never from a private window, so that no site visited in private enters the
// list kept on disk. Ignoring turns the tabs of the site ignored on the event
// page, so the popup asks it again what the tab shows.
async function ignore(): Promise<void> {
  const shown = data;
  if (shown !== null && shown.site !== null && !shown.privateWindow) {
    await ask<IgnoredData>({ kind: "ignoreSite", host: shown.site });
    watchedAgain = false;
    await load();
  }
  askToConfirm(null);
}

// Nothing is lost by watching a site again, so the popup asks nothing.
async function unignore(): Promise<void> {
  const shown = data;
  if (shown !== null && shown.site !== null) {
    await ask<IgnoredData>({ kind: "unignoreSite", site: shown.site });
    watchedAgain = true;
    await load();
  }
}

// Selecting the tab of about:addons hides no popup of an extension
// (Tabbrowser.sys.mjs, Firefox 159.0.1), which would stay open over the
// preferences it opened.
async function openPreferences(): Promise<void> {
  await browser.runtime.openOptionsPage();
  window.close();
}

writeLabels();
const gear = element("preferences");
const preferences = browser.i18n.getMessage("popupPreferences");
gear.setAttribute("aria-label", preferences);
gear.setAttribute("title", preferences);
gear.addEventListener("click", () => report(openPreferences()));
element("ignore-site").addEventListener("click", () => askToConfirm("ignore"));
element("ignore-cancel").addEventListener("click", () => askToConfirm(null));
element("ignore").addEventListener("click", () => report(ignore()));
element("unignore-site").addEventListener("click", () => report(unignore()));
element("clear-site").addEventListener("click", () => askToConfirm("clear"));
element("clear-cancel").addEventListener("click", () => askToConfirm(null));
element("clear").addEventListener("click", () => report(clear()));
report(open());

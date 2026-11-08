// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The map, map.html, which the popup opens in a tab. It asks the event page
// for the counts of every site and puts them into the page through the view
// of core/map-view.ts, which decides everything that is shown.

import {
  type CategoryLine,
  type Choice,
  type Column,
  colourOfCategory,
  columnOf,
  type Filters,
  formatsOf,
  type Heading,
  headerOf,
  heightOf,
  highlightOf,
  type Icon,
  type LimitList,
  type LimitRow,
  NO_FILTER,
  OTHERS,
  type Panel,
  type PreparedMap,
  panelOf,
  placesOf,
  prepare,
  ROW_HEIGHT,
  type SiteRow,
  selectionOf,
  toggled,
  toolsOf,
  withoutLimit,
  yOf,
} from "./core/map-view.js";
import type { ClearedData, MapData } from "./core/popup-message.js";
import { ask, element, writeLabels } from "./page.js";
import table from "./providers.js";
import { siteText } from "./site.js";
import { ICONS, report } from "./toolbar.js";

const SVG = "http://www.w3.org/2000/svg";

// The geometry of the mock-up, in pixels, in a tab 1280 pixels wide: the
// column of the sites, then the links, the pills of the providers at their
// end. A wider tab gives the links more room, and a narrower one keeps them
// some, the providers then cut at the right as in the mock-up.
const LIST_WIDTH = 340;
const LINKS_MIN_WIDTH = 400;
const PILL_WIDTH = 200;
const PILL_MARGIN = 18;

// Firefox gives an extension page of a private window the private browsing
// of its window (ExtensionCommon.sys.mjs and child/ext-extension.js, Firefox
// 159.0.1), and the popup opens the map in its own window: from a private
// window, the map shows the private session only.
const privateWindow = browser.extension.inIncognitoContext === true;

const language = browser.i18n.getUILanguage();
const formats = formatsOf(
  language,
  (name, substitutions) => browser.i18n.getMessage(name, [...substitutions]),
  siteText,
);

let map: PreparedMap | null = null;
let filters: Filters = NO_FILTER;
let selection: string | null = null;
let confirming = false;
let column: Column | null = null;
// Each link with what places it, so that a scroll moves it without a lookup.
let drawn: { path: SVGPathElement; slot: number; end: number }[] = [];
let pillX = LINKS_MIN_WIDTH - PILL_WIDTH - PILL_MARGIN;

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const created = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) {
    created.setAttribute(name, String(value));
  }
  return created;
}

function titled<T extends SVGElement>(target: T, text: string): T {
  const title = svg("title");
  title.textContent = text;
  target.append(title);
  return target;
}

function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = text;
  return created;
}

function points(size: number): SVGSVGElement {
  const image = svg("svg", {
    viewBox: "0 0 16 16",
    width: size,
    height: size,
    "aria-hidden": "true",
  });
  for (const [cx, cy] of [
    [4, 10],
    [8, 5],
    [12, 10],
  ]) {
    image.append(
      svg("circle", { class: "point", cx: cx ?? 0, cy: cy ?? 0, r: 2.6 }),
    );
  }
  return image;
}

// The cloud or the point says what the text beside it says, so it reads as
// nothing more.
function iconOf(icon: Icon, size: number): Element {
  switch (icon.kind) {
    case "cloud": {
      const image = document.createElement("img");
      image.setAttribute("src", ICONS[icon.colour]);
      image.setAttribute("alt", "");
      image.setAttribute("width", String(size));
      image.setAttribute("height", String(size));
      return image;
    }
    case "point": {
      const image = svg("svg", {
        viewBox: "0 0 16 16",
        width: size,
        height: size,
        "aria-hidden": "true",
      });
      image.append(svg("circle", { class: "point", cx: 8, cy: 8, r: 3.5 }));
      return image;
    }
    case "points":
      return points(size);
    case "flag": {
      const flag = html("span", "flag", icon.flag);
      if (icon.title !== null) {
        flag.title = icon.title;
      }
      return flag;
    }
  }
}

function renderHeader(): void {
  if (map === null) {
    return;
  }
  const header = headerOf(map);
  element("subtitle").textContent = header.subtitle;
  element("scope").textContent = header.scope;
  const search = element("search") as HTMLInputElement;
  search.placeholder = header.search;
  search.setAttribute("aria-label", header.search);
  const asking = confirming && header.question !== null;
  element("ask-purge").hidden = header.question === null || asking;
  const question = element("purge-question");
  question.hidden = !asking;
  question.textContent = asking ? (header.question ?? "") : "";
  element("purge").hidden = !asking;
  element("purge-cancel").hidden = !asking;
  element("tools").hidden = header.empty !== null;
  const empty = element("empty");
  empty.hidden = header.empty === null;
  empty.textContent = header.empty ?? "";
}

function renderTools(): void {
  if (map === null || column === null) {
    return;
  }
  const tools = toolsOf(map, column, filters);
  element("chips").replaceChildren(
    ...tools.chips.map((chip) => {
      const button = html("button", "chip");
      button.type = "button";
      button.setAttribute("aria-label", chip.remove);
      const cross = html("span", "cross", "✕");
      cross.setAttribute("aria-hidden", "true");
      button.append(iconOf(chip.icon, 14), html("span", "", chip.label), cross);
      button.addEventListener("click", () => {
        filters = withoutLimit(filters, chip.list);
        refresh(true);
      });
      return button;
    }),
  );
  element("shown-count").hidden = tools.shown === null;
  element("shown").textContent = tools.shown ?? "";
}

function siteName(row: SiteRow): SVGTextElement {
  const name = svg("text", { x: 32, y: yOf(row.slot) + 4, "font-size": 13 });
  const text = row.site.name;
  if (row.match === null) {
    name.textContent = text;
    return name;
  }
  const found = svg("tspan", { class: "match" });
  found.textContent = text.slice(row.match.start, row.match.end);
  name.append(text.slice(0, row.match.start), found, text.slice(row.match.end));
  return name;
}

// The rows, the providers and the links, drawn again at each change of the
// filters, which takes about 10 ms a keystroke on 900 sites in LibreWolf
// 159, far below the 100 ms under which an answer feels immediate.
function renderColumn(resetScroll: boolean): void {
  const plan = element("plan");
  const drawing = element("drawing");
  const noMatch = element("no-match");
  drawn = [];
  if (map === null || map.sites.length === 0) {
    column = null;
    noMatch.hidden = true;
    drawing.replaceChildren();
    return;
  }
  const current = columnOf(map, filters);
  column = current;
  const header = headerOf(map);
  const viewHeight = plan.clientHeight;
  const linksWidth = Math.max(LINKS_MIN_WIDTH, plan.clientWidth - LIST_WIDTH);
  pillX = linksWidth - PILL_WIDTH - PILL_MARGIN;
  const places = placesOf(map, current, viewHeight);
  if (resetScroll) {
    plan.scrollTop = 0;
  }
  noMatch.hidden = current.rows.length > 0;
  if (current.rows.length === 0) {
    drawing.replaceChildren();
    return;
  }

  const height = Math.max(heightOf(current), viewHeight);
  const list = svg("svg", {
    class: "sites",
    width: LIST_WIDTH,
    height,
    viewBox: `0 0 ${LIST_WIDTH} ${height}`,
    role: "img",
    "aria-label": header.sitesHeading,
  });
  const heading = svg("text", { class: "muted", x: 8, y: 18, "font-size": 11 });
  heading.textContent = header.sitesHeading;
  const unit = svg("text", {
    class: "muted",
    x: LIST_WIDTH - 8,
    y: 18,
    "font-size": 11,
    "text-anchor": "end",
  });
  unit.textContent = header.unit;
  list.append(heading, unit);
  for (const row of current.rows) {
    const y = yOf(row.slot);
    if (row.kind === "heading") {
      const text = svg("text", {
        class: "muted heading",
        x: 8,
        y: y + 4,
        "font-size": 11,
        "font-weight": 600,
        "letter-spacing": "0.04em",
      });
      text.textContent = row.text;
      list.append(text);
      continue;
    }
    const line = svg("g", { class: "fades", "data-k": row.key, tabindex: 0 });
    line.append(
      svg("rect", {
        class: "ground",
        x: 0,
        y: y - ROW_HEIGHT / 2,
        width: LIST_WIDTH,
        height: ROW_HEIGHT,
        rx: 3,
      }),
    );
    let name: SVGTextElement;
    if (row.kind === "site") {
      line.append(
        row.site.worst === "blue2"
          ? svg("circle", { class: "point", cx: 16, cy: y, r: 3.5 })
          : svg("image", {
              href: ICONS[colourOfCategory(row.site.worst)],
              x: 8,
              y: y - 8,
              width: 16,
              height: 16,
            }),
      );
      name = siteName(row);
    } else {
      const group = points(16);
      group.setAttribute("x", "8");
      group.setAttribute("y", String(y - 8));
      line.append(group);
      name = svg("text", { x: 32, y: y + 4, "font-size": 13 });
      const label = svg("tspan", { "font-weight": 600 });
      label.textContent = row.label;
      const suffix = svg("tspan", { class: "muted" });
      suffix.textContent = row.suffix;
      name.append(label, suffix);
    }
    const total = svg("text", {
      class: "muted",
      x: LIST_WIDTH - 8,
      y: y + 4,
      "font-size": 12,
      "text-anchor": "end",
    });
    total.textContent = formats.number(
      row.kind === "site" ? row.site.total : row.total,
    );
    line.append(name, total);
    list.append(titled(line, row.kind === "site" ? row.site.title : row.title));
  }

  const right = svg("svg", {
    class: "providers",
    width: linksWidth,
    height: viewHeight,
    viewBox: `0 0 ${linksWidth} ${viewHeight}`,
    role: "img",
    "aria-label": header.providersHeading,
  });
  const title = svg("text", {
    class: "muted",
    x: pillX + 12,
    y: 18,
    "font-size": 11,
  });
  title.textContent = header.providersHeading;
  const links = svg("g");
  const ends = new Map(
    places.providers.map((label) => [label.provider.id, label.y]),
  );
  for (const link of current.links) {
    const end = ends.get(link.provider);
    if (end === undefined) {
      continue;
    }
    const path = svg("path", {
      class: `link fades ${link.category}`,
      "data-k": link.key,
    });
    links.append(titled(path, link.title));
    drawn.push({ path, slot: link.slot, end });
  }
  right.append(title, links);
  const pill = (
    key: string,
    y: number,
    name: string,
    note: string,
    tip: string,
  ) => {
    const label = svg("g", {
      class: "fades",
      "data-k": key,
      tabindex: 0,
      transform: `translate(${pillX} ${y.toFixed(1)})`,
    });
    const first = svg("text", {
      x: 12,
      y: -3,
      "font-size": 13,
      "font-weight": 600,
    });
    first.textContent = name;
    const second = svg("text", {
      class: "muted",
      x: 12,
      y: 12,
      "font-size": 11,
    });
    second.textContent = note;
    label.append(
      svg("rect", {
        class: "pill",
        x: 0,
        y: -20,
        width: PILL_WIDTH,
        height: 40,
        rx: 8,
      }),
      first,
      second,
    );
    right.append(titled(label, tip));
  };
  for (const label of places.providers) {
    pill(label.key, label.y, label.name, label.sites, label.provider.title);
  }
  if (places.others !== null) {
    const { others } = places;
    pill(others.key, others.y, others.name, others.note, others.title);
  }
  drawing.replaceChildren(list, right);
  follow();
}

// While the sites scroll, each link leaves from where its row is in view,
// and the links of the rows out of view are not drawn.
function follow(): void {
  const plan = element("plan");
  const top = plan.scrollTop;
  const viewHeight = plan.clientHeight;
  const middle = pillX / 2;
  for (const { path, slot, end } of drawn) {
    const y = yOf(slot) - top;
    path.setAttribute(
      "d",
      `M0 ${y.toFixed(1)}C${middle} ${y.toFixed(1)} ${middle} ${end.toFixed(1)} ${pillX} ${end.toFixed(1)}`,
    );
    path.style.display = y < 24 || y > viewHeight - 4 ? "none" : "";
  }
}

function renderHighlight(): void {
  const plan = element("plan");
  if (column === null) {
    return;
  }
  const { active, chosen } = highlightOf(column, selection);
  for (const image of Array.from(plan.querySelectorAll(".drawing > svg"))) {
    image.classList.toggle("selection", active.size > 0);
  }
  for (const target of Array.from(
    plan.querySelectorAll<SVGElement>("[data-k]"),
  )) {
    const key = target.dataset["k"] ?? "";
    target.classList.toggle("active", active.has(key));
    target.classList.toggle("chosen", key === chosen);
  }
  const row = column.rows.find(
    (entry) => entry.kind !== "heading" && entry.key === chosen,
  );
  if (row !== undefined) {
    const y = yOf(row.slot);
    if (
      y < plan.scrollTop + 40 ||
      y > plan.scrollTop + plan.clientHeight - 48
    ) {
      plan.scrollTop = y - plan.clientHeight / 3;
      follow();
    }
  }
}

function headingOf(heading: Heading): HTMLElement {
  const block = html("div", "panel-heading");
  block.append(html("span", "", heading.title));
  if (heading.unit !== null) {
    block.append(html("span", "unit", heading.unit));
  }
  return block;
}

function labelOf(text: string, proof: string | null): HTMLElement {
  const label = html("span", "", text);
  if (proof !== null) {
    label.append(html("span", "proof", proof));
  }
  return label;
}

function lineOf(line: CategoryLine): HTMLElement {
  const row = html("div", "line");
  row.append(
    iconOf({ kind: "cloud", colour: line.colour }, 16),
    labelOf(line.label, line.proof),
    html("span", "count", line.count),
  );
  for (const detail of line.details) {
    const part = html("div", "detail");
    part.append(
      html("span", "", detail.kind),
      html("span", "count", detail.count),
    );
    row.append(part);
  }
  return row;
}

function choiceOf(choice: Choice): HTMLElement {
  const button = html("button", choice.bold ? "choice bold" : "choice");
  button.type = "button";
  button.dataset["k"] = choice.key;
  if (choice.title !== null) {
    button.title = choice.title;
  }
  button.append(
    iconOf(choice.icon, 16),
    html("span", "", choice.label),
    html("span", "count", choice.count),
  );
  return button;
}

function limitOf(row: LimitRow): HTMLElement {
  const classes = [
    "choice",
    ...(row.bold ? ["bold"] : []),
    ...(row.zero ? ["zero"] : []),
  ];
  const button = html("button", classes.join(" "));
  button.type = "button";
  button.setAttribute("aria-pressed", String(row.pressed));
  button.disabled = row.disabled;
  button.append(
    iconOf(row.icon, 16),
    labelOf(row.label, row.proof),
    html("span", "count", row.count),
  );
  button.addEventListener("click", () => limit(row.list, row.value));
  return button;
}

function head(icon: Element | null, name: string): HTMLElement {
  const block = html("div", "panel-head");
  block.append(...(icon === null ? [] : [icon]), html("span", "name", name));
  return block;
}

function panelParts(panel: Panel): HTMLElement[] {
  switch (panel.kind) {
    case "overview":
      return [
        headingOf(panel.heading),
        html("p", "panel-text", panel.line),
        ...panel.notes.map((note) => html("p", "panel-note", note)),
        ...panel.sections.flatMap((section) => [
          headingOf(section.heading),
          ...section.rows.map(limitOf),
          ...(section.note === null
            ? []
            : [html("p", "panel-note", section.note)]),
        ]),
      ];
    case "others":
      return [
        head(null, panel.name),
        html("p", "panel-text", panel.text),
        headingOf(panel.heading),
        ...panel.choices.map(choiceOf),
      ];
    case "site":
      return [
        head(iconOf(panel.icon, 32), panel.name),
        headingOf(panel.heading),
        ...(panel.note === null ? [] : [html("p", "panel-note", panel.note)]),
        ...panel.providers.flatMap((provider) => [
          choiceOf(provider.choice),
          ...provider.lines.map(lineOf),
        ]),
      ];
    case "provider": {
      const top = head(html("span", "flag", panel.flag), panel.name);
      top.title = panel.title;
      return [
        top,
        ...panel.texts.map((text) => html("p", "panel-text", text)),
        html("p", "panel-note", panel.note),
        headingOf(panel.worst.heading),
        ...panel.worst.lines.map(lineOf),
        headingOf(panel.sites.heading),
        ...panel.sites.choices.map(choiceOf),
      ];
    }
    case "group":
      return [
        head(points(32), panel.name),
        html("p", "panel-text", panel.text),
        headingOf(panel.heading),
        ...panel.choices.map(choiceOf),
      ];
  }
}

function renderPanel(): void {
  const content = element("panel-content");
  if (map === null || column === null) {
    element("back").hidden = true;
    content.replaceChildren();
    return;
  }
  const panel = panelOf(map, column, filters, selection);
  element("back").hidden = panel.kind === "overview";
  content.replaceChildren(...panelParts(panel));
}

// The panel follows a change of the limits, and a keystroke only when it
// counts what the filters keep, so that the details of a selection stay put.
function refresh(withPanel: boolean): void {
  renderColumn(true);
  renderTools();
  if (withPanel || selection === null || selection === OTHERS) {
    renderPanel();
  }
  renderHighlight();
}

function limit(list: LimitList, value: string): void {
  filters = toggled(filters, list, value);
  refresh(true);
}

function clearFilters(): void {
  filters = NO_FILTER;
  (element("search") as HTMLInputElement).value = "";
  refresh(true);
}

function choose(key: string | null): void {
  selection = key === null ? null : selectionOf(key);
  renderPanel();
  element("panel").scrollTop = 0;
  renderHighlight();
}

function render(resetScroll: boolean): void {
  renderHeader();
  renderColumn(resetScroll);
  renderTools();
  renderPanel();
  renderHighlight();
}

async function load(resetScroll: boolean): Promise<void> {
  const data = await ask<MapData>({ kind: "map", privateWindow });
  map = prepare(data, table.providers, formats);
  render(resetScroll);
}

function askToPurge(asking: boolean): void {
  confirming = asking;
  renderHeader();
}

// The map opens on the whole again once everything is purged.
async function purge(): Promise<void> {
  await ask<ClearedData>({ kind: "purgeAll", privateWindow });
  confirming = false;
  filters = NO_FILTER;
  selection = null;
  (element("search") as HTMLInputElement).value = "";
  await load(true);
}

function keyOf(event: Event): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  return (
    target.closest<HTMLElement | SVGElement>("[data-k]")?.dataset["k"] ?? null
  );
}

writeLabels();
element("search").addEventListener("input", (event) => {
  filters = { ...filters, text: (event.target as HTMLInputElement).value };
  refresh(false);
});
element("clear-filters").addEventListener("click", clearFilters);
element("no-match-clear").addEventListener("click", clearFilters);
element("ask-purge").addEventListener("click", () => askToPurge(true));
element("purge-cancel").addEventListener("click", () => askToPurge(false));
element("purge").addEventListener("click", () => report(purge()));
element("back").addEventListener("click", () => choose(null));
element("plan").addEventListener("scroll", follow, { passive: true });
element("plan").addEventListener("click", (event) => {
  if (element("drawing").contains(event.target as Node)) {
    choose(keyOf(event));
  }
});
element("plan").addEventListener("keydown", (event) => {
  const key = keyOf(event);
  if (key !== null && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    choose(key);
  }
});
element("panel-content").addEventListener("click", (event) => {
  const key = keyOf(event);
  if (key !== null) {
    choose(key);
  }
});
window.addEventListener("resize", () => {
  renderColumn(false);
  renderHighlight();
});
// The event page keeps counting while the map is open: the map asks again
// each time its tab comes back into view, and keeps the filters, the
// selection and the scroll.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    report(load(false));
  }
});
report(load(true));

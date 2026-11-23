// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The map, map.html, which the popup opens in a tab. It asks the event page
// for the counts of every site and puts them into the page through the view
// of core/map-view.ts, which decides everything that is shown.

import { colourOfCategory, type KnownCategory } from "./core/counts.js";
import {
  type AddressRow,
  type CategoryLine,
  type Choice,
  type Column,
  type CopyTexts,
  columnOf,
  cutToFit,
  type DetailLine,
  type Filters,
  formatsOf,
  type Heading,
  headerOf,
  heightOf,
  highlightOf,
  type Icon,
  keyPartsOf,
  type LimitList,
  type LimitRow,
  type LinkInView,
  NO_FILTER,
  type Panel,
  PILL_HEIGHT,
  type PreparedMap,
  type ProviderLabel,
  type ProvidersInView,
  panelOf,
  placesInView,
  placesOf,
  prepare,
  ROW_HEIGHT,
  type SiteRecord,
  type SiteRow,
  selectionOf,
  toggled,
  toolsOf,
  UNKNOWN_COUNTRY,
  withoutLimit,
  yOf,
} from "./core/map-view.js";
import type {
  ClearedData,
  MapData,
  Settings,
  SiteAddresses,
} from "./core/popup-message.js";
import { setUpHelp } from "./help.js";
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
// A pill holds one line: the flag and the name of its provider on the left,
// its sites in grey on the right, at least NOTE_GAP apart.
const PILL_WIDTH = 248;
const PILL_MARGIN = 18;
const PILL_PADDING = 12;
const NOTE_GAP = 8;
// The corridor of the providers without a pill, on the left of the pills,
// and how far on each side of it the pointer reaches its points.
const CORRIDOR_GAP = 16;
const CORRIDOR_REACH = 8;

// A cut address scrolls on hover and focus at this speed, in pixels a
// second, so that the time it takes follows its length.
const ADDRESS_SPEED = 80;
// How long the chip of a copied address stays.
const COPIED_MS = 1500;

// Firefox gives an extension page of a private window the private browsing
// of its window (ExtensionCommon.sys.mjs and child/ext-extension.js, Firefox
// 159.0.1), and the popup opens the map in its own window: from a private
// window, the map shows the private session only.
const privateWindow = browser.extension.inIncognitoContext === true;

// Firefox checks, looks up and fills in a message at each call, 1 to 5 µs
// (ExtensionCommon.sys.mjs, LibreWolf 159.0.1), and the map writes some
// 4 000 for 900 sites at each answer of the event page, most of them the same
// from one answer to the next. The messages of the last answer are kept
// beside those of the current one, so that what is kept follows the counts
// rather than grow with each of them.
let messages = new Map<string, string>();
let lastMessages = new Map<string, string>();

function message(name: string, substitutions: readonly string[]): string {
  const key = JSON.stringify([name, ...substitutions]);
  let text = messages.get(key);
  if (text === undefined) {
    text =
      lastMessages.get(key) ??
      browser.i18n.getMessage(name, [...substitutions]);
    messages.set(key, text);
  }
  return text;
}

// Firefox writes in Unicode only a label in punycode (idn.domainToDisplay
// in child/ext-publicSuffix.js, LibreWolf 159.0.1), at 7 to 17 µs a call: any
// other site, kept in lowercase ASCII as Firefox reduced it, shows as it is.
const shownSites = new Map<string, string>();

function shownSite(site: string): string {
  if (!/(?:^|\.)xn--/i.test(site)) {
    return site;
  }
  let shown = shownSites.get(site);
  if (shown === undefined) {
    shown = siteText(site);
    shownSites.set(site, shown);
  }
  return shown;
}

const language = browser.i18n.getUILanguage();
const formats = formatsOf(language, message, shownSite);

let map: PreparedMap | null = null;
let filters: Filters = NO_FILTER;
let selection: string | null = null;
let confirming = false;
let column: Column | null = null;
// Each link with what places it, so that a scroll moves it without a lookup.
let drawn: {
  path: SVGPathElement;
  slot: number;
  provider: string;
  category: KnownCategory;
}[] = [];
// The provider of each link, which pointing at the link points at.
let linkProvider = new Map<Element, string>();
// The pill of each provider drawn, in the order of the column, with its
// texts, and the point it has on the corridor while it has no pill.
interface ProviderMarks {
  readonly label: ProviderLabel;
  readonly pill: SVGGElement;
  readonly name: SVGTextElement;
  readonly note: SVGTextElement;
  readonly point: SVGCircleElement;
  // The band of the corridor around the point, which the pointer reaches.
  readonly reach: SVGRectElement;
}
let marks = new Map<string, ProviderMarks>();
// The right of the drawing: its image, its corridor, and the layer of the
// pill that opens over the others.
interface Right {
  readonly image: SVGSVGElement;
  readonly corridor: SVGGElement;
  readonly rail: SVGLineElement;
  readonly focus: SVGRectElement;
  readonly floating: SVGGElement;
}
let right: Right | null = null;
let supposed = new Set<string>();
let pillX = LINKS_MIN_WIDTH - PILL_WIDTH - PILL_MARGIN;
// Where the column last placed the providers, and the provider without a
// pill that the pointer or the arrows point at.
let places: ProvidersInView | null = null;
let hovered: string | null = null;
let corridorFocused = false;
// The addresses the event page keeps of the site whose panel is open, and
// the rows of that panel the user unfolded.
let record: SiteRecord | null = null;
let unfolded = new Set<string>();
let lists = 0;
const chips = new WeakMap<HTMLElement, number>();

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
  linkProvider = new Map();
  marks = new Map();
  right = null;
  places = null;
  hovered = null;
  corridorFocused = false;
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
  const labels = placesOf(map, current).providers;
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

  const image = svg("svg", {
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
  const placed = new Set(labels.map((label) => label.provider.id));
  for (const link of current.links) {
    if (!placed.has(link.provider)) {
      continue;
    }
    const path = svg("path", {
      class: `link fades ${link.category}`,
      "data-k": link.key,
    });
    links.append(titled(path, link.title));
    drawn.push({
      path,
      slot: link.slot,
      provider: link.provider,
      category: link.category,
    });
    linkProvider.set(path, link.provider);
  }
  const corridor = corridorOf(image, header.corridor);
  const floating = svg("g");
  image.append(title, links, corridor.corridor);
  supposed = new Set(
    labels
      .filter((label) => label.provider.country === UNKNOWN_COUNTRY)
      .map((label) => label.provider.id),
  );
  const reaches: SVGRectElement[] = [];
  for (const label of labels) {
    const { pill, name, note } = pillOf(label, label.name, "fades");
    pill.setAttribute("tabindex", "0");
    const point = svg("circle", {
      class: "hollow fades",
      "data-k": label.key,
      cx: pillX - CORRIDOR_GAP,
    });
    const reach = svg("rect", {
      class: "reach",
      "data-k": label.key,
      x: pillX - CORRIDOR_GAP - CORRIDOR_REACH,
      width: 2 * CORRIDOR_REACH,
    });
    point.style.display = "none";
    reach.style.display = "none";
    corridor.corridor.append(point);
    reaches.push(reach);
    image.append(pill);
    marks.set(label.provider.id, { label, pill, name, note, point, reach });
  }
  corridor.corridor.append(...reaches);
  image.append(floating);
  // Over nothing of a provider, such as the line that ties the pill opened
  // to its point, the pill stays open, so that the pointer reaches it.
  image.addEventListener("pointerover", (event) => {
    const provider = providerAt(event);
    if (provider !== null) {
      hover(provider);
    }
  });
  image.addEventListener("pointerleave", () => {
    if (!corridorFocused) {
      hover(null);
    }
  });
  right = { image, ...corridor, floating };
  drawing.replaceChildren(list, image);
  cutNames();
  follow();
}

// A pill on one line: the flag and the name of its provider on the left,
// its sites in grey on the right. Its tooltip keeps the name whole.
function pillOf(
  label: ProviderLabel,
  name: string,
  className: string,
): { pill: SVGGElement; name: SVGTextElement; note: SVGTextElement } {
  const pill = svg("g", { class: className, "data-k": label.key });
  const first = svg("text", {
    x: PILL_PADDING,
    y: 4.5,
    "font-size": 13,
    "font-weight": 600,
  });
  first.textContent = name;
  const note = svg("text", {
    class: "muted",
    x: PILL_WIDTH - PILL_PADDING,
    y: 4.5,
    "font-size": 11,
    "text-anchor": "end",
  });
  note.textContent = label.sites;
  pill.append(
    svg("rect", {
      class: "pill",
      x: 0,
      y: -PILL_HEIGHT / 2,
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      rx: 6,
    }),
    first,
    note,
  );
  return { pill: titled(pill, label.provider.title), name: first, note };
}

// A name too long for its pill is cut at its end, once it is in the page
// and can be measured, the room its sites leave it read for every pill
// before any is cut, so that the page is laid out once. Each try of a cut
// lays the page out again, which a supposed provider beside its sites often
// needs: a name keeps its cut beside the same sites, those of the last
// answer of the event page kept beside those of the current one, as the
// messages are, so that neither a keystroke nor a return to the tab measures
// what it has already seen: with 120 providers in view, a keystroke took
// 76 ms rather than 53 without it, in LibreWolf 159 without display. Its
// tooltip keeps it whole.
let cuts = new Map<string, string>();
let lastCuts = new Map<string, string>();

function cutNames(): void {
  const keyOf = (label: ProviderLabel) => `${label.name}\u0000${label.sites}`;
  const unseen: ProviderMarks[] = [];
  for (const marked of marks.values()) {
    const key = keyOf(marked.label);
    const cut = cuts.get(key) ?? lastCuts.get(key);
    if (cut === undefined) {
      unseen.push(marked);
    } else {
      cuts.set(key, cut);
      marked.name.textContent = cut;
    }
  }
  const widths = unseen.map(({ name, note }) => [
    name.getComputedTextLength(),
    note.getComputedTextLength(),
  ]);
  unseen.forEach(({ label, name }, index) => {
    const [width = 0, sites = 0] = widths[index] ?? [];
    const room = PILL_WIDTH - 2 * PILL_PADDING - NOTE_GAP - sites;
    if (width > room) {
      name.textContent = cutToFit(label.name, room, (cut) => {
        name.textContent = cut;
        return name.getComputedTextLength();
      });
    }
    cuts.set(keyOf(label), name.textContent ?? label.name);
  });
}

// The corridor of the providers without a pill: a rail, their points, and
// one stop of the Tab key, whose arrows go through the points.
function corridorOf(
  image: SVGSVGElement,
  name: string,
): Omit<Right, "image" | "floating"> {
  const x = pillX - CORRIDOR_GAP;
  const corridor = svg("g", { class: "corridor" });
  const rail = svg("line", { class: "rail", x1: x, x2: x });
  const focus = svg("rect", {
    class: "corridor-focus",
    tabindex: 0,
    "aria-label": name,
    x: x - CORRIDOR_REACH,
    width: 2 * CORRIDOR_REACH,
  });
  corridor.append(rail, focus);
  focus.addEventListener("focus", () => {
    corridorFocused = true;
    image.classList.add("corridor-active");
    if (hovered === null) {
      go("Home");
    }
  });
  focus.addEventListener("blur", () => {
    corridorFocused = false;
    image.classList.remove("corridor-active");
    hover(null);
  });
  focus.addEventListener("keydown", (event) => {
    const { key } = event;
    if (key === "Enter") {
      event.preventDefault();
      const chosen = hovered === null ? undefined : marks.get(hovered);
      if (chosen !== undefined) {
        choose(chosen.label.key);
      }
    } else if (key === "Escape") {
      event.preventDefault();
      hover(null);
      focus.blur();
    } else if (go(key)) {
      event.preventDefault();
    }
  });
  return { corridor, rail, focus };
}

// The arrows go through the points of the corridor from the top, Home and
// End to its ends, opening the pill of each, and a screen reader hears its
// provider. Whether the key is one of them.
function go(key: string): boolean {
  const ids = [...(places?.points.keys() ?? [])];
  const at = hovered === null ? -1 : ids.indexOf(hovered);
  const next = {
    ArrowDown: Math.min(ids.length - 1, at + 1),
    ArrowUp: Math.max(0, at - 1),
    Home: 0,
    End: ids.length - 1,
  }[key];
  if (next === undefined) {
    return false;
  }
  const id = ids[next];
  if (id !== undefined) {
    hover(id);
    element("announce").textContent = marks.get(id)?.label.spoken ?? "";
  }
  return true;
}

// The provider a pointer event is over: that of a link, of a point, of the
// band around it or of a pill, or null over nothing of a provider.
function providerAt(event: Event): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const link = linkProvider.get(target);
  if (link !== undefined) {
    return link;
  }
  const parts = keyPartsOf(
    target.closest<SVGElement>("[data-k]")?.dataset["k"] ?? "",
  );
  return parts?.kind === "provider" ? parts.name : null;
}

// Only a provider with a point opens a pill: pointing at a pill, or at a
// link to it, closes the one opened.
function hover(id: string | null): void {
  if (id !== hovered) {
    hovered = id;
    showHover();
  }
}

// The links and the point of the provider pointed at stand out, and its
// pill opens at the height of its point, tied to it by a horizontal line.
function showHover(): void {
  if (right === null) {
    return;
  }
  const y = hovered === null ? undefined : places?.points.get(hovered);
  const marked = hovered === null ? undefined : marks.get(hovered);
  if (y === undefined || marked === undefined) {
    hovered = null;
  }
  right.image.classList.toggle("hovering", hovered !== null);
  for (const { path, provider } of drawn) {
    path.classList.toggle("hovered", provider === hovered);
  }
  for (const [id, { point }] of marks) {
    point.classList.toggle("hovered", id === hovered);
  }
  if (y === undefined || marked === undefined || places === null) {
    right.floating.replaceChildren();
    return;
  }
  const { pill } = pillOf(
    marked.label,
    marked.name.textContent ?? "",
    "floating",
  );
  pill.setAttribute("transform", `translate(${pillX} ${y.toFixed(1)})`);
  right.floating.replaceChildren(
    svg("line", {
      class: "tie",
      x1: (pillX - CORRIDOR_GAP + places.radius).toFixed(1),
      y1: y.toFixed(1),
      x2: pillX,
      y2: y.toFixed(1),
    }),
    pill,
  );
}

// While the sites scroll, each link leaves from where its row is in view,
// and the links of the rows out of view are not drawn. The providers those
// links reach, with the one chosen, whose panel is open, each end its links
// on its pill, or on its point when the pills have no room left for it.
function follow(): void {
  const plan = element("plan");
  const top = plan.scrollTop;
  const viewHeight = plan.clientHeight;
  const inView = (slot: number): boolean => {
    const y = yOf(slot) - top;
    return y >= 24 && y <= viewHeight - 4;
  };
  const links: LinkInView[] = [];
  for (const { slot, provider, category } of drawn) {
    if (inView(slot)) {
      links.push({ provider, y: yOf(slot) - top, category });
    }
  }
  const now = placesInView(
    [...marks.keys()],
    links,
    selectedOf("provider"),
    (id) => supposed.has(id),
    viewHeight,
  );
  places = now;
  for (const { pill, label } of marks.values()) {
    const y = now.pills.get(label.provider.id);
    pill.style.display = y === undefined ? "none" : "";
    if (y !== undefined) {
      pill.setAttribute("transform", `translate(${pillX} ${y.toFixed(1)})`);
    }
  }
  drawCorridor(now);
  for (const { path, slot, provider } of drawn) {
    const pill = now.pills.get(provider);
    const end = pill ?? now.points.get(provider);
    if (end === undefined || !inView(slot)) {
      path.style.display = "none";
      continue;
    }
    const x = pill === undefined ? pillX - CORRIDOR_GAP - now.radius : pillX;
    const y = (yOf(slot) - top).toFixed(1);
    const middle = (x / 2).toFixed(1);
    path.setAttribute(
      "d",
      `M0 ${y}C${middle} ${y} ${middle} ${end.toFixed(1)} ${x.toFixed(1)} ${end.toFixed(1)}`,
    );
    path.style.display = "";
  }
  showHover();
}

// The points from the top, each band of the pointer reaching halfway to the
// next point, and the corridor hidden while every provider has its pill.
function drawCorridor(now: ProvidersInView): void {
  if (right === null) {
    return;
  }
  right.corridor.style.display = now.points.size === 0 ? "none" : "";
  right.rail.setAttribute("y1", now.top.toFixed(1));
  right.rail.setAttribute("y2", now.bottom.toFixed(1));
  right.focus.setAttribute("y", now.top.toFixed(1));
  right.focus.setAttribute("height", (now.bottom - now.top).toFixed(1));
  const ys = [...now.points.values()];
  const index = new Map([...now.points.keys()].map((id, at) => [id, at]));
  for (const [id, { point, reach }] of marks) {
    const at = index.get(id);
    const y = at === undefined ? undefined : ys[at];
    point.style.display = y === undefined ? "none" : "";
    reach.style.display = point.style.display;
    if (at === undefined || y === undefined) {
      continue;
    }
    const from = at === 0 ? now.top : ((ys[at - 1] ?? y) + y) / 2;
    const to = at === ys.length - 1 ? now.bottom : (y + (ys[at + 1] ?? y)) / 2;
    point.setAttribute("cy", y.toFixed(1));
    point.setAttribute("r", now.radius.toFixed(2));
    reach.setAttribute("y", from.toFixed(1));
    reach.setAttribute("height", Math.max(1, to - from).toFixed(1));
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
    }
  }
  // The provider chosen stays in the column, whatever the rows in view.
  follow();
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

// A cut address fades at its end, and scrolls on hover and focus as far as
// it is cut, so each is measured once in the page: every width first, then
// every change, so that the page is laid out once. A list is always drawn
// anew, so only the cut addresses have anything to change.
function measure(list: HTMLElement): void {
  const buttons = Array.from(list.querySelectorAll<HTMLElement>(".address"));
  const cuts = buttons.map((button) => {
    const text = button.querySelector<HTMLElement>(".text");
    return text === null ? 0 : Math.ceil(text.scrollWidth - text.clientWidth);
  });
  buttons.forEach((button, index) => {
    const cut = cuts[index] ?? 0;
    if (cut > 0) {
      button.classList.add("cut");
      button.style.setProperty("--shift", `${-cut}px`);
      button.style.setProperty("--duration", `${cut / ADDRESS_SPEED}s`);
    }
  });
}

// Firefox lets a page of the extension write to the clipboard during the
// click that asks for it, without the clipboardWrite permission: the click
// gives the page a transient user activation
// (nsContentUtils::IsCutCopyAllowed and Clipboard::Write, Firefox 159.0.1).
// A failure is said on the chip and to a screen reader, never shown as a
// copy.
async function copyAddress(
  button: HTMLElement,
  address: string,
  copy: CopyTexts,
): Promise<void> {
  const announce = element("announce");
  announce.textContent = "";
  let copied = true;
  try {
    await navigator.clipboard.writeText(address);
  } catch (error: unknown) {
    copied = false;
    console.error(`Cloud Leak: address not copied: ${String(error)}`);
  }
  const chip = chipOf(button);
  chip.classList.toggle("failed", !copied);
  const word = chip.querySelector<HTMLElement>(".word");
  if (word !== null) {
    word.textContent = copied ? copy.copied : copy.failed;
  }
  button.classList.add("done");
  announce.textContent = copied ? copy.announced : copy.failed;
  clearTimeout(chips.get(button));
  chips.set(
    button,
    setTimeout(() => button.classList.remove("done"), COPIED_MS),
  );
}

function checkMark(): SVGSVGElement {
  const image = svg("svg", {
    viewBox: "0 0 10 10",
    width: 10,
    height: 10,
    "aria-hidden": "true",
  });
  image.append(
    svg("path", {
      d: "M1.5 5.5L4 8L8.5 2.5",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.6,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    }),
  );
  return image;
}

// The chip of a copy is drawn at the first copy of its address, since a list
// may hold thousands of addresses that are never copied.
function chipOf(button: HTMLElement): HTMLElement {
  const drawn = button.querySelector<HTMLElement>(".copied");
  if (drawn !== null) {
    return drawn;
  }
  const chip = html("span", "copied");
  chip.setAttribute("aria-hidden", "true");
  chip.append(checkMark(), html("span", "word"));
  button.append(chip);
  return chip;
}

// Whole, the scheme included, which says whether the request was encrypted,
// and whole again in its tooltip and in the copy.
function addressList(row: AddressRow, copy: CopyTexts): HTMLElement {
  const list = html("ul", "addresses");
  lists += 1;
  list.id = `addresses-${lists}`;
  for (const address of row.addresses) {
    const button = html("button", "address");
    button.type = "button";
    button.title = address;
    button.append(html("span", "text", address));
    button.addEventListener("click", () =>
      report(copyAddress(button, address, copy)),
    );
    const item = html("li");
    item.append(button);
    list.append(item);
  }
  return list;
}

// The triangle of the lists that unfold in Firefox, to the right when the
// row is folded and down when it is unfolded.
function triangle(open: boolean): HTMLElement {
  const image = svg("svg", {
    viewBox: "0 0 8 8",
    width: 8,
    height: 8,
    "aria-hidden": "true",
  });
  image.append(
    svg("path", { d: open ? "M.5 2H7.5L4 6.5Z" : "M2 .5L6.5 4L2 7.5Z" }),
  );
  const mark = html("span", "mark");
  mark.append(image);
  return mark;
}

// A row with addresses kept unfolds in place, its button kept, so that the
// focus stays on it and the other lists keep their scroll. Its list is drawn
// only while it is unfolded. Gives the list drawn.
function drawRow(
  block: HTMLElement,
  button: HTMLElement,
  detail: DetailLine,
  row: AddressRow,
  copy: CopyTexts,
  open: boolean,
): HTMLElement | null {
  button.setAttribute("aria-expanded", String(open));
  button.replaceChildren(
    triangle(open),
    html("span", "", detail.kind),
    html("span", "count", detail.count),
  );
  if (!open) {
    button.removeAttribute("aria-controls");
    block.replaceChildren(button);
    return null;
  }
  const list = addressList(row, copy);
  button.setAttribute("aria-controls", list.id);
  block.replaceChildren(button, list, html("p", "addresses-note", row.note));
  return list;
}

function detailOf(
  detail: DetailLine,
  copy: CopyTexts | null,
  drawn: HTMLElement[],
): HTMLElement {
  const row = detail.addresses;
  if (row === null || copy === null) {
    const part = html("div", "detail");
    part.append(
      html("span", "", detail.kind),
      html("span", "count", detail.count),
    );
    return part;
  }
  const block = html("div", "kind-row");
  const button = html("button", "kind");
  button.type = "button";
  button.addEventListener("click", () => {
    const open = !unfolded.has(row.key);
    if (open) {
      unfolded.add(row.key);
    } else {
      unfolded.delete(row.key);
    }
    const list = drawRow(block, button, detail, row, copy, open);
    if (list !== null) {
      measure(list);
    }
  });
  const list = drawRow(block, button, detail, row, copy, row.open);
  if (list !== null) {
    drawn.push(list);
  }
  return block;
}

function lineOf(
  line: CategoryLine,
  copy: CopyTexts | null,
  drawn: HTMLElement[],
): HTMLElement {
  const row = html("div", "line");
  row.append(
    iconOf({ kind: "cloud", colour: line.colour }, 16),
    labelOf(line.label, line.proof),
    html("span", "count", line.count),
    ...line.details.map((detail) => detailOf(detail, copy, drawn)),
  );
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

function head(icon: Element, name: string): HTMLElement {
  const block = html("div", "panel-head");
  block.append(icon, html("span", "name", name));
  return block;
}

// The lists of addresses drawn go into drawn, to be measured once in the
// page.
function panelParts(panel: Panel, drawn: HTMLElement[]): HTMLElement[] {
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
    case "site":
      return [
        head(iconOf(panel.icon, 32), panel.name),
        headingOf(panel.heading),
        ...(panel.note === null ? [] : [html("p", "panel-note", panel.note)]),
        ...panel.providers.flatMap((provider) => [
          choiceOf(provider.choice),
          ...provider.lines.map((line) => lineOf(line, panel.copy, drawn)),
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
        ...panel.worst.lines.map((line) => lineOf(line, null, drawn)),
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
  const panel = panelOf(map, column, filters, selection, record, unfolded);
  element("back").hidden = panel.kind === "overview";
  const drawn: HTMLElement[] = [];
  content.replaceChildren(...panelParts(panel, drawn));
  for (const list of drawn) {
    measure(list);
  }
}

// The site or the provider whose panel is open, or null.
function selectedOf(kind: "site" | "provider"): string | null {
  const parts = selection === null ? null : keyPartsOf(selection);
  return parts?.kind === kind ? parts.name : null;
}

// Asked when the panel of a site opens, rather than with the counts of every
// site, so that the map reads the addresses of the site looked at alone.
// Never from a private window, where nothing is recorded.
async function askAddresses(): Promise<void> {
  const site = selectedOf("site");
  if (privateWindow || site === null) {
    return;
  }
  const [addresses, settings] = await Promise.all([
    ask<SiteAddresses>({ kind: "siteAddresses", site, privateWindow }),
    ask<Settings>({ kind: "settings" }),
  ]);
  if (selectedOf("site") !== site) {
    return;
  }
  const next = { site, addresses, limit: settings.recordLimit };
  // The panel already shows them when the map comes back into view or its
  // site is chosen again, and a long list costs its drawing.
  if (JSON.stringify(next) === JSON.stringify(record)) {
    return;
  }
  record = next;
  renderPanel();
}

// The panel follows a change of the limits, and a keystroke only when it
// counts what the filters keep, so that the details of a selection stay put.
function refresh(withPanel: boolean): void {
  renderColumn(true);
  renderTools();
  if (withPanel || selection === null) {
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

// The rows unfolded and the addresses go with the panel they belong to.
function choose(key: string | null): void {
  const next = key === null ? null : selectionOf(key);
  if (next !== selection) {
    record = null;
    unfolded = new Set();
  }
  selection = next;
  renderPanel();
  element("panel").scrollTop = 0;
  renderHighlight();
  report(askAddresses());
}

function render(resetScroll: boolean): void {
  renderHeader();
  renderColumn(resetScroll);
  renderTools();
  renderPanel();
  renderHighlight();
}

// The addresses of the site whose panel is open are asked again with the
// counts, since both grow while the map is open.
async function load(resetScroll: boolean): Promise<void> {
  const data = await ask<MapData>({ kind: "map", privateWindow });
  lastMessages = messages;
  messages = new Map();
  lastCuts = cuts;
  cuts = new Map();
  map = prepare(data, table.providers, formats);
  // The legend explains the question mark only when the map shows one.
  element("legend-supposed").hidden = !map.providers.some(
    (provider) => provider.country === UNKNOWN_COUNTRY,
  );
  render(resetScroll);
  await askAddresses();
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
  record = null;
  unfolded = new Set();
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
setUpHelp();
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

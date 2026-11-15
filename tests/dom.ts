// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// A stand-in for the DOM of a page of the extension, enough for its script:
// elements found by id and by data-message, created, appended, clicked and
// typed into, and found by the few selectors the scripts use: a tag, classes
// and attributes, and a child of another. Its elements come from the HTML
// file of the page itself, so that the ids and the messages the script looks
// up are the ones the file has.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Listener = (event: object) => void;

// The element the script last focused.
let focused: Element | null = null;

export function focusedElement(): Element | null {
  return focused;
}

// A data-* attribute as dataset names it: data-row-key is rowKey.
function datasetName(attribute: string): string {
  return attribute
    .slice("data-".length)
    .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

// The properties the script sets on the style of an element, custom ones
// included.
class Style {
  readonly properties = new Map<string, string>();
  display = "";

  setProperty(name: string, value: string): void {
    this.properties.set(name, value);
  }
}

export class Element {
  readonly tagName: string;
  readonly children: Element[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Listener[]>();
  readonly style = new Style();
  parent: Element | null = null;
  id = "";
  className = "";
  hidden = false;
  inert = false;
  checked = false;
  lang = "";
  value = "";
  title = "";
  ownText: string;
  // A layout the stand-in does not compute: as wide as what it shows.
  scrollTop = 0;
  scrollWidth = 0;
  clientWidth = 0;
  clientHeight = 0;

  constructor(tagName: string, text = "") {
    this.tagName = tagName;
    this.ownText = text;
  }

  get textContent(): string {
    return (
      this.ownText + this.children.map((child) => child.textContent).join("")
    );
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.ownText = value;
  }

  append(...nodes: (Element | string)[]): void {
    for (const node of nodes) {
      const child =
        typeof node === "string" ? new Element("#text", node) : node;
      const siblings = child.parent?.children ?? [];
      const index = siblings.indexOf(child);
      if (index >= 0) {
        siblings.splice(index, 1);
      }
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: (Element | string)[]): void {
    for (const child of this.children) {
      child.parent = null;
    }
    this.children.length = 0;
    this.ownText = "";
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "class") {
      this.className = value;
    } else if (name.startsWith("data-")) {
      this.dataset[datasetName(name)] = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  readonly classList = {
    contains: (name: string): boolean =>
      this.className.split(/\s+/).includes(name),
    add: (name: string): void => {
      this.classList.toggle(name, true);
    },
    remove: (name: string): void => {
      this.classList.toggle(name, false);
    },
    toggle: (name: string, force?: boolean): boolean => {
      const names = this.className.split(/\s+/).filter((entry) => entry);
      const on = force ?? !names.includes(name);
      this.className = [
        ...names.filter((entry) => entry !== name),
        ...(on ? [name] : []),
      ].join(" ");
      return on;
    },
  };

  // A tag, classes and attributes written together, such as button.kind or
  // [data-k], each part of a child of the one before it after ">".
  matches(selector: string): boolean {
    const parts = selector.split(">").map((part) => part.trim());
    let node: Element | null = this;
    for (const part of parts.reverse()) {
      if (node === null || !node.matchesOne(part)) {
        return false;
      }
      node = node.parent;
    }
    return true;
  }

  private matchesOne(selector: string): boolean {
    const tag = /^[a-z][a-z0-9]*/.exec(selector)?.[0];
    if (tag !== undefined && tag !== this.tagName) {
      return false;
    }
    for (const match of selector.matchAll(/\.([\w-]+)/g)) {
      if (!this.classList.contains(match[1] ?? "")) {
        return false;
      }
    }
    for (const match of selector.matchAll(/\[([\w-]+)\]/g)) {
      const name = match[1] ?? "";
      const present = name.startsWith("data-")
        ? this.dataset[datasetName(name)] !== undefined
        : this.attributes.has(name);
      if (!present) {
        return false;
      }
    }
    return true;
  }

  closest(selector: string): Element | null {
    let node: Element | null = this;
    while (node !== null && !node.matches(selector)) {
      node = node.parent;
    }
    return node;
  }

  querySelectorAll(selector: string): Element[] {
    return [...this.all()].slice(1).filter((entry) => entry.matches(selector));
  }

  querySelector(selector: string): Element | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  contains(other: Element): boolean {
    return [...this.all()].includes(other);
  }

  // The first element of the page with these classes.
  find(className: string): Element | undefined {
    return [...this.all()].find((entry) => entry.classList.contains(className));
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: object = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target: this, ...event });
    }
  }

  click(): void {
    this.dispatch("click");
  }

  focus(): void {
    focused = this;
  }

  *all(): Generator<Element> {
    yield this;
    for (const child of this.children) {
      yield* child.all();
    }
  }
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(attributes)?.[1];
}

export function htmlOf(page: string): string {
  return readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
}

// A flat list of the elements is enough: the scripts find them by id and by
// data-message, and only append into them.
function bodyOf(html: string): Element {
  const body = new Element("body");
  for (const match of html.matchAll(/<(\w+)([^>]*)>/g)) {
    const element = new Element(match[1] ?? "");
    const attributes = match[2] ?? "";
    element.id = attribute(attributes, "id") ?? "";
    element.className = attribute(attributes, "class") ?? "";
    const message = attribute(attributes, "data-message");
    if (message !== undefined) {
      element.dataset["message"] = message;
    }
    element.hidden = /\shidden(?:\s|$)/.test(attributes);
    body.append(element);
  }
  return body;
}

// Puts the page of the HTML file in place of the document, and gives its
// root element.
export function installPage(html: string): Element {
  const root = new Element("html");
  root.append(bodyOf(html));
  (globalThis as Record<string, unknown>)["document"] = {
    documentElement: root,
    // The events of the document itself, such as visibilitychange, go to
    // its root.
    visibilityState: "visible",
    addEventListener: (type: string, listener: Listener) =>
      root.addEventListener(type, listener),
    getElementById: (id: string) =>
      [...root.all()].find((entry) => entry.id === id) ?? null,
    querySelectorAll: (selector: string) => {
      assert.equal(selector, "[data-message]");
      return [...root.all()].filter(
        (entry) => entry.dataset["message"] !== undefined,
      );
    },
    createElement: (tagName: string) => new Element(tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      new Element(tagName),
  };
  return root;
}

export function find(root: Element, id: string): Element {
  const found = [...root.all()].find((entry) => entry.id === id);
  assert.ok(found, `the page has no element "${id}"`);
  return found;
}

// The handlers of the page settle within the promise chain of the stand-in,
// which one turn of the event loop lets finish.
export function settled(): Promise<void> {
  return new Promise((done) => setTimeout(done, 0));
}

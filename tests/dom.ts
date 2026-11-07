// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// A stand-in for the DOM of a page of the extension, enough for its script:
// elements found by id and by data-message, created, appended, clicked and
// typed into. Its elements come from the HTML file of the page itself, so
// that the ids and the messages the script looks up are the ones the file
// has.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Listener = (event: object) => void;

export class Element {
  readonly tagName: string;
  readonly children: Element[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Listener[]>();
  // The options of each call of scrollIntoView, in order.
  readonly scrolls: object[] = [];
  id = "";
  className = "";
  hidden = false;
  lang = "";
  value = "";
  ownText: string;

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
      this.children.push(
        typeof node === "string" ? new Element("#text", node) : node,
      );
    }
  }

  replaceChildren(...nodes: (Element | string)[]): void {
    this.children.length = 0;
    this.ownText = "";
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: object = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  click(): void {
    this.dispatch("click");
  }

  scrollIntoView(options: object): void {
    this.scrolls.push(options);
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
    const message = attribute(attributes, "data-message");
    if (message !== undefined) {
      element.dataset["message"] = message;
    }
    element.hidden = /\shidden(?:\s|$)/.test(attributes);
    body.children.push(element);
  }
  return body;
}

// Puts the page of the HTML file in place of the document, and gives its
// root element.
export function installPage(html: string): Element {
  const root = new Element("html");
  root.children.push(bodyOf(html));
  (globalThis as Record<string, unknown>)["document"] = {
    documentElement: root,
    getElementById: (id: string) =>
      [...root.all()].find((entry) => entry.id === id) ?? null,
    querySelectorAll: (selector: string) => {
      assert.equal(selector, "[data-message]");
      return [...root.all()].filter(
        (entry) => entry.dataset["message"] !== undefined,
      );
    },
    createElement: (tagName: string) => new Element(tagName),
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

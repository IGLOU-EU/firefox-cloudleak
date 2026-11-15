// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The help of the popup and of the map. The question mark opens its window
// over the page, under a veil, and the cross, Escape or a click on the veil
// closes it. Meanwhile the page under the veil is inert, so that the keyboard
// stays in the help. In the popup, Escape may close the popup itself, which
// is Firefox's choice.

import { element } from "./page.js";

// The text of the help, in order: a paragraph for each message, a list for
// each group of messages.
const TEXT: readonly (string | readonly string[])[] = [
  "helpRoute",
  "helpHttps",
  "helpProviders",
  "helpLaw",
  "helpLevels",
  ["helpLevel2", "helpLevel3", "helpLevel4"],
  "helpColours",
  ["helpRed", "helpOrange", "helpBlue"],
];

function written(tagName: string, message: string): HTMLElement {
  const node = document.createElement(tagName);
  node.textContent = browser.i18n.getMessage(message);
  return node;
}

export function setUpHelp(): void {
  const open = element("help");
  const close = element("help-close");
  const veil = element("help-veil");
  const content = element("content");
  element("help-text").append(
    ...TEXT.map((part) => {
      if (typeof part === "string") {
        return written("p", part);
      }
      const list = document.createElement("ul");
      list.append(...part.map((message) => written("li", message)));
      return list;
    }),
  );
  for (const [button, message] of [
    [open, "helpOpen"],
    [close, "helpClose"],
  ] as const) {
    const name = browser.i18n.getMessage(message);
    button.setAttribute("aria-label", name);
    button.setAttribute("title", name);
  }
  const show = (shown: boolean): void => {
    veil.hidden = !shown;
    content.inert = shown;
    (shown ? close : open).focus();
  };
  open.addEventListener("click", () => show(true));
  close.addEventListener("click", () => show(false));
  veil.addEventListener("click", (event) => {
    if (event.target === veil) {
      show(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !veil.hidden) {
      show(false);
    }
  });
}

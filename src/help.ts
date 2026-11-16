// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The help of the popup and of the map. The question mark opens its window
// over the page, under a veil, and the cross, Escape or a click on the veil
// closes it. Meanwhile the page under the veil is inert, so that the keyboard
// stays in the help. In the popup, Escape may close the popup itself, which
// is Firefox's choice.

import type { Settings } from "./core/popup-message.js";
import { ask, element } from "./page.js";
import { report } from "./toolbar.js";

// The text of the help, in order: a paragraph for each message, a list for
// each group of messages.
const TEXT: readonly (string | readonly string[])[] = [
  "helpRoute",
  "helpHttps",
  "helpProviders",
  "helpLaw",
  "helpStates",
  "helpLevels",
  ["helpLevel2", "helpLevel3", "helpLevel4"],
  "helpColours",
];

// Said only while the dynamic detection is on, after the paragraph on the
// law of a provider, whose flag a supposed provider lacks.
const SUPPOSED = "helpSupposed";
const SUPPOSED_AFTER = "helpLaw";

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
  const supposed = written("p", SUPPOSED);
  supposed.hidden = true;
  element("help-text").append(
    ...TEXT.flatMap((part) => {
      if (typeof part === "string") {
        return part === SUPPOSED_AFTER
          ? [written("p", part), supposed]
          : [written("p", part)];
      }
      const list = document.createElement("ul");
      list.append(...part.map((message) => written("li", message)));
      return [list];
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
  // The settings are asked at each opening, since they may change while the
  // page is open. Without an answer, the paragraph stays as it was.
  const refresh = async (): Promise<void> => {
    const settings = await ask<Settings>({ kind: "settings" });
    supposed.hidden = !settings.dynamic;
  };
  open.addEventListener("click", () => {
    show(true);
    report(refresh());
  });
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

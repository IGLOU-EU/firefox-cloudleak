// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The help of the popup and of the map. The question mark opens its window
// over the page, under a veil, and the cross, Escape or a click on the veil
// closes it. Meanwhile the page under the veil is inert, so that the keyboard
// stays in the help. In the popup, Escape may close the popup itself, which
// is Firefox's choice. The text ends with the about section of the extension.

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

// The addresses of the about section live here rather than in _locales,
// where a test refuses a colon in French without a no-break space before it.
const SOURCE = "https://gitlab.com/iglou.eu/firefox-cloudleak";
const LISTING = "https://addons.mozilla.org/firefox/addon/cloud-leak/";
// GitLab fills the new issue from the template of that name, a file of
// .gitlab/issue_templates/ on the default branch.
const ISSUE = `${SOURCE}/-/issues/new?issuable_template=provider-or-translation`;

function written(
  tagName: string,
  message: string,
  className = "",
  substitutions: string[] = [],
): HTMLElement {
  const node = document.createElement(tagName);
  node.className = className;
  node.textContent = browser.i18n.getMessage(message, substitutions);
  return node;
}

function holding(
  tagName: string,
  className: string,
  ...children: HTMLElement[]
): HTMLElement {
  const node = document.createElement(tagName);
  node.className = className;
  node.append(...children);
  return node;
}

// A link in a new tab of the same window, where Firefox opens a link with
// target="_blank" from the popup as well as from the map: the browser of the
// popup takes the handler of new windows of the window that holds it
// (nsFrameLoader.cpp, ContentParent.cpp and BrowserDOMWindow.sys.mjs,
// Firefox 159.0.1). No referrer, so that the site does not learn the address
// of the page of the extension. The whole address is in its tooltip.
function link(address: string, message: string): HTMLElement {
  const anchor = written("a", message);
  anchor.setAttribute("href", address);
  anchor.setAttribute("title", address);
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noreferrer");
  return anchor;
}

// The logo beside the name, the version read from the manifest, so that
// the build stamps nothing, and the licence, then the links. The logo is
// decorative: the name beside it says it.
function about(): HTMLElement {
  const logo = document.createElement("img");
  for (const [name, value] of [
    ["src", "/icons/logo.svg"],
    ["alt", ""],
    ["width", "48"],
    ["height", "48"],
  ] as const) {
    logo.setAttribute(name, value);
  }
  const version = browser.runtime.getManifest().version;
  return holding(
    "section",
    "about-section",
    written("p", "aboutTitle", "about-title"),
    holding(
      "div",
      "about",
      holding(
        "div",
        "identity",
        logo,
        holding(
          "div",
          "",
          written("p", "extensionName", "name"),
          written("p", "aboutVersion", "meta", [version]),
          written("p", "aboutLicence", "meta"),
        ),
      ),
      holding(
        "ul",
        "links",
        holding("li", "", link(SOURCE, "aboutSource")),
        holding("li", "", link(LISTING, "aboutListing")),
      ),
      written("p", "aboutContribute"),
      holding("p", "issue", link(ISSUE, "aboutIssue")),
    ),
  );
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
    about(),
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

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Firefox runs this file as an event page and runs it again at every wake-up,
// so the listeners whose events must wake it are added synchronously at the
// top level of this module.

import { answer } from "./answer.js";
import { onWindowRemoved } from "./counts.js";
import {
  onBeforeRedirect,
  onErrorOccurred,
  onResponseStarted,
  onSendHeaders,
} from "./requests.js";
import {
  forget,
  onAccessChange,
  onCommitted,
  onCompleted,
  onStatus,
  ready,
} from "./tabs.js";
import { report, setBadgeColours } from "./toolbar.js";

// No listener asks for "blocking" and each returns at once, so Firefox never
// holds a request for the extension. HTTP and WebSocket only, the schemes
// that "*" covers in a match pattern.
const FILTER: browser.webRequest.RequestFilter = { urls: ["*://*/*"] };

browser.webRequest.onSendHeaders.addListener(
  (details) => report(onSendHeaders(details)),
  FILTER,
  ["requestHeaders"],
);
browser.webRequest.onBeforeRedirect.addListener(
  (details) => report(onBeforeRedirect(details)),
  FILTER,
  ["responseHeaders"],
);
browser.webRequest.onResponseStarted.addListener(
  (details) => report(onResponseStarted(details)),
  FILTER,
  ["responseHeaders"],
);

// Firefox persists only the listeners added while the page starts, until its
// DOMContentLoaded, and wakes a suspended page for their events
// (ExtensionCommon.sys.mjs and ext-backgroundPage.js, Firefox 159.0.1). A
// blocker such as uBlock Origin, which LibreWolf installs, makes an error of
// every request it cancels (ChannelWrapper.cpp, Firefox 159.0.1), and this
// listener only drops a request waiting in memory, which a suspension loses
// anyway. Added once the page has read its state, it is not persisted: it
// receives the errors while the page is awake and never wakes it.
ready.then(() => {
  browser.webRequest.onErrorOccurred.addListener(
    (details) => report(onErrorOccurred(details)),
    FILTER,
  );
});

// Without a filter, since Firefox throws on an empty one (browser-compat-data,
// webextensions.api.webNavigation.onCommitted). Frames other than the top
// one are left at once.
browser.webNavigation.onCommitted.addListener((details) =>
  report(onCommitted(details)),
);

// Only a page Firefox loads in its own process needs its completion, having
// no commit: an about: page such as the settings, a chrome: page, and the
// view-source: of either, which loads where the page it shows loads
// (ProcessIsolation.cpp, Firefox 159.0.1). Firefox applies the filter before
// sending anything (ext-webNavigation.js and MatchURLFilters.sys.mjs), so the
// completion of each frame of each website neither reaches nor wakes the
// page. A document with the system principal under a resource: or moz-src:
// address, loaded from a tab already in that process, would stay there too
// (same file), and would keep the state of the page before it: whether
// Firefox has such a page was not checked.
browser.webNavigation.onCompleted.addListener(
  (details) => report(onCompleted(details)),
  { url: [{ schemes: ["about", "chrome", "view-source"] }] },
);

browser.tabs.onUpdated.addListener(
  (tabId, change, tab) => report(onStatus(tabId, change, tab)),
  { properties: ["status"] },
);
browser.tabs.onRemoved.addListener((tabId) => report(forget(tabId)));

// The counts of a private session go with it, when its last private window
// closes. The event wakes the page when it is suspended: its listener is
// primed then, as for every persistent event of an event page
// (ext-windows.js, ext-backgroundPage.js and ExtensionCommon.sys.mjs,
// Firefox 159.0.1).
browser.windows.onRemoved.addListener(() => report(onWindowRemoved()));

// Both fire for a grant or a withdrawal the user makes in the add-ons
// manager or the extensions panel (ext-permissions.js and
// ExtensionPermissions.sys.mjs, Firefox 159.0.1).
browser.permissions.onAdded.addListener(() => report(onAccessChange()));
browser.permissions.onRemoved.addListener(() => report(onAccessChange()));

// The popup asks, the event page answers. Firefox wakes the page for a
// message of the extension whatever its listeners (ext-runtime.js and
// ExtensionParent.sys.mjs, Firefox 159.0.1), and takes the promise a listener
// returns as the answer, or no answer when it returns nothing
// (ExtensionChild.sys.mjs).
browser.runtime.onMessage.addListener((message: unknown) => answer(message));

setBadgeColours();

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Firefox runs this file as an event page and runs it again at every wake-up,
// so listeners must be added synchronously at the top level of this module.

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
browser.webRequest.onErrorOccurred.addListener(
  (details) => report(onErrorOccurred(details)),
  FILTER,
);

// Without a filter, since Firefox throws on an empty one (browser-compat-data,
// webextensions.api.webNavigation.onCommitted). Frames other than the top
// one are left at once.
browser.webNavigation.onCommitted.addListener((details) =>
  report(onCommitted(details)),
);
browser.webNavigation.onCompleted.addListener((details) =>
  report(onCompleted(details)),
);

browser.tabs.onUpdated.addListener(
  (tabId, change, tab) => report(onStatus(tabId, change, tab)),
  { properties: ["status"] },
);
browser.tabs.onRemoved.addListener((tabId) => report(forget(tabId)));

// Both fire for a grant or a withdrawal the user makes in the add-ons
// manager or the extensions panel (ext-permissions.js and
// ExtensionPermissions.sys.mjs, Firefox 159.0.1).
browser.permissions.onAdded.addListener(() => report(onAccessChange()));
browser.permissions.onRemoved.addListener(() => report(onAccessChange()));

setBadgeColours();

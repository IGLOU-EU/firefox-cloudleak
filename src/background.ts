// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Firefox runs this file as an event page and runs it again at every wake-up,
// so listeners must be added synchronously at the top level of this module.

import { forgetAccess } from "./access.js";
import { onErrorOccurred, onResponse, onSendHeaders } from "./requests.js";
import { forget, onStatus } from "./tabs.js";
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
  (details) => report(onResponse(details)),
  FILTER,
  ["responseHeaders"],
);
browser.webRequest.onResponseStarted.addListener(
  (details) => report(onResponse(details)),
  FILTER,
  ["responseHeaders"],
);
browser.webRequest.onErrorOccurred.addListener(
  (details) => report(onErrorOccurred(details)),
  FILTER,
);

browser.tabs.onUpdated.addListener(
  (tabId, _change, tab) => report(onStatus(tabId, tab)),
  { properties: ["status"] },
);
browser.tabs.onRemoved.addListener(forget);

browser.permissions.onAdded.addListener(forgetAccess);
browser.permissions.onRemoved.addListener(forgetAccess);

setBadgeColours();

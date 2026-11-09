// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { canonicalNameOf } from "./cname.js";
import { addressOf } from "./core/addresses.js";
import {
  classifyByCname,
  classifyRequest,
  type RequestFacts,
} from "./core/classify.js";
import {
  leftTheBrowser,
  type RequestSide,
  requestSideOf,
  responseSideOf,
} from "./core/request-facts.js";
import { ignoredNavigation, navigationAt } from "./core/tab-record.js";
import { recording, recordsAddressOf } from "./counts.js";
import table from "./providers.js";
import { fold, missRequest, navigate, ready, recordOf } from "./tabs.js";

// The request side waits here for its response, joined by request id. Each
// entry goes at the response, the redirect or the error, and an entry whose
// error came before the page was ready goes with the page at its
// suspension.
interface Pending {
  readonly tabId: number;
  // The navigation of the document the request was sent for.
  readonly navigation: string;
  readonly request: RequestSide;
  // Firefox flags the requests of a private window (WebRequest.sys.mjs,
  // Firefox 159.0.1), whose counts are never kept.
  readonly privateWindow: boolean;
  // The reduced address, while the recording is on and outside a private
  // window, until the level of the request tells whether it is recorded.
  readonly address: string | null;
}

const pending = new Map<string, Pending>();

// The requests of the browser itself and of other extensions belong to no
// tab, and the tab is what the icon speaks of.
function inTab(details: { readonly tabId: number }): boolean {
  return details.tabId >= 0;
}

// onSendHeaders fires once the headers are final, and before the cache is
// looked up, so a response served from the cache is sorted out at the
// response (WebRequest.sys.mjs and nsHttpChannel.cpp, Firefox 159.0.1).
export async function onSendHeaders(
  details: browser.webRequest._OnSendHeadersDetails,
): Promise<void> {
  if (!inTab(details)) {
    return;
  }
  // The header values stop here: only names and presence go further.
  const request = requestSideOf(details);
  if (request === null) {
    return;
  }
  // Read before waiting, so that the headers are not held across the wait.
  // The time stamp is taken when Firefox sends the request, before the
  // batch that delivers the event (WebRequest.sys.mjs and
  // ConduitsParent.sys.mjs, Firefox 159.0.1).
  const { tabId, requestId, type, timeStamp } = details;
  const privateWindow = details.incognito === true;
  // The URL stops here too: only its reduced address goes further, and none
  // for a private window, which records nothing. The settings are read with
  // the counts, so whether the recording is on is known after the wait.
  const address = privateWindow ? null : addressOf(details.url);
  await ready;
  if (type === "main_frame") {
    navigate(tabId, requestId, timeStamp);
  }
  pending.set(requestId, {
    tabId,
    navigation:
      type === "main_frame"
        ? requestId
        : navigationAt(recordOf(tabId), timeStamp),
    request,
    privateWindow,
    address: recording() ? address : null,
  });
}

// A redirect is a response of its own: the provider read it, and the request
// goes on under the same request id with a new onSendHeaders. An upgrade to
// HTTPS gives its redirect before the request is sent, so a redirect without
// its request says nothing (WebRequest.sys.mjs, Firefox 159.0.1).
export async function onBeforeRedirect(
  details: browser.webRequest._OnBeforeRedirectDetails,
): Promise<void> {
  await ready;
  await settle(details);
}

// A response of a tab whose request the extension never saw means it missed
// requests: Firefox sends no onSendHeaders for a request a service worker
// intercepts (nsHttpChannel.cpp, Firefox 159.0.1), the worker's own requests
// belong to no tab, and the page forgets the requests it waited on when it is
// suspended. The display then says the view is partial, as it cannot know
// what those requests carried.
export async function onResponseStarted(
  details: browser.webRequest._OnResponseStartedDetails,
): Promise<void> {
  await ready;
  if (pending.has(details.requestId) || !inTab(details)) {
    await settle(details);
    return;
  }
  const { tabId, requestId, type, timeStamp } = details;
  if (type === "main_frame") {
    navigate(tabId, requestId, timeStamp);
  }
  missRequest(
    tabId,
    type === "main_frame"
      ? requestId
      : navigationAt(recordOf(tabId), timeStamp),
  );
}

async function settle(
  details:
    | browser.webRequest._OnBeforeRedirectDetails
    | browser.webRequest._OnResponseStartedDetails,
): Promise<void> {
  const entry = pending.get(details.requestId);
  if (entry === undefined) {
    return;
  }
  pending.delete(details.requestId);
  // Read at the response, the last moment before the classification, which
  // may cost a DNS resolution: the site of the document may have become
  // ignored since the request was sent, by the user or by the commit of the
  // document the request opens.
  if (
    !leftTheBrowser(details) ||
    ignoredNavigation(recordOf(entry.tabId), entry.navigation)
  ) {
    return;
  }
  const facts: RequestFacts = {
    ...entry.request,
    ...responseSideOf(details),
  };
  const classification = await classify(facts, details.timeStamp);
  if (classification === null) {
    fold(entry.tabId, entry.navigation, null);
    return;
  }
  // The address waits with the request for the site of its document only
  // when its level is recorded.
  const { address } = entry;
  fold(entry.tabId, entry.navigation, {
    classification,
    method: entry.request.method,
    type: entry.request.type,
    privateWindow: entry.privateWindow,
    ...(address !== null && recordsAddressOf(classification.leak.level)
      ? { address }
      : {}),
  });
}

export async function onErrorOccurred(
  details: browser.webRequest._OnErrorOccurredDetails,
): Promise<void> {
  await ready;
  pending.delete(details.requestId);
}

// The CNAME chain costs a DNS resolution, so it is read only when the address
// and the response do not already name the provider.
async function classify(facts: RequestFacts, timeStamp: number) {
  const direct = classifyRequest(facts, table);
  if (direct !== null) {
    return direct;
  }
  const name = await canonicalNameOf(facts.host, timeStamp);
  return name === null ? null : classifyByCname(facts, name, table);
}

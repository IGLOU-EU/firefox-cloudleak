// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { canonicalNameOf } from "./cname.js";
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
import { navigationAt } from "./core/tab-record.js";
import table from "./providers.js";
import { fold, missRequest, navigate, ready, recordOf } from "./tabs.js";

// The request side waits here for its response, joined by request id. Each
// entry goes at the response, the redirect or the error, so none outlives
// its request.
interface Pending {
  readonly tabId: number;
  // The navigation of the document the request was sent for.
  readonly navigation: string;
  readonly request: RequestSide;
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
  if (!leftTheBrowser(details)) {
    return;
  }
  const facts: RequestFacts = {
    ...entry.request,
    ...responseSideOf(details),
  };
  fold(entry.tabId, entry.navigation, await classify(facts, details.timeStamp));
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

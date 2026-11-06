// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import type { RequestFacts, ResponseHeader } from "./classify.js";

// A header as webRequest delivers it. A header given only as binary is kept
// by its name, since its presence alone can be a signal.
export interface HttpHeader {
  readonly name: string;
  readonly value?: string | undefined;
}

export type RequestSide = Pick<
  RequestFacts,
  | "method"
  | "type"
  | "tls"
  | "host"
  | "path"
  | "queryNames"
  | "cookies"
  | "authorization"
>;

export type ResponseSide = Pick<
  RequestFacts,
  "ip" | "responseHeaders" | "setCookies"
>;

const TLS_SCHEMES = ["https:", "wss:"];
const SCHEMES = ["http:", "ws:", ...TLS_SCHEMES];

// Firefox hands over the whole Cookie and Authorization headers, values
// included. Only the names and the presence leave this function, so that no
// value can be kept or passed on by mistake.
export function requestSideOf(request: {
  readonly url: string;
  readonly method: string;
  readonly type: string;
  readonly requestHeaders?: readonly HttpHeader[] | undefined;
}): RequestSide | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (!SCHEMES.includes(url.protocol)) {
    return null;
  }
  const headers = request.requestHeaders ?? [];
  return {
    method: request.method,
    type: request.type,
    tls: TLS_SCHEMES.includes(url.protocol),
    host: url.hostname,
    path: url.pathname,
    queryNames: queryNamesOf(url.search),
    cookies: headers
      .filter((header) => isNamed(header, "cookie"))
      .flatMap((header) => (header.value ?? "").split(";"))
      .filter((pair) => pair.trim() !== "")
      .map(nameOfPair),
    authorization: headers.some((header) => isNamed(header, "authorization")),
  };
}

export function responseSideOf(response: {
  readonly ip?: string | null | undefined;
  readonly responseHeaders?: readonly HttpHeader[] | undefined;
}): ResponseSide {
  const headers = response.responseHeaders ?? [];
  const responseHeaders: ResponseHeader[] = headers
    .filter((header) => !isNamed(header, "set-cookie"))
    .map((header) => ({ name: header.name, value: header.value ?? "" }));
  // Firefox joins several Set-Cookie headers with a line break.
  const setCookies = headers
    .filter((header) => isNamed(header, "set-cookie"))
    .flatMap((header) => (header.value ?? "").split("\n"))
    .filter((line) => line.trim() !== "")
    .map((line) => nameOfPair(line.split(";")[0] ?? ""));
  return { ip: response.ip ?? null, responseHeaders, setCookies };
}

// Firefox gives no address to a response its cache served alone, and the
// address of the server to one it revalidated there. Only the first sent
// nothing out, and a response from the network always counts, with or
// without an address, so that a missing address never hides a request.
export function leftTheBrowser(response: {
  readonly fromCache?: boolean | undefined;
  readonly ip?: string | null | undefined;
}): boolean {
  return response.fromCache !== true || (response.ip ?? null) !== null;
}

function isNamed(header: HttpHeader, name: string): boolean {
  return header.name.toLowerCase() === name;
}

// A cookie written without "=" has an empty name and the whole text as its
// value, so the text is never taken for a name.
function nameOfPair(pair: string): string {
  const equals = pair.indexOf("=");
  return equals < 0 ? "" : pair.slice(0, equals).trim();
}

// Split by hand rather than with URLSearchParams, so that the values are
// never even decoded.
function queryNamesOf(search: string): string[] {
  return search
    .slice(1)
    .split("&")
    .filter((part) => part !== "")
    .map((part) => decodeName(part.split("=")[0] ?? ""));
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name.replaceAll("+", " "));
  } catch {
    return name;
  }
}

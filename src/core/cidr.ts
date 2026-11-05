// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

export type IpFamily = 4 | 6;

export interface IpAddress {
  readonly family: IpFamily;
  readonly value: bigint;
}

export interface Cidr {
  readonly family: IpFamily;
  readonly network: bigint;
  readonly prefixLength: number;
}

// The reason is meant for a person fixing a data file, so it says what is
// wrong rather than only that something is.
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

const WIDTH: Record<IpFamily, number> = { 4: 32, 6: 128 };

// Leading zeros are refused because some parsers read them as octal, so the
// same text could name two different addresses.
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HEX_GROUP = /^[0-9a-fA-F]{1,4}$/;

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function parseIpv4(text: string): bigint | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) {
    return undefined;
  }
  let value = 0n;
  for (const part of parts) {
    if (!DECIMAL.test(part) || part.length > 3 || Number(part) > 255) {
      return undefined;
    }
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseGroups(text: string): bigint[] | undefined {
  if (text === "") {
    return [];
  }
  const groups: bigint[] = [];
  for (const group of text.split(":")) {
    if (!HEX_GROUP.test(group)) {
      return undefined;
    }
    groups.push(BigInt(`0x${group}`));
  }
  return groups;
}

function parseIpv6(text: string): bigint | undefined {
  let body = text;
  let tail: bigint[] = [];
  const lastColon = body.lastIndexOf(":");
  if (body.includes(".", lastColon)) {
    const ipv4 = parseIpv4(body.slice(lastColon + 1));
    if (ipv4 === undefined) {
      return undefined;
    }
    tail = [ipv4 >> 16n, ipv4 & 0xffffn];
    // Keep the colon when it belongs to "::", so the split below still sees it.
    body = body.endsWith("::", lastColon + 1)
      ? body.slice(0, lastColon + 1)
      : body.slice(0, lastColon);
  }

  const halves = body.split("::");
  if (halves.length > 2) {
    return undefined;
  }
  const head = parseGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (head === undefined || rest === undefined) {
    return undefined;
  }
  const explicit = [...head, ...rest, ...tail];
  if (halves.length === 1 ? explicit.length !== 8 : explicit.length > 7) {
    return undefined;
  }
  const zeros: bigint[] = new Array(8 - explicit.length).fill(0n);
  const groups = [...head, ...zeros, ...rest, ...tail];
  return groups.reduce((value, group) => (value << 16n) | group, 0n);
}

export function parseIp(text: string): Parsed<IpAddress> {
  if (text.includes(":")) {
    const value = parseIpv6(text);
    return value === undefined
      ? fail(`"${text}" is not an IP address`)
      : { ok: true, value: { family: 6, value } };
  }
  const value = parseIpv4(text);
  return value === undefined
    ? fail(`"${text}" is not an IP address`)
    : { ok: true, value: { family: 4, value } };
}

export function parseCidr(text: string): Parsed<Cidr> {
  const slash = text.indexOf("/");
  if (slash === -1) {
    return fail(`"${text}" has a missing prefix length, such as "/24"`);
  }
  const address = parseIp(text.slice(0, slash));
  if (!address.ok) {
    return address;
  }
  const { family, value } = address.value;
  const width = WIDTH[family];
  const prefixText = text.slice(slash + 1);
  const prefixLength = Number(prefixText);
  if (!DECIMAL.test(prefixText) || prefixLength > width) {
    return fail(
      `"${text}" has an invalid prefix length, it must be between 0 and ${width}`,
    );
  }
  const hostBits = BigInt(width - prefixLength);
  if (value & ((1n << hostBits) - 1n)) {
    // A set host bit is most often a typing error in the network address.
    return fail(
      `"${text}" has host bits set beyond the prefix length of ${prefixLength}`,
    );
  }
  return { ok: true, value: { family, network: value, prefixLength } };
}

export function cidrContains(range: Cidr, address: IpAddress): boolean {
  if (range.family !== address.family) {
    return false;
  }
  const hostBits = BigInt(WIDTH[range.family] - range.prefixLength);
  return address.value >> hostBits === range.network >> hostBits;
}

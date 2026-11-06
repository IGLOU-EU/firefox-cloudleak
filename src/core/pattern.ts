// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

const STAR = "*".charCodeAt(0);

// The data uses "*" as its only wildcard, so a plain matcher does the work of
// a regular expression without its cost: regular expressions run interpreted
// in the safer levels of Tor Browser. Every name, value and host the data
// describes is compared without regard to case.
export function matchesPattern(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  let j = 0;
  // Where the last "*" stands in the pattern, and where its match ends in the
  // text, so a failed attempt can give that "*" one more character.
  let star = -1;
  let starEnd = 0;
  while (j < t.length) {
    if (i < p.length && p.charCodeAt(i) === STAR) {
      star = i;
      starEnd = j;
      i += 1;
    } else if (i < p.length && p.charCodeAt(i) === t.charCodeAt(j)) {
      i += 1;
      j += 1;
    } else if (star !== -1) {
      starEnd += 1;
      i = star + 1;
      j = starEnd;
    } else {
      return false;
    }
  }
  while (i < p.length && p.charCodeAt(i) === STAR) {
    i += 1;
  }
  return i === p.length;
}

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// Long enough to gather the requests of a page load into one write, far
// shorter than the suspension delay so that no write is lost.
export const WRITE_DELAY_MS = 500;

// Gathers the items that change during a burst and hands them over once,
// after the delay, each item once.
export function batch<T>(
  delayMs: number,
  flush: (items: readonly T[]) => void,
): (item: T) => void {
  const pending = new Set<T>();
  return (item) => {
    if (pending.size === 0) {
      setTimeout(() => {
        const items = [...pending];
        pending.clear();
        flush(items);
      }, delayMs);
    }
    pending.add(item);
  };
}

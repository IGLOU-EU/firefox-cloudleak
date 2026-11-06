// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification } from "../src/core/classify.js";
import {
  type DocumentRecord,
  displayedDocument,
  EMPTY_RECORD,
  foldRequest,
  HIDDEN_SITE,
  markHiddenSite,
  markMissedRequest,
  markPartialView,
  navigationAt,
  PREVIOUS_DOCUMENTS,
  showCompletedDocument,
  showDocument,
  startNavigation,
  type TabRecord,
} from "../src/core/tab-record.js";
import {
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";

const RED_3: Classification = {
  provider: "cloudflare",
  proven: true,
  leak: { level: 3 },
};
const BLUE_2: Classification = { ...RED_3, leak: { level: 2 } };
const RED_4: Classification = {
  ...RED_3,
  leak: { level: 4, case: "session", possible: true, challenge: false },
};

function seen(
  request: Classification,
  partial = false,
  missed = false,
): TabState {
  const level = request.leak.level;
  const tallies = [
    { level, proven: level <= 2 ? null : request.proven, count: 1 },
  ];
  return { kind: "seen", request, tallies, partial, missed };
}

// A page loaded by a top-level request the extension saw: the request is
// sent, its response is classified, then Firefox commits the document.
function load(
  record: TabRecord,
  navigation: string,
  document: string,
  at: number,
  request: Classification | null,
): TabRecord {
  const started = startNavigation(record, navigation, false, at);
  const folded = foldRequest(started, navigation, request);
  return showDocument(folded, document, at + 10, false);
}

// What the tab shows of a record: its document and its state.
function shown(record: DocumentRecord) {
  return { document: record.document, state: record.state };
}

describe("startNavigation", () => {
  it("starts a tab over on a new top-level navigation, before the document commits", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const next = startNavigation(record, "2", false, 200);
    assert.equal(next.navigation, "2");
    assert.equal(next.document, null);
    assert.deepEqual(next.state, NEUTRAL);
  });

  it("starts a tab over neutral with a partial view while the extension lacks the access to all sites", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    assert.deepEqual(
      startNavigation(record, "2", true, 200).state,
      markPartial(NEUTRAL),
    );
    assert.deepEqual(markPartial(NEUTRAL), {
      kind: "neutral",
      partial: true,
      missed: false,
    });
  });

  it("keeps the tab across the redirects of the same navigation", () => {
    const record = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false, 100),
      "1",
      RED_3,
    );
    assert.equal(startNavigation(record, "1", false, 150), record);
  });

  it("keeps the document a navigation leaves, the most recently shown first", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const b = load(a, "2", "doc-b", 200, BLUE_2);
    const next = startNavigation(b, "3", false, 300);
    assert.deepEqual(
      next.previous.map((entry) => [entry.document, entry.state]),
      [
        ["doc-b", seen(BLUE_2)],
        ["doc-a", seen(RED_3)],
        ["", EMPTY_RECORD.state],
      ],
    );
  });

  it("does not keep a navigation that never committed, such as one replaced by the next click", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = startNavigation(a, "2", false, 200);
    const next = startNavigation(pending, "3", false, 210);
    assert.deepEqual(
      next.previous.map((entry) => entry.document),
      ["doc-a", ""],
    );
  });

  it("lets a top-level request sent before the document the tab shows committed open that document, without starting over", () => {
    // Firefox delivers request events in batches and navigation events at
    // once, so the commit can reach the extension before its request.
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const committed = showDocument(a, "doc-b", 220, false);
    const late = startNavigation(committed, "2", false, 200);
    assert.equal(late.navigation, "2");
    assert.equal(late.document, "doc-b");
    assert.deepEqual(late.state, NEUTRAL);
    assert.deepEqual(shown(foldRequest(late, "2", BLUE_2)), {
      document: "doc-b",
      state: seen(BLUE_2),
    });
    assert.deepEqual(late.previous[0]?.state, seen(RED_3));
  });

  it("lets a late top-level request open the document committed first after it was sent, even once the tab went Back", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = showDocument(searx, "doc-deezer", 210, false);
    const back = showDocument(deezer, "doc-searx", 300, false);
    const late = foldRequest(
      startNavigation(back, "2", false, 200),
      "2",
      RED_4,
    );
    assert.deepEqual(shown(late), { document: "doc-searx", state: NEUTRAL });
    assert.equal(late.navigation, "1");
    assert.deepEqual(shown(showDocument(late, "doc-deezer", 400, false)), {
      document: "doc-deezer",
      state: seen(RED_4),
    });
  });

  it("starts over on a top-level request sent after the tab showed its document", () => {
    const committed = showDocument(
      load(EMPTY_RECORD, "1", "doc-a", 100, RED_3),
      "doc-b",
      220,
      false,
    );
    const next = startNavigation(committed, "3", false, 220);
    assert.equal(next.document, null);
    assert.equal(next.navigation, "3");
  });
});

describe("showDocument", () => {
  it("gives the pending navigation the document it committed, with what it saw", () => {
    const pending = foldRequest(
      startNavigation(EMPTY_RECORD, "1", false, 100),
      "1",
      RED_3,
    );
    const record = showDocument(pending, "doc-a", 120, false);
    assert.deepEqual(shown(record), { document: "doc-a", state: seen(RED_3) });
    assert.equal(record.navigation, "1");
    assert.equal(record.shownAt, 120);
  });

  it("starts neutral a document no request opened, such as a local file or an about: page", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const file = showDocument(a, "doc-file", 300, false);
    assert.deepEqual(shown(file), { document: "doc-file", state: NEUTRAL });
    assert.deepEqual(file.previous[0]?.state, seen(RED_3));
    assert.deepEqual(
      showDocument(a, "doc-file", 300, true).state,
      markPartial(NEUTRAL),
    );
  });

  it("says a document Back or Forward brings back that the tab never showed missed its requests, such as one loaded before the extension started", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const back = showDocument(a, "doc-unknown", 300, false, true);
    assert.deepEqual(shown(back), {
      document: "doc-unknown",
      state: markMissed(NEUTRAL),
    });
    assert.deepEqual(
      showDocument(a, "doc-unknown", 300, true, true).state,
      markPartial(markMissed(NEUTRAL)),
    );
  });

  it("brings back as it was a document Back or Forward brings back that the tab showed before", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, BLUE_2);
    const deezer = load(searx, "2", "doc-deezer", 200, null);
    const back = showDocument(deezer, "doc-searx", 300, false, true);
    assert.deepEqual(shown(back), {
      document: "doc-searx",
      state: seen(BLUE_2),
    });
  });

  it("gives the pending navigation a document Back or Forward loads again, whose request the extension saw", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = foldRequest(
      startNavigation(a, "2", false, 200),
      "2",
      RED_3,
    );
    assert.deepEqual(
      showDocument(pending, "doc-b", 210, false, true).state,
      seen(RED_3),
    );
  });

  it("counts what a document no request opened receives next, for that document", () => {
    const file = showDocument(
      load(EMPTY_RECORD, "1", "doc-a", 100, RED_3),
      "doc-file",
      300,
      false,
    );
    const navigation = navigationAt(file, 310);
    assert.deepEqual(shown(foldRequest(file, navigation, BLUE_2)), {
      document: "doc-file",
      state: seen(BLUE_2),
    });
  });

  it("brings back the state of a document the tab showed before, on Back and on Forward", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, RED_4);
    const back = showDocument(deezer, "doc-searx", 300, false);
    assert.deepEqual(shown(back), { document: "doc-searx", state: NEUTRAL });
    const forward = showDocument(back, "doc-deezer", 400, false);
    assert.deepEqual(shown(forward), {
      document: "doc-deezer",
      state: seen(RED_4),
    });
    assert.deepEqual(
      forward.previous.map((entry) => [entry.document, entry.state]),
      [
        ["doc-searx", NEUTRAL],
        ["", EMPTY_RECORD.state],
      ],
    );
  });

  it("counts what a document brought back receives next, for that document", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, BLUE_2);
    const back = showDocument(
      load(searx, "2", "doc-deezer", 200, RED_4),
      "doc-searx",
      300,
      false,
    );
    const after = foldRequest(back, navigationAt(back, 310), BLUE_2);
    assert.equal(after.document, "doc-searx");
    assert.deepEqual(after.state.kind === "seen" ? after.state.tallies : [], [
      { level: 2, proven: null, count: 2 },
    ]);
  });

  it("brings back a document with a partial view while the extension lacks the access to all sites", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, BLUE_2);
    const deezer = load(searx, "2", "doc-deezer", 200, RED_4);
    assert.deepEqual(
      showDocument(deezer, "doc-searx", 300, true).state,
      seen(BLUE_2, true),
    );
  });

  it("leaves the record as it is on a second commit of the document the tab shows", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    assert.equal(showDocument(record, "doc-a", 500, false), record);
  });

  it(`keeps the ${PREVIOUS_DOCUMENTS} documents shown last, and starts over neutral one it no longer keeps`, () => {
    const first = load(EMPTY_RECORD, "1", "doc-0", 100, RED_3);
    let record = first;
    for (let index = 1; index <= PREVIOUS_DOCUMENTS + 1; index += 1) {
      record = load(
        record,
        String(index + 1),
        `doc-${index}`,
        1000 * index,
        null,
      );
    }
    assert.equal(record.previous.length, PREVIOUS_DOCUMENTS);
    assert.equal(
      record.previous.some((entry) => entry.document === "doc-0"),
      false,
    );
    assert.deepEqual(shown(showDocument(record, "doc-0", 50_000, false)), {
      document: "doc-0",
      state: NEUTRAL,
    });
  });
});

describe("showCompletedDocument", () => {
  it("starts neutral a document the tab completed without a commit, such as the browser's settings page", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const settings = showCompletedDocument(a, "doc-settings", 300, false);
    assert.deepEqual(shown(settings), {
      document: "doc-settings",
      state: NEUTRAL,
    });
    assert.deepEqual(settings.previous[0]?.state, seen(RED_3));
    assert.deepEqual(
      showCompletedDocument(a, "doc-settings", 300, true).state,
      markPartial(NEUTRAL),
    );
  });

  it("leaves the record as it is for a document it knows, the one shown or one shown before", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const b = load(a, "2", "doc-b", 200, BLUE_2);
    assert.equal(showCompletedDocument(b, "doc-b", 300, false), b);
    assert.equal(showCompletedDocument(b, "doc-a", 300, false), b);
  });
});

describe("navigationAt", () => {
  it("gives a request the navigation of the document the tab shows", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    assert.equal(navigationAt(record, 110), "1");
    assert.equal(navigationAt(record, 5000), "1");
  });

  it("gives a request sent while a navigation is pending to the document the tab still shows", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = startNavigation(a, "2", false, 200);
    assert.equal(navigationAt(pending, 150), "1");
    assert.equal(navigationAt(pending, 250), "1");
  });

  it("gives a request sent while a navigation is pending to the document shown when it was sent", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, null);
    const pending = startNavigation(deezer, "3", false, 300);
    assert.equal(navigationAt(pending, 150), "1");
    assert.equal(navigationAt(pending, 250), "2");
  });

  it("gives a request to a pending navigation when the tab showed nothing before it", () => {
    const record: TabRecord = {
      document: null,
      shownAt: 0,
      navigation: "1",
      state: NEUTRAL,
      previous: [],
    };
    assert.equal(navigationAt(record, 50), "1");
  });

  it("gives a request to the wait for a site out of reach, which the tab shows at once", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const hidden = markHiddenSite(a);
    assert.equal(navigationAt(hidden, 150), HIDDEN_SITE);
  });

  it("gives a request sent before the tab showed its document to the document shown then", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, null);
    const back = showDocument(deezer, "doc-searx", 300, false);
    assert.equal(navigationAt(back, 250), "2");
    assert.equal(navigationAt(back, 300), "1");
  });

  it("gives a request to the document shown when no document shown before remains for it", () => {
    const record: TabRecord = {
      document: "doc-a",
      shownAt: 100,
      navigation: "1",
      state: NEUTRAL,
      previous: [],
    };
    assert.equal(navigationAt(record, 50), "1");
  });
});

describe("foldRequest", () => {
  it("folds the requests of the current navigation", () => {
    const record = startNavigation(EMPTY_RECORD, "1", false, 100);
    assert.deepEqual(foldRequest(record, "1", BLUE_2).state, seen(BLUE_2));
    assert.equal(foldRequest(record, "1", null), record);
  });

  it("folds a request into the document it was sent for, even once the tab left it", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, RED_4);
    const back = showDocument(deezer, "doc-searx", 300, false);
    const late = foldRequest(back, navigationAt(back, 290), RED_4);
    assert.deepEqual(late.state, NEUTRAL);
    const saved = late.previous.find(
      (entry) => entry.document === "doc-deezer",
    );
    assert.deepEqual(saved?.state.kind === "seen" ? saved.state.tallies : [], [
      { level: 4, proven: true, count: 2 },
    ]);
  });

  it("ignores a request of a navigation the tab does not keep, such as one that never committed", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const record = startNavigation(
      startNavigation(a, "2", false, 200),
      "3",
      false,
      210,
    );
    assert.equal(foldRequest(record, "2", RED_3), record);
  });

  it("folds into a tab seen for the first time, such as one open before the extension, and says it missed its start", () => {
    assert.deepEqual(
      foldRequest(EMPTY_RECORD, "", BLUE_2).state,
      seen(BLUE_2, false, true),
    );
  });
});

describe("displayedDocument", () => {
  it("is the document the tab shows once it committed", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    assert.equal(displayedDocument(record), record);
  });

  it("stays the document still shown while a navigation has not committed, which a download, a 204 response or a stop never does", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const pending = startNavigation(red, "2", false, 200);
    const downloaded = foldRequest(pending, "2", null);
    assert.deepEqual(shown(displayedDocument(downloaded)), {
      document: "doc-a",
      state: seen(RED_4),
    });
  });

  it("counts the requests the page still shown sends during that wait, and shows them", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const pending = foldRequest(
      startNavigation(red, "2", false, 200),
      "2",
      BLUE_2,
    );
    const polled = foldRequest(pending, navigationAt(pending, 300), RED_4);
    const state = displayedDocument(polled).state;
    assert.deepEqual(state.kind === "seen" ? state.tallies : [], [
      { level: 4, proven: true, count: 2 },
    ]);
  });

  it("keeps the page still shown, with what it saw, when the next click replaces the navigation that never committed", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const pending = startNavigation(red, "2", false, 200);
    const polled = foldRequest(pending, navigationAt(pending, 300), RED_4);
    const next = startNavigation(polled, "3", false, 400);
    assert.deepEqual(
      shown(displayedDocument(next)),
      shown(polled.previous[0] ?? red),
    );
    assert.equal(next.previous[0]?.document, "doc-a");
  });

  it("becomes the document the navigation opens once it commits", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const committed = showDocument(
      startNavigation(red, "2", false, 200),
      "doc-b",
      210,
      false,
    );
    assert.deepEqual(shown(displayedDocument(committed)), {
      document: "doc-b",
      state: NEUTRAL,
    });
  });

  it("is the wait for a site out of reach, shown at once as not observed", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const hidden = markHiddenSite(red);
    assert.equal(displayedDocument(hidden), hidden);
    assert.deepEqual(displayedDocument(hidden).state, NOT_OBSERVED);
  });

  it("is the pending navigation when the tab showed nothing before it", () => {
    const record: TabRecord = {
      document: null,
      shownAt: 0,
      navigation: "1",
      state: NEUTRAL,
      previous: [],
    };
    assert.equal(displayedDocument(record), record);
  });
});

describe("EMPTY_RECORD", () => {
  it("shows neutral a tab the extension has not seen navigate, and says it missed requests of its page", () => {
    assert.deepEqual(EMPTY_RECORD.state, markMissed(NEUTRAL));
    assert.deepEqual(markMissed(NEUTRAL), {
      kind: "neutral",
      partial: false,
      missed: true,
    });
  });

  it("lets the first navigation the extension sees start the tab over, with nothing missed", () => {
    assert.deepEqual(
      startNavigation(EMPTY_RECORD, "1", false, 100).state,
      NEUTRAL,
    );
    assert.deepEqual(
      load(EMPTY_RECORD, "1", "doc-a", 100, null).state,
      NEUTRAL,
    );
  });
});

describe("markMissedRequest", () => {
  it("says the document a navigation opened missed requests, and keeps what it saw", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const missed = markMissedRequest(record, "1");
    assert.deepEqual(shown(missed), {
      document: "doc-a",
      state: seen(RED_3, false, true),
    });
    assert.equal(markMissedRequest(missed, "1"), missed);
  });

  it("marks the document shown before that the navigation opened, not the one shown now", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, RED_4);
    const missed = markMissedRequest(deezer, "1");
    assert.deepEqual(missed.state, deezer.state);
    assert.deepEqual(
      missed.previous.find((entry) => entry.document === "doc-searx")?.state,
      markMissed(NEUTRAL),
    );
  });

  it("marks a pending navigation, whose document then commits with requests missed", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = markMissedRequest(startNavigation(a, "2", false, 200), "2");
    assert.deepEqual(
      showDocument(pending, "doc-b", 210, false).state,
      markMissed(NEUTRAL),
    );
  });

  it("ignores a navigation the tab does not keep", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    assert.equal(markMissedRequest(record, "9"), record);
  });
});

describe("markHiddenSite", () => {
  it("makes a document no request opened not observed when it shows a site the extension cannot see", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const hidden = markHiddenSite(showDocument(a, "doc-h", 300, true));
    assert.deepEqual(shown(hidden), { document: "doc-h", state: NOT_OBSERVED });
    assert.deepEqual(hidden.previous[0]?.state, seen(RED_3));
  });

  it("sets aside a document opened by a request the extension saw: the hidden site is the next document, which takes the next commit", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const hidden = markHiddenSite(a);
    assert.deepEqual(shown(hidden), { document: null, state: NOT_OBSERVED });
    assert.equal(hidden.navigation, HIDDEN_SITE);
    assert.deepEqual(hidden.previous[0]?.state, seen(RED_3));
    const committed = showDocument(hidden, "doc-h", 300, true);
    assert.deepEqual(shown(committed), {
      document: "doc-h",
      state: NOT_OBSERVED,
    });
    assert.deepEqual(shown(showDocument(committed, "doc-a", 400, false)), {
      document: "doc-a",
      state: seen(RED_3),
    });
  });

  it("keeps what the tab saw on the hidden site, with a partial view", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    assert.deepEqual(hidden.state, NOT_OBSERVED);
    const after = foldRequest(hidden, navigationAt(hidden, 100), BLUE_2);
    assert.deepEqual(after.state, seen(BLUE_2, true));
    assert.equal(markHiddenSite(after), after);
  });

  it("leaves a navigation the extension saw and that has not committed: the page still shown is the one out of reach", () => {
    const pending = startNavigation(
      markHiddenSite(EMPTY_RECORD),
      "2",
      true,
      200,
    );
    assert.equal(markHiddenSite(pending), pending);
  });

  it("lets a later navigation the extension sees start the tab over", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    const next = startNavigation(hidden, "3", false, 200);
    assert.equal(next.navigation, "3");
    assert.deepEqual(next.state, NEUTRAL);
  });
});

describe("markPartialView", () => {
  it("makes the view of the current navigation partial, and keeps what it saw", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const partial = markPartialView(record);
    assert.deepEqual(shown(partial), {
      document: "doc-a",
      state: seen(RED_3, true),
    });
  });

  it("keeps a tab where nothing was seen neutral, with a partial view", () => {
    assert.deepEqual(
      markPartialView(startNavigation(EMPTY_RECORD, "1", false, 100)).state,
      { kind: "neutral", partial: true, missed: false },
    );
    assert.deepEqual(markPartialView(EMPTY_RECORD).state, {
      kind: "neutral",
      partial: true,
      missed: true,
    });
  });

  it("leaves a tab not observed, or already partial, as it is", () => {
    const hidden = markHiddenSite(EMPTY_RECORD);
    assert.equal(markPartialView(hidden), hidden);
    const partial = markPartialView(
      startNavigation(EMPTY_RECORD, "1", false, 100),
    );
    assert.equal(markPartialView(partial), partial);
  });

  it("lets the next navigation start over with the view the permissions give", () => {
    const partial = markPartialView(
      startNavigation(EMPTY_RECORD, "1", false, 100),
    );
    assert.deepEqual(startNavigation(partial, "2", false, 200).state, NEUTRAL);
  });

  it("makes partial the page still shown while a navigation is pending, and the navigation", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const partial = markPartialView(startNavigation(red, "2", false, 200));
    assert.deepEqual(displayedDocument(partial).state, seen(RED_3, true));
    assert.deepEqual(partial.state, markPartial(NEUTRAL));
    assert.equal(markPartialView(partial), partial);
  });
});

// The visit the extension must follow: a search page with no provider, a
// site behind one, then Back and Forward from the back-forward cache, which
// send no request. Firefox delivers request events in batches and
// navigation events at once, so both orders are played.
describe("Back and Forward between two pages", () => {
  function visit(commitFirst: boolean): TabRecord {
    let record = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    if (commitFirst) {
      record = showDocument(record, "doc-deezer", 220, false);
      record = startNavigation(record, "2", false, 200);
      record = foldRequest(record, "2", RED_4);
    } else {
      record = startNavigation(record, "2", false, 200);
      record = showDocument(record, "doc-deezer", 220, false);
      record = foldRequest(record, "2", RED_4);
    }
    return foldRequest(record, navigationAt(record, 230), RED_4);
  }

  for (const commitFirst of [false, true]) {
    it(`shows each page's own state${commitFirst ? ", when the commit arrives before the request" : ""}`, () => {
      const deezer = visit(commitFirst);
      assert.equal(deezer.document, "doc-deezer");
      assert.deepEqual(
        deezer.state.kind === "seen" ? deezer.state.tallies : [],
        [{ level: 4, proven: true, count: 2 }],
      );
      const back = showDocument(deezer, "doc-searx", 300, false);
      assert.deepEqual(shown(back), { document: "doc-searx", state: NEUTRAL });
      const forward = showDocument(back, "doc-deezer", 400, false);
      assert.deepEqual(shown(forward), shown(deezer));
    });
  }

  it("counts a request the left page sent just before Back for that page, even when it arrives after", () => {
    const deezer = visit(false);
    const back = showDocument(deezer, "doc-searx", 300, false);
    const late = foldRequest(back, navigationAt(back, 299), RED_4);
    assert.deepEqual(shown(late), { document: "doc-searx", state: NEUTRAL });
    const forward = showDocument(late, "doc-deezer", 400, false);
    assert.deepEqual(
      forward.state.kind === "seen" ? forward.state.tallies : [],
      [{ level: 4, proven: true, count: 3 }],
    );
  });
});

// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Classification } from "../src/core/classify.js";
import type { SeenRequest } from "../src/core/counts.js";
import {
  type DocumentRecord,
  displayedDocument,
  EMPTY_RECORD,
  foldRequest,
  HIDDEN_SITE,
  ignoredNavigation,
  learnUnseenDocument,
  markHiddenSite,
  markIgnoredSite,
  markMissedRequest,
  markPartialView,
  markWatchedSite,
  navigationAt,
  PREVIOUS_DOCUMENTS,
  showCompletedDocument,
  showDocument,
  siteToLearn,
  startNavigation,
  type TabRecord,
  takeCountable,
} from "../src/core/tab-record.js";
import {
  addRequest,
  IGNORED,
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

const SITE = "site.example";

// A tab whose first navigation is pending, which showed nothing before it.
const FIRST_NAVIGATION: TabRecord = {
  document: null,
  shownAt: 0,
  navigation: "1",
  state: NEUTRAL,
  page: "site",
  site: null,
  uncounted: [],
  previous: [],
};

// A request through a provider, as the kept counts take it.
function sent(
  classification: Classification,
  method = "GET",
  type = "script",
): SeenRequest {
  return { classification, method, type, privateWindow: false };
}

// Folds a request through a provider, or none, into the document a
// navigation opened.
function fold(
  record: TabRecord,
  navigation: string,
  request: Classification | null,
): TabRecord {
  return foldRequest(
    record,
    navigation,
    request === null ? null : sent(request),
  );
}

// A tab that saw one request, from a neutral state that was partial or missed
// requests or neither.
function seen(
  request: Classification,
  partial = false,
  missed = false,
): TabState {
  return addRequest({ kind: "neutral", partial, missed }, request);
}

// A page loaded by a top-level request the extension saw: the request is
// sent, its response is classified, then Firefox commits the document, a
// website whose site is known from then on.
function load(
  record: TabRecord,
  navigation: string,
  document: string,
  at: number,
  request: Classification | null,
  site: string | null = SITE,
): TabRecord {
  const started = startNavigation(record, navigation, false, at);
  const folded = fold(started, navigation, request);
  return showDocument(folded, document, at + 10, false, false, "site", site);
}

// What the kept counts take of a record, by site and by level.
function taken(record: TabRecord): [string, number][] {
  return takeCountable(record).countable.map(({ site, request }) => [
    site,
    request.classification.leak.level,
  ]);
}

// A page of the browser, such as a new tab, committed while the extension
// lacks the access to all sites, which would make the view of a site partial.
function showBrowserPage(
  record: TabRecord,
  document: string,
  at: number,
  backOrForward = false,
): TabRecord {
  return showDocument(record, document, at, true, backOrForward, "browser");
}

// Reader view, committed while the extension lacks the access to all sites.
function showReader(
  record: TabRecord,
  document: string,
  at: number,
  backOrForward = false,
): TabRecord {
  return showDocument(record, document, at, true, backOrForward, "reader");
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
    const record = fold(
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
    assert.deepEqual(shown(fold(late, "2", BLUE_2)), {
      document: "doc-b",
      state: seen(BLUE_2),
    });
    assert.deepEqual(late.previous[0]?.state, seen(RED_3));
  });

  it("lets a late top-level request open the document committed first after it was sent, even once the tab went Back", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = showDocument(searx, "doc-deezer", 210, false);
    const back = showDocument(deezer, "doc-searx", 300, false);
    const late = fold(startNavigation(back, "2", false, 200), "2", RED_4);
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
    const pending = fold(
      startNavigation(EMPTY_RECORD, "1", false, 100),
      "1",
      RED_3,
    );
    const record = showDocument(pending, "doc-a", 120, false);
    assert.deepEqual(shown(record), { document: "doc-a", state: seen(RED_3) });
    assert.equal(record.navigation, "1");
    assert.equal(record.shownAt, 120);
  });

  it("starts neutral a document of a site that no request the extension saw opened", () => {
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
    const pending = fold(startNavigation(a, "2", false, 200), "2", RED_3);
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
    assert.deepEqual(shown(fold(file, navigation, BLUE_2)), {
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
    const after = fold(back, navigationAt(back, 310), BLUE_2);
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

  it("starts a page of the browser neutral, such as a new tab or a local file, with no partial view without the access to all sites", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const newTab = showBrowserPage(a, "doc-newtab", 300);
    assert.deepEqual(shown(newTab), { document: "doc-newtab", state: NEUTRAL });
    assert.equal(newTab.page, "browser");
    assert.deepEqual(newTab.previous[0]?.state, seen(RED_3));
    assert.equal(showDocument(a, "doc-site", 300, true).page, "site");
  });

  it("brings back a page of the browser with no partial view while the extension lacks the access to all sites", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const newTab = showDocument(a, "doc-newtab", 200, false, false, "browser");
    const b = load(newTab, "2", "doc-b", 300, RED_3);
    const back = showBrowserPage(b, "doc-newtab", 400, true);
    assert.deepEqual(shown(back), { document: "doc-newtab", state: NEUTRAL });
  });

  for (const commitFirst of [false, true]) {
    it(`gives a page of the browser opened by a request the extension saw, such as view-source:, what the request showed, with no partial view${commitFirst ? ", when the commit arrives before the request" : ""}`, () => {
      const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
      const source = commitFirst
        ? fold(
            startNavigation(
              showBrowserPage(a, "doc-source", 210),
              "2",
              true,
              200,
            ),
            "2",
            RED_3,
          )
        : showBrowserPage(
            fold(startNavigation(a, "2", true, 200), "2", RED_3),
            "doc-source",
            210,
          );
      assert.deepEqual(shown(source), {
        document: "doc-source",
        state: seen(RED_3),
      });
      assert.equal(source.page, "browser");
    });
  }

  it("shows neutral the page of the browser that the wait for a site out of reach commits, with what the wait saw and no partial view", () => {
    const hidden = markHiddenSite(load(EMPTY_RECORD, "1", "doc-a", 100, null));
    const newTab = showBrowserPage(hidden, "doc-newtab", 300);
    assert.deepEqual(shown(newTab), { document: "doc-newtab", state: NEUTRAL });
    const after = fold(hidden, navigationAt(hidden, 250), BLUE_2);
    assert.deepEqual(
      showBrowserPage(after, "doc-newtab", 300).state,
      seen(BLUE_2),
    );
  });

  it("starts reader view neutral, with a partial view without the access to all sites, since it loads the article's images from the web", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const reader = showReader(a, "doc-reader", 300);
    assert.deepEqual(shown(reader), {
      document: "doc-reader",
      state: markPartial(NEUTRAL),
    });
    assert.equal(reader.page, "reader");
    assert.deepEqual(reader.previous[0]?.state, seen(RED_3));
    assert.deepEqual(
      showDocument(a, "doc-reader", 300, false, false, "reader").state,
      NEUTRAL,
    );
  });

  it("brings back reader view with a partial view while the extension lacks the access to all sites", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const reader = showDocument(a, "doc-reader", 200, false, false, "reader");
    const b = load(reader, "2", "doc-b", 300, RED_3);
    const back = showReader(b, "doc-reader", 400, true);
    assert.deepEqual(shown(back), {
      document: "doc-reader",
      state: markPartial(NEUTRAL),
    });
  });

  it("shows reader view, which the wait for a site out of reach commits, neutral with a partial view and what the wait saw", () => {
    const hidden = markHiddenSite(load(EMPTY_RECORD, "1", "doc-a", 100, null));
    const reader = showReader(hidden, "doc-reader", 300);
    assert.deepEqual(shown(reader), {
      document: "doc-reader",
      state: markPartial(NEUTRAL),
    });
    const after = fold(hidden, navigationAt(hidden, 250), BLUE_2);
    assert.deepEqual(
      showReader(after, "doc-reader", 300).state,
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
  it("starts neutral a document the tab completed without a commit, such as the browser's settings page, with no partial view", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const settings = showCompletedDocument(
      a,
      "doc-settings",
      300,
      true,
      "browser",
    );
    assert.deepEqual(shown(settings), {
      document: "doc-settings",
      state: NEUTRAL,
    });
    assert.equal(settings.page, "browser");
    assert.deepEqual(settings.previous[0]?.state, seen(RED_3));
    assert.deepEqual(
      showCompletedDocument(a, "doc-site", 300, true).state,
      markPartial(NEUTRAL),
    );
  });

  it("shows neutral the settings page that the wait for a site out of reach completes", () => {
    const hidden = markHiddenSite(load(EMPTY_RECORD, "1", "doc-a", 100, RED_3));
    assert.deepEqual(
      shown(
        showCompletedDocument(hidden, "doc-settings", 300, true, "browser"),
      ),
      { document: "doc-settings", state: NEUTRAL },
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
    assert.equal(navigationAt(FIRST_NAVIGATION, 50), "1");
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
      page: "site",
      site: "site.example",
      uncounted: [],
      previous: [],
    };
    assert.equal(navigationAt(record, 50), "1");
  });
});

describe("foldRequest", () => {
  it("folds the requests of the current navigation", () => {
    const record = startNavigation(EMPTY_RECORD, "1", false, 100);
    assert.deepEqual(fold(record, "1", BLUE_2).state, seen(BLUE_2));
    assert.equal(fold(record, "1", null), record);
  });

  it("folds a request into the document it was sent for, even once the tab left it", () => {
    const searx = load(EMPTY_RECORD, "1", "doc-searx", 100, null);
    const deezer = load(searx, "2", "doc-deezer", 200, RED_4);
    const back = showDocument(deezer, "doc-searx", 300, false);
    const late = fold(back, navigationAt(back, 290), RED_4);
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
    assert.equal(fold(record, "2", RED_3), record);
  });

  it("folds into a tab seen for the first time, such as one open before the extension, and says it missed its start", () => {
    assert.deepEqual(
      fold(EMPTY_RECORD, "", BLUE_2).state,
      seen(BLUE_2, false, true),
    );
  });
});

describe("the site of a document", () => {
  it("is known at the commit, and null before and for a page of the browser", () => {
    const pending = startNavigation(EMPTY_RECORD, "1", false, 100);
    assert.equal(pending.site, null);
    assert.equal(EMPTY_RECORD.site, null);
    const site = showDocument(
      pending,
      "doc-a",
      110,
      false,
      false,
      "site",
      SITE,
    );
    assert.equal(site.site, SITE);
    assert.equal(showBrowserPage(site, "doc-newtab", 200).site, null);
    assert.equal(showReader(site, "doc-reader", 300).site, null);
    assert.equal(showDocument(site, "doc-b", 400, false).site, null);
    assert.equal(
      showCompletedDocument(site, "doc-c", 500, false, "site", "c.example")
        .site,
      "c.example",
    );
  });

  it("comes back with the document Back or Forward brings back", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null, "a.example");
    const b = load(a, "2", "doc-b", 200, null, "b.example");
    const back = showDocument(b, "doc-a", 300, false, false, "site", null);
    assert.equal(back.site, "a.example");
    assert.equal(back.previous[0]?.site, "b.example");
  });

  it("is kept by a late top-level request that opens the document already shown", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const committed = showDocument(a, "doc-b", 220, false, false, "site", SITE);
    assert.equal(startNavigation(committed, "2", false, 200).site, SITE);
  });

  it("is set aside with the document when the site shown is out of reach", () => {
    const hidden = markHiddenSite(load(EMPTY_RECORD, "1", "doc-a", 100, null));
    assert.equal(hidden.site, null);
    assert.equal(hidden.previous[0]?.site, SITE);
  });
});

describe("takeCountable", () => {
  it("keeps the requests of a navigation uncounted until its commit gives the site, then takes them once", () => {
    const pending = fold(
      fold(startNavigation(EMPTY_RECORD, "1", false, 100), "1", RED_3),
      "1",
      BLUE_2,
    );
    assert.equal(pending.uncounted.length, 2);
    assert.equal(takeCountable(pending).record, pending);
    assert.deepEqual(taken(pending), []);
    const committed = showDocument(
      pending,
      "doc-a",
      120,
      false,
      false,
      "site",
      SITE,
    );
    assert.deepEqual(taken(committed), [
      [SITE, 3],
      [SITE, 2],
    ]);
    const { record } = takeCountable(committed);
    assert.deepEqual(record.uncounted, []);
    assert.deepEqual(shown(record), shown(committed));
    assert.equal(takeCountable(record).record, record);
    assert.deepEqual(taken(record), []);
  });

  it("takes the request as the counts need it: classification, method and request type", () => {
    const request = sent(RED_4, "POST", "xmlhttprequest");
    const record = foldRequest(
      load(EMPTY_RECORD, "1", "doc-a", 100, null),
      "1",
      request,
    );
    assert.deepEqual(takeCountable(record).countable, [
      { site: SITE, request },
    ]);
  });

  it("drops the requests of a navigation that commits a page of the browser, which has no site", () => {
    const pending = fold(
      startNavigation(EMPTY_RECORD, "1", true, 100),
      "1",
      RED_3,
    );
    const source = showBrowserPage(pending, "doc-source", 110);
    const { record, countable } = takeCountable(source);
    assert.deepEqual(countable, []);
    assert.deepEqual(record.uncounted, []);
    assert.deepEqual(shown(record), shown(source));
    assert.notEqual(record, source);
  });

  it("drops the requests of reader view and of a website whose host could not be read", () => {
    const reader = fold(
      showReader(
        load(EMPTY_RECORD, "1", "doc-a", 100, null),
        "doc-reader",
        200,
      ),
      "doc-reader",
      BLUE_2,
    );
    assert.deepEqual(taken(reader), []);
    assert.deepEqual(takeCountable(reader).record.uncounted, []);
    const unknown = fold(
      showDocument(
        load(EMPTY_RECORD, "1", "doc-a", 100, null),
        "doc-u",
        200,
        false,
      ),
      "doc-u",
      BLUE_2,
    );
    assert.deepEqual(taken(unknown), []);
  });

  it("takes a request of a document shown before for the site of that document", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null, "a.example");
    const b = load(a, "2", "doc-b", 200, null, "b.example");
    const late = fold(b, navigationAt(b, 150), RED_4);
    assert.deepEqual(taken(late), [["a.example", 4]]);
    const { record } = takeCountable(late);
    assert.deepEqual(record.previous[0]?.uncounted, []);
    assert.equal(record.site, "b.example");
  });

  it("takes a request of the document shown at once, and leaves a pending navigation waiting", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = fold(startNavigation(a, "2", false, 200), "2", RED_3);
    const polled = fold(pending, navigationAt(pending, 250), BLUE_2);
    assert.deepEqual(taken(polled), [[SITE, 2]]);
    const { record } = takeCountable(polled);
    assert.deepEqual(
      record.uncounted.map((entry) => entry.classification),
      [RED_3],
    );
    assert.deepEqual(record.previous[0]?.uncounted, []);
  });

  it("drops the requests of a navigation that never committed, with the navigation", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, null);
    const pending = fold(startNavigation(a, "2", false, 200), "2", RED_3);
    const next = startNavigation(pending, "3", false, 300);
    assert.deepEqual(taken(next), []);
    assert.equal(
      next.previous.some((entry) => entry.uncounted.length > 0),
      false,
    );
  });

  it("drops the requests of a tab the extension has not seen navigate, once Firefox gave no site for it", () => {
    const record = fold(EMPTY_RECORD, "", BLUE_2);
    assert.equal(record.state.kind, "seen");
    assert.deepEqual(taken(record), []);
    assert.deepEqual(takeCountable(record).record.uncounted, []);
  });

  it("keeps the requests of a tab the extension has not seen navigate while its site is asked, then takes them for that site", () => {
    const record = fold(fold(EMPTY_RECORD, "", BLUE_2), "", RED_3);
    const asking = takeCountable(record, true);
    assert.equal(asking.record, record);
    assert.deepEqual(asking.countable, []);
    const learned = learnUnseenDocument(record, false, "site", SITE);
    assert.deepEqual(taken(learned), [
      [SITE, 2],
      [SITE, 3],
    ]);
    assert.deepEqual(takeCountable(learned).record.uncounted, []);
  });

  it("keeps waiting only the requests of the document whose site is asked", () => {
    const unseen = fold(EMPTY_RECORD, "", BLUE_2);
    const pending = fold(startNavigation(unseen, "1", false, 200), "1", RED_3);
    const committed = showDocument(
      pending,
      "doc-a",
      210,
      false,
      false,
      "site",
      "a.example",
    );
    const { record, countable } = takeCountable(committed, true);
    assert.deepEqual(
      countable.map(({ site, request }) => [
        site,
        request.classification.leak.level,
      ]),
      [["a.example", 3]],
    );
    assert.deepEqual(record.uncounted, []);
    assert.equal(record.previous[0]?.uncounted.length, 1);
  });

  it("takes what the wait for a site out of reach saw once the site commits", () => {
    const hidden = markHiddenSite(load(EMPTY_RECORD, "1", "doc-a", 100, null));
    const waited = fold(hidden, navigationAt(hidden, 150), BLUE_2);
    assert.deepEqual(taken(waited), []);
    const committed = showDocument(
      waited,
      "doc-h",
      200,
      true,
      false,
      "site",
      "hidden.example",
    );
    assert.deepEqual(taken(committed), [["hidden.example", 2]]);
  });
});

describe("the document of a tab the extension has not seen navigate", () => {
  it("asks for its site while the tab shows it, and only then", () => {
    assert.equal(siteToLearn(EMPTY_RECORD), true);
    assert.equal(siteToLearn(fold(EMPTY_RECORD, "", BLUE_2)), true);
    assert.equal(siteToLearn(markHiddenSite(EMPTY_RECORD)), true);
    assert.equal(
      siteToLearn(startNavigation(EMPTY_RECORD, "1", false, 100)),
      true,
    );
    assert.equal(
      siteToLearn(learnUnseenDocument(EMPTY_RECORD, false, "site", SITE)),
      false,
    );
    assert.equal(
      siteToLearn(learnUnseenDocument(EMPTY_RECORD, false, "browser", null)),
      false,
    );
    assert.equal(
      siteToLearn(load(EMPTY_RECORD, "1", "doc-a", 100, null)),
      false,
    );
    assert.equal(
      siteToLearn(showDocument(EMPTY_RECORD, "doc-a", 100, false)),
      false,
    );
  });

  it("takes the site Firefox gives, and keeps what the tab saw", () => {
    const record = fold(EMPTY_RECORD, "", BLUE_2);
    const learned = learnUnseenDocument(record, false, "site", SITE);
    assert.equal(learned.site, SITE);
    assert.equal(learned.page, "site");
    assert.deepEqual(shown(learned), shown(record));
  });

  it("gives the site to the document still shown while a navigation is pending, and to the requests it sent before", () => {
    const pending = startNavigation(
      fold(EMPTY_RECORD, "", BLUE_2),
      "1",
      false,
      200,
    );
    const learned = learnUnseenDocument(pending, false, "site", SITE);
    assert.equal(learned.site, null);
    assert.equal(learned.previous[0]?.site, SITE);
    const late = fold(learned, navigationAt(learned, 150), RED_3);
    assert.deepEqual(taken(late), [
      [SITE, 2],
      [SITE, 3],
    ]);
  });

  it("is left as it is once the tab shows another document, whose URL Firefox may have given", () => {
    const committed = showDocument(
      fold(EMPTY_RECORD, "", BLUE_2),
      "doc-a",
      100,
      false,
      false,
      "site",
      "a.example",
    );
    assert.equal(
      learnUnseenDocument(committed, false, "site", "b.example"),
      committed,
    );
    const learned = learnUnseenDocument(EMPTY_RECORD, false, "site", SITE);
    assert.equal(
      learnUnseenDocument(learned, false, "site", "b.example"),
      learned,
    );
  });

  it("becomes a page of the browser, neutral as a committed one, neither out of reach, partial nor missed, since it sends no request of its own", () => {
    for (const record of [
      markHiddenSite(EMPTY_RECORD),
      markPartialView(EMPTY_RECORD),
      EMPTY_RECORD,
    ]) {
      const learned = learnUnseenDocument(record, true, "browser", null);
      assert.equal(learned.page, "browser");
      assert.equal(learned.site, null);
      assert.deepEqual(learned.state, NEUTRAL);
      assert.deepEqual(
        learned.state,
        showBrowserPage(
          load(EMPTY_RECORD, "1", "doc-a", 100, null),
          "doc-b",
          200,
        ).state,
      );
    }
    const seenThere = learnUnseenDocument(
      markPartialView(fold(EMPTY_RECORD, "", BLUE_2)),
      true,
      "browser",
      null,
    );
    assert.deepEqual(seenThere.state, seen(BLUE_2, false, false));
  });

  it("becomes reader view, partial without the access to all sites, since it loads the article's images from the web", () => {
    const learned = learnUnseenDocument(
      markHiddenSite(EMPTY_RECORD),
      true,
      "reader",
      null,
    );
    assert.equal(learned.page, "reader");
    assert.deepEqual(learned.state, markMissed(markPartial(NEUTRAL)));
  });

  it("stays not observed on a site out of reach once its site is known", () => {
    const learned = learnUnseenDocument(
      markHiddenSite(EMPTY_RECORD),
      true,
      "site",
      "hidden.example",
    );
    assert.equal(learned.site, "hidden.example");
    assert.deepEqual(learned.state, NOT_OBSERVED);
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
    const downloaded = fold(pending, "2", null);
    assert.deepEqual(shown(displayedDocument(downloaded)), {
      document: "doc-a",
      state: seen(RED_4),
    });
  });

  it("counts the requests the page still shown sends during that wait, and shows them", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const pending = fold(startNavigation(red, "2", false, 200), "2", BLUE_2);
    const polled = fold(pending, navigationAt(pending, 300), RED_4);
    const state = displayedDocument(polled).state;
    assert.deepEqual(state.kind === "seen" ? state.tallies : [], [
      { level: 4, proven: true, count: 2 },
    ]);
  });

  it("keeps the page still shown, with what it saw, when the next click replaces the navigation that never committed", () => {
    const red = load(EMPTY_RECORD, "1", "doc-a", 100, RED_4);
    const pending = startNavigation(red, "2", false, 200);
    const polled = fold(pending, navigationAt(pending, 300), RED_4);
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
    assert.equal(displayedDocument(FIRST_NAVIGATION), FIRST_NAVIGATION);
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
    const after = fold(hidden, navigationAt(hidden, 100), BLUE_2);
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

  it("leaves a page of the browser as it is, whose URL Firefox withholds as for a site out of reach", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const newTab = showBrowserPage(a, "doc-newtab", 300);
    assert.equal(markHiddenSite(newTab), newTab);
    const source = showBrowserPage(
      startNavigation(a, "2", true, 200),
      "doc-source",
      210,
    );
    assert.equal(markHiddenSite(source), source);
  });

  it("leaves reader view as it is, whose URL Firefox withholds too", () => {
    const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    const reader = showReader(a, "doc-reader", 300);
    assert.equal(markHiddenSite(reader), reader);
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

  it("leaves a page of the browser as it is", () => {
    const newTab = showDocument(
      EMPTY_RECORD,
      "doc-newtab",
      100,
      false,
      false,
      "browser",
    );
    assert.equal(markPartialView(newTab), newTab);
  });

  it("makes reader view partial, since the images it loads from the web go unseen from then on", () => {
    const reader = showDocument(
      EMPTY_RECORD,
      "doc-reader",
      100,
      false,
      false,
      "reader",
    );
    assert.deepEqual(markPartialView(reader).state, markPartial(NEUTRAL));
    const pending = markPartialView(startNavigation(reader, "2", false, 200));
    assert.deepEqual(displayedDocument(pending).state, markPartial(NEUTRAL));
  });

  it("makes partial a navigation pending from a page of the browser, not the page still shown", () => {
    const newTab = showBrowserPage(EMPTY_RECORD, "doc-newtab", 100);
    const partial = markPartialView(startNavigation(newTab, "2", false, 200));
    assert.deepEqual(displayedDocument(partial).state, NEUTRAL);
    assert.deepEqual(partial.state, markPartial(NEUTRAL));
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
      record = fold(record, "2", RED_4);
    } else {
      record = startNavigation(record, "2", false, 200);
      record = showDocument(record, "doc-deezer", 220, false);
      record = fold(record, "2", RED_4);
    }
    return fold(record, navigationAt(record, 230), RED_4);
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
    const late = fold(back, navigationAt(back, 299), RED_4);
    assert.deepEqual(shown(late), { document: "doc-searx", state: NEUTRAL });
    const forward = showDocument(late, "doc-deezer", 400, false);
    assert.deepEqual(
      forward.state.kind === "seen" ? forward.state.tallies : [],
      [{ level: 4, proven: true, count: 3 }],
    );
  });
});

describe("a document of an ignored site", () => {
  const OTHER = "other.example";

  // A page whose top-level request went through a provider, committed for a
  // site the user ignores.
  function loadIgnored(
    record: TabRecord,
    navigation: string,
    document: string,
    at: number,
  ): TabRecord {
    const started = startNavigation(record, navigation, false, at);
    const folded = fold(started, navigation, RED_3);
    return showDocument(
      folded,
      document,
      at + 10,
      false,
      false,
      "site",
      SITE,
      true,
    );
  }

  it("is decided at its commit, which drops what its navigation saw before", () => {
    const record = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
    assert.deepEqual(shown(record), { document: "doc-a", state: IGNORED });
    assert.equal(record.site, SITE);
    assert.deepEqual(record.uncounted, []);
    assert.deepEqual(taken(record), []);
    assert.equal(ignoredNavigation(record, "1"), true);
  });

  it("folds none of its requests, nor any it missed", () => {
    const record = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
    assert.equal(fold(record, "1", RED_4), record);
    assert.equal(markMissedRequest(record, "1"), record);
    assert.equal(markPartialView(record), record);
  });

  it("takes the top-level request whose commit came first, so that the request is dropped before anything is made of it", () => {
    const committed = showDocument(
      load(EMPTY_RECORD, "1", "doc-a", 100, null),
      "doc-b",
      220,
      false,
      false,
      "site",
      SITE,
      true,
    );
    const started = startNavigation(committed, "2", false, 200);
    assert.equal(started.document, "doc-b");
    assert.equal(ignoredNavigation(started, "2"), true);
    assert.equal(ignoredNavigation(started, "1"), false);
  });

  it("is watched when its site is not ignored, as before", () => {
    const record = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
    assert.deepEqual(shown(record), { document: "doc-a", state: seen(RED_3) });
    assert.equal(ignoredNavigation(record, "1"), false);
    assert.equal(ignoredNavigation(record, "unknown"), false);
  });

  it("comes back ignored with Back, even when the access to all sites was withdrawn since", () => {
    const ignored = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
    const left = load(ignored, "2", "doc-b", 200, BLUE_2, OTHER);
    const back = showDocument(left, "doc-a", 300, true, true);
    assert.deepEqual(shown(back), { document: "doc-a", state: IGNORED });
  });

  it("is decided too for a page Firefox completes without a commit", () => {
    const record = showCompletedDocument(
      EMPTY_RECORD,
      "doc-a",
      100,
      false,
      "site",
      SITE,
      true,
    );
    assert.deepEqual(shown(record), { document: "doc-a", state: IGNORED });
  });

  it("is decided when Firefox gives the site of a tab the extension has not seen navigate, which drops the requests held for it", () => {
    const held = fold(fold(EMPTY_RECORD, "", BLUE_2), "", RED_4);
    const learned = learnUnseenDocument(held, false, "site", SITE, true);
    assert.equal(learned.site, SITE);
    assert.equal(learned.state, IGNORED);
    assert.deepEqual(learned.uncounted, []);
    assert.deepEqual(taken(learned), []);
    assert.equal(siteToLearn(learned), false);
    assert.equal(ignoredNavigation(learned, ""), true);
  });

  describe("markIgnoredSite", () => {
    it("turns every document of the site ignored, shown or shown before, and drops what they had not counted", () => {
      const a = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
      const b = load(a, "2", "doc-b", 200, BLUE_2, OTHER);
      const c = load(b, "3", "doc-c", 300, RED_4);
      const marked = markIgnoredSite(c, SITE);
      assert.deepEqual(shown(marked), { document: "doc-c", state: IGNORED });
      assert.deepEqual(marked.uncounted, []);
      assert.deepEqual(
        marked.previous.map((entry) => [entry.document, entry.state.kind]),
        [
          ["doc-b", "seen"],
          ["doc-a", "ignored"],
          ["", "neutral"],
        ],
      );
      assert.deepEqual(taken(marked), [[OTHER, 2]]);
    });

    it("turns ignored the page still shown while a navigation is pending, and not the navigation, whose site comes at its commit", () => {
      const pending = startNavigation(
        load(EMPTY_RECORD, "1", "doc-a", 100, RED_3),
        "2",
        false,
        200,
      );
      const marked = markIgnoredSite(pending, SITE);
      assert.equal(displayedDocument(marked).state, IGNORED);
      assert.deepEqual(marked.state, NEUTRAL);
    });

    it("returns the record itself when no document is of the site, or all already are ignored", () => {
      const other = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3, OTHER);
      assert.equal(markIgnoredSite(other, SITE), other);
      const ignored = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
      assert.equal(markIgnoredSite(ignored, SITE), ignored);
      assert.equal(markIgnoredSite(EMPTY_RECORD, SITE), EMPTY_RECORD);
    });
  });

  describe("markWatchedSite", () => {
    it("turns the documents of the site neutral, saying they missed requests, since none was watched", () => {
      const a = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
      const b = load(a, "2", "doc-b", 200, BLUE_2, OTHER);
      const c = loadIgnored(b, "3", "doc-c", 300);
      const watched = markWatchedSite(c, SITE, false);
      const missed = markMissed(NEUTRAL);
      assert.deepEqual(shown(watched), { document: "doc-c", state: missed });
      assert.deepEqual(
        watched.previous.map((entry) => [entry.document, entry.state]),
        [
          ["doc-b", seen(BLUE_2)],
          ["doc-a", missed],
          ["", EMPTY_RECORD.state],
        ],
      );
    });

    it("says the view is partial too while the extension lacks the access to all sites", () => {
      const ignored = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
      assert.deepEqual(
        markWatchedSite(ignored, SITE, true).state,
        markMissed(markPartial(NEUTRAL)),
      );
    });

    it("counts again the requests that come after, for the site", () => {
      const watched = markWatchedSite(
        loadIgnored(EMPTY_RECORD, "1", "doc-a", 100),
        SITE,
        false,
      );
      assert.equal(ignoredNavigation(watched, "1"), false);
      assert.deepEqual(taken(fold(watched, "1", RED_4)), [[SITE, 4]]);
    });

    it("returns the record itself when no document of the site is ignored", () => {
      const watched = load(EMPTY_RECORD, "1", "doc-a", 100, RED_3);
      assert.equal(markWatchedSite(watched, SITE, false), watched);
      const other = loadIgnored(EMPTY_RECORD, "1", "doc-a", 100);
      assert.equal(markWatchedSite(other, OTHER, false), other);
    });
  });
});

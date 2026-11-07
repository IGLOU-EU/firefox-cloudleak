// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type Classification,
  type Colour,
  colourOf,
  type Leak,
  type LeakLevel,
} from "../src/core/classify.js";
import {
  addRequest,
  clearPartial,
  IGNORED,
  markMissed,
  markPartial,
  NEUTRAL,
  NOT_OBSERVED,
  type TabState,
} from "../src/core/tab-state.js";

function request(leak: Leak, proven: boolean): Classification {
  return { provider: "alpha", proven, leak };
}

const BLUE_2 = request({ level: 2 }, true);
const BLUE_2_UNPROVEN = request({ level: 2 }, false);
const ORANGE_3 = request({ level: 3 }, false);
const ORANGE_4 = request(
  { level: 4, case: "session", possible: true, challenge: false },
  false,
);
const RED_3 = request({ level: 3 }, true);
const RED_4 = request({ level: 4, case: "data-sent", challenge: true }, true);

const PARTIAL_NEUTRAL = { kind: "neutral", partial: true };

function fold(requests: (Classification | null)[], start = NEUTRAL): TabState {
  return requests.reduce(addRequest, start);
}

type View =
  | { kind: "neutral"; partial: boolean }
  | { kind: "not-observed" }
  | { kind: "ignored" }
  | { kind: "seen"; colour: Colour; level: LeakLevel; partial: boolean };

// What the icon shows of a state: its colour, its level and whether the view
// is partial, all read from the request the state keeps.
function view(state: TabState): View {
  if (state.kind === "neutral") {
    return { kind: "neutral", partial: state.partial };
  }
  if (state.kind === "not-observed" || state.kind === "ignored") {
    return { kind: state.kind };
  }
  const level = state.request.leak.level;
  return {
    kind: "seen",
    colour: colourOf(level, state.request.proven),
    level,
    partial: state.partial,
  };
}

function seen(colour: Colour, level: LeakLevel, partial = false): View {
  return { kind: "seen", colour, level, partial };
}

// The request the icon and the tooltip speak of.
function kept(state: TabState): Classification | null {
  return state.kind === "seen" ? state.request : null;
}

describe("addRequest", () => {
  it("stays neutral while no request goes through a known provider", () => {
    assert.deepEqual(fold([]), NEUTRAL);
    assert.deepEqual(fold([null, null]), NEUTRAL);
  });

  it("takes the colour and level of the first request seen", () => {
    assert.deepEqual(view(fold([BLUE_2])), seen("blue", 2));
    assert.deepEqual(view(fold([BLUE_2_UNPROVEN])), seen("blue", 2));
    assert.deepEqual(view(fold([ORANGE_4])), seen("orange", 4));
    assert.deepEqual(view(fold([RED_3])), seen("red", 3));
  });

  it("orders red before orange before blue, whatever the level", () => {
    assert.deepEqual(view(fold([ORANGE_4, RED_3])), seen("red", 3));
    assert.deepEqual(view(fold([RED_3, ORANGE_4])), seen("red", 3));
    assert.deepEqual(view(fold([BLUE_2, ORANGE_3])), seen("orange", 3));
    assert.deepEqual(view(fold([ORANGE_3, BLUE_2])), seen("orange", 3));
  });

  it("orders by level number within a colour", () => {
    assert.deepEqual(view(fold([ORANGE_3, ORANGE_4])), seen("orange", 4));
    assert.deepEqual(view(fold([ORANGE_4, ORANGE_3])), seen("orange", 4));
    assert.deepEqual(view(fold([RED_3, RED_4, RED_3])), seen("red", 4));
  });

  it("is not lowered by a later, less serious request or by a request through no provider", () => {
    assert.deepEqual(
      view(fold([RED_4, BLUE_2, null, ORANGE_4])),
      seen("red", 4),
    );
  });

  it("follows the most serious request seen on a tab it does not fully observe, and says the view is partial", () => {
    assert.deepEqual(view(fold([BLUE_2], NOT_OBSERVED)), seen("blue", 2, true));
    assert.deepEqual(
      view(fold([RED_4, BLUE_2], NOT_OBSERVED)),
      seen("red", 4, true),
    );
    assert.deepEqual(
      view(fold([BLUE_2, ORANGE_3, null], NOT_OBSERVED)),
      seen("orange", 3, true),
    );
  });

  it("keeps the view partial on a neutral tab that starts to see requests", () => {
    const partial = markPartial(NEUTRAL);
    assert.deepEqual(view(fold([ORANGE_3], partial)), seen("orange", 3, true));
    assert.deepEqual(view(fold([null], partial)), PARTIAL_NEUTRAL);
  });

  it("stays not observed while it sees no request through a known provider", () => {
    assert.deepEqual(view(fold([], NOT_OBSERVED)), NOT_OBSERVED);
    assert.deepEqual(view(fold([null, null], NOT_OBSERVED)), NOT_OBSERVED);
  });

  it("keeps the most serious request itself, for its provider and its case", () => {
    const akamai: Classification = { ...ORANGE_4, provider: "akamai" };
    assert.deepEqual(kept(fold([BLUE_2, akamai, ORANGE_3])), akamai);
  });

  it("keeps the first of two requests of the same colour and level", () => {
    const session = request(
      { level: 4, case: "session", possible: true, challenge: false },
      true,
    );
    const sent = request(
      { level: 4, case: "data-sent", challenge: false },
      true,
    );
    assert.deepEqual(kept(fold([session, sent])), session);
    assert.deepEqual(kept(fold([sent, session])), sent);
  });

  it("lets a request of the site replace an anti-bot request of the same colour and level, never the reverse", () => {
    const antiBot = RED_4;
    const site = request(
      { level: 4, case: "session", possible: true, challenge: false },
      true,
    );
    assert.deepEqual(kept(fold([antiBot, site])), site);
    assert.deepEqual(kept(fold([site, antiBot])), site);
    const antiBotSession = request(
      { level: 4, case: "session", possible: true, challenge: true },
      true,
    );
    assert.deepEqual(kept(fold([antiBot, antiBotSession])), antiBot);
  });

  it("lets a session replace a possible session of the same colour and level, never the reverse", () => {
    for (const proven of [true, false]) {
      const sure = request(
        { level: 4, case: "session", possible: false, challenge: false },
        proven,
      );
      const possible = request(
        { level: 4, case: "session", possible: true, challenge: false },
        proven,
      );
      assert.deepEqual(kept(fold([possible, sure])), sure);
      assert.deepEqual(kept(fold([sure, possible])), sure);
      assert.deepEqual(kept(fold([possible, possible, sure, possible])), sure);
    }
  });

  it("keeps the colour first: a possible session proven read stays before a session not proven", () => {
    const sureUnproven = request(
      { level: 4, case: "session", possible: false, challenge: false },
      false,
    );
    const possibleProven = request(
      { level: 4, case: "session", possible: true, challenge: false },
      true,
    );
    assert.deepEqual(
      kept(fold([possibleProven, sureUnproven])),
      possibleProven,
    );
    assert.deepEqual(
      kept(fold([sureUnproven, possibleProven])),
      possibleProven,
    );
  });

  it("lets a session replace a possible session among anti-bot requests too, while a request of the site still replaces an anti-bot one first", () => {
    const antiBotSure = request(
      { level: 4, case: "session", possible: false, challenge: true },
      true,
    );
    const antiBotPossible = request(
      { level: 4, case: "session", possible: true, challenge: true },
      true,
    );
    const sitePossible = request(
      { level: 4, case: "session", possible: true, challenge: false },
      true,
    );
    assert.deepEqual(kept(fold([antiBotPossible, antiBotSure])), antiBotSure);
    assert.deepEqual(kept(fold([antiBotSure, antiBotPossible])), antiBotSure);
    assert.deepEqual(kept(fold([antiBotSure, sitePossible])), sitePossible);
    assert.deepEqual(kept(fold([sitePossible, antiBotSure])), sitePossible);
  });

  it("does not order a session against data sent: the first of the two stays", () => {
    const sure = request(
      { level: 4, case: "session", possible: false, challenge: false },
      true,
    );
    const sent = request(
      { level: 4, case: "data-sent", challenge: false },
      true,
    );
    assert.deepEqual(kept(fold([sure, sent])), sure);
    assert.deepEqual(kept(fold([sent, sure])), sent);
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    addRequest(state, RED_4);
    assert.deepEqual(view(state), seen("blue", 2));
    assert.deepEqual(state.kind === "seen" ? state.tallies : null, [
      { level: 2, proven: null, count: 1 },
    ]);
    addRequest(NEUTRAL, RED_4);
    assert.deepEqual(NEUTRAL, {
      kind: "neutral",
      partial: false,
      missed: false,
    });
    addRequest(NOT_OBSERVED, RED_4);
    assert.deepEqual(NOT_OBSERVED, { kind: "not-observed" });
  });
});

describe("what a tab saw beyond its most serious request", () => {
  function sightings(state: TabState) {
    return state.kind === "seen"
      ? { session: state.session, antiBot: state.antiBot }
      : null;
  }

  const SESSION_SURE = request(
    { level: 4, case: "session", possible: false, challenge: false },
    true,
  );
  const ANTI_BOT_UNPROVEN = request(
    { level: 4, case: "data-sent", challenge: true },
    false,
  );
  const DATA_SENT = request(
    { level: 4, case: "data-sent", challenge: false },
    true,
  );

  it("sees neither a session nor an anti-bot request in requests that carry neither", () => {
    assert.deepEqual(sightings(fold([BLUE_2, ORANGE_3, RED_3, DATA_SENT])), {
      session: "none",
      antiBot: "none",
    });
  });

  it("sees a session in a request that carries a cookie of the site or an Authorization header, with its proof", () => {
    assert.deepEqual(sightings(fold([BLUE_2, ORANGE_4])), {
      session: "unproven",
      antiBot: "none",
    });
    assert.deepEqual(sightings(fold([SESSION_SURE])), {
      session: "proven",
      antiBot: "none",
    });
  });

  it("sees an anti-bot request, with its proof, whatever its case", () => {
    assert.deepEqual(sightings(fold([ANTI_BOT_UNPROVEN])), {
      session: "none",
      antiBot: "unproven",
    });
    const antiBotSession = request(
      { level: 4, case: "session", possible: true, challenge: true },
      true,
    );
    assert.deepEqual(sightings(fold([antiBotSession])), {
      session: "proven",
      antiBot: "proven",
    });
  });

  it("keeps what it saw when the most serious request is of another kind", () => {
    const state = fold([ORANGE_4, RED_4, RED_3, BLUE_2]);
    assert.deepEqual(kept(state), RED_4);
    assert.deepEqual(sightings(state), {
      session: "unproven",
      antiBot: "proven",
    });
  });

  it("keeps a proof once seen, whatever request of the same kind comes next", () => {
    assert.equal(sightings(fold([ORANGE_4, SESSION_SURE]))?.session, "proven");
    assert.equal(sightings(fold([SESSION_SURE, ORANGE_4]))?.session, "proven");
    assert.equal(
      sightings(fold([RED_4, ANTI_BOT_UNPROVEN]))?.antiBot,
      "proven",
    );
  });

  it("sees on a tab it does not fully observe", () => {
    assert.deepEqual(sightings(fold([ORANGE_4], NOT_OBSERVED)), {
      session: "unproven",
      antiBot: "none",
    });
  });
});

describe("the counts of a tab", () => {
  function tallies(state: TabState) {
    return state.kind === "seen" ? state.tallies : [];
  }

  it("counts nothing while no request goes through a known provider", () => {
    assert.deepEqual(tallies(fold([null, null])), []);
  });

  it("counts every request by level, and by proof where the colour depends on it", () => {
    assert.deepEqual(tallies(fold([BLUE_2, BLUE_2_UNPROVEN, BLUE_2])), [
      { level: 2, proven: null, count: 3 },
    ]);
    assert.deepEqual(tallies(fold([RED_3, ORANGE_3, RED_3])), [
      { level: 3, proven: true, count: 2 },
      { level: 3, proven: false, count: 1 },
    ]);
  });

  it("lists the counts from the most serious to the least, in the order of the icon", () => {
    assert.deepEqual(
      tallies(fold([BLUE_2, ORANGE_3, ORANGE_4, null, RED_3, RED_4, BLUE_2])),
      [
        { level: 4, proven: true, count: 1 },
        { level: 3, proven: true, count: 1 },
        { level: 4, proven: false, count: 1 },
        { level: 3, proven: false, count: 1 },
        { level: 2, proven: null, count: 2 },
      ],
    );
  });

  it("counts the requests that do not change the icon as well", () => {
    const state = fold([RED_4, RED_4, BLUE_2, RED_4]);
    assert.deepEqual(kept(state), RED_4);
    assert.deepEqual(tallies(state), [
      { level: 4, proven: true, count: 3 },
      { level: 2, proven: null, count: 1 },
    ]);
  });

  it("counts on a tab it does not fully observe", () => {
    assert.deepEqual(tallies(fold([ORANGE_3, ORANGE_3], NOT_OBSERVED)), [
      { level: 3, proven: false, count: 2 },
    ]);
    assert.deepEqual(tallies(fold([BLUE_2], markPartial(NEUTRAL))), [
      { level: 2, proven: null, count: 1 },
    ]);
  });
});

describe("markPartial", () => {
  it("keeps a tab where nothing was seen neutral, with a partial view, and never makes it not observed", () => {
    assert.deepEqual(view(markPartial(NEUTRAL)), PARTIAL_NEUTRAL);
    assert.deepEqual(view(markPartial(markPartial(NEUTRAL))), PARTIAL_NEUTRAL);
  });

  it("leaves a tab not observed as it is", () => {
    assert.equal(markPartial(NOT_OBSERVED), NOT_OBSERVED);
  });

  it("keeps the most serious request seen and its counts, and says the view is partial", () => {
    assert.deepEqual(view(markPartial(fold([RED_3]))), seen("red", 3, true));
    assert.deepEqual(
      view(markPartial(markPartial(fold([BLUE_2])))),
      seen("blue", 2, true),
    );
    const state = markPartial(fold([RED_3, BLUE_2]));
    assert.deepEqual(state.kind === "seen" ? state.tallies : null, [
      { level: 3, proven: true, count: 1 },
      { level: 2, proven: null, count: 1 },
    ]);
  });

  it("returns the state itself when the view is already partial", () => {
    const partial = markPartial(fold([BLUE_2]));
    assert.equal(markPartial(partial), partial);
    const neutral = markPartial(NEUTRAL);
    assert.equal(markPartial(neutral), neutral);
  });

  it("keeps the view partial whatever request comes next", () => {
    const partial = markPartial(fold([ORANGE_3]));
    assert.deepEqual(view(fold([RED_4], partial)), seen("red", 4, true));
    assert.deepEqual(
      view(fold([BLUE_2, null], partial)),
      seen("orange", 3, true),
    );
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    markPartial(state);
    assert.deepEqual(view(state), seen("blue", 2));
    markPartial(NEUTRAL);
    assert.deepEqual(NEUTRAL, {
      kind: "neutral",
      partial: false,
      missed: false,
    });
  });
});

describe("markMissed", () => {
  function missedOf(state: TabState): boolean | null {
    return state.kind === "not-observed" || state.kind === "ignored"
      ? null
      : state.missed;
  }

  it("says a tab where nothing was seen missed requests, and keeps it neutral", () => {
    const missed = markMissed(NEUTRAL);
    assert.deepEqual(missed, { kind: "neutral", partial: false, missed: true });
    assert.deepEqual(view(missed), view(NEUTRAL));
  });

  it("keeps what the tab saw, its counts and its partial view", () => {
    const state = markPartial(fold([BLUE_2, RED_4]));
    const missed = markMissed(state);
    assert.equal(missedOf(missed), true);
    assert.deepEqual(view(missed), seen("red", 4, true));
    assert.deepEqual(
      missed.kind === "seen" ? missed.tallies : null,
      state.kind === "seen" ? state.tallies : null,
    );
  });

  it("keeps the requests missed whatever request comes next", () => {
    const missed = markMissed(NEUTRAL);
    assert.equal(missedOf(fold([BLUE_2], missed)), true);
    assert.equal(missedOf(fold([BLUE_2, RED_4, null], missed)), true);
    assert.equal(missedOf(fold([BLUE_2])), false);
  });

  it("keeps the requests missed when the view becomes partial, and the partial view when requests are missed", () => {
    const both = { kind: "neutral", partial: true, missed: true };
    assert.deepEqual(markPartial(markMissed(NEUTRAL)), both);
    assert.deepEqual(markMissed(markPartial(NEUTRAL)), both);
  });

  it("leaves a tab not observed as it is, since it already says it can say nothing", () => {
    assert.equal(markMissed(NOT_OBSERVED), NOT_OBSERVED);
  });

  it("returns the state itself when it already missed requests", () => {
    const missed = markMissed(fold([BLUE_2]));
    assert.equal(markMissed(missed), missed);
  });

  it("does not change the state it is given", () => {
    const state = fold([BLUE_2]);
    markMissed(state);
    assert.equal(missedOf(state), false);
    markMissed(NEUTRAL);
    assert.equal(missedOf(NEUTRAL), false);
  });
});

describe("clearPartial", () => {
  it("takes the partial view off what was seen, and keeps its counts and the requests missed", () => {
    const state = markMissed(markPartial(fold([BLUE_2, RED_4])));
    const cleared = clearPartial(state);
    assert.deepEqual(view(cleared), seen("red", 4));
    assert.deepEqual(
      cleared.kind === "seen" ? [cleared.tallies, cleared.missed] : null,
      state.kind === "seen" ? [state.tallies, true] : null,
    );
  });

  it("makes neutral a tab not observed, since what was out of reach is no site", () => {
    assert.deepEqual(clearPartial(NOT_OBSERVED), NEUTRAL);
    assert.deepEqual(clearPartial(markPartial(NEUTRAL)), NEUTRAL);
  });

  it("returns the state itself when the view is not partial", () => {
    const state = fold([BLUE_2]);
    assert.equal(clearPartial(state), state);
    assert.equal(clearPartial(NEUTRAL), NEUTRAL);
  });
});

describe("a document of an ignored site", () => {
  it("counts no request, whatever its level", () => {
    assert.equal(fold([BLUE_2, RED_4, ORANGE_3], IGNORED), IGNORED);
  });

  it("stays ignored, neither partial nor missing requests, since it looks at nothing", () => {
    assert.equal(markPartial(IGNORED), IGNORED);
    assert.equal(markMissed(IGNORED), IGNORED);
    assert.equal(clearPartial(IGNORED), IGNORED);
    assert.deepEqual(view(markMissed(markPartial(IGNORED))), {
      kind: "ignored",
    });
  });
});

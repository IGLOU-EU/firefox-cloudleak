// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

// The sets of sites of the validated mock-up of the map, drawn the same way
// from the same seeds: ten sites after the captures and the survey of the
// providers, 900 sites, and 36 of a private session. The mock-up states what
// its own code shows of them, which the tests then expect of the map.

import type { MapData, SiteCounts } from "../src/core/popup-message.js";

interface Drawn {
  readonly site: string;
  readonly date?: number;
  readonly f: SiteCounts;
}

// Local midnight, as the event page keeps a start.
export function day(date: number, month: number): number {
  return new Date(2026, month - 1, date).getTime();
}

export const COMMON_START = day(7, 11);

const SMALL: readonly Drawn[] = [
  {
    site: "legifrance.gouv.fr",
    f: {
      cloudflare: {
        red4: {
          "POST xmlhttprequest": 41,
          "POST main_frame": 6,
          "GET main_frame": 23,
          "GET xmlhttprequest": 37,
          "GET script": 72,
          "GET image": 61,
          "GET stylesheet": 38,
          "GET font": 34,
        },
        red3: { "GET xmlhttprequest": 19 },
        blue2: {
          "GET script": 412,
          "GET image": 520,
          "GET stylesheet": 148,
          "GET font": 100,
        },
      },
    },
  },
  {
    site: "ameli.fr",
    date: day(10, 11),
    f: {
      cloudflare: {
        red4: {
          "POST xmlhttprequest": 12,
          "GET main_frame": 9,
          "GET xmlhttprequest": 44,
          "GET script": 58,
          "GET image": 49,
          "GET stylesheet": 19,
          "GET font": 12,
        },
        blue2: {
          "GET script": 102,
          "GET image": 150,
          "GET stylesheet": 38,
          "GET font": 20,
        },
      },
    },
  },
  {
    site: "interieur.gouv.fr",
    f: {
      cloudflare: {
        red4: { "POST main_frame": 2 },
        red3: { "GET main_frame": 5 },
        blue2: {
          "GET script": 34,
          "GET image": 52,
          "GET stylesheet": 18,
          "GET font": 9,
        },
      },
    },
  },
  {
    site: "inpi.fr",
    f: {
      cloudflare: {
        red4: {
          "POST xmlhttprequest": 2,
          "GET main_frame": 3,
          "GET xmlhttprequest": 9,
          "GET script": 21,
          "GET stylesheet": 8,
          "GET image": 11,
        },
      },
    },
  },
  {
    site: "impots.gouv.fr",
    f: {
      akamai: {
        red3: { "GET main_frame": 3 },
        blue2: {
          "GET script": 48,
          "GET image": 57,
          "GET stylesheet": 21,
          "GET font": 12,
        },
      },
      radware: { orange4: { "GET main_frame": 6, "GET xmlhttprequest": 12 } },
    },
  },
  {
    site: "caf.fr",
    f: {
      radware: {
        orange4: {
          "POST xmlhttprequest": 6,
          "GET main_frame": 3,
          "GET xmlhttprequest": 18,
        },
        orange3: { "GET xmlhttprequest": 3 },
        blue2: {
          "GET script": 40,
          "GET image": 36,
          "GET stylesheet": 12,
          "GET font": 8,
        },
      },
    },
  },
  {
    site: "franceconnect.gouv.fr",
    f: {
      imperva: {
        red4: {
          "POST main_frame": 2,
          "GET main_frame": 4,
          "GET xmlhttprequest": 6,
          "GET script": 9,
          "GET stylesheet": 3,
        },
        blue2: { "GET image": 14, "GET font": 6 },
      },
    },
  },
  {
    site: "service-public.gouv.fr",
    f: {
      "ovhcloud-cdn": {
        red4: {
          "POST main_frame": 1,
          "GET main_frame": 2,
          "GET script": 24,
          "GET image": 15,
          "GET stylesheet": 9,
          "GET font": 4,
        },
      },
    },
  },
  {
    site: "leboncoin.fr",
    f: {
      cloudfront: {
        red4: {
          "PUT xmlhttprequest": 3,
          "POST xmlhttprequest": 2,
          "GET main_frame": 1,
          "GET xmlhttprequest": 51,
          "GET script": 47,
          "GET image": 61,
          "GET stylesheet": 13,
          "GET font": 10,
        },
        red3: { "OPTIONS xmlhttprequest": 28 },
        blue2: { "GET script": 3 },
      },
    },
  },
  {
    site: "chorus-pro.gouv.fr",
    f: { fastly: { blue2: { "GET script": 14 } } },
  },
];

const PRIVATE_BASE: readonly Drawn[] = [
  {
    site: "leboncoin.fr",
    f: {
      cloudfront: {
        red4: {
          "PUT xmlhttprequest": 1,
          "GET main_frame": 2,
          "GET xmlhttprequest": 14,
          "GET script": 9,
          "GET image": 8,
        },
        red3: { "OPTIONS xmlhttprequest": 9 },
        blue2: { "GET script": 3 },
      },
    },
  },
  {
    site: "legifrance.gouv.fr",
    f: {
      cloudflare: {
        red4: {
          "POST xmlhttprequest": 4,
          "GET main_frame": 2,
          "GET xmlhttprequest": 5,
          "GET script": 6,
          "GET stylesheet": 6,
        },
        red3: { "GET xmlhttprequest": 2 },
        blue2: {
          "GET script": 18,
          "GET image": 22,
          "GET stylesheet": 7,
          "GET font": 5,
        },
      },
    },
  },
];

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Weights = readonly (readonly [string, number])[];
type Kinds = Record<string, number>;

// The draw of the mock-up, step for step, so that the same seed gives the
// same sites.
function draw(
  seed: number,
  count: number,
  base: readonly Drawn[],
  scale: number,
): Drawn[] {
  const next = random(seed);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const pick = (weights: Weights): string => {
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    let x = next() * total;
    for (const [value, weight] of weights) {
      x -= weight;
      if (x < 0) {
        return value;
      }
    }
    return weights[weights.length - 1]?.[0] ?? "";
  };
  const whole = (x: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(x * scale)));
  const share = (n: number, types: Weights): Kinds => {
    const parts = types.map(
      ([key, weight]) => [key, weight * (0.2 + next())] as const,
    );
    const sum = parts.reduce((total, [, weight]) => total + weight, 0);
    const kinds: Kinds = {};
    let left = n;
    for (const [key, weight] of parts) {
      const k = Math.floor((n * weight) / sum);
      if (k > 0) {
        kinds[key] = k;
        left -= k;
      }
    }
    const first = parts.slice().sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    kinds[first] = (kinds[first] ?? 0) + left;
    return kinds;
  };
  const BLUE: Weights = [
    ["GET script", 3],
    ["GET image", 4],
    ["GET stylesheet", 1.5],
    ["GET font", 1],
  ];
  const LIBRARY: Weights = [
    ["GET script", 3],
    ["GET stylesheet", 1],
    ["GET font", 1],
  ];
  const FOUR: Weights = [
    ["POST xmlhttprequest", 2],
    ["GET xmlhttprequest", 3],
    ["GET main_frame", 1],
    ["GET script", 2],
    ["GET image", 2],
    ["POST main_frame", 0.3],
    ["GET websocket", 0.1],
  ];
  const THREE: Weights = [
    ["GET main_frame", 3],
    ["GET sub_frame", 1],
    ["GET xmlhttprequest", 1.5],
    ["OPTIONS xmlhttprequest", 0.6],
  ];
  const MAIN: Weights = [
    ["cloudflare", 52],
    ["cloudfront", 15],
    ["fastly", 12],
    ["akamai", 10],
    ["imperva", 4],
    ["ovhcloud-cdn", 4],
    ["radware", 3],
  ];
  const SECOND: Weights = [
    ["cloudflare", 40],
    ["fastly", 35],
    ["cloudfront", 15],
    ["akamai", 10],
  ];
  const WORDS =
    "atelier journal mairie cuisine meteo forum boutique librairie musee radio club agence cabinet ecole jardin garage theatre cinema voyages sante immo emploi sport velo rando photo musique ferme cave cafe patisserie pharmacie mutuelle notaire dentiste hotel camping gite festival asso recettes bricolage tricot astronomie echecs peche escalade chorale poterie logiciel jeux bd manga vins fromages marche annonces covoit location meubles fleurs animaux creche lycee bibliotheque piscine yoga danse ski voile plongee brocante".split(
      " ",
    );
  const PLACES =
    "du-lac des-pins nord sud ouest est plus pratique libre local central alpin breton normand provence des-iles du-port de-la-gare en-ligne express solidaire du-coin des-amis du-centre du-val des-monts de-loire du-rhone atlantique occitan picard lorrain savoyard basque".split(
      " ",
    );
  const ENDS: Weights = [
    [".fr", 50],
    [".com", 22],
    [".org", 12],
    [".net", 5],
    [".eu", 4],
    [".io", 3],
    [".info", 2],
    [".be", 1],
    [".ch", 1],
  ];
  const word = () => WORDS[Math.floor(next() * WORDS.length)] ?? "";
  const taken = new Set(base.map((entry) => entry.site));
  const name = (): string => {
    for (;;) {
      const first = word();
      const form = next();
      const body =
        form < 0.15
          ? first
          : form < 0.3
            ? `${first}-${word()}`
            : `${first}-${PLACES[Math.floor(next() * PLACES.length)] ?? ""}`;
      const site = body + pick(ENDS);
      if (!taken.has(site)) {
        taken.add(site);
        return site;
      }
    }
  };
  const traffic = (worst: string | null, main: boolean) => {
    const categories: Record<string, Kinds> = {};
    if (!main) {
      categories["blue2"] = share(
        whole(Math.exp(gauss() * 0.9 + 2.0), 1, 300),
        LIBRARY,
      );
    } else if (worst === null || next() < 0.85) {
      categories["blue2"] = share(
        whole(Math.exp(gauss() * 1.1 + 3.4), 1, 4000),
        BLUE,
      );
    }
    if (worst !== null) {
      const four = worst.endsWith("4");
      categories[worst] = share(
        four
          ? whole(Math.exp(gauss() + 3.0), 1, 900)
          : whole(Math.exp(gauss() * 0.8 + 1.8), 1, 200),
        four ? FOUR : THREE,
      );
      if (worst === "red4" && next() < 0.4) {
        categories["red3"] = share(
          whole(Math.exp(gauss() * 0.7 + 1.5), 1, 100),
          THREE,
        );
      }
      if (worst === "orange4" && next() < 0.4) {
        categories["orange3"] = share(
          whole(Math.exp(gauss() * 0.7 + 1.5), 1, 100),
          THREE,
        );
      }
    }
    return categories;
  };
  const sites: Drawn[] = base.map(
    (entry) => JSON.parse(JSON.stringify(entry)) as Drawn,
  );
  while (sites.length < count) {
    const f: Record<string, Record<string, Kinds>> = {};
    const main = pick(MAIN);
    const serious =
      main === "radware"
        ? 0.6
        : main === "imperva" || main === "ovhcloud-cdn"
          ? 0.45
          : 0.1;
    let worst: string | null = null;
    if (next() < serious) {
      worst =
        main === "radware"
          ? next() < 0.7
            ? "orange4"
            : "orange3"
          : pick([
              ["red4", 50],
              ["red3", 20],
              ["orange4", 20],
              ["orange3", 10],
            ]);
    }
    f[main] = traffic(worst, true);
    if (next() < 0.2) {
      const second = pick(SECOND.filter(([id]) => id !== main));
      f[second] = traffic(null, false);
      if (next() < 0.12) {
        const third = pick(
          SECOND.filter(([id]) => id !== main && id !== second),
        );
        f[third] = traffic(null, false);
      }
    }
    sites.push({ site: name(), f });
  }
  return sites;
}

function dataOf(
  drawn: readonly Drawn[],
  privateWindow: boolean,
  since = COMMON_START,
): MapData {
  const siteSince: Record<string, number> = {};
  const sites: Record<string, SiteCounts> = {};
  for (const entry of drawn) {
    sites[entry.site] = entry.f;
    if (entry.date !== undefined && !privateWindow) {
      siteSince[entry.site] = entry.date;
    }
  }
  return { privateWindow, since: privateWindow ? 0 : since, siteSince, sites };
}

export function smallSample(): MapData {
  return dataOf(SMALL, false);
}

export function largeSample(): MapData {
  const sites = draw(20261107, 900, SMALL, 1);
  const dated = (index: number, date: number) => {
    const entry = sites[index];
    if (entry !== undefined) {
      sites[index] = { ...entry, date };
    }
  };
  dated(40, day(18, 11));
  dated(150, day(26, 11));
  dated(230, day(2, 12));
  return dataOf(sites, false);
}

export function privateSample(): MapData {
  return dataOf(draw(611, 36, PRIVATE_BASE, 0.15), true);
}

// The providers of data/providers, as the table gives them to the map.
export const PROVIDERS = [
  { id: "cloudflare", name: "Cloudflare", country: "US", parent: null },
  { id: "akamai", name: "Akamai", country: "US", parent: null },
  { id: "cloudfront", name: "Amazon CloudFront", country: "US", parent: null },
  { id: "fastly", name: "Fastly", country: "US", parent: null },
  {
    id: "imperva",
    name: "Imperva",
    country: "US",
    parent: { name: "Thales", country: "FR" },
  },
  { id: "ovhcloud-cdn", name: "OVHcloud CDN", country: "FR", parent: null },
  { id: "radware", name: "Radware", country: "IL", parent: null },
] as const;

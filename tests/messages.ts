// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Adrien Kara

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Message {
  readonly message: string;
  readonly description?: string;
  readonly placeholders?: Record<string, { readonly content: string }>;
}

const ROOT = fileURLToPath(new URL("../../_locales/", import.meta.url));

// The messages of the popup page, apart from those of the tooltip, so that
// the check of the locales knows every message in use.
export const POPUP_MESSAGES: readonly string[] = [
  // The help, which the map shares.
  "helpOpen",
  "helpClose",
  "helpRoute",
  "helpHttps",
  "helpProviders",
  "helpLaw",
  "helpStates",
  "helpLevels",
  "helpLevel2",
  "helpLevel3",
  "helpLevel4",
  "helpColours",
  "helpSupposed",
  "supposed",
  "popupPage",
  "popupUnit",
  "popupSite",
  "popupSitePrivate",
  "popupBrowserPage",
  "popupUnknownSite",
  "popupNothingBrowser",
  "popupNothingSite",
  "popupMap",
  "popupIgnoreSite",
  "popupUnignoreSite",
  "popupClearSite",
  "popupIgnore",
  "popupClear",
  "popupCancel",
  "popupIgnoreSiteQuestion",
  "popupClearSiteQuestion",
  "popupClearSiteQuestionPrivate",
  "popupIgnored",
  "popupIgnoredText",
  "popupWatchedAgain",
  "popupPreferences",
  "level1",
  "level2",
  "level3",
  "level4",
  "decryptionProven",
  "decryptionUnproven",
  // The about section, at the end of the help, which the map shares.
  "aboutTitle",
  "aboutVersion",
  "aboutLicence",
  "aboutSource",
  "aboutListing",
  "aboutContribute",
  "aboutIssue",
];

// The messages of the preferences page.
export const OPTIONS_MESSAGES: readonly string[] = [
  "optionsIgnoredSites",
  "optionsIgnoredText",
  "optionsRemove",
  "optionsRemoveSite",
  "optionsEmpty",
  "optionsAddSite",
  "optionsAdd",
  "optionsHelp",
  "optionsPreview",
  "optionsRefused",
  "optionsAlready",
  "optionsRecord",
  "optionsRecordText",
  "optionsRecordNone",
  "optionsRecordLevel4",
  "optionsRecordLevel3and4",
  "optionsRecordPrivate",
  "optionsRecordQuestion",
  "optionsPurge",
  "optionsCancel",
  "optionsRecordPurged",
  "optionsLimit",
  "optionsLimitHelp",
  "optionsLimitError",
  "optionsDynamic",
  "optionsDynamicOn",
  "optionsDynamicText",
  "optionsDynamicHelp",
  "optionsDynamicPurged",
];

// The messages of the map page, apart from those it shares with the popup.
export const MAP_MESSAGES: readonly string[] = [
  "mapLegendSupposed",
  "mapProviderSupposed",
  "mapSubjectToUnknown",
  "mapSupposedOrigin",
  "mapCountryUnknown",
  "mapCountryUnknownNote",
  "mapSupposedSites",
  "mapTitle",
  "mapKeptSince",
  "mapKeptSinceSummary",
  "mapPrivateSession",
  "mapPrivateSessionSummary",
  "mapPurgeAll",
  "mapPurgeAllQuestion",
  "mapPurgeAllQuestionPrivate",
  "mapPurge",
  "mapCancel",
  "mapNothingKept",
  "mapNothingPrivate",
  "mapLegendRed4",
  "mapLegendRed3",
  "mapLegendOrange4",
  "mapLegendOrange3",
  "mapLegendBlue2",
  "mapLegendSite",
  "mapLegendProvider",
  "mapLegendScope",
  "mapLegendScopePrivate",
  "mapSearch",
  "mapCategoryRed4",
  "mapCategoryRed3",
  "mapCategoryOrange4",
  "mapCategoryOrange3",
  "mapCategoryBlue2",
  "mapRemoveLimit",
  "mapClearFilters",
  "mapNoMatch",
  "mapSitesHeading",
  "mapUnit",
  "mapProvidersHeading",
  "mapHeadingRed4",
  "mapHeadingRed3",
  "mapHeadingOrange4",
  "mapHeadingOrange3",
  "mapHeadingBlue2",
  "mapGroupLevel",
  "mapLevelRed4",
  "mapLevelRed3",
  "mapLevelOrange4",
  "mapLevelOrange3",
  "mapLevelBlue2",
  "mapSiteTitle",
  "mapLinkTitle",
  "mapGroupTitle",
  "mapGroupLinkTitle",
  "mapProviderLaw",
  "mapProviderLawParent",
  "mapLawOfUS",
  "mapLawOfFR",
  "mapLawOfIL",
  "mapLawOfCH",
  "mapLawOfCN",
  "mapLawOfCZ",
  "mapLawOfDE",
  "mapLawOfGB",
  "mapLawOfIN",
  "mapLawOfLU",
  "mapLawOfNL",
  "mapLawOfPH",
  "mapLawOfRU",
  "mapLawOfSG",
  "mapLawOfSI",
  "mapLawOfTR",
  "mapInUS",
  "mapInFR",
  "mapInIL",
  "mapInCH",
  "mapInCN",
  "mapInCZ",
  "mapInDE",
  "mapInGB",
  "mapInIN",
  "mapInLU",
  "mapInNL",
  "mapInPH",
  "mapInRU",
  "mapInSG",
  "mapInSI",
  "mapInTR",
  "mapOverview",
  "mapShownSites",
  "mapOverviewLine",
  "mapOverviewHelp",
  "mapLimitHelp",
  "mapByLinks",
  "mapSitesUnit",
  "mapByLinksNote",
  "mapByCountry",
  "mapByCountryNote",
  "mapByProvider",
  "mapBack",
  "mapSince",
  "mapOwnDate",
  "mapSubjectTo",
  "mapParent",
  "mapProviderNote",
  "mapProviderNotePrivate",
  "mapByWorst",
  "mapItsSite",
  "mapItsSites",
  "mapGroupText",
  "mapThisPrivateSession",
  "mapSitesOne",
  "mapSitesMany",
  "mapSitesOfOne",
  "mapSitesOfMany",
  "mapProvidersOne",
  "mapProvidersMany",
  "mapRequestsOne",
  "mapRequestsMany",
  "mapTypeMainFrame",
  "mapTypeSubFrame",
  "mapTypeXmlhttprequest",
  "mapTypeScript",
  "mapTypeImage",
  "mapTypeStylesheet",
  "mapTypeFont",
  "mapTypeMedia",
  "mapTypeWebsocket",
  "mapTypeOther",
  "mapAddressesOne",
  "mapAddressesMany",
  "mapAddressesLimitOne",
  "mapAddressesLimitMany",
  "mapAddressCopied",
  "mapAddressCopyFailed",
  "mapAddressCopiedAnnounced",
];

export function messagesOf(locale: string): Record<string, Message> {
  return JSON.parse(
    readFileSync(`${ROOT}${locale}/messages.json`, "utf8"),
  ) as Record<string, Message>;
}

// Each locale with its messages, English, the source, first.
export const LOCALES: readonly {
  readonly locale: string;
  readonly messages: Record<string, Message>;
}[] = ["en", "fr"].map((locale) => ({ locale, messages: messagesOf(locale) }));

// Fills a message as browser.i18n.getMessage does: each $NAME$ takes the
// content of its placeholder, whose $1 takes the first substitution. A
// missing message fails, where Firefox would show an empty string.
export function getMessageOf(
  locale: string,
): (name: string, substitutions: readonly string[]) => string {
  const messages = messagesOf(locale);
  return (name, substitutions) => {
    const entry = messages[name];
    if (entry === undefined) {
      throw new Error(`${locale}: no message ${name}`);
    }
    return entry.message
      .replace(
        /\$([A-Za-z0-9_@]+)\$/g,
        (_, key: string) =>
          entry.placeholders?.[key.toLowerCase()]?.content ?? "",
      )
      .replace(
        /\$([1-9])/g,
        (_, index: string) => substitutions[Number(index) - 1] ?? "",
      );
  };
}

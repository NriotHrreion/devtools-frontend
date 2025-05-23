
// Copyright 2020 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../core/common/common.js';
import * as i18n from '../../core/i18n/i18n.js';
import type * as Platform from '../../core/platform/platform.js';
import * as SDK from '../../core/sdk/sdk.js';
import * as Protocol from '../../generated/protocol.js';
import * as ThirdPartyWeb from '../../third_party/third-party-web/third-party-web.js';

import {Issue, IssueCategory, IssueKind} from './Issue.js';
import {
  type LazyMarkdownIssueDescription,
  type MarkdownIssueDescription,
  resolveLazyDescription,
} from './MarkdownIssueDescription.js';

const UIStrings = {
  /**
   *@description Label for the link for SameSiteCookies Issues
   */
  samesiteCookiesExplained: 'SameSite cookies explained',
  /**
   *@description Label for the link for Schemeful Same-Site Issues
   */
  howSchemefulSamesiteWorks: 'How Schemeful Same-Site Works',
  /**
   * @description Label for a link for SameParty Issues. 'Attribute' refers to a cookie attribute.
   */
  firstPartySetsExplained: '`First-Party Sets` and the `SameParty` attribute',
  /**
   * @description Label for a link for cross-site redirect Issues.
   */
  fileCrosSiteRedirectBug: 'File a bug',
  /**
   * @description text to show in Console panel when a third-party cookie is blocked in Chrome.
   */
  consoleTpcdErrorMessage:
      'Third-party cookie is blocked in Chrome either because of Chrome flags or browser configuration.',

} as const;
const str_ = i18n.i18n.registerUIStrings('models/issues_manager/CookieIssue.ts', UIStrings);
const i18nLazyString = i18n.i18n.getLazilyComputedLocalizedString.bind(undefined, str_);

// The enum string values need to match the IssueExpanded enum values in UserMetrics.ts.
export const enum CookieIssueSubCategory {
  GENERIC_COOKIE = 'GenericCookie',
  SAME_SITE_COOKIE = 'SameSiteCookie',
  THIRD_PARTY_PHASEOUT_COOKIE = 'ThirdPartyPhaseoutCookie',
}

// Enum to show cookie status from the security panel's third-party cookie report tool
export const enum CookieStatus {
  BLOCKED = 0,
  ALLOWED = 1,
  ALLOWED_BY_GRACE_PERIOD = 2,
  ALLOWED_BY_HEURISTICS = 3,
}

export interface CookieReportInfo {
  name: string;
  domain: string;
  type?: string;
  platform?: string;
  status: CookieStatus;
  insight?: Protocol.Audits.CookieIssueInsight;
}

export class CookieIssue extends Issue {
  #issueDetails: Protocol.Audits.CookieIssueDetails;

  constructor(
      code: string, issueDetails: Protocol.Audits.CookieIssueDetails, issuesModel: SDK.IssuesModel.IssuesModel,
      issueId: Protocol.Audits.IssueId|undefined) {
    super(code, issuesModel, issueId);
    this.#issueDetails = issueDetails;
  }

  cookieId(): string {
    if (this.#issueDetails.cookie) {
      const {domain, path, name} = this.#issueDetails.cookie;
      const cookieId = `${domain};${path};${name}`;
      return cookieId;
    }
    return this.#issueDetails.rawCookieLine ?? 'no-cookie-info';
  }

  primaryKey(): string {
    const requestId = this.#issueDetails.request ? this.#issueDetails.request.requestId : 'no-request';
    return `${this.code()}-(${this.cookieId()})-(${requestId})`;
  }

  /**
   * Returns an array of issues from a given CookieIssueDetails.
   */
  static createIssuesFromCookieIssueDetails(
      cookieIssueDetails: Protocol.Audits.CookieIssueDetails, issuesModel: SDK.IssuesModel.IssuesModel,
      issueId: Protocol.Audits.IssueId|undefined): CookieIssue[] {
    const issues: CookieIssue[] = [];

    // Exclusion reasons have priority. It means a cookie was blocked. Create an issue
    // for every exclusion reason but ignore warning reasons if the cookie was blocked.
    // Some exclusion reasons are dependent on warning reasons existing in order to produce an issue.
    if (cookieIssueDetails.cookieExclusionReasons && cookieIssueDetails.cookieExclusionReasons.length > 0) {
      for (const exclusionReason of cookieIssueDetails.cookieExclusionReasons) {
        const code = CookieIssue.codeForCookieIssueDetails(
            exclusionReason, cookieIssueDetails.cookieWarningReasons, cookieIssueDetails.operation,
            cookieIssueDetails.cookieUrl as Platform.DevToolsPath.UrlString | undefined);
        if (code) {
          issues.push(new CookieIssue(code, cookieIssueDetails, issuesModel, issueId));
        }
      }
      return issues;
    }

    if (cookieIssueDetails.cookieWarningReasons) {
      for (const warningReason of cookieIssueDetails.cookieWarningReasons) {
        // warningReasons should be an empty array here.
        const code = CookieIssue.codeForCookieIssueDetails(
            warningReason, [], cookieIssueDetails.operation,
            cookieIssueDetails.cookieUrl as Platform.DevToolsPath.UrlString | undefined);
        if (code) {
          issues.push(new CookieIssue(code, cookieIssueDetails, issuesModel, issueId));
        }
      }
    }
    return issues;
  }

  /**
   * Calculates an issue code from a reason, an operation, and an array of warningReasons. All these together
   * can uniquely identify a specific cookie issue.
   * warningReasons is only needed for some CookieExclusionReason in order to determine if an issue should be raised.
   * It is not required if reason is a CookieWarningReason.
   *
   * The issue code will be mapped to a CookieIssueSubCategory enum for metric purpose.
   */
  static codeForCookieIssueDetails(
      reason: Protocol.Audits.CookieExclusionReason|Protocol.Audits.CookieWarningReason,
      warningReasons: Protocol.Audits.CookieWarningReason[], operation: Protocol.Audits.CookieOperation,
      cookieUrl?: Platform.DevToolsPath.UrlString): string|null {
    const isURLSecure =
        cookieUrl && (Common.ParsedURL.schemeIs(cookieUrl, 'https:') || Common.ParsedURL.schemeIs(cookieUrl, 'wss:'));
    const secure = isURLSecure ? 'Secure' : 'Insecure';

    if (reason === Protocol.Audits.CookieExclusionReason.ExcludeSameSiteStrict ||
        reason === Protocol.Audits.CookieExclusionReason.ExcludeSameSiteLax ||
        reason === Protocol.Audits.CookieExclusionReason.ExcludeSameSiteUnspecifiedTreatedAsLax) {
      if (warningReasons && warningReasons.length > 0) {
        if (warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnSameSiteStrictLaxDowngradeStrict)) {
          return [
            Protocol.Audits.InspectorIssueCode.CookieIssue,
            'ExcludeNavigationContextDowngrade',
            secure,
          ].join('::');
        }

        if (warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnSameSiteStrictCrossDowngradeStrict) ||
            warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnSameSiteStrictCrossDowngradeLax) ||
            warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnSameSiteLaxCrossDowngradeStrict) ||
            warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnSameSiteLaxCrossDowngradeLax)) {
          return [
            Protocol.Audits.InspectorIssueCode.CookieIssue,
            'ExcludeContextDowngrade',
            operation,
            secure,
          ].join('::');
        }
      }

      if (warningReasons.includes(Protocol.Audits.CookieWarningReason.WarnCrossSiteRedirectDowngradeChangesInclusion)) {
        return [
          Protocol.Audits.InspectorIssueCode.CookieIssue,
          'CrossSiteRedirectDowngradeChangesInclusion',
        ].join('::');
      }

      // If we have ExcludeSameSiteUnspecifiedTreatedAsLax but no corresponding warnings, then add just
      // the Issue code for ExcludeSameSiteUnspecifiedTreatedAsLax.
      if (reason === Protocol.Audits.CookieExclusionReason.ExcludeSameSiteUnspecifiedTreatedAsLax) {
        return [Protocol.Audits.InspectorIssueCode.CookieIssue, reason, operation].join('::');
      }

      // ExcludeSameSiteStrict and ExcludeSameSiteLax require being paired with an appropriate warning. We didn't
      // find one of those warnings so return null to indicate there shouldn't be an issue created.
      return null;
    }

    if (reason === Protocol.Audits.CookieWarningReason.WarnSameSiteStrictLaxDowngradeStrict) {
      return [Protocol.Audits.InspectorIssueCode.CookieIssue, reason, secure].join('::');
    }
    // These have the same message.
    if (reason === Protocol.Audits.CookieWarningReason.WarnSameSiteStrictCrossDowngradeStrict ||
        reason === Protocol.Audits.CookieWarningReason.WarnSameSiteStrictCrossDowngradeLax ||
        reason === Protocol.Audits.CookieWarningReason.WarnSameSiteLaxCrossDowngradeLax ||
        reason === Protocol.Audits.CookieWarningReason.WarnSameSiteLaxCrossDowngradeStrict) {
      return [Protocol.Audits.InspectorIssueCode.CookieIssue, 'WarnCrossDowngrade', operation, secure].join('::');
    }

    if (reason === Protocol.Audits.CookieExclusionReason.ExcludePortMismatch) {
      return [Protocol.Audits.InspectorIssueCode.CookieIssue, 'ExcludePortMismatch'].join('::');
    }

    if (reason === Protocol.Audits.CookieExclusionReason.ExcludeSchemeMismatch) {
      return [Protocol.Audits.InspectorIssueCode.CookieIssue, 'ExcludeSchemeMismatch'].join('::');
    }
    return [Protocol.Audits.InspectorIssueCode.CookieIssue, reason, operation].join('::');
  }

  override cookies(): Iterable<Protocol.Audits.AffectedCookie> {
    if (this.#issueDetails.cookie) {
      return [this.#issueDetails.cookie];
    }
    return [];
  }

  override rawCookieLines(): Iterable<string> {
    if (this.#issueDetails.rawCookieLine) {
      return [this.#issueDetails.rawCookieLine];
    }
    return [];
  }

  override requests(): Iterable<Protocol.Audits.AffectedRequest> {
    if (this.#issueDetails.request) {
      return [this.#issueDetails.request];
    }
    return [];
  }

  getCategory(): IssueCategory {
    return IssueCategory.COOKIE;
  }

  getDescription(): MarkdownIssueDescription|null {
    const description = issueDescriptions.get(this.code());
    if (!description) {
      return null;
    }
    return resolveLazyDescription(description);
  }

  override isCausedByThirdParty(): boolean {
    const outermostFrame = SDK.FrameManager.FrameManager.instance().getOutermostFrame();
    return isCausedByThirdParty(outermostFrame, this.#issueDetails.cookieUrl, this.#issueDetails.siteForCookies);
  }

  getKind(): IssueKind {
    if (this.#issueDetails.cookieExclusionReasons?.length > 0) {
      return IssueKind.PAGE_ERROR;
    }
    return IssueKind.BREAKING_CHANGE;
  }

  makeCookieReportEntry(): CookieReportInfo|undefined {
    const status = CookieIssue.getCookieStatus(this.#issueDetails);
    if (this.#issueDetails.cookie && this.#issueDetails.cookieUrl && status !== undefined) {
      const entity = ThirdPartyWeb.ThirdPartyWeb.getEntity(this.#issueDetails.cookieUrl);
      return {
        name: this.#issueDetails.cookie.name,
        domain: this.#issueDetails.cookie.domain,
        type: entity?.category,
        platform: entity?.name,
        status,
        insight: this.#issueDetails.insight,
      };
    }

    return;
  }

  static getCookieStatus(cookieIssueDetails: Protocol.Audits.CookieIssueDetails): CookieStatus|undefined {
    if (cookieIssueDetails.cookieExclusionReasons.includes(
            Protocol.Audits.CookieExclusionReason.ExcludeThirdPartyPhaseout)) {
      return CookieStatus.BLOCKED;
    }

    if (cookieIssueDetails.cookieWarningReasons.includes(
            Protocol.Audits.CookieWarningReason.WarnDeprecationTrialMetadata)) {
      return CookieStatus.ALLOWED_BY_GRACE_PERIOD;
    }

    if (cookieIssueDetails.cookieWarningReasons.includes(
            Protocol.Audits.CookieWarningReason.WarnThirdPartyCookieHeuristic)) {
      return CookieStatus.ALLOWED_BY_HEURISTICS;
    }

    if (cookieIssueDetails.cookieWarningReasons.includes(Protocol.Audits.CookieWarningReason.WarnThirdPartyPhaseout)) {
      return CookieStatus.ALLOWED;
    }

    return;
  }

  static fromInspectorIssue(issuesModel: SDK.IssuesModel.IssuesModel, inspectorIssue: Protocol.Audits.InspectorIssue):
      CookieIssue[] {
    const cookieIssueDetails = inspectorIssue.details.cookieIssueDetails;
    if (!cookieIssueDetails) {
      console.warn('Cookie issue without details received.');
      return [];
    }

    return CookieIssue.createIssuesFromCookieIssueDetails(cookieIssueDetails, issuesModel, inspectorIssue.issueId);
  }

  static getSubCategory(code: string): CookieIssueSubCategory {
    if (code.includes('SameSite') || code.includes('Downgrade')) {
      return CookieIssueSubCategory.SAME_SITE_COOKIE;
    }
    if (code.includes('ThirdPartyPhaseout')) {
      return CookieIssueSubCategory.THIRD_PARTY_PHASEOUT_COOKIE;
    }
    return CookieIssueSubCategory.GENERIC_COOKIE;
  }

  static isThirdPartyCookiePhaseoutRelatedIssue(issue: Issue): boolean {
    const excludeFromAggregate = [
      Protocol.Audits.CookieWarningReason.WarnThirdPartyCookieHeuristic,
      Protocol.Audits.CookieWarningReason.WarnDeprecationTrialMetadata,
      Protocol.Audits.CookieWarningReason.WarnThirdPartyPhaseout,
      Protocol.Audits.CookieExclusionReason.ExcludeThirdPartyPhaseout,
    ];

    return (excludeFromAggregate.some(exclude => issue.code().includes(exclude)));
  }

  override maybeCreateConsoleMessage(): SDK.ConsoleModel.ConsoleMessage|undefined {
    const issuesModel = this.model();
    if (issuesModel && this.code().includes(Protocol.Audits.CookieExclusionReason.ExcludeThirdPartyPhaseout)) {
      return new SDK.ConsoleModel.ConsoleMessage(
          issuesModel.target().model(SDK.RuntimeModel.RuntimeModel), Common.Console.FrontendMessageSource.ISSUE_PANEL,
          Protocol.Log.LogEntryLevel.Warning, UIStrings.consoleTpcdErrorMessage, {
            url: this.#issueDetails.request?.url as Platform.DevToolsPath.UrlString | undefined,
            affectedResources: {requestId: this.#issueDetails.request?.requestId, issueId: this.issueId},
            isCookieReportIssue: true
          });
    }
    return;
  }
}

/**
 * Exported for unit test.
 */
export function isCausedByThirdParty(
    outermostFrame: SDK.ResourceTreeModel.ResourceTreeFrame|null, cookieUrl?: string,
    siteForCookies?: string): boolean {
  if (!outermostFrame) {
    // The outermost frame is not yet available. Consider this issue as a third-party issue
    // until the outermost frame is available. This will prevent the issue from being visible
    // for only just a split second.
    return true;
  }
  // The value that should be consulted for the third-partiness as defined in
  // https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-cookie-same-site#section-2.1.1
  if (!siteForCookies) {
    return true;
  }

  // In the case of no domain and registry, we assume its an IP address or localhost
  // during development, in this case we classify the issue as first-party.
  if (!cookieUrl || outermostFrame.domainAndRegistry() === '') {
    return false;
  }

  const parsedCookieUrl = Common.ParsedURL.ParsedURL.fromString(cookieUrl);
  if (!parsedCookieUrl) {
    return false;
  }

  // For both operation types we compare the cookieUrl's domain  with the outermost frames
  // registered domain to determine first-party vs third-party. If they don't match
  // then we consider this issue a third-party issue.
  //
  // For a Set operation: The Set-Cookie response is part of a request to a third-party.
  //
  // For a Read operation: The cookie was included in a request to a third-party
  //     site. Only cookies that have their domain also set to this third-party
  //     are included in the request. We assume that the cookie was set by the same
  //     third-party at some point, so we treat this as a third-party issue.
  //
  // TODO(crbug.com/1080589): Use "First-Party sets" instead of the sites registered domain.
  return !isSubdomainOf(parsedCookieUrl.domain(), outermostFrame.domainAndRegistry());
}

function isSubdomainOf(subdomain: string, superdomain: string): boolean {
  // Subdomain must be identical or have strictly more labels than the
  // superdomain.
  if (subdomain.length <= superdomain.length) {
    return subdomain === superdomain;
  }

  // Superdomain must be suffix of subdomain, and the last character not
  // included in the matching substring must be a dot.
  if (!subdomain.endsWith(superdomain)) {
    return false;
  }

  const subdomainWithoutSuperdomian = subdomain.substr(0, subdomain.length - superdomain.length);
  return subdomainWithoutSuperdomian.endsWith('.');
}

const sameSiteUnspecifiedWarnRead: LazyMarkdownIssueDescription = {
  file: 'SameSiteUnspecifiedLaxAllowUnsafeRead.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const sameSiteUnspecifiedWarnSet: LazyMarkdownIssueDescription = {
  file: 'SameSiteUnspecifiedLaxAllowUnsafeSet.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const sameSiteNoneInsecureErrorRead: LazyMarkdownIssueDescription = {
  file: 'SameSiteNoneInsecureErrorRead.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const sameSiteNoneInsecureErrorSet: LazyMarkdownIssueDescription = {
  file: 'SameSiteNoneInsecureErrorSet.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const sameSiteNoneInsecureWarnRead: LazyMarkdownIssueDescription = {
  file: 'SameSiteNoneInsecureWarnRead.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const sameSiteNoneInsecureWarnSet: LazyMarkdownIssueDescription = {
  file: 'SameSiteNoneInsecureWarnSet.md',
  links: [
    {
      link: 'https://web.dev/samesite-cookies-explained/',
      linkTitle: i18nLazyString(UIStrings.samesiteCookiesExplained),
    },
  ],
};

const schemefulSameSiteArticles =
    [{link: 'https://web.dev/schemeful-samesite/', linkTitle: i18nLazyString(UIStrings.howSchemefulSamesiteWorks)}];

function schemefulSameSiteSubstitutions(
    {isDestinationSecure, isOriginSecure}: {isDestinationSecure: boolean, isOriginSecure: boolean}):
    Map<string, () => string> {
  return new Map([
    // TODO(crbug.com/1168438): Use translated phrases once the issue description is localized.
    ['PLACEHOLDER_destination', () => isDestinationSecure ? 'a secure' : 'an insecure'],
    ['PLACEHOLDER_origin', () => isOriginSecure ? 'a secure' : 'an insecure'],
  ]);
}

function sameSiteWarnStrictLaxDowngradeStrict(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteWarnStrictLaxDowngradeStrict.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: isSecure, isOriginSecure: !isSecure}),
    links: schemefulSameSiteArticles,
  };
}

function sameSiteExcludeNavigationContextDowngrade(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteExcludeNavigationContextDowngrade.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: isSecure, isOriginSecure: !isSecure}),
    links: schemefulSameSiteArticles,
  };
}

function sameSiteWarnCrossDowngradeRead(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteWarnCrossDowngradeRead.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: isSecure, isOriginSecure: !isSecure}),
    links: schemefulSameSiteArticles,
  };
}

function sameSiteExcludeContextDowngradeRead(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteExcludeContextDowngradeRead.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: isSecure, isOriginSecure: !isSecure}),
    links: schemefulSameSiteArticles,
  };
}

function sameSiteWarnCrossDowngradeSet(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteWarnCrossDowngradeSet.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: !isSecure, isOriginSecure: isSecure}),
    links: schemefulSameSiteArticles,
  };
}

function sameSiteExcludeContextDowngradeSet(isSecure: boolean): LazyMarkdownIssueDescription {
  return {
    file: 'SameSiteExcludeContextDowngradeSet.md',
    substitutions: schemefulSameSiteSubstitutions({isDestinationSecure: isSecure, isOriginSecure: !isSecure}),
    links: schemefulSameSiteArticles,
  };
}

const sameSiteInvalidSameParty: LazyMarkdownIssueDescription = {
  file: 'SameSiteInvalidSameParty.md',
  links: [{
    link: 'https://developer.chrome.com/blog/first-party-sets-sameparty/',
    linkTitle: i18nLazyString(UIStrings.firstPartySetsExplained),
  }],
};

const samePartyCrossPartyContextSet: LazyMarkdownIssueDescription = {
  file: 'SameSiteSamePartyCrossPartyContextSet.md',
  links: [{
    link: 'https://developer.chrome.com/blog/first-party-sets-sameparty/',
    linkTitle: i18nLazyString(UIStrings.firstPartySetsExplained),
  }],
};

const attributeValueExceedsMaxSize: LazyMarkdownIssueDescription = {
  file: 'CookieAttributeValueExceedsMaxSize.md',
  links: [],
};

const warnDomainNonAscii: LazyMarkdownIssueDescription = {
  file: 'cookieWarnDomainNonAscii.md',
  links: [],
};

const excludeDomainNonAscii: LazyMarkdownIssueDescription = {
  file: 'cookieExcludeDomainNonAscii.md',
  links: [],
};

const excludeBlockedWithinRelatedWebsiteSet: LazyMarkdownIssueDescription = {
  file: 'cookieExcludeBlockedWithinRelatedWebsiteSet.md',
  links: [],
};

const cookieCrossSiteRedirectDowngrade: LazyMarkdownIssueDescription = {
  file: 'cookieCrossSiteRedirectDowngrade.md',
  links: [{
    link:
        'https://bugs.chromium.org/p/chromium/issues/entry?template=Defect%20report%20from%20user&summary=[Cross-Site Redirect Chain] <INSERT BUG SUMMARY HERE>&comment=Chrome Version: (copy from chrome://version)%0AChannel: (e.g. Canary, Dev, Beta, Stable)%0A%0AAffected URLs:%0A%0AWhat is the expected result?%0A%0AWhat happens instead?%0A%0AWhat is the purpose of the cross-site redirect?:%0A%0AWhat steps will reproduce the problem?:%0A(1)%0A(2)%0A(3)%0A%0APlease provide any additional information below.&components=Internals%3ENetwork%3ECookies',
    linkTitle: i18nLazyString(UIStrings.fileCrosSiteRedirectBug),
  }],
};

const ExcludePortMismatch: LazyMarkdownIssueDescription = {
  file: 'cookieExcludePortMismatch.md',
  links: [],
};

const ExcludeSchemeMismatch: LazyMarkdownIssueDescription = {
  file: 'cookieExcludeSchemeMismatch.md',
  links: [],
};

// This description will be used by cookie issues that need to be added to the
// issueManager, but aren't intended to be surfaced in the issues pane. This
// is why they are using a placeholder description
const placeholderDescriptionForInvisibleIssues: LazyMarkdownIssueDescription = {
  file: 'placeholderDescriptionForInvisibleIssues.md',
  links: [],
};

const issueDescriptions = new Map<string, LazyMarkdownIssueDescription>([
  // These two don't have a deprecation date yet, but they need to be fixed eventually.
  ['CookieIssue::WarnSameSiteUnspecifiedLaxAllowUnsafe::ReadCookie', sameSiteUnspecifiedWarnRead],
  ['CookieIssue::WarnSameSiteUnspecifiedLaxAllowUnsafe::SetCookie', sameSiteUnspecifiedWarnSet],
  ['CookieIssue::WarnSameSiteUnspecifiedCrossSiteContext::ReadCookie', sameSiteUnspecifiedWarnRead],
  ['CookieIssue::WarnSameSiteUnspecifiedCrossSiteContext::SetCookie', sameSiteUnspecifiedWarnSet],
  ['CookieIssue::ExcludeSameSiteNoneInsecure::ReadCookie', sameSiteNoneInsecureErrorRead],
  ['CookieIssue::ExcludeSameSiteNoneInsecure::SetCookie', sameSiteNoneInsecureErrorSet],
  ['CookieIssue::WarnSameSiteNoneInsecure::ReadCookie', sameSiteNoneInsecureWarnRead],
  ['CookieIssue::WarnSameSiteNoneInsecure::SetCookie', sameSiteNoneInsecureWarnSet],
  ['CookieIssue::WarnSameSiteStrictLaxDowngradeStrict::Secure', sameSiteWarnStrictLaxDowngradeStrict(true)],
  ['CookieIssue::WarnSameSiteStrictLaxDowngradeStrict::Insecure', sameSiteWarnStrictLaxDowngradeStrict(false)],
  ['CookieIssue::WarnCrossDowngrade::ReadCookie::Secure', sameSiteWarnCrossDowngradeRead(true)],
  ['CookieIssue::WarnCrossDowngrade::ReadCookie::Insecure', sameSiteWarnCrossDowngradeRead(false)],
  ['CookieIssue::WarnCrossDowngrade::SetCookie::Secure', sameSiteWarnCrossDowngradeSet(true)],
  ['CookieIssue::WarnCrossDowngrade::SetCookie::Insecure', sameSiteWarnCrossDowngradeSet(false)],
  ['CookieIssue::ExcludeNavigationContextDowngrade::Secure', sameSiteExcludeNavigationContextDowngrade(true)],
  [
    'CookieIssue::ExcludeNavigationContextDowngrade::Insecure',
    sameSiteExcludeNavigationContextDowngrade(false),
  ],
  ['CookieIssue::ExcludeContextDowngrade::ReadCookie::Secure', sameSiteExcludeContextDowngradeRead(true)],
  ['CookieIssue::ExcludeContextDowngrade::ReadCookie::Insecure', sameSiteExcludeContextDowngradeRead(false)],
  ['CookieIssue::ExcludeContextDowngrade::SetCookie::Secure', sameSiteExcludeContextDowngradeSet(true)],
  ['CookieIssue::ExcludeContextDowngrade::SetCookie::Insecure', sameSiteExcludeContextDowngradeSet(false)],
  ['CookieIssue::ExcludeInvalidSameParty::SetCookie', sameSiteInvalidSameParty],
  ['CookieIssue::ExcludeSamePartyCrossPartyContext::SetCookie', samePartyCrossPartyContextSet],
  ['CookieIssue::WarnAttributeValueExceedsMaxSize::ReadCookie', attributeValueExceedsMaxSize],
  ['CookieIssue::WarnAttributeValueExceedsMaxSize::SetCookie', attributeValueExceedsMaxSize],
  ['CookieIssue::WarnDomainNonASCII::ReadCookie', warnDomainNonAscii],
  ['CookieIssue::WarnDomainNonASCII::SetCookie', warnDomainNonAscii],
  ['CookieIssue::ExcludeDomainNonASCII::ReadCookie', excludeDomainNonAscii],
  ['CookieIssue::ExcludeDomainNonASCII::SetCookie', excludeDomainNonAscii],
  [
    'CookieIssue::ExcludeThirdPartyCookieBlockedInRelatedWebsiteSet::ReadCookie',
    excludeBlockedWithinRelatedWebsiteSet,
  ],
  [
    'CookieIssue::ExcludeThirdPartyCookieBlockedInRelatedWebsiteSet::SetCookie',
    excludeBlockedWithinRelatedWebsiteSet,
  ],
  ['CookieIssue::WarnThirdPartyPhaseout::ReadCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::WarnThirdPartyPhaseout::SetCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::WarnDeprecationTrialMetadata::ReadCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::WarnDeprecationTrialMetadata::SetCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::WarnThirdPartyCookieHeuristic::ReadCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::WarnThirdPartyCookieHeuristic::SetCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::ExcludeThirdPartyPhaseout::ReadCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::ExcludeThirdPartyPhaseout::SetCookie', placeholderDescriptionForInvisibleIssues],
  ['CookieIssue::CrossSiteRedirectDowngradeChangesInclusion', cookieCrossSiteRedirectDowngrade],
  ['CookieIssue::ExcludePortMismatch', ExcludePortMismatch],
  ['CookieIssue::ExcludeSchemeMismatch', ExcludeSchemeMismatch],
]);

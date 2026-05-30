export type PageKey = string & { readonly __pageKey: unique symbol };

export type PageIdentityInput = {
  url?: string;
  canonicalUrl?: string;
  title?: string;
  favIconUrl?: string;
};

export type PageIdentity =
  | {
      status: "ready";
      pageKey: PageKey;
      url: string;
      canonicalUrl?: string;
      title?: string;
      displayTitle: string;
      favIconUrl?: string;
    }
  | {
      status: "unsupported";
      reason: "missing_url" | "unsupported_url" | "active_tab_unavailable";
      url?: string;
      title?: string;
      favIconUrl?: string;
    };

export type PageIdentityResolution = PageIdentity;

const TRACKING_PARAMETER_NAMES = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi"
]);

export function resolvePageIdentity(input: PageIdentityInput): PageIdentityResolution {
  const canonicalPageKey = input.canonicalUrl ? normalizePageKeyUrl(input.canonicalUrl) : null;
  const currentPageKey = input.url ? normalizePageKeyUrl(input.url) : null;
  const pageKey = canonicalPageKey ?? currentPageKey;
  const favIconUrl = cleanOptionalText(input.favIconUrl);

  if (!pageKey) {
    return {
      status: "unsupported",
      reason: input.url ? "unsupported_url" : "missing_url",
      url: input.url,
      title: input.title,
      favIconUrl
    };
  }

  const displayTitle = input.title?.trim() || pageKey;

  return {
    status: "ready",
    pageKey,
    url: currentPageKey ?? pageKey,
    canonicalUrl: canonicalPageKey ?? undefined,
    title: input.title,
    displayTitle,
    favIconUrl
  };
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function normalizePageKeyUrl(rawUrl: string): PageKey | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return null;
  }

  parsedUrl.hash = "";
  parsedUrl.search = stableSearchString(parsedUrl.searchParams);

  return parsedUrl.toString() as PageKey;
}

function stableSearchString(searchParams: URLSearchParams): string {
  const keptParameters = Array.from(searchParams.entries())
    .filter(([name]) => !isTrackingParameterName(name))
    .sort(([firstName, firstValue], [secondName, secondValue]) => {
      const nameOrder = firstName.localeCompare(secondName);
      if (nameOrder !== 0) return nameOrder;
      return firstValue.localeCompare(secondValue);
    });

  const normalizedSearch = new URLSearchParams();
  for (const [name, value] of keptParameters) {
    normalizedSearch.append(name, value);
  }

  return normalizedSearch.toString();
}

function isTrackingParameterName(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName.startsWith("utm_") || TRACKING_PARAMETER_NAMES.has(normalizedName);
}

export type CapturedTabDocument = {
  documentUrl: string;
  title: string;
  html: string;
  bodyInnerText: string;
  capturedAt: string;
  canonicalUrl?: string;
  siteName?: string;
  excerpt?: string;
  byline?: string;
  language?: string;
};

export function captureCurrentDocumentSnapshot(): CapturedTabDocument {
  function cleanOptionalString(value: string | undefined): string | undefined {
    const cleaned = value?.trim();
    return cleaned ? cleaned : undefined;
  }

  function readLinkHref(selector: string): string | undefined {
    const element = document.querySelector<HTMLLinkElement>(selector);
    return cleanOptionalString(element?.href);
  }

  function readMetaContent(selector: string): string | undefined {
    const element = document.querySelector<HTMLMetaElement>(selector);
    return cleanOptionalString(element?.content);
  }

  return {
    documentUrl: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML,
    bodyInnerText: document.body?.innerText ?? "",
    capturedAt: new Date().toISOString(),
    canonicalUrl: readLinkHref('link[rel="canonical"]'),
    siteName: readMetaContent('meta[property="og:site_name"]'),
    excerpt: readMetaContent('meta[name="description"]') ?? readMetaContent('meta[property="og:description"]'),
    byline:
      readMetaContent('meta[name="author"]') ??
      readMetaContent('meta[property="article:author"]') ??
      readMetaContent('meta[name="byline"]'),
    language: document.documentElement.lang || undefined
  };
}

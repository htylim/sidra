import { describe, expect, it } from "vitest";
import { resolvePageIdentity } from "./page-key";

describe("resolvePageIdentity", () => {
  it("prefers_canonical_url_when_present", () => {
    expect(
      resolvePageIdentity({
        url: "https://example.com/current?x=1",
        canonicalUrl: "https://example.com/canonical?utm_source=newsletter#section"
      })
    ).toMatchObject({ status: "ready", pageKey: "https://example.com/canonical" });
  });

  it("falls_back_to_current_url_without_hash", () => {
    expect(resolvePageIdentity({ url: "https://example.com/article#comments" })).toMatchObject({
      status: "ready",
      pageKey: "https://example.com/article"
    });
  });

  it("strips_common_tracking_parameters_case_insensitively", () => {
    expect(
      resolvePageIdentity({
        url: "https://example.com/article?UTM_Source=x&fbclid=y&GCLID=z&id=42"
      })
    ).toMatchObject({ pageKey: "https://example.com/article?id=42" });
  });

  it("preserves_non_tracking_query_parameters_and_stabilizes_order", () => {
    const first = resolvePageIdentity({ url: "https://example.com/article?b=2&a=1" });
    const second = resolvePageIdentity({ url: "https://example.com/article?a=1&b=2" });
    expect(first).toMatchObject({ status: "ready" });
    expect(second).toMatchObject({ status: "ready" });
    if (first.status !== "ready" || second.status !== "ready") throw new Error("expected ready pages");
    expect(first.pageKey).toBe(second.pageKey);
  });

  it("falls_back_to_current_url_when_canonical_url_is_invalid", () => {
    expect(
      resolvePageIdentity({
        url: "https://example.com/current",
        canonicalUrl: "not a url"
      })
    ).toMatchObject({ pageKey: "https://example.com/current" });
  });

  it("keeps_distinct_page_keys_for_distinct_non_tracking_queries", () => {
    const first = resolvePageIdentity({ url: "https://example.com/article?id=1" });
    const second = resolvePageIdentity({ url: "https://example.com/article?id=2" });
    expect(first).toMatchObject({ status: "ready" });
    expect(second).toMatchObject({ status: "ready" });
    if (first.status !== "ready" || second.status !== "ready") throw new Error("expected ready pages");
    expect(first.pageKey).not.toBe(second.pageKey);
  });

  describe("favicon identity modeling", () => {
    it("preserves_favicon_url_for_ready_page_identity", () => {
      expect(
        resolvePageIdentity({
          url: "https://example.com/article",
          favIconUrl: " https://example.com/favicon.ico "
        })
      ).toMatchObject({
        status: "ready",
        favIconUrl: "https://example.com/favicon.ico"
      });
    });

    it("preserves_favicon_url_for_unsupported_page_identity", () => {
      expect(
        resolvePageIdentity({
          url: "chrome://extensions",
          title: "Extensions",
          favIconUrl: "https://example.com/favicon.ico"
        })
      ).toMatchObject({
        status: "unsupported",
        reason: "unsupported_url",
        favIconUrl: "https://example.com/favicon.ico"
      });
    });

    it("omits_blank_favicon_url_for_ready_page_identity", () => {
      expect(resolvePageIdentity({ url: "https://example.com/article", favIconUrl: "   " })).toEqual(
        expect.not.objectContaining({ favIconUrl: expect.any(String) })
      );
    });

    it("omits_blank_favicon_url_for_unsupported_page_identity", () => {
      expect(resolvePageIdentity({ url: "chrome://extensions", favIconUrl: "" })).toEqual(
        expect.not.objectContaining({ favIconUrl: expect.any(String) })
      );
    });
  });
});

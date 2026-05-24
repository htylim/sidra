import { describe, expect, it } from "vitest";
import { buildSidraCodexThreadTitle } from "./codex-thread-title.js";

describe("buildSidraCodexThreadTitle", () => {
  it("builds_title_from_page_title_and_prompt", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Summarize this page",
        pageMetadata: {
          title: "Research notes",
          canonicalUrl: "https://example.com/research",
          url: "https://example.com/page"
        }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("preserves_prompt_budget_when_page_title_is_long", () => {
    const title = buildSidraCodexThreadTitle({
      prompt: "Summarize this article for my team",
      pageMetadata: {
        title: "Very Long Page Title That Would Otherwise Consume The Whole Sidebar",
        url: "https://example.com/page"
      }
    });

    expect(title).toBe("Sidra: Very Long Page Title That... - Summarize this arti...");
    expect(title?.length).toBeLessThanOrEqual(60);
  });

  it("falls_back_to_canonical_hostname", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "What does this say?",
        pageMetadata: {
          canonicalUrl: "https://docs.example.com/articles?id=1",
          url: "https://fallback.test/page"
        }
      })
    ).toBe("Sidra: docs.example.com - What does this say?");
  });

  it("falls_back_to_url_hostname", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "What does this say?",
        pageMetadata: {
          canonicalUrl: "not a url",
          url: "https://example.com/page"
        }
      })
    ).toBe("Sidra: example.com - What does this say?");
  });

  it("builds_prompt_only_title_without_page_metadata", () => {
    expect(buildSidraCodexThreadTitle({ prompt: "Explain this snippet" })).toBe("Sidra: Explain this snippet");
  });

  it("returns_no_title_when_sources_are_empty_after_cleanup", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u001B[31m\u202E",
        pageMetadata: { title: "\u0000\u200F", url: "not a url" }
      })
    ).toBeUndefined();
  });

  it("normalizes_control_whitespace", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Summarize\tthis\npage",
        pageMetadata: { title: "Research\r\nnotes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_ansi_escape_sequences_and_control_format_characters", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u001B[31mSummarize\u001B[0m \u202Ethis page",
        pageMetadata: { title: "\u001B[1mResearch\u001B[0m \u200Fnotes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_osc_ansi_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u001B]8;;https://evil.test\u0007Summarize\u001B]8;;\u0007 this page",
        pageMetadata: { title: "\u001B]0;Window title\u0007Research notes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_c1_ansi_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u009B31mSummarize\u009B0m this page",
        pageMetadata: { title: "\u009D0;Window title\u009CResearch notes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_unterminated_ansi_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Summarize this page \u001B[31",
        pageMetadata: { title: "Research notes \u001B]0;Window title", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_unterminated_c1_ansi_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Summarize this page \u009B31",
        pageMetadata: { title: "Research notes \u009D0;Window title", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_osc_sequences_with_embedded_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u001B]8;;https://evil.test\u001B[31m title\u0007Summarize this page",
        pageMetadata: { title: "\u001B]0;Bad \u001B[31m title\u0007Research notes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_c1_osc_sequences_with_embedded_escape_sequences", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u009D8;;https://evil.test\u001B[31m title\u0007Summarize this page",
        pageMetadata: { title: "\u009D0;Bad \u001B[31m title\u0007Research notes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("strips_complete_escape_sequences_with_intermediate_bytes", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "\u001B(BSummarize \u001B)0this \u001B%Gpage",
        pageMetadata: { title: "\u001B#8Research notes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("does_not_treat_bel_as_a_dcs_terminator", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Summarize \u001BPignore\u0007this hidden text\u001B\\this page",
        pageMetadata: { title: "Research \u0090ignore\u0007hidden\u009Cnotes", url: "https://example.com" }
      })
    ).toBe("Sidra: Research notes - Summarize this page");
  });

  it("uses_remaining_title_space_for_prompt_after_short_page_identity", () => {
    const title = buildSidraCodexThreadTitle({
      prompt: "Summarize this unusually long article for the release notes",
      pageMetadata: { title: "Docs", url: "https://example.com" }
    });

    expect(title).toBe("Sidra: Docs - Summarize this unusually long article for t...");
    expect(title?.length).toBe(60);
  });

  it("preserves_original_capitalization_and_punctuation", () => {
    expect(
      buildSidraCodexThreadTitle({
        prompt: "Explain OAuth 2.0, please!",
        pageMetadata: { title: "API Docs: Auth", url: "https://example.com" }
      })
    ).toBe("Sidra: API Docs: Auth - Explain OAuth 2.0, please!");
  });

  it("never_exceeds_sixty_characters", () => {
    const title = buildSidraCodexThreadTitle({
      prompt: "Summarize this very long browser page prompt for a teammate",
      pageMetadata: {
        title: "Another extremely long page identity that cannot fit",
        url: "https://example.com"
      }
    });

    expect(title?.length).toBeLessThanOrEqual(60);
  });

  it("uses_ascii_ellipsis_when_truncated", () => {
    expect(buildSidraCodexThreadTitle({ prompt: "This is a very long prompt that should be truncated in history" })).toContain(
      "..."
    );
  });
});

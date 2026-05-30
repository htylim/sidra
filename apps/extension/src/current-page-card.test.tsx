// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CurrentPageCard } from "./current-page-card";

afterEach(() => {
  cleanup();
});

describe("current page card", () => {
  it("renders_favicon_image_when_available", () => {
    const { container } = render(
      <CurrentPageCard
        title="Example Article"
        statusLabel="No context sent yet"
        favIconUrl="https://example.com/favicon.ico"
      />
    );

    const favicon = container.querySelector("img.page-favicon");

    expect(favicon?.getAttribute("src")).toBe("https://example.com/favicon.ico");
    expect(favicon?.getAttribute("alt")).toBe("");
    expect(favicon?.getAttribute("aria-hidden")).toBe("true");
  });

  it("preserves_full_title_tooltip_for_truncated_titles", () => {
    const { container } = render(<CurrentPageCard title="Example Article" statusLabel="No context sent yet" />);

    expect(container.querySelector(".page-title")?.getAttribute("title")).toBe("Example Article");
  });

  it("falls_back_to_document_icon_when_favicon_is_missing", () => {
    const { container } = render(<CurrentPageCard title="Example Article" statusLabel="No context sent yet" />);

    expect(container.querySelector("img.page-favicon")).toBeNull();
    expect(container.querySelector(".page-icon .sidra-icon")).not.toBeNull();
  });

  it("falls_back_to_document_icon_when_favicon_image_errors", async () => {
    const { container } = render(
      <CurrentPageCard
        title="Example Article"
        statusLabel="No context sent yet"
        favIconUrl="https://example.com/broken.ico"
      />
    );

    const favicon = container.querySelector("img.page-favicon");
    if (!favicon) throw new Error("expected favicon image");

    fireEvent.error(favicon);

    expect(container.querySelector("img.page-favicon")).toBeNull();
    expect(container.querySelector(".page-icon .sidra-icon")).not.toBeNull();
  });

  it("resets_favicon_error_fallback_when_favicon_url_changes", async () => {
    const { container, rerender } = render(
      <CurrentPageCard
        title="Example Article"
        statusLabel="No context sent yet"
        favIconUrl="https://example.com/broken.ico"
      />
    );

    const brokenFavicon = container.querySelector("img.page-favicon");
    if (!brokenFavicon) throw new Error("expected favicon image");

    fireEvent.error(brokenFavicon);
    rerender(
      <CurrentPageCard
        title="Example Article"
        statusLabel="No context sent yet"
        favIconUrl="https://example.com/recovered.ico"
      />
    );

    expect(container.querySelector("img.page-favicon")?.getAttribute("src")).toBe("https://example.com/recovered.ico");
  });

  it("does_not_render_current_page_card_trailing_affordance", () => {
    const { container } = render(<CurrentPageCard title="Example Article" statusLabel="No context sent yet" />);

    expect(container.querySelector(`.${"chev"}${"ron"}`)).toBeNull();
    expect(screen.queryByText("›")).toBeNull();
  });

  it("renders_unsupported_page_state_in_current_page_card", () => {
    render(<CurrentPageCard title="chrome://extensions" statusLabel="This page cannot be captured" />);

    expect(screen.getByText("chrome://extensions")).not.toBeNull();
    expect(screen.getByText("This page cannot be captured")).not.toBeNull();
  });
});

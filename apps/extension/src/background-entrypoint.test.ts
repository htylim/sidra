import { describe, expect, it } from "vitest";
import { startSidraBackground } from "./background";

describe("background composition", () => {
  it("starts_the_tab_visibility_controller_from_the_background_entrypoint", async () => {
    let started = false;

    startSidraBackground({
      createVisibilityController: () => ({
        start() {
          started = true;
        },
        stop() {
          return undefined;
        }
      })
    });

    expect(started).toBe(true);
  });
});

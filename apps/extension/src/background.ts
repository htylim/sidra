import {
  createChromeSidePanelTabVisibilityController,
  type SidePanelTabVisibilityController
} from "./side-panel-tab-visibility";

type BackgroundDependencies = {
  createVisibilityController?: () => SidePanelTabVisibilityController;
};

export function startSidraBackground(
  dependencies: BackgroundDependencies = {}
): SidePanelTabVisibilityController {
  const createVisibilityController =
    dependencies.createVisibilityController ?? createChromeSidePanelTabVisibilityController;
  const visibilityController = createVisibilityController();
  visibilityController.start();
  return visibilityController;
}

if (typeof chrome !== "undefined") {
  startSidraBackground();
}

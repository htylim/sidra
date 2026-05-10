import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createChromeSidePanelController } from "./side-panel-controller";
import { SidePanelView } from "./side-panel-view";
import "./styles.css";

const sidePanelController = createChromeSidePanelController();

function SidePanel() {
  const snapshot = useSyncExternalStore(
    sidePanelController.subscribe,
    sidePanelController.getSnapshot
  );

  return (
    <SidePanelView
      snapshot={snapshot}
      onSendPrompt={sidePanelController.sendPrompt}
      onDraftPromptChange={sidePanelController.updateDraftPrompt}
      onNewChat={sidePanelController.newChat}
      onRetryBridge={sidePanelController.retryBridge}
    />
  );
}

createRoot(document.getElementById("root")!).render(<SidePanel />);

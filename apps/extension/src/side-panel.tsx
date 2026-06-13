import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createChromeSidePanelController } from "./side-panel-controller";
import { SidePanelView } from "./side-panel-view";
import "./styles.css";

const sidePanelController = createChromeSidePanelController();
let shutdownStarted = false;
function shutdownSidePanel(): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  sidePanelController.shutdown();
}

window.addEventListener("pagehide", shutdownSidePanel);
window.addEventListener("beforeunload", shutdownSidePanel);

function SidePanel() {
  const snapshot = useSyncExternalStore(
    sidePanelController.subscribe,
    sidePanelController.getSnapshot
  );

  return (
    <SidePanelView
      snapshot={snapshot}
      onSendPrompt={sidePanelController.sendPrompt}
      onCaptureAndSend={sidePanelController.captureAndSend}
      onQuickAction={sidePanelController.sendQuickAction}
      onCancelTurn={sidePanelController.cancelTurn}
      onRespondToPermission={sidePanelController.respondToPermission}
      onDraftPromptChange={sidePanelController.updateDraftPrompt}
      onCaptureModeChange={sidePanelController.updateCaptureMode}
      onSendModeChange={sidePanelController.updateSendMode}
      onNewChat={sidePanelController.newChat}
      onRetryBridge={sidePanelController.retryBridge}
      onOpenSettings={sidePanelController.openSettings}
      onToggleSpeechForTranscriptEntry={sidePanelController.toggleSpeechForTranscriptEntry}
    />
  );
}

createRoot(document.getElementById("root")!).render(<SidePanel />);

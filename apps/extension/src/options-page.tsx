import { createRoot } from "react-dom/client";
import { createChromeSettingsStore } from "./settings-store";
import { OptionsPageView } from "./options-page-view";
import { BridgeConnection } from "./bridge/connection";
import { SpeechCredentialClient } from "./bridge/speech-credentials";
import { MediaSourceSpeechPlaybackGateway } from "./transcript-speech-controller";
import { SpeechPreviewClient } from "./speech-preview-client";
import "./styles.css";

const settingsStore = createChromeSettingsStore();
const bridgeConnection = new BridgeConnection({ connectNative: (application) => chrome.runtime.connectNative(application) });
const speechCredentials = new SpeechCredentialClient({ transport: bridgeConnection });
const speechPreview = new SpeechPreviewClient({
  transport: bridgeConnection,
  playback: new MediaSourceSpeechPlaybackGateway()
});

createRoot(document.getElementById("root")!).render(
  <OptionsPageView settingsStore={settingsStore} speechCredentials={speechCredentials} speechPreview={speechPreview} />
);

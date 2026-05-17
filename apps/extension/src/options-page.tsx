import { createRoot } from "react-dom/client";
import { createChromeSettingsStore } from "./settings-store";
import { OptionsPageView } from "./options-page-view";
import "./styles.css";

const settingsStore = createChromeSettingsStore();

createRoot(document.getElementById("root")!).render(<OptionsPageView settingsStore={settingsStore} />);

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Image,
  Pause,
  Play,
  Plus,
  ScanText,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type IconName =
  | "alert"
  | "check"
  | "chevron-down"
  | "copy"
  | "file-text"
  | "image"
  | "pause"
  | "play"
  | "plus"
  | "scan-text"
  | "settings"
  | "sparkle"
  | "x";

export function SidraIcon(props: { name: IconName; className?: string }) {
  const IconByName: Record<IconName, LucideIcon> = {
    alert: AlertTriangle,
    check: Check,
    "chevron-down": ChevronDown,
    copy: Copy,
    "file-text": FileText,
    image: Image,
    pause: Pause,
    play: Play,
    plus: Plus,
    "scan-text": ScanText,
    settings: Settings,
    sparkle: Sparkles,
    x: X
  };
  const Icon = IconByName[props.name];

  return (
    <Icon
      aria-hidden="true"
      className={`sidra-icon${props.className ? ` ${props.className}` : ""}`}
      focusable={false}
      strokeWidth={2.35}
    />
  );
}

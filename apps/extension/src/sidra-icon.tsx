import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, FileText, Pause, Play, Plus, Settings, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type IconName = "alert" | "check" | "chevron-down" | "chevron-up" | "copy" | "file-text" | "pause" | "play" | "plus" | "settings" | "sparkle";

export function SidraIcon(props: { name: IconName; className?: string }) {
  const IconByName: Record<IconName, LucideIcon> = {
    alert: AlertTriangle,
    check: Check,
    "chevron-down": ChevronDown,
    "chevron-up": ChevronUp,
    copy: Copy,
    "file-text": FileText,
    pause: Pause,
    play: Play,
    plus: Plus,
    settings: Settings,
    sparkle: Sparkles
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

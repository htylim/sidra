import { AlertTriangle, ChevronDown, FileText, Plus, Settings, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type IconName = "alert" | "chevron-down" | "file-text" | "plus" | "settings" | "sparkle";

export function SidraIcon(props: { name: IconName; className?: string }) {
  const IconByName: Record<IconName, LucideIcon> = {
    alert: AlertTriangle,
    "chevron-down": ChevronDown,
    "file-text": FileText,
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

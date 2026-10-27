import { Bot, Boxes } from "lucide-react";
import { BRAND_ICONS } from "./brand-icons";

/** Agent id → brand key; ids without a mark fall back to a generic glyph. */
const AGENT_ICONS: Record<string, string> = { codex: "codex", claude: "claudecode", gemini: "geminicli", antigravity: "antigravity", kimi: "moonshot", qwen: "qwen", opencode: "opencode", grok: "grok", zcode: "zcode", cursor: "cursor", cline: "cline", hermes: "hermesagent", openclaw: "openclaw" };

export function agentIconKey(agentId: string): string | undefined {
  return AGENT_ICONS[agentId];
}

/** Brand SVGs are trusted, bundled assets (see brand-icons.ts), so inline markup is safe here. */
export function BrandIcon({ icon, kind = "api", size = 16 }: { icon?: string; kind?: "agent" | "api"; size?: number }) {
  const svg = icon ? BRAND_ICONS[icon] : undefined;
  if (!svg) {
    const Fallback = kind === "agent" ? Bot : Boxes;
    return <span className="qa-brand qa-brand--generic" style={{ width: size, height: size }} aria-hidden="true"><Fallback size={size - 2} /></span>;
  }
  return <span className="qa-brand" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

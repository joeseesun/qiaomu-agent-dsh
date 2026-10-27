import { getLanguage } from "obsidian";

const zh = {
  diagram: "Mermaid 图表", source: "图表源码", zoomIn: "放大图表", zoomOut: "缩小图表", reset: "适应宽度",
  failed: "图表未能显示，请检查源码或缩小图表。", limit: "图表过大，请减少节点、连线或源码长度。",
} as const;
const en: Record<keyof typeof zh, string> = {
  diagram: "Mermaid diagram", source: "Diagram source", zoomIn: "Zoom in", zoomOut: "Zoom out", reset: "Fit diagram",
  failed: "Could not display the diagram. Check its source or simplify it.", limit: "Diagram is too large. Reduce nodes, connections or source length.",
};
export function diagramText(key: keyof typeof zh): string {
  return (getLanguage().startsWith("en") ? en : zh)[key];
}

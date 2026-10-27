import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { MAX_MERMAID_SOURCE, renderMermaidSvg, sizeSvg, svgDataUrl } from "../services/host-mermaid";
import { isDiagramLimit, mountPeleDiagram, supportsPele } from "../services/pele-diagram";
import { diagramText as t } from "../i18n/diagrams";

export function MermaidDiagram({ source }: { source: string }) {
  // A replacement source discards old SVGs, zoom state and pending host renders together.
  return <DiagramContent key={source} source={source} />;
}

function DiagramContent({ source }: { source: string }) {
  const canvas = useRef<HTMLDivElement>(null);
  const mounted = useRef<ReturnType<typeof mountPeleDiagram> | null>(null);
  const labelId = useId();
  const [engine, setEngine] = useState<"pele" | "host" | "limit">(() => source.length > MAX_MERMAID_SOURCE ? "limit" : supportsPele(source) ? "pele" : "host");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (engine !== "pele" || !canvas.current) return;
    let live = true;
    const onError = (error: unknown) => {
      if (live) { setReady(false); setEngine(isDiagramLimit(error) ? "limit" : "host"); }
    };
    try {
      mounted.current = mountPeleDiagram(canvas.current, source, { onRender: () => { if (live) setReady(true); }, onError });
    } catch (error) { onError(error); }
    return () => { live = false; mounted.current?.destroy(); mounted.current = null; };
  }, [source, engine]);
  const error = failed || engine === "limit";
  return <div className="qa-mermaid" data-renderer={engine}>
    <span id={labelId} className="qiaomu-agent__sr-only">{t("diagram")}</span>
    {engine === "pele" && <div className="qa-diagram-canvas" ref={canvas} role="group" aria-labelledby={labelId} />}
    {engine === "host" && <HostMermaidImage source={source} onError={setFailed} />}
    {error && <p className="qa-diagram-error" role="status">{t(engine === "limit" ? "limit" : "failed")}</p>}
    <div className="qa-diagram-footer">
      <details open={error}><summary>{t("source")}</summary><pre>{source}</pre></details>
      {engine === "pele" && ready && <div className="qa-diagram-actions">
        <button type="button" className="clickable-icon" aria-label={t("zoomOut")} onClick={() => mounted.current?.zoom?.zoomBy(0.8)}><Minus size={16} aria-hidden="true" /></button>
        <button type="button" className="clickable-icon" aria-label={t("zoomIn")} onClick={() => mounted.current?.zoom?.zoomBy(1.25)}><Plus size={16} aria-hidden="true" /></button>
        <button type="button" className="clickable-icon" aria-label={t("reset")} onClick={() => mounted.current?.zoom?.reset()}><RotateCcw size={16} aria-hidden="true" /></button>
      </div>}
    </div>
  </div>;
}

/** The fallback remains an inert image; it cannot navigate or execute diagram callbacks. */
function HostMermaidImage({ source, onError }: { source: string; onError: (failed: boolean) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [dark, setDark] = useState<boolean | null>(null);
  const [image, setImage] = useState<{ url: string; width: number } | null>(null);
  useEffect(() => {
    const root = container.current?.closest<HTMLElement>(".qiaomu-agent");
    const body = container.current?.ownerDocument.body;
    if (!body) return;
    const update = () => {
      const theme = root?.dataset.qaTheme;
      setDark(theme ? theme === "dark" || theme === "black" : body.classList.contains("theme-dark"));
    };
    update();
    const observer = new MutationObserver(update);
    if (root) observer.observe(root, { attributes: true, attributeFilter: ["data-qa-theme"] });
    observer.observe(body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (dark === null) return;
    let live = true;
    onError(false);
    renderMermaidSvg(source, dark ? "dark" : "default")
      .then((svg) => { if (!live) return; const sized = sizeSvg(svg); setImage({ url: svgDataUrl(sized.svg), width: sized.width }); })
      .catch(() => { if (live) { setImage(null); onError(true); } });
    return () => { live = false; };
  }, [source, dark, onError]);
  return <div ref={container} className="qa-diagram-fallback">{image && <img src={image.url} alt={t("diagram")} style={{ width: image.width, maxWidth: "100%" }} onError={() => { setImage(null); onError(true); }} />}</div>;
}

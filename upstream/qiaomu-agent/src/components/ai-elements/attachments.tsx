// Host adaptation of AI Elements' inline attachment composition. Apache-2.0; see THIRD_PARTY_NOTICES.md.
import { FileText, X } from "lucide-react";
import type { ChatAttachment } from "../../types";
export function Attachments({ files, onRemove, onOpenImage, onImageMenu, variant = "inline" }: { files: ChatAttachment[]; onRemove?: (id: string) => void; onOpenImage?: (file: ChatAttachment, event: MouseEvent) => void; onImageMenu?: (file: ChatAttachment, event: MouseEvent) => void; variant?: "inline" | "grid" }) {
  if (!files.length) return null;
  return <div className={`qa-attachments qa-attachments--${variant}`}>{files.map((file) => <div className="qa-attachment" key={file.id}>
    {file.mediaType.startsWith("image/") && file.url ? onOpenImage ? <button type="button" className="qa-image-thumb" data-qa-image-id={file.id} aria-label={`放大 ${file.name}`} onClick={(event) => onOpenImage(file, event.nativeEvent)} onContextMenu={(event) => { event.preventDefault(); onImageMenu?.(file, event.nativeEvent); }}><img src={file.url} alt={file.name} width={variant === "grid" ? undefined : 36} height={variant === "grid" ? undefined : 36} /></button> : <img src={file.url} alt={file.name} width={variant === "grid" ? undefined : 36} height={variant === "grid" ? undefined : 36} /> : <FileText size={16} aria-hidden="true" />}
    {file.intent === "edit" && <span className="qa-reference-label">参考图 · 笔记只读</span>}
    {!(variant === "grid" && file.mediaType.startsWith("image/")) && <span>{file.vaultPath || file.name}</span>}
    {onRemove && <button type="button" onClick={() => onRemove(file.id)} aria-label={`移除 ${file.name}`}><X size={13} /></button>}
  </div>)}</div>;
}

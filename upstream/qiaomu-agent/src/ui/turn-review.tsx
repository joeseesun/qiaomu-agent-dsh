import { useId, useMemo } from "react";
import { ChevronRight, FileDiff, ShieldQuestion, Undo2 } from "lucide-react";
import type { ApprovalState, FileChange, TurnChanges } from "../types";
import { diffLines, diffStats, hunks } from "../services/line-diff";

const MAX_DIFF_LINES = 400;

function changeKind(change: FileChange): string {
  if (change.outside && !change.tracked) return "库外";
  if (change.binary) return "文件";
  if (!change.tracked) return change.after === null ? "删除" : "修改";
  if (change.before === null) return "新建";
  if (change.after === null) return "删除";
  return "修改";
}

function FileRow({ change, onOpen }: { change: FileChange; onOpen: (path: string) => void }) {
  const diff = useMemo(() => change.tracked && !change.binary ? diffLines(change.before, change.after) : [], [change]);
  const stats = diffStats(diff);
  const shown = useMemo(() => hunks(diff), [diff]);
  const kind = changeKind(change);
  const canOpen = !change.outside && change.after !== null;
  return <details className="qa-change">
    <summary>
      <span className={`qa-change-kind is-${kind}`}>{kind}</span>
      {change.reverted && <span className="qa-changes-reverted">已恢复</span>}
      <span className="qa-change-path">{change.path}</span>
      {change.tracked && !change.binary && <span className="qa-change-stats"><span className="is-add">+{stats.added}</span><span className="is-del">−{stats.removed}</span></span>}
      <ChevronRight className="qa-chevron" size={13} aria-hidden="true" />
    </summary>
    <div className="qa-change-body">
      {canOpen && <button type="button" className="qa-change-open" onClick={() => onOpen(change.path)}>打开文件</button>}
      {!change.tracked || change.binary
        ? <p className="qa-change-note">{change.outside ? "库外文件，只列出路径。" : change.binary ? "非文本或过大，不显示差异。" : "没有记录到修改前的内容，无法显示差异或自动恢复。"}</p>
        : <pre className="qa-diff">{shown.slice(0, MAX_DIFF_LINES).map((line, index) => line.type === "gap"
          ? <span key={index} className="qa-diff-gap">… {line.count} 行未改动</span>
          : <span key={index} className={`qa-diff-${line.type}`}>{line.type === "add" ? "+" : line.type === "del" ? "−" : " "} {line.text}</span>)}
          {shown.length > MAX_DIFF_LINES && <span className="qa-diff-gap">… 还有 {shown.length - MAX_DIFF_LINES} 行，打开文件查看</span>}</pre>}
    </div>
  </details>;
}

/** One summary per agent turn: which files changed, their diffs, and a pre-checked undo. */
export function ChangeSummary({ changes, disabled, onOpen, onRevert }: { changes: TurnChanges; disabled: boolean; onOpen: (path: string) => void; onRevert: () => void }) {
  const totals = useMemo(() => changes.files.reduce((sum, file) => {
    if (!file.tracked || file.binary) return sum;
    const stats = diffStats(diffLines(file.before, file.after));
    return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
  }, { added: 0, removed: 0 }), [changes]);
  const restorable = changes.files.some((file) => file.tracked && !file.binary && !file.reverted);
  const partly = changes.files.some((file) => file.reverted);
  return <details className="qa-changes" open>
    <summary>
      <FileDiff size={14} aria-hidden="true" />
      <span>修改了 {changes.files.length} 个文件</span>
      <span className="qa-change-stats"><span className="is-add">+{totals.added}</span><span className="is-del">−{totals.removed}</span></span>
      {changes.revertedAt ? <span className="qa-changes-reverted">已撤销</span> : partly ? <span className="qa-changes-reverted">部分已恢复</span> : null}
      <ChevronRight className="qa-chevron" size={14} aria-hidden="true" />
    </summary>
    <div className="qa-changes-list">{changes.files.map((change) => <FileRow key={change.path} change={change} onOpen={onOpen} />)}</div>
    {restorable && !changes.revertedAt && <div className="qa-changes-actions">
      <button type="button" disabled={disabled} onClick={onRevert}><Undo2 size={14} aria-hidden="true" />{partly ? "撤销其余修改…" : "撤销这些修改…"}</button>
    </div>}
  </details>;
}

const DECIDED: Record<string, string> = { allow_once: "已允许一次", allow_always: "本次会话已允许", reject_once: "已拒绝", reject_always: "已拒绝" };

/** Inline approval: the agent waits until one option is chosen. */
export function ApprovalCard({ approval, onChoose }: { approval: ApprovalState; onChoose: (choice: string | null) => void }) {
  const titleId = useId();
  const pending = approval.status === "pending";
  const chosen = approval.options.find((option) => option.id === approval.chosen);
  const ordered = [...approval.options].sort((a, b) => ["allow_once", "allow_always", "reject_once", "reject_always"].indexOf(a.kind) - ["allow_once", "allow_always", "reject_once", "reject_always"].indexOf(b.kind));
  return <div className={`qa-approval${pending ? " is-pending" : ""}`} role="group" aria-labelledby={titleId}>
    <div className="qa-approval-head"><ShieldQuestion size={15} aria-hidden="true" /><span id={titleId}>{approval.title}</span></div>
    {approval.detail && <pre className="qa-approval-detail">{approval.detail}</pre>}
    {pending ? <div className="qa-approval-actions">
      {ordered.map((option) => <button key={option.id} type="button" className={option.kind === "allow_once" ? "mod-cta" : option.kind.startsWith("reject") ? "is-reject" : undefined}
        onClick={() => onChoose(option.id)}>{option.label}</button>)}
    </div> : <p className="qa-approval-result">{approval.status === "cancelled" ? "已取消" : chosen ? DECIDED[chosen.kind] ?? chosen.label : "已处理"}</p>}
  </div>;
}

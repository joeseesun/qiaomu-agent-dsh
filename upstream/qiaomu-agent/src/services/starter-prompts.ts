/**
 * Built-in prompts chosen by what the user is looking at. The body is what lands in the composer;
 * a body ending in "：" leaves the sentence for the user to finish, and its label ends in "…".
 */
export type StarterScene = "selection" | "reading" | "daily" | "note" | "vault";

export interface StarterPrompt { id: string; label: string; body: string }

export interface StarterContext { selection: boolean; reading: boolean; noteName?: string; today?: Date }

export function starterScene(context: StarterContext): StarterScene {
  if (context.selection) return "selection";
  if (context.reading) return "reading";
  if (!context.noteName) return "vault";
  // Only today's daily note is about "today"; an older one is just a note.
  const date = dailyNoteDate(context.noteName);
  const today = context.today ?? new Date();
  return date && date.y === today.getFullYear() && date.m === today.getMonth() + 1 && date.d === today.getDate() ? "daily" : "note";
}

// A bare date, optionally followed by the weekday: "2026-09-27", "2026年9月27日 周日", "20260927 Sunday".
const DAILY_NOTE = /^(?:(\d{4})([-_.])(\d{1,2})\2(\d{1,2})|(\d{4})年(\d{1,2})月(\d{1,2})日|(\d{4})(\d{2})(\d{2}))(?:\s*(?:周|星期)[一二三四五六日天]|\s+[A-Za-z]{3,9})?$/;

function dailyNoteDate(name: string): { y: number; m: number; d: number } | null {
  const match = DAILY_NOTE.exec(name);
  if (!match) return null;
  const [y, m, d] = [match[1] ?? match[5] ?? match[8], match[3] ?? match[6] ?? match[9], match[4] ?? match[7] ?? match[10]].map(Number) as [number, number, number];
  return { y, m, d };
}

export const SCENE_NAMES: Record<StarterScene, string> = {
  selection: "选中的文字", reading: "正在阅读", daily: "日记", note: "当前笔记", vault: "随时可用",
};

export const STARTER_PROMPTS: Record<StarterScene, StarterPrompt[]> = {
  selection: [
    { id: "sel-polish", label: "润色这段", body: "润色选中的文字：保持原意和语气，修正病句、重复和啰嗦的地方。直接给出改好的文字，不用解释。" },
    { id: "sel-explain", label: "讲明白这段", body: "用通俗的话解释选中的内容：术语先给一句定义，再举一个生活里的例子。" },
    { id: "sel-shorten", label: "压缩到一半", body: "把选中的文字压缩到原来一半左右，保留关键信息、数字和结论。" },
    { id: "sel-structure", label: "整理成列表或表格", body: "把选中的内容整理成层次清楚的 Markdown 列表；如果有能横向比较的维度，改用表格。" },
    { id: "sel-translate", label: "中英互译", body: "翻译选中的文字：中文译成地道的英文，英文译成自然的中文。保留原有 Markdown 格式和链接。" },
    { id: "sel-challenge", label: "挑挑毛病", body: "以挑剔读者的眼光看选中的内容：哪些说法缺少证据、哪里逻辑跳跃、哪句容易被误解？逐条指出并给出改法。" },
    { id: "sel-continue", label: "顺着往下写", body: "顺着选中内容的思路和文风续写一段，200 字左右，不要重复已经说过的话。" },
  ],
  reading: [
    { id: "read-three", label: "三句话讲清", body: "用三句话讲清我正在读的内容：它在说什么，凭什么这么说，对我有什么用。严格三句话，每句独立一段，段落之间留一个空行，不加标题或编号。" },
    { id: "read-argument", label: "理一理论证", body: "梳理作者的核心论点和支撑证据，分清哪些是事实、哪些是观点，指出最薄弱的一环。" },
    { id: "read-quotes", label: "摘出值得记的句子", body: "摘出正在读的内容里最值得记住的 5 句原文，每句后面用一行写我可以怎么用上它。" },
    { id: "read-note", label: "整理成读书笔记", body: "把正在读的内容整理成一篇读书笔记：一句话概括、关键要点、相关概念，最后留一个「我的想法」小节给我自己写。" },
    { id: "read-counter", label: "换个立场看", body: "站在反对者的立场，这篇内容最容易被质疑的地方是什么？给出最有力的反驳和作者可能的回应。" },
    { id: "read-connect", label: "连到我的笔记", body: "在我的库里找和正在读的内容相关的笔记，说说它们之间有什么呼应或冲突，适合在哪里加 [[双链]]。" },
  ],
  daily: [
    { id: "daily-review", label: "写今日复盘", body: "根据今天的日记写一段复盘：做成了什么、卡在哪里、明天最该做的一件事。语气平实，不要鸡汤。" },
    { id: "daily-tasks", label: "整理待办", body: "把今天日记里散落的待办整理成 - [ ] 任务列表，按紧急程度排序，已完成的保持勾选。" },
    { id: "daily-ideas", label: "捞出值得写的想法", body: "找出今天日记里值得单独成篇的想法，每个给一个笔记标题和一句话说明为什么值得写。" },
    { id: "daily-tomorrow", label: "排明天的计划", body: "结合今天的日记帮我排明天：最多 3 件重要的事，每件写清楚第一步做什么。" },
  ],
  note: [
    { id: "note-points", label: "提炼要点", body: "用 3 到 5 条要点总结当前笔记，每条一句话；最后用一句话说出这篇笔记最重要的结论。" },
    { id: "note-related", label: "找相关笔记", body: "在我的库里找出和当前笔记主题相关的笔记，说明各自的关联点，并建议在正文哪里加 [[双链]]。" },
    { id: "note-actions", label: "列出待办", body: "从当前笔记里找出所有待办、承诺和下一步，整理成 - [ ] 任务列表；能看出期限的写上日期。" },
    { id: "note-properties", label: "补全标签和摘要", body: "为当前笔记建议 frontmatter：3 到 5 个标签、一句话摘要（description）和可能的别名（aliases）。先给出 YAML，等我确认后再写入。" },
    { id: "note-structure", label: "理顺结构", body: "检查当前笔记的结构，给出更清楚的标题层级和段落顺序；需要改动的地方列出改前改后。" },
    { id: "note-gaps", label: "找出论证漏洞", body: "以审稿人的眼光读当前笔记：指出论证跳跃、证据不足和前后矛盾的地方，按严重程度排序。" },
    { id: "note-quiz", label: "出几道自测题", body: "根据当前笔记出 5 道由浅入深的自测题，答案统一放在最后，帮我检验是不是真的理解了。" },
    { id: "note-publish", label: "改写成短文", body: "把当前笔记改写成一篇可以发布的短文：标题要具体，开头用一个真实场景引入，800 字以内，保留我的观点。" },
  ],
  vault: [
    { id: "vault-find", label: "在库里找笔记…", body: "在我的库里找和「{{主题}}」有关的笔记，按相关度列出，每篇用一句话说明讲了什么。" },
    { id: "vault-dump", label: "整理脑子里的想法…", body: "帮我把下面这些想法整理成结构清楚的笔记，尽量保留我的原话：\n\n{{想法}}" },
    { id: "vault-angles", label: "给写作找角度…", body: "我想围绕「{{主题}}」写一篇笔记。先列出 8 个可以展开的角度，再推荐最值得写的一个并说明理由。" },
    { id: "vault-learn", label: "学一个新概念…", body: "用费曼学习法教我「{{概念}}」：先一句话定义，再打个比方，最后出一道检验理解的小题。" },
    { id: "vault-decide", label: "帮我做个决定…", body: "我在纠结一个决定：{{情况}}\n\n先问我 3 个最关键的问题，等我回答后再列出各选项的利弊和最坏情况。" },
    { id: "vault-weekly", label: "做一次周回顾", body: "陪我做一次周回顾：一次只问一个问题，帮我理清这周最重要的进展、卡住的地方和下周的重点，最后整理成一篇笔记。" },
    { id: "vault-template", label: "设计笔记模板…", body: "帮我设计一个用于「{{用途}}」的 Obsidian 笔记模板，包括 frontmatter 属性和正文小节。" },
  ],
};

/** Library groups for the Prompt menu: the scene first (a daily note is also a note), then what is useful anywhere. With a query, every group. */
export function starterGroups(scene: StarterScene, all = false): StarterScene[] {
  const lead: StarterScene[] = scene === "daily" ? ["daily", "note"] : [scene];
  const rest = (["selection", "reading", "daily", "note", "vault"] as const).filter((s) => !lead.includes(s));
  return all ? [...lead, ...rest] : [...new Set<StarterScene>([...lead, "vault"])];
}

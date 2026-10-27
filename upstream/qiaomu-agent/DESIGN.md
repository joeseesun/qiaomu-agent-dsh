# Qiaomu Agent design system

## Direction

Selected direction: **A — Codex 静流**, confirmed 2026-09-20. Dials: variance 5, motion 3, density 6.

Build brief: make conversation the primary surface in a narrow Obsidian sidebar. Translate Codex's quiet transcript and unified composer, and ZCode's inspectable execution process, into host-native controls. No promotional assets, duplicate identities, permanent protocol labels, or simulated review/undo controls. Success means readable Chinese text, compact inspectable tools, stable streaming scroll, and one coherent input surface. Research sources are recorded in `docs/research/ai-sidebar-interface-patterns-2026-09-20.md`.

The chat sidebar should feel like a focused part of Obsidian, not an embedded web dashboard. The connection experience may use a larger modal because it is an occasional setup and switching task; routine chat stays compact.

## Functional contract

- The sidebar shows a conversation title, conversation, attached-note context, Skill selector, permission mode, Agent selector, composer, and new-conversation action. Status appears only when actionable or running.
- The composer selects a model and its supported reasoning effort, not a transport. A separate header settings icon opens connection setup (CLI/API).
- Desktop-native transports are preferred: Codex App Server and ACP where supported. Model APIs remain the mobile fallback.
- On desktop, API chats may read a user-supplied public HTTP/HTTPS page, Markdown/text/JSON, or RSS/Atom/XML feed through a bounded, read-only tool. Internal `obsidian://` links are not public web pages; reading context passed by Qiaomu RSS/Reader supplies the article body. A failed read reports its specific cause.
- Markdown is rendered through Obsidian's renderer so GFM-like tables, code, internal links, and Mermaid follow the host application.
- A reply shows its work in the order it happened, the way the Codex app does: text runs, one-line steps named by verb and target (`已运行 npm test`, `已编辑 a.md +2 −1`, `已搜索 …`), the plan as a checklist, and questions for the user. Consecutive read-only commands fold into one `已探索 N 个文件，M 次搜索` row. Opening a step shows its command output or diff.
- While the agent works, the step in progress and the reasoning heading breathe quietly (opacity, no gradient) in the transcript; no status line sits above the composer. Once the reply finishes, its work folds into `已处理 <用时>` and only the final answer stays in view. Failures show a red icon on their row and never force the list open.
- When the agent needs a decision it asks with a question card inline in the reply: Codex `request_user_input` (enabled outside Plan mode via `features.default_mode_request_user_input`), Claude Code AskUserQuestion through ACP form elicitation, and an `ask_user` tool for API models. One question at a time with header tabs and a progress ring when there are several; lettered options (A–J / 1–9 keys, ↑↓), an optional typed answer, 跳过, and 下一题/提交 with ⌘/Ctrl+↵. A single choice advances to the next question; the last one waits for 提交. Once answered it settles into a quiet 已回答 summary; secret answers are masked and never saved. The existing layout follows Kobra's Question Card (interaction only, no source reused). shadcn now provides Questionnaire; retain this host adapter until its React 19 requirement and our secret-answer, shortcut and transport contracts have been verified.
- User messages show a quiet timestamp with copy and edit actions. Editing happens in place; resubmitting truncates the later branch, resets the Agent session and regenerates from the edited message.
- File changes require an explicit access choice. A dedicated shield control offers read-only, current-vault write, and desktop-only full filesystem access; no `仅建议` label is permanently shown in the composer.

## Visual language

- Use Obsidian semantic CSS variables for light/dark themes.
- Use host interface/text fonts first, then Apple and common Chinese system fonts.
- Borders are neutral and complete; do not use decorative left-edge borders.
- No gradients, glass effects, oversized hero text, or italics.
- Corner radii: 6–14 px depending on hierarchy; cards never become excessive nested containers.
- Accent color communicates focus or active work, not decoration.

## Components

### Sidebar header

- The first prompt supplies the conversation title; long titles truncate.
- No permanent provider, protocol, or unverified green connection indicator.
- Secondary icons are connection setup, history and new conversation.

### Connection center

- Responsive tile grid; selected tile uses a full neutral outline plus check badge.
- Tiles distinguish `可用`, `未连接`, native transport, and version.
- A single details region explains the selected option and the next required action.
- Primary action is disabled when the option cannot run; errors must explain how to recover.

### Messages and tools

- User prompts use one restrained tinted surface; assistant answers are flat.
- Markdown typography has generous line height and overflow protection for code, Mermaid, and tables.
- Tool calls use native `details/summary` controls with status icons and concise labels.

### Composer

- A single outlined composer contains removable file/image context chips, text input, and a bottom toolbar for attachments, Skill, permission, model, reasoning effort and send/stop.
- Model selection opens a host dropdown anchored to its trigger, not a modal. Manual ID entry remains a separate explicit action. Capability lists come from Codex model/list or ACP configOptions.
- `/` at the start of a single-line draft opens searchable Prompt choices. Enter runs the prompt (see Prompt library), Shift+Enter inserts it; Escape keeps the draft; IME composition never submits.
- `@` at a token boundary opens the native vault file picker. Upload, paste and drop share attachment ingestion and limits (6 files, 5 MB each, 10 MB total). Unsupported inputs retain the draft and display an actionable error.
- Reading older content disables automatic scroll-follow; returning near the bottom resumes it.
- Enter sends; Shift+Enter inserts a line break.
- Access is a compact Lucide shield control in the composer footer. Its icon reflects the active scope, while the anchored menu names read-only, current-vault write and desktop-only full access with a checked choice; removing persistent text never grants write access. Reasoning effort is muted text without a brain icon.
- Model navigation stays in one anchored popover: search, keyboard navigation, checked selection, loading/error/retry, manual ID, and a fixed model-management footer. Management reuses host settings; no second native model menu.
- Quiet input: a stable neutral 1px border, 20px radius, no hover background/ring or focus-within border jump. Keyboard-visible textarea focus has a restrained outline.
- The left plus opens attachment/note/Skill actions; its adjacent shield opens access scope; the right model chip opens a compact non-modal popover containing model selection and supported discrete effort levels. Escape restores focus; outside click and Tab departure dismiss. No hover-only controls.
- User messages have a restrained neutral 18px bubble capped at 90% width; assistant Markdown remains flat with 28px inter-message spacing. Preserve Chinese system fonts and host theme variables.
- Reply typography: 15px body at 1.75 line height (Chinese needs more leading than Latin, per W3C clreq), 1em paragraph gaps, headings capped at 1.3em, 1.5em list indent, CJK–Latin autospace, no fake italic for Chinese. Links keep neutral ink with a faint 1px underline; internal links show the note name, open in place (Cmd/Ctrl or middle click opens a new tab), and unresolved ones use a dashed underline. Quotes use a quiet surface instead of a side rule. Prose is capped at 76ch on wide panes; code and tables scroll within their own blocks. Trim only response boundaries, including host block wrappers, never every descendant paragraph. Conversation replies use blank lines between paragraphs; explicit user formatting and raw Markdown copy/append remain authoritative.

### Reply actions and persistence

- Reply action buttons are Lucide icons only: Copy, CalendarPlus, FilePlus2. Accessible names and targeted tooltips are retained per the user's explicit icon requirement.
- Assistant reply actions stay hidden until pointer hover or keyboard focus on desktop; touch devices keep them visible. User-message time, copy and edit remain visible below the bubble.
- File append shows an exact path and Markdown preview before committing. It uses Vault.process and offers conservative undo, refusing to overwrite edits in the affected prefix. Manual user writes are distinct from AI tool permission mode.
- Daily target resolution and creation use official Obsidian CLI so host folder/date/template settings remain authoritative. Mobile users can append to an explicitly selected Markdown file; daily CLI actions require desktop.
- New conversations archive the previous transcript instead of discarding it. Persistence retains attachment snapshots (local plugin data); they are not encrypted separately from Obsidian storage.
- Reused AI Elements composition and Apache notices are recorded in THIRD_PARTY_NOTICES.md. Wiki links use the host renderer. Complete Mermaid fences use Pele for flowcharts, sequences and mindmaps: host-sanitized SVG, scoped chat palette/font variables, adaptive layout and Lucide zoom controls below the drawing. Links, remote images and custom icon markup are disabled. Other types and rendering incompatibilities fall back to Obsidian's Mermaid as an inert image; resource-limit failures display a recovery message without bypassing limits. Source stays unchanged in a collapsed disclosure and in copy/append output. Vault trust settings and native note rendering stay unchanged.

### September 20 interaction polish

- Functional contract: read diagrams without an execution step; choose a model beside the composer; keep permission out of the everyday toolbar.
- Dials unchanged: restrained variation 5, minimal motion 3, compact density 6. No new decorative assets.
- Notion reference DNA: flat reading surface, 1px neutral boundaries, 8px spacing; translate through existing Obsidian theme variables rather than copying brand colors/fonts.
- Deliberate details: anchored menu, checked current model, theme-aware diagrams, collapsible source, visible focus, Chinese system fonts, bounded mobile controls.

### Settings

- Follow Qiaomu Reader's task-based progressive disclosure: top-level tabs are 模型、对话、工具; the default 模型 page puts connection choice first and folds API fallback details until requested.
- Selecting 模型 API reveals provider, key and model immediately. Protocol, Base URL, MCP and filesystem paths remain under advanced disclosures.
- Connection success is not a persistent chat message; only running, interruption and actionable error states may occupy the composer status area.

## Responsive behavior

- At narrow widths, connection cards form two columns and nonessential status copy disappears.
- No hover-only interaction may be required.
- Desktop local CLI features are presented as unavailable on mobile; API remains usable.

## Do / do not

- Do preserve theme compatibility, keyboard focus, and readable Chinese typography.
- Do provide specific recovery guidance for missing CLI/API configuration.
- Do not display provider setup controls in the permanent sidebar.
- Do not silently auto-approve unexpected permission requests.
- Do not copy AGPL implementation code into this MIT project; protocol behavior may be independently implemented from public specifications.

### Models (September 24, after magpie)

- One picker for everything. The composer's model chip opens a non-modal popover: search (“筛选，或输入任意模型 ID”) on top, a vertical source rail (all, recent, each agent and provider by brand mark), and a list grouped by source with small uppercase headers. Choosing a model also chooses its source, so there is no separate connection step.
- Typing an unknown id offers “使用「id」” for the focused source. Enter picks the first match; arrows move through items.
- Local agents show “默认模型” until their list is fetched; fetching starts the agent, so it only happens when that agent is focused in the rail. Lists are cached.
- Reasoning effort is a pill row under the list, only when the chosen model reports levels.
- Settings → 模型 is two cards: local agents (installed only; missing ones collapsed into one line) and providers (brand mark, name, host · model count, masked key with a status dot, chevron). A row expands into an inline editor: key with a “获取密钥” link, model chips that choose what the picker shows, “添加模型 ID”, refresh, and the URL behind a disclosure. A failed fetch (401/403) turns the dot red with “验证失败”.
- “添加服务商” opens a searchable tile grid grouped into 国内厂商 / 海外厂商 / 聚合平台 / 本机运行, plus 自定义 (name, OpenAI or Anthropic compatible, URL). Adding asks for one field, the key, then fetches the vendor's model list.

### Safe writes (September 24)

- Every local-agent turn is tracked. Before-content comes from, in order: what the agent reports (ACP diff `oldText`), a read when the agent announces the write (Codex `item/started` fileChange, ACP edit `locations`/`rawInput`), what the agent read earlier in the turn, and snapshots taken before the turn (active note, files named in the prompt). Codex patches are reversed if our read raced the write. Vault events catch everything else, listed as untracked.
- ACP agents get `fs.readTextFile/writeTextFile`; reads and writes go through the vault (inside the vault only; writes refused in read-only mode).
- After the turn, one "修改了 N 个文件 +a −b" card: kind badge (新建/修改/删除/库外), path, per-file diff with collapsed context, open file.
- Undo is pre-checked: files still as the agent left them are restored; files edited since are listed separately and need a checkbox; untracked ones are only listed; files already back to their before-state are skipped. Created files go to the trash. Undo state is per file ("部分已恢复" → "撤销其余修改…").
- Stopped turns still get their change card (attached after the stream closes).
- Approvals: ACP `session/request_permission` and Codex approval requests become an inline card in the reply (command/paths, 允许一次 / 本次会话都允许 / 拒绝). Read-only turns reject without asking. Codex runs with `on-request` only in writable mode, so escalations (network, outside the vault) reach the user.

### Obsidian awareness (September 24)

- Every backend gets a fixed conventions block before the user's own system prompt (stable prefix): wikilink references, moves/renames through Obsidian so links update, deletes to the trash, `property:set` for frontmatter, keep Markdown/YAML/Chinese typography, and "change only the selected lines" semantics. API mode also receives the vault-root `AGENTS.md` (local agents read it themselves).
- Context blocks share one format with escaped attributes: `<active_note path>`, `<editor_selection path lines>` (1-based, inclusive).
- The editor selection in the most recent note becomes a removable composer chip ("选中 N 行 · 笔记"), refreshed when the composer gains focus; dismissing it lasts until the selection changes. While focus is in the sidebar, the selection stays visible in the note through the CSS Custom Highlight API (no document changes), cleared when the editor regains focus.

### Model settings update (September 25)

- The first screen answers “what does this chat use?” with the selected model and source. Adding an API provider is visible immediately on first use and otherwise opens on demand. Cloud providers stay visible; the longer local Agent list starts collapsed. Showing a source in the picker is separate from changing the current model.
- Provider details lead with the models available in chat. Key replacement, endpoint details, and removal follow. “Default” belongs to that provider, not every conversation.
- Plugin-owned settings use a Vercel-inspired neutral scale: light ink `#171717`, line `#e5e5e5`, quiet surface `#fafafa`, dark equivalents, and a quiet one-pixel keyboard focus change. Inputs keep stable borders and surfaces on hover; no double borders or focus glow. No purple control accent. `--qa-*` variables stay within the plugin; Chinese uses system fonts and mobile targets remain at least 44px.
- AI Elements [Model Selector](https://elements.ai-sdk.dev/components/model-selector) was reviewed on 2026-09-25. Its search, source grouping, and keyboard pattern match the existing React chat picker. The settings screen uses Obsidian Modal and does not copy the React/cmdk/Tailwind component. No new third-party code or license is introduced.

### Model settings redesign (September 26)

- One page, no tabs inside tabs: 模型服务 first, then 本机 Agent on desktop. Each section has a title, one line of purpose and its own action (添加服务商 / 重新检测) as an outlined icon+text button.
- Source rows sit in one bordered list. The row opens details; the host switch on the right decides whether the source appears in the composer's model menu, and its accessible name says so. A hidden source dims. The subline states the next step when one is needed (需要 API Key, 尚未启用模型) in the warning color.
- Provider details are a single page: 连接 (API Key shown masked with a replace field, endpoint, 验证并保存 enabled only after an edit), then 模型 (刷新列表, 测试, search when there are more than 8, 已启用 before 可启用, a switch per model, 设为默认 and a parameters icon on enabled rows, inline manual ID entry). Removal is a two-step footer action. Switches apply immediately; there is no 完成 button (NN/g toggle guidance).
- Model parameters open in place with the back control inside the title row. Only information the vendor reported is shown; each option says what 自动 or an empty field resolves to.
- The provider chooser groups presets into 海外, 国内, 聚合平台 and 本地与自定义, left-aligned with logos; Enter picks the first match. After a successful connection the provider page opens so the user can choose models.

### Composer toolbar (September 26)

- Access is icon-only (Shield, FolderPen, ShieldAlert); full access keeps a warning tint. The level lives in the accessible name and the host tooltip.
- The toolbar never wraps. It sizes against the composer's own width with a container query: below 330 px the reasoning label hides, below 250 px the model name hides and only the brand icon and chevron remain. The model name truncates before either happens.

### Settings navigation and About (September 25)

- The settings header is a compact identity row with a Lucide tree and a stable, understated tab bar. The active tab uses an underline; there is no large header card or nested segmented surface.
- About opens with one version card: a muted 当前版本 label over a large version number, with outlined link buttons for changelog, bug reports and the guide. It does not repeat the product name, since the settings header already shows it. Below it, the Official Account and tip QR codes are always visible in two equal neutral cards, each on a white plate so they stay scannable in dark themes. A quiet footer holds the author links plus one line each for privacy and license. A container query (not a viewport query) lets the actions wrap and stacks the QR cards below 420 px of the settings pane's width.
- This follows the Qiaomu AI RSS settings content inventory and Apple HIG guidance on grouped layout, stable settings navigation, and progressive disclosure (reviewed 2026-09-25): https://developer.apple.com/design/human-interface-guidelines/settings , https://developer.apple.com/design/human-interface-guidelines/layout , https://developer.apple.com/design/human-interface-guidelines/disclosure-controls .

### Search and external content (September 25)

- OpenAI Responses, Anthropic Messages, Gemini, and xAI Responses use their documented native search tools. OpenRouter uses its server-side web search and fetch tools with the existing OpenRouter key. Native source URLs are retained in the answer. An API model without native search can use the user's Brave Search key, kept only in Obsidian SecretStorage; the model never receives that key. The tool is configured in 工具 → 联网搜索.
- The shared page reader accepts public HTTP/HTTPS HTML, plain text, Markdown, JSON, RSS, Atom, and XML. Every redirect is revalidated, DNS is resolved before connecting and the public IPv4 address is pinned; localhost and private addresses remain inaccessible. Reading a URL does not itself provide keyword search.
- Provider tools can incur vendor charges. The tool loops are bounded, and external text is treated as untrusted material. A model with no search backend must say it cannot verify current information rather than claim it searched.
- API chats can also search and read Markdown in the current vault without write access. `obsidian://open` and Wiki links resolve to vault notes; plugin action URLs need their source plugin to pass a reading snapshot. Vault search is capped at 2,000 files and eight results, with an explicit incomplete flag.
- References: https://platform.openai.com/docs/quickstart/make-your-first-api-request , https://docs.anthropic.com/zh-CN/docs/agents-and-tools/tool-use/web-search-tool , https://ai.google.dev/gemini-api/docs/google-search , https://docs.x.ai/developers/tools/web-search , https://openrouter.ai/docs/guides/features/server-tools/web-search , https://api-dashboard.search.brave.com/documentation/guides/authentication .
- Model setup has two tabs: model services and detected local Agents. The connected-service heading has an add icon; an empty list also offers an “添加服务商” button. CLI detection must not imply sign-in.
- Adding a provider stays in one searchable Obsidian modal: choose the brand, then enter its API Key and connect. Ollama and custom endpoints appear at the end of this chooser; Ollama needs no key. Existing connections remain continuous rows with quiet hover and a right-hand chevron; visibility switches are separate. Model rows use separators instead of nested cards, with chevrons for details. A small native modal adds a custom model ID.
- The Agent view and ribbon use Lucide `tree-deciduous`, matching the Qiaomu name without implying a magic action.
- Settings follow the RSS plugin's calm rhythm: one neutral title/navigation surface, short grouped rows, and right-aligned controls. Keep visible text to names, values, actionable errors, and necessary privacy/permission consequences. Put system Prompt, custom models, endpoints, and parameter overrides behind disclosures; avoid repeated headings and success explanations.

### Chat and tools settings (September 26)

- 对话 has three titled sections in the same bordered lists as 模型: 外观 (live preview of chat and code text, then font, size, code font, code size), 默认行为 (file access with a one-line consequence per level; choosing full access here shows the same one-time explanation as the composer), and a disclosure for the system Prompt (full-width, with 恢复默认) and quick prompts (one input per line, Enter adds the next, at most 8).
- Chat font choices: system default, Obsidian interface font, note text font (the description names the resolved family), fonts declared through `@font-face` by themes, snippets and plugins (read from `document.fonts`, icon/math faces excluded — e.g. 朱雀仿宋 from a font plugin), installed common Chinese system fonts (canvas-metric detection over a fixed list, not the permission-gated Local Font Access API), and a free-text family. A custom family is stored by name with the system stack as fallback; if it disappears the setting says so in the warning color. Native `<select>` options cannot render in their own font, so the preview block carries that job. Code text can follow `--font-monospace`.
- 工具 is 搜索 / Obsidian CLI / 扩展. Rows open detail pages with a chevron and state in the subline (counts, next step). No text buttons such as 设置 or 管理.
- Skills and tool connections open as a single page for the row that was chosen; tabs appear only when opened from the command palette. Adding happens in place with a back control in the title row. Skills are grouped by source with a count of enabled ones; paths are not shown in the list; import can pick a folder. Tool connections list Qiaomu entries first (switch plus an overflow menu with 加入 Codex and a two-step 移除), then Codex's read-only list, then the JSON editor. Errors are inline, not notices.

### First screen and touch polish (September 27)

- The empty conversation follows what is on screen: editor selection, then reading context, then today's daily note (a bare date name, optionally with the weekday; older daily notes count as ordinary notes), then the open note, otherwise the vault. The heading, one line saying what will be sent, the composer placeholder and four prompts change with it. Pinned custom prompts come first. Nothing is random, so re-renders stay stable.
- Prompts ending in "…" ask for a blank before sending (superseded on September 28: prompts now run in one click, see Prompt library). The library lives in `src/services/starter-prompts.ts` as Chinese prompts for real note work: polish, explain, restructure a selection; argument, quotes, reading notes; today's review and tasks; key points, related notes and links, frontmatter, self-test; finding notes, sorting thoughts, finding writing angles, learning a concept, making a decision, a weekly review.
- Group labels in the `/` menu are not options, and arrow keys keep the active option in view.
- With no model source, the first screen offers one neutral ink button, 连接模型, instead of prompts.
- The shortcut strip appears only once a conversation has started, so the first screen does not repeat itself. Keyboard hints (`/`, `@`, ⇧↵) appear on desktop only.
- Touch: no tap highlight, and a pressed background replaces hover. Prompt and menu rows are at least 44 px tall. The strip scrolls without a scrollbar, and the textarea is capped at 28dvh so the keyboard leaves room for the conversation. Running states pulse a 6 px dot, which stops under reduced motion.

### Prompt library (September 28)

Reference: Raycast AI Commands (one press runs a prompt; `{argument}` asks before running; built-ins can be duplicated, not deleted), Copilot for Obsidian (commands as Markdown files, slash menu and palette), TypingMind (`{{variable}}` blanks), AI Elements `Suggestion` (clicking a suggestion sends it).

- Running is separate from editing. A chip, a first-screen suggestion, a `/` choice or a palette command sends the prompt at once, with the note, selection or reading context that already goes along. Text in the composer goes with it; if the prompt has a blank without a default, that text fills the blank instead.
- Blanks (`{{名称}}`, `{{名称|默认值}}`, Raycast `{argument name= default= options=}`) open a small form above the composer: one field per blank, options as a select, Enter sends, Esc cancels. `{selection}` and `{clipboard}` ask for the text only when there is none. `{note}`, `{reading}`, `{date}`, `{time}`, `{day}` are filled from the screen.
- The strip shows pinned prompts in the user's order, then up to three that fit the screen, then a fixed 全部 Prompt button (Lucide Library) outside the scrolling chips. Right click or long press: 填入输入框, pin, edit, manage. The picker groups 已固定, 适合现在, 最近常用, 我的, then categories; search matches title, body, category, tags and source.
- A message sent from a prompt shows its title (Sparkles) and what the user added; the full text is folded under 完整 Prompt.
- Settings → Prompt is the library: tabs 已启用 / 全部 / 我的 / 场景 / 乔木精选 / Yao Open Prompts with counts, search and a category filter; each row has an enable switch, pin and an overflow menu (edit, copy as mine, open file, source, reset, delete to trash). The editor names blanks as the user types. The same panel opens as a modal from the chat.
- Scene prompts are on by default; the bundled 乔木精选 (50) and a curated Yao Open Prompts set (31, CC BY 4.0, credited in the panel) are off until turned on. ai-boost (GPL-3.0) and image prompts are not bundled. `tools/import-quickprompt.mjs` regenerates `src/prompts/library.json` from a Qiaomu-QuickPrompt checkout.
- The user's prompts are Markdown files in one visible folder (default `Qiaomu Agent/Prompts`, created with the first saved prompt): frontmatter `id`, `title`, `category`, `tags`, `run`; the body is the prompt. Editing a built-in prompt saves a file with the built-in id, which replaces it until 恢复默认 trashes the file. Enabled, pinned and usage state stays in plugin settings. Hand edits and synced changes reload automatically.
- Each enabled prompt is also a palette command (运行 Prompt：…) so it can take a hotkey, plus 运行 Prompt… to pick any of them. Before 0.5, saved templates and edited quick prompts moved to files once on load.

## 对话配色

外观设置沿用 RSS 的明亮、宣纸、竹青、雾蓝、深海、墨黑，默认跟随 Obsidian。仅覆盖对话面板和设置预览中的语义色，保留宿主设置与弹窗主题。切换只修改面板属性，不重建对话或触发模型连接。代码高亮、错误与修改记录提示分别适配浅深色；Mermaid 跟随面板明暗。

### AI Elements October 2026 adoption

- Prefer shadcn AI Elements patterns and base components for new work. Existing Apache-licensed AI SDK Elements wrappers remain valid and retain their notices.
- Execution rows use locally adapted Trace primitives: native details/summary, Lucide icons, scoped host colors, no animated layout or Tailwind reset. Keep chronological segments, grouped exploration, user expansion, collapsed completion, and visible pending approvals/questions.
- Tool output uses the adapted Code Block composition with literal text, bounded keyboard scrolling, optional wrapping and icon-only copy. Copy uses the owning window's clipboard; errors remain visible and retries are available. Markdown replies still use Obsidian MarkdownRenderer.
- Message Scroller and Questionnaire are evaluated but deferred: @shadcn/react 0.3.1 declares React >=19 while this plugin uses 18.3.1. No dependency upgrade is included. See docs/research/2026-10-15-shadcn-ai-elements.md for the compatibility and acceptance matrix.

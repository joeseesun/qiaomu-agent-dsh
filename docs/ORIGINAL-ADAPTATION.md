# Agent migration evidence and remaining work

Updated 2026-10-28, Asia/Shanghai. This is an implementation checkpoint, not a release acceptance report.

## Frozen source and boundaries

- Original Agent 0.6.7: `785bdce9f62262e252b6d92547950d9a5d3adfd4`, MIT. `upstream/qiaomu-agent` is byte-preserved and covered by a hash test. Original worktree and its other worktrees were not modified.
- Home host boundary: `fa980f4644dbddee4b88ab31259b847884e1d78a`, GPL-3.0. Copied files and original hashes are in `vendor/qiaomu-home-dsh/source.json`; local type-safety patches are recorded separately.
- Original React 18, ChatPanel, AI Elements, prompt input, history controls, model picker, reply actions and all six CSS files are reused. No replacement chat UI was drawn.
- Installed Harness public service contracts were inspected read-only. The native adapter uses injected `sessions.retain`, `uiSession.bindingSource`, `hooks.session` and `hooks.chat`; no internal runtime Client package imports.
- Native projection is a disposable in-memory view cache. No persisted shadow chat history, polling, raw event scans, remote approvals or model requests are implemented in this checkpoint.

## Verified code

| Area | Evidence | Remaining acceptance |
| --- | --- | --- |
| Original source and styles | Every frozen file SHA-256 checked | Actual Harness appearance in light/dark/narrow layouts |
| Original behavior baseline | 480 original tests pass; one Windows-only test skipped on macOS | Original API/CLI services are not wired to Harness |
| Native chat view | Ordered text/reasoning, keyed replacement/retry, tool activity, removal and stable identity tests | Native host execution, attachments, plans, usage, complete per-turn grouping |
| Session lifetime | Retain/release, provider replacement, unavailable state, stale callback and late failure tests | Reconnect with a real installed plugin |
| Original UI through adapter | Real ChatPanel + original AgentTransport + Markdown/internal-link DOM tests | Native prompting/cancel/history/fork/model/settings/file actions |
| Markdown boundary | Headings/tables/code/wiki aliases, scoped relative images, unload cancellation, script/handler/URL filtering and SVG geometry tests | Embeds, host file preview, physical diagrams/images and external navigation |
| Build | Original component JS/CSS and lazy Mermaid chunks compile | Cordis Host/Client entry, bundle metadata, package audit and isolated install |

Current full check: `npm run check`; 480 original tests plus 20 adaptation tests. The Markdown security tests use jsdom as recommended by DOMPurify; happy-dom remains only for the unchanged original suite. No browser or native UI was operated. No paid AI request was made.

## Full migration checklist

- [ ] Wire Cordis Host/Client entry and standard session controller to the original UI.
- [ ] Preserve native send/stop/error/retry, authoritative history, branches, model/effort selection, and queued prompts.
- [ ] Integrate original API/CLI backend capabilities with documented host authority and credential handling; do not claim preserved files mean working backends.
- [ ] Attachments: files/folders/web/clipboard/images, generated artifacts, previews and downloads.
- [ ] Original prompts, skills, MCP/connection settings, theme/font preferences and update notes.
- [ ] Reading context, editor selections, note attachment, append/daily note confirmation, change review/undo.
- [ ] User-owned approval and question interactions, permission controls, no automatic policy relaxation.
- [ ] Original Home provider, commands/hotkeys and navigation.
- [ ] Explicit legacy data import with backup/conflict handling; original data stays untouched.
- [ ] Full packaging, clean install, upgrade preservation, actual Harness runtime and visual acceptance.
- [ ] Public release/download verification and daily installation after acceptance.

Unsupported native node/block types are explicitly returned to the future controller; it must present a native conversation fallback until their mapping is complete. Current projection is not full native chat parity. The component entry is a development library; package.json remains private and has no install entry.

## User environment

The user still controls the test browser (taskspace 92). No browser takeover, QA restart, daily Harness restart or other chat approval action is authorized at this checkpoint. Continue code/release preparation; wait for explicit permission to resume the browser phase.

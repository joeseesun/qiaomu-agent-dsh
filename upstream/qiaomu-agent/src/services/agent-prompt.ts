import type { ChatRequest } from "../types";
import { READING_CONVENTIONS } from "../integrations/reading-prompt";

/** Escapes a value for use inside a double-quoted XML attribute. */
export function xmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Fixed, vault-independent conventions placed before the user's own instructions,
 * so the prefix stays stable across turns (cache-friendly) and every backend gets them.
 */
export const OBSIDIAN_CONVENTIONS = `## Working in an Obsidian vault
- The working directory is the vault root. Refer to vault files in replies as wikilinks with vault-relative paths, e.g. [[folder/note]], so they are clickable.
- Move or rename notes through Obsidian (the Obsidian CLI \`move\` command when available) so links are updated; never use shell mv on notes.
- Delete through Obsidian's trash (\`obsidian delete\`); never delete permanently unless the user explicitly asks.
- Change frontmatter properties with the Obsidian CLI \`property:set\` / \`property:remove\` when available instead of hand-editing YAML.
- Keep existing Markdown, YAML frontmatter, wikilinks, embeds, callouts and Chinese typography intact; change only what the request needs.
- Context tags: <active_note path> is the open note; <editor_selection path lines> is the text the user selected. When asked to rewrite or fix "this", change only the selected lines of that note.`;

/** Presentation guidance shared by CLI and API chats; explicit output contracts take precedence. */
export const RESPONSE_CONVENTIONS = `## Readable conversation replies
- Follow the user's requested language, length and output format first. These defaults apply to conversational replies, not verbatim quotes, replacement note text, poetry or machine-readable output.
- Lead with the answer. Use short paragraphs for ordinary explanations, with a blank line between paragraphs (a single newline only creates a line break in Obsidian).
- If asked for three sentences, write exactly three sentences, one per paragraph, separated by blank lines; do not add headings, numbering or a closing summary.
- Use brief headings only for longer answers. Use bullets for parallel items, numbered lists for steps, and tables for compact comparisons; avoid wide tables in the sidebar. Leave blank lines around lists and headings, and keep nested lists shallow.
- Use bold sparingly for key conclusions. Put code in fenced blocks with a language, preserve its indentation and line breaks, and keep paths or identifiers in inline code unless they should be clickable links. Do not turn an ordinary answer into a code block.`;

/** Conventions, then the user's instructions, then (API only) the vault's AGENTS.md. */
export function buildSystemPrompt(userPrompt: string, vaultInstructions?: string): string {
  const parts = [`${OBSIDIAN_CONVENTIONS}\n${READING_CONVENTIONS}\n\n${RESPONSE_CONVENTIONS}`, userPrompt.trim()];
  if (vaultInstructions?.trim()) parts.push(`<vault_instructions source="AGENTS.md">\n${vaultInstructions.trim()}\n</vault_instructions>`);
  return parts.filter(Boolean).join("\n\n");
}

export function selectionBlock(request: Pick<ChatRequest, "selection">): string | null {
  const selection = request.selection;
  if (!selection?.text.trim()) return null;
  const lines = selection.startLine === selection.endLine ? `${selection.startLine}` : `${selection.startLine}-${selection.endLine}`;
  return `<editor_selection path="${xmlAttr(selection.path)}" lines="${lines}">\n${selection.text}\n</editor_selection>`;
}

export function activeNoteBlock(request: Pick<ChatRequest, "activeFilePath" | "activeFileContent">): string | null {
  if (!request.activeFilePath || request.activeFileContent === undefined) return null;
  return `<active_note path="${xmlAttr(request.activeFilePath)}">\n${request.activeFileContent}\n</active_note>`;
}

export function createId(prefix = "message"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function extractJsonEventText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const event = value as Record<string, unknown>;

  const directKeys = ["delta", "text", "result", "output_text"];
  for (const key of directKeys) {
    if (typeof event[key] === "string") return event[key];
  }

  if (event.type === "item.completed" && event.item && typeof event.item === "object") {
    const item = event.item as Record<string, unknown>;
    if (typeof item.text === "string") return item.text;
  }

  if (event.message && typeof event.message === "object") {
    const message = event.message as Record<string, unknown>;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const record = part as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        })
        .join("");
    }
  }

  if (event.content && typeof event.content === "object") {
    const content = event.content as Record<string, unknown>;
    if (typeof content.text === "string") return content.text;
  }

  if (event.part && typeof event.part === "object") {
    const part = event.part as Record<string, unknown>;
    if (typeof part.text === "string") return part.text;
  }

  if (event.error && typeof event.error === "object") {
    const error = event.error as Record<string, unknown>;
    if (typeof error.message === "string") return error.message;
  }

  if (Array.isArray(event.errors)) {
    return event.errors.filter((item): item is string => typeof item === "string").join("\n");
  }

  return "";
}

export function parseSkillFrontmatter(markdown: string): { name: string; description: string; body: string } | null {
  if (!markdown.startsWith("---")) return null;
  const closing = markdown.indexOf("\n---", 3);
  if (closing < 0) return null;
  const header = markdown.slice(3, closing).trim();
  const body = markdown.slice(closing + 4).trim();
  const values = new Map<string, string>();
  const lines = header.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index]?.match(/^([a-zA-Z0-9_-]+):\s*(.*?)\s*$/);
    if (!match?.[1] || match[2] === undefined) continue;
    const [, key, raw] = match;
    if (/^[>|][-+]?\s*$/.test(raw)) {
      const chunks: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1] ?? "")) chunks.push(lines[++index]!.trim());
      values.set(key, raw.startsWith(">") ? chunks.join(" ") : chunks.join("\n"));
    } else values.set(key, raw.replace(/^(["'])(.*)\1$/, "$2"));
  }
  const name = values.get("name")?.trim();
  const description = values.get("description")?.trim();
  if (!name || !description) return null;
  return { name, description, body };
}

export function truncateMiddle(value: string, max = 44): string {
  if (value.length <= max) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}

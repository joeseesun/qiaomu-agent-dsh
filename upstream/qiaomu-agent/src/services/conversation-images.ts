import type { AgentMessage } from "./chat-transport";
import type { ChatAttachment } from "../types";

/** Images in reading order, including generated data parts and user attachments. */
export function conversationImages(messages: AgentMessage[]): ChatAttachment[] {
  const images: ChatAttachment[] = [];
  for (const message of messages) {
    const files = new Map((message.metadata?.attachments ?? []).map((file) => [file.id, file]));
    for (const part of message.parts) if (part.type === "data-attachment") files.set(part.data.id, part.data);
    for (const file of files.values()) if (file.mediaType.startsWith("image/") && file.url) images.push(file);
  }
  return images;
}

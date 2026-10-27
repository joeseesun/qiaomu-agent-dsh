import { expect, it } from "vitest";
import { conversationImages } from "../src/services/conversation-images";
import type { AgentMessage } from "../src/services/chat-transport";

it("collects user and generated images in reading order without duplicating data parts", () => {
  const user = { id: "u", name: "before.png", mediaType: "image/png", size: 3, url: "data:image/png;base64,AA==" };
  const generated = { id: "a", name: "after.png", mediaType: "image/png", size: 3, url: "app://after.png" };
  const messages: AgentMessage[] = [
    { id: "m1", role: "user", metadata: { createdAt: 1, attachments: [user] }, parts: [{ type: "text", text: "修改" }] },
    { id: "m2", role: "assistant", metadata: { createdAt: 2, attachments: [generated] }, parts: [{ type: "text", text: "完成" }, { type: "data-attachment", id: generated.id, data: generated }] },
  ];
  expect(conversationImages(messages).map((image) => image.name)).toEqual(["before.png", "after.png"]);
});

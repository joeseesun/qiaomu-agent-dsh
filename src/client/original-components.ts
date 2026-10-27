// Buildable original UI surface; the Harness controller is not yet connected.
export { ChatPanel } from "../../upstream/qiaomu-agent/src/ui/chat-panel";
export { AgentTransport } from "../../upstream/qiaomu-agent/src/services/chat-transport";
export { NativeChatProjection, observeNativeChat } from "./native-chat";
export { NativeSessionActions, forkNativeMessage } from "./native-actions";
export { originalModelSources, selectOriginalModel, selectDefaultFlash } from "./native-models";
import "./harness-ui.css";
import "../../upstream/qiaomu-agent/src/base.css";
import "../../upstream/qiaomu-agent/src/palettes.css";
import "../../upstream/qiaomu-agent/src/chat-ui.css";
import "../../upstream/qiaomu-agent/src/settings-polish.css";
import "../../upstream/qiaomu-agent/src/ui/models.css";
import "../../upstream/qiaomu-agent/src/ui/review.css";

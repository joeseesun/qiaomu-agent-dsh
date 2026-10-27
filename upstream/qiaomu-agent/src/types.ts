import type { ContextSnapshot } from "./integrations/qiaomu-context";
export type PermissionMode = "plan" | "edit" | "full";

export type BackendKind = "auto" | "cli" | "api";

export interface ApiConnection {
  provider: string;
  protocol?: "openai-chat" | "openai-responses" | "anthropic" | "google";
  baseUrl: string;
  /** Exact private HTTP endpoint explicitly confirmed in connection settings. */
  privateHttpApprovedUrl?: string;
  model: string;
  secretId: string;
}

export interface ProviderConfig extends ApiConnection {
  /** Stable id: the preset id, or `custom-…` for user-defined endpoints. */
  id: string;
  name?: string;
  /** Last list reported by the vendor. */
  models?: ModelChoice[];
  /** Explicit user models, independent of the remote discovery cache. */
  manualModels?: Array<Pick<ModelChoice, "id" | "name">>;
  /** Explicit removals survive discovery refresh; manual re-add restores the ID. */
  removedModels?: string[];
  /** Models shown in the picker; empty means none. */
  enabledModels?: string[];
  /** Hide this provider from the composer without deleting its credentials. */
  showInPicker?: boolean;
  /** Optional API request parameters, keyed by exact model ID. */
  modelOptions?: Record<string, ModelOptions>;
  fetchedAt?: number;
}

/** Per-model settings; an unset capability means "use what the vendor reports". */
export interface ModelOptions {
  temperature?: number;
  maxOutputTokens?: number;
  /** Context window in tokens. */
  contextWindow?: number;
  /** Whether the model thinks, i.e. offers reasoning effort levels. */
  reasoning?: boolean;
  /** Whether the model accepts image input. */
  vision?: boolean;
}

export interface QiaomuSettings {
  schemaVersion: 1;
  backendKind: BackendKind;
  preferredCli: string;
  permissionMode: PermissionMode;
  /** Web search for API models; off only when the user turned it off in the add menu. */
  webSearch?: boolean;
  /** The user accepted the full-access warning once; it is not shown again. */
  fullAccessAcknowledged?: boolean;
  api: ApiConnection;
  apiProfiles?: Record<string, ApiConnection>;
  /** Every configured model provider; `api` mirrors the active one. */
  providers: ProviderConfig[];
  /** Most recently used models, newest first, across agents and providers. */
  recentModels: Array<{ source: string; model: string }>;
  /** Local agents hidden from the composer model picker. */
  hiddenAgents: string[];
  /** Explicit composer visibility overrides. Discovered callable agents show by default. */
  agentVisibility: Record<string, boolean>;
  chatTheme: import("./services/palettes").ChatTheme;
  chatFontFamily: "system" | "obsidian" | "text" | "custom";
  /** Family name used when chatFontFamily is "custom" (for example a font another plugin loads). */
  chatFontCustom: string;
  codeFontFamily: "system" | "obsidian";
  chatFontSize: number;
  codeFontSize: number;
  /** Model lists reported by local agents, so the picker can show them without starting each agent. */
  agentModelCache: Record<string, { models: ModelChoice[]; fetchedAt: number }>;
  /** Explicit per-agent picker choices. Missing entry means all reported models and the default. */
  agentEnabledModels: Record<string, string[]>;
  /** User supplied model IDs for agents that do not report a complete list. */
  agentCustomModels: Record<string, string[]>;
  systemPrompt: string;
  /** Prompt library state: which prompts are on, the strip order, usage, and the folder for the user's own. */
  prompts: import("./services/prompt-library").PromptSettings;
  /** Before 0.5: strip texts. Read once to move edited ones into prompt files, then removed. */
  quickPrompts?: string[];
  autoAttachActiveNote: boolean;
  useObsidianCli: boolean;
  skillDirectories: string[];
  /** Skill paths hidden from Qiaomu's explicit picker and prompt injection. */
  disabledSkillPaths: string[];
  mcpConfig: string;
  /** MCP servers excluded from Qiaomu-managed per-session configuration. */
  disabledMcpServers: string[];
  lastConversation: ChatMessage[];
  activeConversation?: ConversationIdentity;
  conversations?: ConversationRecord[];
  modelSelections?: Record<string, { model: string; effort: string }>;
  /** Before 0.5: saved templates. Moved into prompt files once, then removed. */
  customPrompts?: PromptTemplate[];
}

export interface ConversationIdentity {
  id: string;
  title: string;
  createdAt: number;
  fork?: { parentId: string; parentTitle: string; messageId: string };
}

export interface ConversationRecord extends ConversationIdentity {
  messages: ChatMessage[];
}

export interface SentPrompt { id: string; title: string; /** What the user added: blanks filled in or text typed alongside. */ extra?: string }

export interface PromptTemplate { id: string; name: string; body: string; pinned?: boolean; }

export type ChatRole = "user" | "assistant" | "status";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  backend?: string;
  sourcePath?: string;
  attachments?: ChatAttachment[];
  activities?: ChatActivity[];
  /** Order of text, steps and plan; absent in replies saved before steps were interleaved. */
  timeline?: TimelineEntry[];
  plan?: ChatPlan;
  /** Questions the agent asked during the reply, with the user's answers. */
  questions?: QuestionState[];
  finishedAt?: number;
  /** A user message sent from a saved prompt: shown by its title, with the full text on demand. */
  prompt?: SentPrompt;
  changes?: TurnChanges;
  /** Context window occupancy the backend reported after this reply. */
  usage?: ContextUsage;
}

/** Tokens currently in the model's context window, as reported by the backend. */
export interface ContextUsage {
  used: number;
  size: number;
}

/** One file an agent turn touched. `before`/`after` are null when the file did not exist. */
export interface FileChange {
  path: string;
  before: string | null;
  after: string | null;
  /** Content before the turn is known, so the change can be rolled back. */
  tracked: boolean;
  /** Outside the vault, or not text: listed only, never diffed or restored. */
  outside?: boolean;
  binary?: boolean;
  /** Restored to `before` by the user. */
  reverted?: boolean;
}

export interface TurnChanges {
  files: FileChange[];
  revertedAt?: number;
}

export type ApprovalOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface ApprovalRequest {
  id: string;
  title: string;
  detail?: string;
  options: Array<{ id: string; label: string; kind: ApprovalOptionKind }>;
}

export interface ApprovalState extends ApprovalRequest {
  status: "pending" | "decided" | "cancelled";
  chosen?: string;
}

/** One question the agent asks the user mid-turn (Claude Code AskUserQuestion, Codex request_user_input). */
export interface UserQuestion {
  id: string;
  /** Short topic label, a few words. */
  header?: string;
  question: string;
  /** Empty: the answer is typed. */
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
  /** Offer a typed answer besides the options. */
  allowOther?: boolean;
  /** The typed answer is masked and never stored. */
  secret?: boolean;
}

export interface QuestionRequest {
  id: string;
  questions: UserQuestion[];
}

/** Question id → chosen labels and/or typed text; a skipped question is absent. */
export type QuestionAnswers = Record<string, string[]>;

export interface QuestionState extends QuestionRequest {
  status: "pending" | "answered" | "cancelled";
  answers?: QuestionAnswers;
}

export type ChatActivityStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface EditorSelectionContext {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ChatActivity {
  id: string;
  label: string;
  status: ChatActivityStatus;
  detail?: string;
  /** What the step did, so the reply can name it the way Codex does; absent for generic tools. */
  kind?: "command" | "explore" | "edit" | "search" | "tool" | "image";
  /** Read-only look-arounds an explore step made. */
  actions?: ExploreAction[];
  /** Lines an edit added and removed. */
  added?: number;
  removed?: number;
}

export interface ExploreAction { type: "read" | "search" | "list"; target: string }

/** The agent's to-do list for the turn, updated in place as it works. */
export interface ChatPlan {
  explanation?: string;
  steps: Array<{ step: string; status: "pending" | "inProgress" | "completed" }>;
}

/** Where a reply's pieces fell in time: text runs (by length, sliced from `content`), steps and the plan. */
export type TimelineEntry = { text: number } | { activity: string } | { plan: true } | { question: string };

export interface ChatRequest {
  prompt: string;
  systemPrompt: string;
  cwd: string | null;
  model?: string;
  reasoningEffort?: string;
  modelOptions?: { temperature?: number; maxOutputTokens?: number };
  attachments?: ChatAttachment[];
  permissionMode: PermissionMode;
  /** false: attach no search tools this turn. Reading pages, vault and file tools are unaffected. */
  webSearch?: boolean;
  activeFilePath?: string;
  activeFileContent?: string;
  /** Text selected in the editor when the message was sent. Lines are 1-based and inclusive. */
  selection?: EditorSelectionContext;
  /** What the user is reading in another plugin or view (Qiaomu Context Protocol). */
  reading?: ContextSnapshot;
  /** Context window the provider reported for the selected API model. */
  contextWindow?: number;
  skill?: AgentSkill;
  mcpConfig?: Record<string, unknown>;
  obsidianCli?: ObsidianCliConnection;
  history: ChatMessage[];
}

export type ObsidianCliState = "unavailable" | "disabled" | "ready" | "error";

export interface ObsidianCliConnection {
  path: string;
  version: string | null;
  state: ObsidianCliState;
  detail: string;
}

export interface ChatCallbacks {
  onText: (text: string) => void;
  onStatus: (status: string) => void;
  onActivity?: (activity: ChatActivity) => void;
  /** The agent's plan changed; replaces the previous one. */
  onPlan?: (plan: ChatPlan) => void;
  /** The current text run ended (e.g. one agent message finished); the next text starts a new paragraph. */
  onTextEnd?: () => void;
  onAttachment?: (attachment: GeneratedAttachment) => void | Promise<void>;
  onUsage?: (usage: ContextUsage) => void;
  /** The agent is about to write these absolute paths; `before` is given when the agent reports it. */
  onFileIntent?: (paths: Array<{ path: string; before?: string | null; patch?: string; read?: boolean }>) => void;
  /** Ask the user; resolves with the chosen option id, or null when cancelled. */
  requestApproval?: (request: ApprovalRequest) => Promise<string | null>;
  /** Ask the user one or more questions; resolves with the answers, or null when dismissed or cancelled. */
  requestUserInput?: (request: QuestionRequest) => Promise<QuestionAnswers | null>;
  /** Host file access for protocols that route reads/writes through the client (ACP fs). */
  host?: { readText(path: string): Promise<string>; writeText(path: string, content: string): Promise<void> };
}

/** Transient media returned by a model or native agent before it is imported into the vault. */
export interface GeneratedAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  base64?: string;
  localPath?: string;
}

export interface ChatBackend {
  readonly id: string;
  readonly label: string;
  send(request: ChatRequest, callbacks: ChatCallbacks, signal: AbortSignal): Promise<void>;
  resetSession?(): void;
  shutdown?(): Promise<void>;
  prepare?(request: ChatRequest): Promise<void>;
  listModels?(request: ChatRequest): Promise<ModelChoice[]>;
}

export interface ModelChoice {
  id: string;
  name: string;
  efforts: string[];
  isDefault?: boolean;
  /** Context window in tokens, when the provider reports it. */
  contextWindow?: number;
  /** Maximum output tokens in one response, when the provider reports it. */
  maxOutputTokens?: number;
  /** Image input, when the provider reports it. */
  vision?: boolean;
  /** Thinking support, when the provider reports it. */
  reasoning?: boolean;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  text?: string;
  url?: string;
  vaultPath?: string;
  /** User explicitly asked to edit this image as a reference, rather than only analyze it. */
  intent?: "edit";
}

export interface CliDetection {
  /** Runtime arguments/environment for bundled Node CLIs. */
  argsPrefix?: string[];
  env?: Record<string, string>;
  /** Optional separately installed ACP adapter, e.g. Claude Agent ACP. */
  nativePath?: string;
  nativeArgsPrefix?: string[];
  id: string;
  label: string;
  command: string;
  path: string | null;
  version: string | null;
  available: boolean;
  callable: boolean;
  note?: string;
}

export interface AgentSkill {
  name: string;
  description: string;
  path: string;
  body: string;
  source: "vault" | "external";
}

export interface CliProfile {
  id: string;
  label: string;
  commands: string[];
  versionArgs: string[];
  supportsMcpFile: boolean;
  mcpFileFlag?: string;
  buildArgs: (request: ChatRequest, mcpFile?: string) => string[];
}

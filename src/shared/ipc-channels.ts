/**
 * Single source of truth for all IPC channel names.
 *
 * Both `main/ipc/index.ts` (which registers `ipcMain.handle`) and
 * `preload/index.ts` (which calls `ipcRenderer.invoke`) MUST reference these
 * constants instead of inlining the channel string. That way:
 *
 *  - Renaming a channel is a single edit caught by the type system everywhere.
 *  - Typos like `"channel:nme"` become impossible.
 *  - It's trivial to grep for every consumer of a channel.
 *
 * The pattern is `{namespace}:{verb}` (or `{namespace}:{verb-noun}`),
 * grouped by feature area.
 */

export const IPC = {
  app: {
    getInfo: "app:get-info"
  },
  settings: {
    getAppearance: "settings:get-appearance",
    setAppearance: "settings:set-appearance"
  },
  uiPrefs: {
    get: "ui-prefs:get",
    set: "ui-prefs:set"
  },
  models: {
    getConfigs: "models:get-configs",
    saveConfig: "models:save-config",
    setAllEnabled: "models:set-all-enabled",
    bulkInit: "models:bulk-init",
    addCustom: "models:add-custom",
    deleteCustom: "models:delete-custom",
    getCustom: "models:get-custom",
    getAllCustom: "models:get-all-custom"
  },
  providers: {
    getAll: "providers:get-all",
    get: "providers:get",
    save: "providers:save",
    delete: "providers:delete"
  },
  connectivity: {
    check: "connectivity:check"
  },
  chat: {
    startStream: "chat:start-stream",
    cancelStream: "chat:cancel-stream",
    /** Per-stream push channel; the real name is `chat:stream:${streamId}`. */
    streamPrefix: "chat:stream:"
  },
  projects: {
    list: "projects:list",
    create: "projects:create",
    update: "projects:update",
    delete: "projects:delete"
  },
  conversations: {
    list: "conversations:list",
    get: "conversations:get",
    create: "conversations:create",
    update: "conversations:update",
    delete: "conversations:delete",
    previews: "conversations:previews"
  },
  messages: {
    list: "messages:list",
    append: "messages:append",
    delete: "messages:delete"
  },
  mcp: {
    list: "mcp:list",
    get: "mcp:get",
    save: "mcp:save",
    delete: "mcp:delete",
    setEnabled: "mcp:set-enabled",
    test: "mcp:test"
  },
  dialog: {
    pickDirectory: "dialog:pick-directory"
  },
  shell: {
    openPath: "shell:open-path"
  },
  git: {
    status: "git:status"
  },
  agent: {
    startRun: "agent:start-run",
    cancelRun: "agent:cancel-run",
    answerPermission: "agent:answer-permission",
    listParts: "agent:list-parts",
    listToolRuns: "agent:list-tool-runs",
    listTodos: "agent:list-todos",
    listTasks: "agent:list-tasks",
    cancelTask: "agent:cancel-task",
    costSummary: "agent:cost-summary",
    /**
     * One-shot context budget snapshot for a conversation. Renderer
     * calls this when switching to an existing conversation so the
     * ContextRing has data to show BEFORE any new stream lands. Without
     * it the ring is invisible until the user sends another message.
     */
    contextSnapshot: "agent:context-snapshot",
    setBypassPermissions: "agent:set-bypass-permissions",
    resumeRun: "agent:resume-run",
    listInterrupted: "agent:list-interrupted",
    discardInterrupted: "agent:discard-interrupted",
    /** Per-run push channel; the real name is `agent:run:${runId}`. */
    runPrefix: "agent:run:",
    /** Per-run permission request channel: `agent:permission:${runId}`. */
    permissionPrefix: "agent:permission:"
  }
} as const;

/** Compose a per-stream push channel from a stream id. */
export function chatStreamChannel(streamId: string): string {
  return `${IPC.chat.streamPrefix}${streamId}`;
}

/** Compose a per-run agent event channel. */
export function agentRunChannel(runId: string): string {
  return `${IPC.agent.runPrefix}${runId}`;
}

/** Compose a per-run permission-request channel. */
export function agentPermissionChannel(runId: string): string {
  return `${IPC.agent.permissionPrefix}${runId}`;
}

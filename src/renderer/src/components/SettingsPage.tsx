import { Component, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { McpServerConfig, McpTestResult, McpTransport } from "@shared/types";

/**
 * Local error boundary so a render-time bug inside SettingsPage doesn't black
 * out the entire app. Without this, an uncaught error in any descendant would
 * unmount the whole React tree and leave only the body bg color visible.
 */
class SettingsErrorBoundary extends Component<{ onClose: () => void; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[SettingsPage] crashed:", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--lp-main-bg)] p-8 text-[var(--lp-text)]">
        <div className="max-w-[640px] rounded-xl border border-red-500/40 bg-red-500/10 p-6">
          <div className="text-[16px] font-semibold text-red-300">设置页崩溃</div>
          <pre className="mt-3 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] text-red-200">
{this.state.error.message}{"\n\n"}{this.state.error.stack}
          </pre>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-1.5 text-[12px]"
            >重试</button>
            <button
              type="button"
              onClick={this.props.onClose}
              className="rounded-lg bg-white px-4 py-1.5 text-[12px] font-medium text-[#151515]"
            >关闭</button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Full-screen system settings overlay (replacement for the old placeholder modal).
 *
 * Layout:
 *   ┌── Header (title + close)
 *   ├── Left rail: category list (general / mcp / about)
 *   └── Right pane: active category content
 *
 * The MCP category provides full CRUD over the persisted `mcp_server` table
 * plus a live connectivity test that runs an `initialize` JSON-RPC handshake
 * (see src/main/mcp/client.ts).
 */

type SettingsCategory = "general" | "mcp" | "about";

/** Temporarily hide subtitle + General nav until that pane is product-ready. */
const SHOW_GENERAL_SETTINGS = false;

interface SettingsPageProps {
  onClose: () => void;
  appVersion?: string;
}

export function SettingsPage(props: SettingsPageProps) {
  return (
    <SettingsErrorBoundary onClose={props.onClose}>
      <SettingsPageInner {...props} />
    </SettingsErrorBoundary>
  );
}

function SettingsPageInner({ onClose, appVersion }: SettingsPageProps) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<SettingsCategory>("mcp");

  // Esc closes the page, matching modal behavior the user is used to.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    /* The outer container must be FULLY opaque — `--lp-main-bg` in dark
       theme is rgba(...,0.8), which leaked the underlying chat page through
       the settings overlay. Use `--lp-bg` (#0a0a0a) for a hard cutoff, with
       a subtle radial highlight for depth. */
    <div
      className="fixed inset-0 z-50 flex text-[var(--lp-text)]"
      style={{
        backgroundColor: "var(--lp-bg)",
        backgroundImage:
          "radial-gradient(1200px 600px at 20% -10%, rgba(255,255,255,0.04), transparent 60%), " +
          "radial-gradient(900px 500px at 100% 110%, rgba(255,255,255,0.03), transparent 55%)"
      }}
    >
      {/* Left rail */}
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-black/30">
        {/* macOS traffic-light spacer (draggable) — mirrors the main shell so
            the native window buttons don't sit on top of clickable UI. */}
        <div
          className="h-[52px] flex-shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        {/* Prominent "back to home" affordance — discoverable in the rail's
            top-left corner the way every major desktop settings page (Cursor,
            VSCode, GitHub) places it. The Esc key still works as a shortcut. */}
        <div className="px-4 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="group flex w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[12.5px] text-[var(--lp-text)]/85 transition hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-[var(--lp-text)]"
            title={`${t("settings.backHome")} (Esc)`}
            aria-label={t("settings.backHome")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition group-hover:-translate-x-0.5" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>{t("settings.backHome")}</span>
            <span className="ml-auto rounded border border-white/[0.1] px-1.5 py-px text-[10px] text-[var(--lp-soft-text)]">Esc</span>
          </button>
        </div>
        <div className="px-5 pb-3 pt-4">
          <div className="text-[15px] font-semibold tracking-tight">{t("settings.title")}</div>
          {SHOW_GENERAL_SETTINGS ? (
            <div className="mt-0.5 text-[11.5px] text-[var(--lp-soft-text)]">{t("settings.subtitle")}</div>
          ) : null}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {SHOW_GENERAL_SETTINGS ? (
            <CategoryGroup label={t("settings.groupGeneral")}>
              <CategoryItem active={category === "general"} onClick={() => setCategory("general")} icon={IconGear} label={t("settings.general")} />
            </CategoryGroup>
          ) : null}
          <CategoryGroup label={t("settings.groupExtensions")}>
            <CategoryItem active={category === "mcp"} onClick={() => setCategory("mcp")} icon={IconPlug} label={t("settings.mcp")} />
          </CategoryGroup>
          <CategoryGroup label={t("settings.groupOther")}>
            <CategoryItem active={category === "about"} onClick={() => setCategory("about")} icon={IconInfo} label={t("settings.about")} />
          </CategoryGroup>
        </nav>
        <div className="border-t border-white/[0.06] px-5 py-3 text-[11px] text-[var(--lp-soft-text)]">
          {appVersion ? `Little Peanut · v${appVersion}` : "Little Peanut"}
        </div>
      </aside>

      {/* Right pane */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-8 py-3.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="text-[var(--lp-soft-text)]">{t("settings.title")}</span>
            <span className="text-[var(--lp-soft-text)]/60">/</span>
            <span className="text-[var(--lp-text)]">{categoryLabel(t, category)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--lp-soft-text)] hover:bg-white/[0.06] hover:text-[var(--lp-text)]"
            title={`${t("settings.backHome")} (Esc)`}
            aria-label={t("settings.backHome")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {category === "general" ? <GeneralPane /> : null}
          {category === "mcp" ? <McpPane /> : null}
          {category === "about" ? <AboutPane appVersion={appVersion} /> : null}
        </div>
      </main>
    </div>
  );
}

function categoryLabel(t: (k: string) => string, c: SettingsCategory): string {
  if (c === "general") return t("settings.general");
  if (c === "mcp") return t("settings.mcp");
  return t("settings.about");
}

function CategoryGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-2">
      <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--lp-soft-text)]/80">{label}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function CategoryItem({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: () => React.ReactElement; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition ${
        active ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-text)]/72 hover:bg-white/[0.04]"
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center opacity-80"><Icon /></span>
      <span>{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* MCP Servers pane                                                           */
/* -------------------------------------------------------------------------- */

function McpPane() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formInitial, setFormInitial] = useState<McpServerConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.listMcpServers) return;
    setLoading(true);
    try {
      const list = await api.listMcpServers();
      setServers(list);
      if (list.length === 0) setSelectedId(null);
      else if (!list.find((s) => s.id === selectedId)) setSelectedId(list[0].id);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.command.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q)
    );
  }, [servers, query]);

  const selected = selectedId ? servers.find((s) => s.id === selectedId) ?? null : null;

  const openCreate = () => { setFormInitial(null); setShowForm(true); };
  const openEdit = (s: McpServerConfig) => { setFormInitial(s); setShowForm(true); };

  const onSave = async (input: Omit<McpServerConfig, "createdAt" | "updatedAt"> & { id?: string }) => {
    const api = window.electronAPI;
    if (!api?.saveMcpServer) return;
    const saved = await api.saveMcpServer(input);
    setShowForm(false);
    setFormInitial(null);
    await refresh();
    setSelectedId(saved.id);
  };

  const onDelete = async (id: string) => {
    const api = window.electronAPI;
    if (!api?.deleteMcpServer) return;
    if (!confirm(t("settings.mcpConfirmDelete"))) return;
    await api.deleteMcpServer(id);
    await refresh();
  };

  const onToggleEnabled = async (id: string, enabled: boolean) => {
    const api = window.electronAPI;
    if (!api?.setMcpServerEnabled) return;
    await api.setMcpServerEnabled(id, enabled);
    await refresh();
  };

  return (
    <div className="flex h-full">
      {/* List column */}
      <section className="flex w-[340px] shrink-0 flex-col border-r border-white/[0.06] bg-black/15 px-4 pb-4 pt-6">
        <div className="px-1">
          <h2 className="text-[17px] font-semibold tracking-tight">{t("settings.mcpTitle")}</h2>
          <p className="mt-1 text-[12px] leading-snug text-[var(--lp-soft-text)]">{t("settings.mcpSubtitle")}</p>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 focus-within:border-white/20">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--lp-soft-text)]"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-[var(--lp-soft-text)]"
              placeholder={t("settings.mcpSearchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-black/30 text-[15px] text-[var(--lp-text)] hover:bg-white/[0.06]"
            title={t("settings.mcpAdd")}
          >＋</button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto">
          {loading ? (
            <div className="px-1 py-2 text-[12px] text-[var(--lp-soft-text)]">{t("settings.loading")}</div>
          ) : filtered.length === 0 ? (
            <EmptyState onCreate={openCreate} />
          ) : (
            <ul className="flex flex-col gap-1">
              {filtered.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(s.id)}
                    className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
                      selectedId === s.id
                        ? "bg-white/[0.07] ring-1 ring-inset ring-white/10"
                        : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${s.enabled ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-zinc-600"}`} />
                    <span className="flex flex-1 min-w-0 flex-col">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-[var(--lp-text)]">{s.name}</span>
                        <span className="shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--lp-soft-text)]">{transportLabel(t, s.transport)}</span>
                      </span>
                      <span className="mt-0.5 truncate text-[11.5px] text-[var(--lp-soft-text)]">
                        {s.description || (s.transport === "stdio" ? s.command : s.url) || t("settings.mcpEmptyDesc")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Detail column */}
      <section className="flex flex-1 flex-col">
        {selected ? (
          <McpDetail
            server={selected}
            onEdit={() => openEdit(selected)}
            onDelete={() => void onDelete(selected.id)}
            onToggleEnabled={(en) => void onToggleEnabled(selected.id, en)}
          />
        ) : (
          <DetailEmpty hasAny={servers.length > 0} onCreate={openCreate} />
        )}
      </section>

      {/* Add / edit modal */}
      {showForm ? (
        <McpFormModal
          initial={formInitial ?? undefined}
          onClose={() => { setShowForm(false); setFormInitial(null); }}
          onSave={onSave}
        />
      ) : null}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-10 flex flex-col items-center justify-center px-6 text-center text-[12px] text-[var(--lp-soft-text)]">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-[var(--lp-text)]/70">
        <IconPlug />
      </div>
      <div className="mt-3.5 text-[13px] text-[var(--lp-text)]/85">{t("settings.mcpEmptyTitle")}</div>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.04] px-4 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.08]"
      >
        <span>＋</span><span>{t("settings.mcpAddBtn")}</span>
      </button>
    </div>
  );
}

/** Right-pane empty state when no server is selected. */
function DetailEmpty({ hasAny, onCreate }: { hasAny: boolean; onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-[var(--lp-text)]/60">
        <IconPlug />
      </div>
      <div className="mt-5 text-[15px] font-medium text-[var(--lp-text)]">
        {hasAny ? t("settings.mcpPick") : t("settings.mcpPickFirst")}
      </div>
      <p className="mt-2 max-w-[420px] text-[12.5px] leading-relaxed text-[var(--lp-soft-text)]">
        {t("settings.mcpSubtitle")}
      </p>
      {!hasAny ? (
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-[13px] font-medium text-[#151515] hover:bg-white/95"
        >
          <span>＋</span><span>{t("settings.mcpAddBtn")}</span>
        </button>
      ) : null}
    </div>
  );
}

function transportLabel(t: (k: string) => string, transport: McpTransport): string {
  if (transport === "stdio") return t("settings.mcpTransportStdio");
  if (transport === "sse") return t("settings.mcpTransportSse");
  return t("settings.mcpTransportHttp");
}

/* -------------------------------------------------------------------------- */
/* Server detail (right column when one is selected)                          */
/* -------------------------------------------------------------------------- */

function McpDetail({ server, onEdit, onDelete, onToggleEnabled }: {
  server: McpServerConfig;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult | null>(null);

  // Reset the test panel when the user picks a different server.
  useEffect(() => { setTestResult(null); }, [server.id]);

  const runTest = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.testMcpServer) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.testMcpServer(server);
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, latencyMs: 0, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }, [server]);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-7 py-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[20px] font-semibold">{server.name}</h2>
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-[var(--lp-soft-text)]">{transportLabel(t, server.transport)}</span>
          </div>
          {server.description ? (
            <p className="mt-1.5 max-w-[640px] text-[12.5px] text-[var(--lp-soft-text)]">{server.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--lp-soft-text)]">
            <span>{server.enabled ? t("settings.mcpEnabled") : t("settings.mcpDisabled")}</span>
            <span
              className={`relative inline-block h-5 w-9 rounded-full transition ${server.enabled ? "bg-emerald-500/70" : "bg-white/[0.08]"}`}
              onClick={() => onToggleEnabled(!server.enabled)}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${server.enabled ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </label>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-1.5 text-[12px] hover:bg-white/[0.06]"
          >{t("settings.mcpEdit")}</button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/20"
          >{t("settings.mcpDelete")}</button>
        </div>
      </div>

      {/* Connection details card */}
      <section className="mt-6 rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel-2)]/40 p-5">
        <h3 className="text-[13px] font-semibold text-[var(--lp-text)]">{t("settings.mcpConnection")}</h3>
        <dl className="mt-3 grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-[12.5px]">
          <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpTransport")}</dt>
          <dd>{transportLabel(t, server.transport)}</dd>
          {server.transport === "stdio" ? (
            <>
              <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpCommand")}</dt>
              <dd className="break-all font-mono text-[12px]">{server.command || <span className="text-[var(--lp-soft-text)]">—</span>}</dd>
              <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpArgs")}</dt>
              <dd className="break-all font-mono text-[12px]">{server.args.length > 0 ? server.args.join(" ") : <span className="text-[var(--lp-soft-text)]">—</span>}</dd>
              <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpEnv")}</dt>
              <dd className="font-mono text-[12px]">
                {Object.keys(server.env).length === 0 ? (
                  <span className="text-[var(--lp-soft-text)]">—</span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(server.env).map(([k, v]) => (
                      <span key={k}><span className="text-[var(--lp-text)]/70">{k}</span>=<span>{v}</span></span>
                    ))}
                  </div>
                )}
              </dd>
            </>
          ) : (
            <>
              <dt className="text-[var(--lp-soft-text)]">URL</dt>
              <dd className="break-all font-mono text-[12px]">{server.url || <span className="text-[var(--lp-soft-text)]">—</span>}</dd>
              <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpHeaders")}</dt>
              <dd className="font-mono text-[12px]">
                {Object.keys(server.headers).length === 0 ? (
                  <span className="text-[var(--lp-soft-text)]">—</span>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {Object.entries(server.headers).map(([k, v]) => (
                      <span key={k}><span className="text-[var(--lp-text)]/70">{k}</span>: <span>{maskSecret(k, v)}</span></span>
                    ))}
                  </div>
                )}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* Connectivity test card */}
      <section className="mt-5 rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel-2)]/40 p-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-[var(--lp-text)]">{t("settings.mcpTestTitle")}</h3>
            <p className="mt-0.5 text-[11.5px] text-[var(--lp-soft-text)]">{t("settings.mcpTestSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-1.5 text-[12px] text-[var(--lp-text)] hover:bg-white/[0.08] disabled:opacity-50"
          >
            {testing ? (
              <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            )}
            <span>{testing ? t("settings.mcpTesting") : t("settings.mcpTestBtn")}</span>
          </button>
        </div>

        {testResult ? (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-[12.5px] ${testResult.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-red-500/40 bg-red-500/10"}`}>
            <div className="flex items-center gap-2 font-medium">
              <span className={`inline-block h-2 w-2 rounded-full ${testResult.ok ? "bg-emerald-400" : "bg-red-400"}`} />
              <span>{testResult.ok ? t("settings.mcpTestOk") : t("settings.mcpTestFail")}</span>
              <span className="text-[var(--lp-soft-text)]">· {testResult.latencyMs} ms</span>
            </div>
            {testResult.ok ? (
              <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-4 gap-y-1.5 text-[12px]">
                <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpServerName")}</dt>
                <dd>{testResult.serverInfo?.name || "—"}</dd>
                <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpServerVersion")}</dt>
                <dd>{testResult.serverInfo?.version || "—"}</dd>
                <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpProtocolVersion")}</dt>
                <dd>{testResult.serverInfo?.protocolVersion || "—"}</dd>
                <dt className="text-[var(--lp-soft-text)]">{t("settings.mcpCapabilities")}</dt>
                <dd>{testResult.capabilities && testResult.capabilities.length > 0
                  ? testResult.capabilities.join(", ")
                  : t("settings.mcpNoCapabilities")}</dd>
              </dl>
            ) : (
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11.5px] text-red-200">{testResult.message}</pre>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function maskSecret(headerName: string, value: string): string {
  // Avoid leaking bearer tokens / api keys in the UI by masking values for
  // header names that strongly hint at auth.
  const lower = headerName.toLowerCase();
  if (lower.includes("authorization") || lower.includes("api-key") || lower.includes("token")) {
    if (value.length <= 8) return "•".repeat(value.length);
    return value.slice(0, 4) + "…" + "•".repeat(Math.min(6, value.length - 8)) + value.slice(-4);
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Add / edit form (modal)                                                    */
/* -------------------------------------------------------------------------- */

function McpFormModal({ initial, onClose, onSave }: {
  initial?: McpServerConfig;
  onClose: () => void;
  onSave: (input: Omit<McpServerConfig, "createdAt" | "updatedAt"> & { id?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? "stdio");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [command, setCommand] = useState(initial?.command ?? "");
  const [argsText, setArgsText] = useState((initial?.args ?? []).join(" "));
  const [envPairs, setEnvPairs] = useState<Array<{ k: string; v: string }>>(
    initial ? Object.entries(initial.env).map(([k, v]) => ({ k, v })) : []
  );
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headerPairs, setHeaderPairs] = useState<Array<{ k: string; v: string }>>(
    initial ? Object.entries(initial.headers).map(([k, v]) => ({ k, v })) : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && (
    transport === "stdio" ? command.trim().length > 0 : url.trim().length > 0
  );

  const submit = async () => {
    if (!canSave || saving) return;
    setError(null);
    setSaving(true);
    try {
      const env: Record<string, string> = {};
      for (const p of envPairs) { if (p.k.trim()) env[p.k.trim()] = p.v; }
      const headers: Record<string, string> = {};
      for (const p of headerPairs) { if (p.k.trim()) headers[p.k.trim()] = p.v; }
      // Argument parsing: a thin shell-like splitter — quoted segments are
      // preserved as single args. Sufficient for typical MCP commands like
      // `npx -y @modelcontextprotocol/server-filesystem /tmp/data`.
      const args = parseArgs(argsText);
      await onSave({
        id: initial?.id,
        name: name.trim(),
        description: description.trim(),
        transport,
        enabled,
        command: command.trim(),
        args,
        env,
        url: url.trim(),
        headers
      });
    } catch (e) {
      setError((e as Error).message || t("modelConfig.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-white/[0.1] text-[var(--lp-text)] shadow-[0_24px_64px_rgba(0,0,0,0.55)]"
        style={{ backgroundColor: "#141416" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--lp-border)] px-6 py-4">
          <h3 className="text-[15px] font-semibold">{editing ? t("settings.mcpFormEditTitle") : t("settings.mcpFormCreateTitle")}</h3>
          <button type="button" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Field label={t("settings.mcpFormName")} required>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.mcpFormNamePh")}
              className="w-full rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-2 text-[13px] outline-none focus:border-white/30"
            />
          </Field>
          <Field label={t("settings.mcpFormDesc")}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("settings.mcpFormDescPh")}
              className="w-full rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-2 text-[13px] outline-none focus:border-white/30"
            />
          </Field>
          <Field label={t("settings.mcpFormTransport")} required>
            <div className="flex gap-2">
              {(["stdio", "sse", "http"] as McpTransport[]).map((tp) => (
                <button
                  key={tp}
                  type="button"
                  onClick={() => setTransport(tp)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-[12.5px] transition ${
                    transport === tp
                      ? "border-white/40 bg-white/[0.08]"
                      : "border-[var(--lp-border)] bg-[var(--lp-panel-2)] text-[var(--lp-soft-text)] hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="font-medium text-[var(--lp-text)]">{transportLabel(t, tp)}</div>
                  <div className="mt-0.5 text-[10.5px] text-[var(--lp-soft-text)]">{transportHint(t, tp)}</div>
                </button>
              ))}
            </div>
          </Field>

          {transport === "stdio" ? (
            <>
              <Field label={t("settings.mcpFormCommand")} required hint={t("settings.mcpFormCommandHint")}>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className="w-full rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-2 font-mono text-[13px] outline-none focus:border-white/30"
                />
              </Field>
              <Field label={t("settings.mcpFormArgs")} hint={t("settings.mcpFormArgsHint")}>
                <input
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  className="w-full rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-2 font-mono text-[13px] outline-none focus:border-white/30"
                />
              </Field>
              <Field label={t("settings.mcpFormEnv")} hint={t("settings.mcpFormEnvHint")}>
                <KvEditor pairs={envPairs} onChange={setEnvPairs} keyPh="API_KEY" valPh="sk-..." />
              </Field>
            </>
          ) : (
            <>
              <Field label="URL" required hint={transport === "sse" ? t("settings.mcpFormUrlSseHint") : t("settings.mcpFormUrlHttpHint")}>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={transport === "sse" ? "https://example.com/mcp/sse" : "https://example.com/mcp"}
                  className="w-full rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-3 py-2 font-mono text-[13px] outline-none focus:border-white/30"
                />
              </Field>
              <Field label={t("settings.mcpFormHeaders")} hint={t("settings.mcpFormHeadersHint")}>
                <KvEditor pairs={headerPairs} onChange={setHeaderPairs} keyPh="Authorization" valPh="Bearer ..." />
              </Field>
            </>
          )}

          <Field label={t("settings.mcpFormEnabledLabel")}>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <span
                className={`relative inline-block h-5 w-9 rounded-full transition ${enabled ? "bg-emerald-500/70" : "bg-white/[0.08]"}`}
                onClick={() => setEnabled((v) => !v)}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${enabled ? "left-[18px]" : "left-0.5"}`} />
              </span>
              <span className="text-[var(--lp-soft-text)]">{enabled ? t("settings.mcpEnabled") : t("settings.mcpDisabled")}</span>
            </label>
          </Field>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--lp-border)] px-6 py-4">
          <div className="min-w-0 text-[12px] text-red-300">{error}</div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-4 py-1.5 text-[12.5px] hover:bg-white/[0.06]"
            >{t("settings.mcpFormCancel")}</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSave || saving}
              className="rounded-lg bg-white px-4 py-1.5 text-[12.5px] font-medium text-[#151515] disabled:cursor-not-allowed disabled:opacity-50"
            >{saving ? t("settings.mcpSaving") : t("settings.mcpFormSave")}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function transportHint(t: (k: string) => string, tp: McpTransport): string {
  if (tp === "stdio") return t("settings.mcpTransportStdioHint");
  if (tp === "sse") return t("settings.mcpTransportSseHint");
  return t("settings.mcpTransportHttpHint");
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <label className="mb-1.5 flex items-center gap-1 text-[12px] text-[var(--lp-soft-text)]">
        <span>{label}</span>
        {required ? <span className="text-red-400">*</span> : null}
      </label>
      {children}
      {hint ? <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]/80">{hint}</div> : null}
    </div>
  );
}

function KvEditor({ pairs, onChange, keyPh, valPh }: {
  pairs: Array<{ k: string; v: string }>;
  onChange: (next: Array<{ k: string; v: string }>) => void;
  keyPh: string;
  valPh: string;
}) {
  const { t } = useTranslation();
  const update = (idx: number, patch: Partial<{ k: string; v: string }>) => {
    onChange(pairs.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const add = () => onChange([...pairs, { k: "", v: "" }]);
  const remove = (idx: number) => onChange(pairs.filter((_, i) => i !== idx));
  return (
    <div className="flex flex-col gap-1.5">
      {pairs.length === 0 ? (
        <div className="text-[11.5px] text-[var(--lp-soft-text)]/80">{t("settings.mcpKvEmpty")}</div>
      ) : (
        pairs.map((p, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              value={p.k}
              onChange={(e) => update(idx, { k: e.target.value })}
              placeholder={keyPh}
              className="w-[40%] rounded-md border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-white/30"
            />
            <span className="text-[var(--lp-soft-text)]">=</span>
            <input
              value={p.v}
              onChange={(e) => update(idx, { v: e.target.value })}
              placeholder={valPh}
              className="flex-1 rounded-md border border-[var(--lp-border)] bg-[var(--lp-panel-2)] px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-white/30"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--lp-soft-text)] hover:bg-red-500/10 hover:text-red-400"
              title={t("settings.mcpKvRemove")}
            >×</button>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-md border border-dashed border-[var(--lp-border)] bg-transparent px-2.5 py-1 text-[11.5px] text-[var(--lp-soft-text)] hover:bg-white/[0.04]"
      >＋ {t("settings.mcpKvAdd")}</button>
    </div>
  );
}

/** Light-weight shell-style arg splitter: respects double quotes. */
function parseArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/* -------------------------------------------------------------------------- */
/* General + About panes                                                      */
/* -------------------------------------------------------------------------- */

function GeneralPane() {
  const { t } = useTranslation();
  return (
    <div className="px-7 py-6 text-[13px] text-[var(--lp-soft-text)]">
      <h2 className="text-[16px] font-semibold text-[var(--lp-text)]">{t("settings.general")}</h2>
      <p className="mt-2 max-w-[620px]">{t("settings.generalDesc")}</p>
      <div className="mt-6 rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel-2)]/40 p-5 text-[12.5px]">
        {t("settings.generalHint")}
      </div>
    </div>
  );
}

function AboutPane({ appVersion }: { appVersion?: string }) {
  const { t } = useTranslation();
  return (
    <div className="px-7 py-6">
      <h2 className="text-[16px] font-semibold text-[var(--lp-text)]">{t("settings.about")}</h2>
      <div className="mt-4 rounded-xl border border-[var(--lp-border)] bg-[var(--lp-panel-2)]/40 p-5 text-[13px]">
        <div className="text-[15px] font-semibold">Little Peanut</div>
        <div className="mt-1 text-[12px] text-[var(--lp-soft-text)]">{appVersion ? `v${appVersion}` : "—"}</div>
        <p className="mt-3 max-w-[640px] text-[12.5px] text-[var(--lp-soft-text)]">{t("settings.aboutBlurb")}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Inline icons                                                               */
/* -------------------------------------------------------------------------- */

function IconGear() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
  );
}

function IconPlug() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v3a6 6 0 1 1-12 0V8z"/><path d="M12 17v4"/></svg>
  );
}

function IconInfo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
  );
}

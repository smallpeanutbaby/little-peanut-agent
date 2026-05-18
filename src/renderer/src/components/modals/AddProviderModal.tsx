import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PROTOCOL_OPTIONS, type CustomProvider } from "../../constants/providers";

/**
 * Form for adding a user-defined OpenAI-compatible / Anthropic / etc. provider.
 * Persists nothing on its own — emits the resulting `CustomProvider` to the
 * caller, which is responsible for `saveProviderConfig` via IPC.
 */
export function AddProviderModal({ onClose, onAdd }: { onClose: () => void; onAdd: (p: CustomProvider) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [protocol, setProtocol] = useState(PROTOCOL_OPTIONS[0].id);
  const [baseUrl, setBaseUrl] = useState("");

  function handleAdd() {
    if (!name.trim()) return;
    onAdd({
      id: `custom-${Date.now()}`,
      name: name.trim(),
      protocol,
      baseUrl: baseUrl.trim()
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold text-[var(--lp-text)]">
              {t("addProvider.title")}
            </div>
            <div className="mt-1 text-[13px] text-[var(--lp-muted)]">
              {t("addProvider.subtitle")}
            </div>
          </div>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-soft-text)] hover:bg-white/[0.06]"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="mt-6">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addProvider.name")}</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder={t("addProvider.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addProvider.protocol")}</div>
          <div className="relative mt-2">
            <select
              className="w-full appearance-none rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 pr-9 text-[13px] text-[var(--lp-text)] outline-none"
              style={{ colorScheme: "dark" }}
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
            >
              {PROTOCOL_OPTIONS.map((opt) => (
                <option
                  key={opt.id}
                  value={opt.id}
                  style={{ backgroundColor: "#1a1a1a", color: "rgba(255,255,255,0.92)" }}
                >
                  {opt.label}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--lp-soft-text)]"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 4.5L6 8L9.5 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">
            {t("addProvider.protocolHint")}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-[14px] font-medium text-[var(--lp-text)]">{t("addProvider.baseUrl")}</div>
          <input
            className="mt-2 w-full rounded-lg border border-[var(--lp-border)] bg-transparent px-3 py-2.5 text-[13px] text-[var(--lp-text)] outline-none placeholder:text-[var(--lp-soft-text)]"
            placeholder="https://api.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <div className="mt-1 text-[11px] text-[var(--lp-soft-text)]">{t("addProvider.baseUrlHint")}</div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-lg border border-[var(--lp-border)] px-4 py-2.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.04]"
            onClick={onClose}
            type="button"
          >
            {t("addProvider.cancel")}
          </button>
          <button
            className="rounded-lg bg-white px-5 py-2.5 text-[13px] font-medium text-[#151515] disabled:opacity-40"
            onClick={handleAdd}
            disabled={!name.trim()}
            type="button"
          >
            {t("addProvider.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

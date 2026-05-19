import { useTranslation } from "react-i18next";

/**
 * "Add to conversation" popover with quick-action shortcuts (images, commands,
 * skills, MCP). Rendered above the chat input and dismisses on any selection.
 */
export function ModeMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  if (!open) return null;

  const items = [t("modeMenu.addPhotos"), t("modeMenu.commands"), t("modeMenu.skills"), t("modeMenu.mcpServers")];

  return (
    <div className="absolute bottom-24 left-0 z-30 w-[360px] rounded-[24px] border border-[var(--lp-border)] bg-[var(--lp-main-bg)] py-3 shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
      <div className="px-5 pb-3 text-[14px] font-medium text-[var(--lp-text)]">{t("modeMenu.title")}</div>
      {items.map((item, index) => (
        <button
          key={item}
          className={`flex w-full items-center justify-between px-5 py-4 text-left text-[15px] text-[var(--lp-text)]/88 hover:bg-white/[0.05] ${
            index !== 0 ? "border-t border-white/6" : ""
          }`}
          onClick={onClose}
          type="button"
        >
          <span>{item}</span>
          <span className="text-[var(--lp-soft-text)]">▾</span>
        </button>
      ))}
    </div>
  );
}

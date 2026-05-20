import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

/** Distance from the bottom (px) still counts as "following" the stream. */
const NEAR_BOTTOM_PX = 120;

/**
 * Chat-style auto-scroll: only pin to bottom while the user is already
 * near the bottom. Scrolling up (or expanding a tall block that pushes
 * the viewport away from the bottom) disables follow until the user
 * returns to the bottom or taps the jump button.
 */
export function useStickToBottomScroll(
  resetKey: string | undefined,
  /** Re-run follow when message/stream content changes. */
  followDeps: DependencyList
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const syncStick = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    const nearBottom = distance <= NEAR_BOTTOM_PX;
    stickRef.current = nearBottom;
    setShowJumpButton(!nearBottom && el.scrollHeight > el.clientHeight + 80);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJumpButton(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // New conversation → follow stream again.
  useEffect(() => {
    stickRef.current = true;
    setShowJumpButton(false);
  }, [resetKey]);

  // Track manual scroll + layout changes (expand/collapse tool groups).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => syncStick();

    const ro = new ResizeObserver(() => {
      syncStick();
      if (stickRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [resetKey, syncStick]);

  // Follow new messages / stream tokens only when pinned.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      if (stickRef.current && containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, followDeps);

  return { containerRef, showJumpButton, scrollToBottom };
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// A rich hover card for rows inside scrolling lists and overflow-hidden cards.
// It renders into <body> with fixed positioning so nothing clips it, opens
// beside the row (flipping sides near the viewport edge), stays open while the
// pointer moves into it, and also opens on keyboard focus.

const GAP = 12;
const EDGE = 12;

interface HoverPanelProps {
  children: ReactNode; // the row
  content: () => ReactNode; // built lazily, only while open
  width?: number;
  onOpen?: () => void;
  className?: string;
}

export function HoverPanel({ children, content, width = 360, onOpen, className }: HoverPanelProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ top: number; left: number; anchorBottom: number } | null>(null);

  function place() {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    let left = r.right + GAP;
    if (left + width > vw - EDGE) left = r.left - width - GAP;
    // No room on either side (narrow screens): drop below the row instead.
    if (left < EDGE) {
      setPos({ top: r.bottom + 8, left: Math.min(Math.max(EDGE, r.left), vw - width - EDGE), anchorBottom: r.bottom });
      return;
    }
    setPos({ top: r.top - 8, left, anchorBottom: r.bottom });
  }

  function open() {
    window.clearTimeout(closeTimer.current);
    if (pos) return;
    openTimer.current = window.setTimeout(() => {
      place();
      onOpen?.();
    }, 140);
  }

  function close() {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), 120);
  }

  // Keep the panel inside the viewport vertically, including when its content
  // grows after opening (e.g. suggestions that load in).
  const isOpen = !!pos;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!isOpen || !panel) return;
    const clamp = () => {
      const maxTop = window.innerHeight - panel.offsetHeight - EDGE;
      setPos((p) => (p && p.top > maxTop ? { ...p, top: Math.max(EDGE, maxTop) } : p));
    };
    clamp();
    const observer = new ResizeObserver(clamp);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isOpen]);

  // Fixed panels don't follow scrolling, so close instead of floating off the row.
  useEffect(() => {
    if (!pos) return;
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setPos(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [pos]);

  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  return (
    <>
      <div
        ref={anchorRef}
        tabIndex={0}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        className={`outline-none focus-visible:ring-2 focus-visible:ring-[#0CA4C3]/40 rounded-lg ${pos ? "bg-[#001A2E]/[0.035]" : ""} ${className || ""}`}
      >
        {children}
      </div>
      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="tooltip"
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={close}
            style={{ position: "fixed", top: pos.top, left: pos.left, width }}
            className="z-[100] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-white p-4 text-[14px] text-foreground shadow-[0_12px_40px_rgba(0,26,46,0.16),0_2px_6px_rgba(0,26,46,0.06)] animate-in fade-in-0 zoom-in-95 duration-100"
          >
            {content()}
          </div>,
          document.body
        )}
    </>
  );
}

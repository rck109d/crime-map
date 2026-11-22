import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export type Snap = "peek" | "half" | "full";
export const sheetSnap = signal<Snap>("peek");
const ORDER: Snap[] = ["peek", "half", "full"];
export const WIDE = "(min-width: 880px)";

interface Props {
  head: ComponentChildren;
  children: ComponentChildren;
  /** Space to leave above the sheet when fully open. */
  topInset: number;
}

/**
 * On phones: a bottom sheet with three resting heights, dragged by its header.
 * On wide screens the same markup is laid out as a static side panel (see CSS).
 */
export function Sheet({ head, children, topInset }: Props) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [, relayout] = useState(0);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => {
    const bump = () => relayout((n) => n + 1);
    const observer = new ResizeObserver(bump);
    observer.observe(headRef.current!);
    addEventListener("resize", bump);
    return () => {
      observer.disconnect();
      removeEventListener("resize", bump);
    };
  }, []);

  const viewport = typeof innerHeight === "number" ? innerHeight : 800;
  const heights: Record<Snap, number> = {
    peek: headRef.current?.offsetHeight ?? 150,
    half: Math.round(viewport * 0.56),
    full: Math.max(240, viewport - topInset - 6),
  };
  const height = dragHeight ?? heights[sheetSnap.value];

  // Start each visit to a taller state at the top of its content.
  useEffect(() => {
    if (sheetSnap.value === "peek") bodyRef.current?.scrollTo(0, 0);
  }, [sheetSnap.value]);

  // The whole header drags the sheet, including its buttons: a press only
  // becomes a drag once it has moved, and a drag swallows the click that follows.
  const onPointerDown = (e: PointerEvent) => {
    if (matchMedia(WIDE).matches || !e.isPrimary) return;
    drag.current = { y: e.clientY, h: height, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (!d.moved && Math.abs(dy) > 6) {
      d.moved = true;
      headRef.current!.setPointerCapture(e.pointerId);
    }
    if (d.moved) setDragHeight(Math.min(heights.full, Math.max(heights.peek, d.h + dy)));
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    setDragHeight(null);
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    const dy = d.y - e.clientY;
    const current = ORDER.indexOf(sheetSnap.value);
    const target = Math.min(heights.full, Math.max(heights.peek, d.h + dy));
    let next = ORDER.reduce((best, s) => (Math.abs(heights[s] - target) < Math.abs(heights[best] - target) ? s : best));
    // A deliberate flick moves at least one step even if it ends nearer where it began.
    if (next === sheetSnap.value && Math.abs(dy) > 48) {
      next = ORDER[Math.min(2, Math.max(0, current + Math.sign(dy)))];
    }
    sheetSnap.value = next;
  };

  return (
    <section
      class={`sheet sheet-${sheetSnap.value} ${dragHeight !== null ? "sheet-dragging" : ""}`}
      style={{ "--sheet-height": `${height}px` }}
      aria-label="Summary"
    >
      <div
        class="sheet-head"
        ref={headRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <button
          class="sheet-handle"
          aria-label={sheetSnap.value === "full" ? "Collapse panel" : "Expand panel"}
          onClick={() => (sheetSnap.value = ORDER[(ORDER.indexOf(sheetSnap.value) + 1) % 3])}
        >
          <span />
        </button>
        {head}
      </div>
      <div class="sheet-body" ref={bodyRef}>
        {children}
      </div>
    </section>
  );
}

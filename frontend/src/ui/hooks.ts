import { useEffect, useState } from "preact/hooks";

/**
 * Width of an element, tracked as it resizes. Returns a callback ref, so it
 * works even when the element only mounts after data has loaded.
 */
export function useWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    setWidth(Math.round(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

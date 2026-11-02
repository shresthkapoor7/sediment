/**
 * Runs `callback` once the page has finished loading and the browser is idle, so background work
 * never competes with what the visitor is looking at. Returns a function that cancels it.
 */
export function whenIdle(callback: () => void, timeout = 1500): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const run = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === "function") {
      handle = window.requestIdleCallback(() => { if (!cancelled) callback(); }, { timeout });
    } else {
      handle = window.setTimeout(() => { if (!cancelled) callback(); }, 200);
    }
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", run);
    if (handle === undefined) return;
    if (typeof window.cancelIdleCallback === "function" && typeof window.requestIdleCallback === "function") window.cancelIdleCallback(handle);
    else window.clearTimeout(handle);
  };
}

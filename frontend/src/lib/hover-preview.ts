"use client";

import { useCallback, useEffect, useState } from "react";

export const TIMELINE_MOBILE_BREAKPOINT_PX = 640;

const HOVER_PREVIEW_STORAGE_KEY = "sediment:hover-preview-enabled";

interface UseHoverPreviewToggleOptions {
  defaultEnabled?: boolean;
  persist?: boolean;
  storageKey?: string;
}

export function useHoverPreviewToggle({
  defaultEnabled = true,
  persist = true,
  storageKey = HOVER_PREVIEW_STORAGE_KEY,
}: UseHoverPreviewToggleOptions = {}) {
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(defaultEnabled);

  useEffect(() => {
    if (!persist) return;

    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue === null) return;

    setHoverPreviewEnabled(storedValue === "true");
  }, [persist, storageKey]);

  useEffect(() => {
    if (!persist) return;
    window.localStorage.setItem(storageKey, String(hoverPreviewEnabled));
  }, [hoverPreviewEnabled, persist, storageKey]);

  const onToggleHoverPreview = useCallback(() => {
    setHoverPreviewEnabled((value) => !value);
  }, []);

  return {
    hoverPreviewEnabled,
    setHoverPreviewEnabled,
    onToggleHoverPreview,
  };
}

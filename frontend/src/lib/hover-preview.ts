"use client";

import { useCallback, useEffect, useState } from "react";

export const TIMELINE_MOBILE_BREAKPOINT_PX = 640;

const HOVER_PREVIEW_STORAGE_KEY = "sediment:hover-preview-enabled";

interface UseHoverPreviewToggleOptions {
  defaultEnabled?: boolean;
  persist?: boolean;
  storageKey?: string;
}

/**
 * Manages the enabled state and persistence of hover previews.
 *
 * @param defaultEnabled - Initial hover-preview state when no persisted preference exists
 * @param persist - Whether to read and write the preference in local storage
 * @param storageKey - Local-storage key used for the preference
 * @returns The current state, its setter, and a callback that toggles the state
 */
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

    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate the persisted toggle preference.
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

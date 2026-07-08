import type { ViewMode } from "./store";

const VIEW_MODE_KEY = "diffit:view-mode";

function isViewMode(value: string | null): value is ViewMode {
  return value === "file" || value === "code";
}

export function getStoredViewMode(): ViewMode | null {
  try {
    const value = window.localStorage.getItem(VIEW_MODE_KEY);
    return isViewMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeViewMode(viewMode: ViewMode) {
  try {
    window.localStorage.setItem(VIEW_MODE_KEY, viewMode);
  } catch {
    // Losing persistence should not block changing the active view.
  }
}

import type { ViewMode } from "./store";

const VIEW_MODE_KEY = "diffit:view-mode";
const SIDEBAR_WIDTH_KEY = "diffit:sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "diffit:sidebar-collapsed";

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 300;

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

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return SIDEBAR_DEFAULT_WIDTH;
  }

  return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

export function getStoredSidebarWidth(): number | null {
  try {
    const value = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (value === null || value.trim() === "") {
      return null;
    }

    const width = Number(value);
    return Number.isFinite(width) ? clampSidebarWidth(width) : null;
  } catch {
    return null;
  }
}

export function storeSidebarWidth(width: number) {
  try {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // Losing persistence should not block resizing the sidebar.
  }
}

export function getStoredSidebarCollapsed(): boolean | null {
  try {
    const value = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (value === "true") {
      return true;
    }
    return value === "false" ? false : null;
  } catch {
    return null;
  }
}

export function storeSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Losing persistence should not block collapsing the sidebar.
  }
}

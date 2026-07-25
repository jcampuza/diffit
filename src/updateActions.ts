import { invoke } from "@tauri-apps/api/core";
import { appActions } from "./store";
import type { UpdateStatus } from "./types";
import { listenToThisWindow } from "./utils/events";

/**
 * The backend owns the check, so a window only asks and renders the answer. The
 * `force` flag separates the automatic check on launch, which the backend runs once
 * per process no matter how many windows are open, from the menu item, which always
 * re-checks.
 */
export async function checkForUpdate(options: { force?: boolean } = {}) {
  try {
    appActions.setUpdateStatus(await invoke<UpdateStatus>("check_for_update", { force: options.force ?? false }));
  } catch (checkError) {
    appActions.setUpdateStatus({ state: "failed", message: String(checkError || "Could not check for updates.") });
  }
}

export async function installUpdate() {
  try {
    appActions.setUpdateStatus(await invoke<UpdateStatus>("install_update"));
  } catch (installError) {
    appActions.setUpdateStatus({ state: "failed", message: String(installError || "Could not install the update.") });
  }
}

/** Catches up a window that opened after the process had already checked. */
export async function loadUpdateStatus() {
  try {
    appActions.setUpdateStatus(await invoke<UpdateStatus>("update_status"));
  } catch {
    // A window with no status yet simply shows nothing.
  }
}

// The update belongs to the process rather than to one repository, so the backend
// broadcasts it and every window's listener sees it, keeping the banners in step.
export async function listenForUpdateStatus() {
  return listenToThisWindow<UpdateStatus>("update-status", (event) => {
    appActions.setUpdateStatus(event.payload);
  });
}

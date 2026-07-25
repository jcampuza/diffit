import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { EventCallback } from "@tauri-apps/api/event";

// `listen` from `@tauri-apps/api/event` registers with the `Any` target, and
// Tauri delivers every event to those listeners regardless of the label the
// backend emitted to. Each window owns one repository, so listeners have to be
// scoped to the current window or every window reacts to every other one.
export function listenToThisWindow<T>(event: string, handler: EventCallback<T>) {
  return getCurrentWebviewWindow().listen<T>(event, handler);
}

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { loadAnnotations } from "./annotationActions";
import { appActions, appStore } from "./store";
import type { RepositoryChanged, RepositoryDiff, TerminalInstallResult } from "./types";
import { repositorySignature } from "./utils/repository";

let currentRepositorySignature: string | null = null;

export function applyRepository(repository: RepositoryDiff) {
  const nextSignature = repositorySignature(repository);
  if (nextSignature === currentRepositorySignature) {
    return;
  }

  currentRepositorySignature = nextSignature;
  appActions.setRepository(repository);
}

export async function loadRepository(cwd?: string, options?: { silent?: boolean }) {
  const hasRepository = appStore.state.repository != null;
  appActions.startRepositoryLoad({ hasRepository, silent: options?.silent });

  try {
    const result = await invoke<RepositoryDiff>("load_repository", { cwd });
    applyRepository(result);
    await loadAnnotations(result.repoRoot);
  } catch (loadError) {
    const message = String(loadError || "Could not load this repository.");
    if (!hasRepository) {
      currentRepositorySignature = null;
      appActions.clearRepository(message);
    } else if (!options?.silent) {
      appActions.setRefreshError(message);
    }
  } finally {
    appActions.finishRepositoryLoad();
  }
}

export async function openRepositoryFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Git Repository",
  });

  if (typeof selected === "string") {
    await loadRepository(selected, { silent: false });
  }
}

export async function installCli() {
  appActions.setCliInstallState("installing");

  try {
    const result = await invoke<TerminalInstallResult>("install_terminal_helper");
    appActions.setCliInstallState(
      "installed",
      result.directoryInPath
        ? `Installed ${result.path}`
        : `Installed ${result.path}. Add ${result.directory} to PATH.`,
    );
  } catch (installError) {
    appActions.setCliInstallState("error", String(installError || "Could not install the CLI helper."));
  }
}

export async function listenForRepositoryChanges() {
  return listen<RepositoryChanged>("repository-changed", (event) => {
    // Background FS updates should not flash the header "Refreshing" indicator.
    void loadRepository(event.payload.cwd, { silent: true });
  });
}

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { loadAnnotations } from "./annotationActions";
import { appActions, appStore } from "./store";
import type { CommitSummary, RepositoryChanged, RepositoryDiff, TerminalInstallResult } from "./types";
import { listenToThisWindow } from "./utils/events";
import { repositorySignature } from "./utils/repository";

const COMMIT_PAGE_SIZE = 50;

let currentRepositorySignature: string | null = null;
// Loads race: the FS watcher, window focus and the commit picker all start one.
// Only the newest request may write to the store.
let repositoryLoadGeneration = 0;
let commitsLoadGeneration = 0;
let requestedCommitLimit = 0;

export function applyRepository(repository: RepositoryDiff) {
  const nextSignature = repositorySignature(repository);
  if (nextSignature === currentRepositorySignature) {
    return;
  }

  currentRepositorySignature = nextSignature;
  appActions.setRepository(repository);
}

export async function loadRepository(cwd?: string, options?: { silent?: boolean; revision?: string | null }) {
  const generation = ++repositoryLoadGeneration;
  const isCurrent = () => generation === repositoryLoadGeneration;
  // Refresh paths (the repository-changed event, window focus, Cmd-R) call this
  // without a `revision`, so it falls back to the selected one and those
  // refreshes stay on whatever commit is being viewed.
  const revision = options && "revision" in options ? options.revision ?? null : appStore.state.revision;
  appActions.startRepositoryLoad({ hasRepository: appStore.state.repository != null, silent: options?.silent });

  try {
    const result = await invoke<RepositoryDiff>("load_repository", { cwd, revision });
    if (!isCurrent()) {
      return;
    }

    appActions.setRevision(revision);
    applyRepository(result);
    await loadAnnotations(result.repoRoot, { shouldApply: isCurrent });
  } catch (loadError) {
    if (!isCurrent()) {
      return;
    }

    const message = String(loadError || "Could not load this repository.");
    // Whether the failure is destructive depends on what is on screen now, not on
    // what was on screen when this load started: a repository may have been opened
    // in between.
    if (appStore.state.repository == null) {
      currentRepositorySignature = null;
      appActions.clearRepository(message);
    } else if (!options?.silent) {
      appActions.setRefreshError(message);
    }
  } finally {
    if (isCurrent()) {
      appActions.finishRepositoryLoad();
    }
  }
}

// Each window owns a repository: `load_repository` without a `cwd` resolves this
// window's directory from the backend window registry, rather than the process
// directory, which only matches the window opened by the first `diffit` invocation.
export async function loadWindowRepository() {
  await loadRepository(undefined, { revision: null });
}

export async function selectRevision(revision: string | null) {
  await loadRepository(appStore.state.repository?.cwd, { silent: false, revision });
}

export async function loadCommits(limit = COMMIT_PAGE_SIZE) {
  const cwd = appStore.state.repository?.cwd;
  if (!cwd) {
    return;
  }

  const generation = ++commitsLoadGeneration;
  requestedCommitLimit = limit;
  appActions.startCommitsLoad();

  try {
    const commits = await invoke<CommitSummary[]>("list_commits", { cwd, limit });
    if (generation !== commitsLoadGeneration) {
      return;
    }

    appActions.setCommits(commits, commits.length < limit);
  } catch (listError) {
    if (generation !== commitsLoadGeneration) {
      return;
    }

    appActions.setCommitsError(String(listError || "Could not list commits."));
  }
}

export async function loadMoreCommits() {
  // Paging off the requested limit rather than the loaded count so a second
  // activation before the first page lands still asks for more.
  await loadCommits(Math.max(requestedCommitLimit, appStore.state.commits.length) + COMMIT_PAGE_SIZE);
}

export async function openRepositoryFolder() {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Git Repository",
  });

  if (typeof selected === "string") {
    await loadRepository(selected, { silent: false, revision: null });
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
  return listenToThisWindow<RepositoryChanged>("repository-changed", (event) => {
    // Background FS updates should not flash the header "Refreshing" indicator.
    void loadRepository(event.payload.cwd, { silent: true });
  });
}

// Re-running `diffit` in a repository that already has a window is a request for
// the working-tree diff, so it leaves any selected commit behind and shows the
// refresh rather than moving the view silently.
export async function listenForRepositoryOpened() {
  return listenToThisWindow<RepositoryChanged>("repository-opened", (event) => {
    void loadRepository(event.payload.cwd, { silent: false, revision: null });
  });
}

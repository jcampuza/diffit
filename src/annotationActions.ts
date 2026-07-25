import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appActions, appStore, type AnnotationDraft } from "./store";
import type { AnnotationStatus, AnnotationsState, RepositoryChanged, SkillInstallResult } from "./types";

function buildAgentPrompt(reviewPath: string) {
  return `Review comments were left on this repo's working-tree diff in \`${reviewPath}\` (Diffit review format, JSON). Read it. For each annotation with \`"status": "open"\`: open \`file\` at \`startLine\`–\`endLine\` (on the \`side\` indicated — \`"old"\` line numbers refer to the HEAD version), and address the \`comment\`. After addressing one, append to its \`replies\` array \`{ "author": "agent", "text": "<one-line summary of what you did>", "at": "<ISO timestamp>" }\` and set \`"status": "resolved"\`. If you deliberately decline one, reply with your reasoning and leave it \`"open"\`. Preserve every other field and any fields you don't recognize; keep the file valid JSON.`;
}

export async function copyAgentPrompt() {
  const reviewPath = appStore.state.reviewPath;
  if (!reviewPath) {
    return;
  }

  try {
    await navigator.clipboard.writeText(buildAgentPrompt(reviewPath));
  } catch (copyError) {
    console.error("Could not copy agent prompt:", copyError);
  }
}

export async function installAgentSkill() {
  appActions.setCliInstallState("installing");

  try {
    const result = await invoke<SkillInstallResult>("install_agent_skill");
    appActions.setCliInstallState("installed", `Installed ${result.path}`);
  } catch (installError) {
    appActions.setCliInstallState("error", String(installError || "Could not install the agent skill."));
  }
}

export async function loadAnnotations(cwd?: string, options?: { shouldApply?: () => boolean }) {
  const resolvedCwd = cwd ?? appStore.state.repository?.repoRoot;
  if (!resolvedCwd) {
    return;
  }

  try {
    const state = await invoke<AnnotationsState>("load_annotations", { cwd: resolvedCwd });
    if (options?.shouldApply && !options.shouldApply()) {
      return;
    }

    appActions.setAnnotations(state);
  } catch (loadError) {
    console.error("Could not load annotations:", loadError);
  }
}

export async function createAnnotation(draft: AnnotationDraft, comment: string) {
  const cwd = appStore.state.repository?.repoRoot;
  if (!cwd) {
    return;
  }

  try {
    const state = await invoke<AnnotationsState>("create_annotation", {
      cwd,
      file: draft.file,
      oldFile: draft.oldFile,
      side: draft.side,
      startLine: draft.startLine,
      endLine: draft.endLine,
      comment,
    });
    appActions.setAnnotations(state);
    appActions.setAnnotationDraft(null);
  } catch (createError) {
    console.error("Could not create annotation:", createError);
  }
}

export async function setAnnotationStatus(id: string, status: AnnotationStatus) {
  const cwd = appStore.state.repository?.repoRoot;
  if (!cwd) {
    return;
  }

  try {
    const state = await invoke<AnnotationsState>("update_annotation", { cwd, id, status });
    appActions.setAnnotations(state);
  } catch (updateError) {
    console.error("Could not update annotation:", updateError);
  }
}

export async function deleteAnnotation(id: string) {
  const cwd = appStore.state.repository?.repoRoot;
  if (!cwd) {
    return;
  }

  try {
    const state = await invoke<AnnotationsState>("delete_annotation", { cwd, id });
    appActions.setAnnotations(state);
  } catch (deleteError) {
    console.error("Could not delete annotation:", deleteError);
  }
}

export async function clearAnnotations(statuses?: AnnotationStatus[]) {
  const cwd = appStore.state.repository?.repoRoot;
  if (!cwd) {
    return;
  }

  try {
    const state = await invoke<AnnotationsState>("clear_annotations", { cwd, statuses });
    appActions.setAnnotations(state);
  } catch (clearError) {
    console.error("Could not clear annotations:", clearError);
  }
}

export async function listenForAnnotationChanges() {
  return listen<RepositoryChanged>("annotations-changed", (event) => {
    void loadAnnotations(event.payload.cwd);
  });
}

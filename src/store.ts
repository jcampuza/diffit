import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { getStoredViewMode, storeViewMode } from "./preferences";
import type {
  Annotation,
  AnnotationSide,
  AnnotationsState,
  CommitSummary,
  DiffFile,
  RepositoryDiff,
} from "./types";

export interface AnnotationDraft {
  file: string;
  oldFile?: string;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
}

export type ViewMode = "file" | "code";

export type CommitsStatus = "idle" | "loading" | "loaded" | "error";

export interface AppState {
  repository: RepositoryDiff | null;
  selectedPath: string | null;
  revision: string | null;
  commits: CommitSummary[];
  commitsStatus: CommitsStatus;
  commitsError: string | null;
  commitsComplete: boolean;
  viewMode: ViewMode;
  findOpen: boolean;
  findQuery: string;
  activeFindIndex: number;
  error: string | null;
  refreshError: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  commandOpen: boolean;
  cliInstallState: "idle" | "installing" | "installed" | "error";
  cliInstallMessage: string | null;
  fileTreeFocusRequest: number;
  annotations: Annotation[];
  reviewPath: string | null;
  annotationDraft: AnnotationDraft | null;
  annotationsPanelOpen: boolean;
  annotationJump: { file: string; side: AnnotationSide; line: number; nonce: number } | null;
}

const initialState: AppState = {
  repository: null,
  selectedPath: null,
  revision: null,
  commits: [],
  commitsStatus: "idle",
  commitsError: null,
  commitsComplete: false,
  viewMode: getStoredViewMode() ?? "file",
  findOpen: false,
  findQuery: "",
  activeFindIndex: 0,
  error: null,
  refreshError: null,
  isLoading: true,
  isRefreshing: false,
  commandOpen: false,
  cliInstallState: "idle",
  cliInstallMessage: null,
  fileTreeFocusRequest: 0,
  annotations: [],
  reviewPath: null,
  annotationDraft: null,
  annotationsPanelOpen: false,
  annotationJump: null,
};

export const appStore = createStore(initialState);

export function useAppSelector<TSelected>(
  selector: (state: AppState) => TSelected,
  options?: { compare?: (left: TSelected, right: TSelected) => boolean },
) {
  return useSelector(appStore, selector, options);
}

export function useShallowAppSelector<TSelected>(selector: (state: AppState) => TSelected) {
  return useAppSelector(selector, { compare: shallow });
}

export function getSelectedFile(state = appStore.state): DiffFile | null {
  return state.repository?.files.find((file) => file.path === state.selectedPath) ?? null;
}

export const appActions = {
  setRepository(repository: RepositoryDiff) {
    appStore.setState((state) => {
      const selectedPath =
        state.selectedPath && repository.files.some((file) => file.path === state.selectedPath)
          ? state.selectedPath
          : repository.files[0]?.path ?? null;
      const movedRepository = state.repository?.repoRoot !== repository.repoRoot;

      return {
        ...state,
        repository,
        selectedPath,
        commits: movedRepository ? [] : state.commits,
        commitsStatus: movedRepository ? "idle" : state.commitsStatus,
        commitsError: movedRepository ? null : state.commitsError,
        commitsComplete: movedRepository ? false : state.commitsComplete,
      };
    });
  },

  clearRepository(error: string | null = null) {
    appStore.setState((state) => ({
      ...state,
      repository: null,
      selectedPath: null,
      revision: null,
      commits: [],
      commitsStatus: "idle",
      commitsError: null,
      commitsComplete: false,
      annotations: [],
      reviewPath: null,
      annotationDraft: null,
      error,
    }));
  },

  setRevision(revision: string | null) {
    appStore.setState((state) => ({
      ...state,
      revision,
      annotationDraft: revision ? null : state.annotationDraft,
    }));
  },

  startCommitsLoad() {
    appStore.setState((state) => ({
      ...state,
      commitsStatus: "loading",
      commitsError: null,
    }));
  },

  setCommits(commits: CommitSummary[], commitsComplete: boolean) {
    appStore.setState((state) => ({
      ...state,
      commits,
      commitsComplete,
      commitsStatus: "loaded",
      commitsError: null,
    }));
  },

  setCommitsError(commitsError: string) {
    appStore.setState((state) => ({
      ...state,
      commitsStatus: "error",
      commitsError,
    }));
  },

  selectPath(path: string | null) {
    appStore.setState((state) => ({
      ...state,
      selectedPath: path,
    }));
  },

  setViewMode(viewMode: ViewMode) {
    storeViewMode(viewMode);
    appStore.setState((state) => ({
      ...state,
      viewMode,
      activeFindIndex: 0,
    }));
  },

  setFindOpen(findOpen: boolean) {
    appStore.setState((state) => ({
      ...state,
      findOpen,
    }));
  },

  setFindQuery(findQuery: string) {
    appStore.setState((state) => ({
      ...state,
      findQuery,
      activeFindIndex: 0,
    }));
  },

  setActiveFindIndex(activeFindIndex: number) {
    appStore.setState((state) => ({
      ...state,
      activeFindIndex,
    }));
  },

  setCommandOpen(commandOpen: boolean) {
    appStore.setState((state) => ({
      ...state,
      commandOpen,
    }));
  },

  toggleCommandOpen() {
    appStore.setState((state) => ({
      ...state,
      commandOpen: !state.commandOpen,
    }));
  },

  requestFileTreeFocus() {
    appStore.setState((state) => ({
      ...state,
      fileTreeFocusRequest: state.fileTreeFocusRequest + 1,
    }));
  },

  startRepositoryLoad(options: { silent?: boolean; hasRepository?: boolean } = {}) {
    appStore.setState((state) => {
      const hasRepository = options.hasRepository ?? state.repository != null;
      const useFullLoading = !options.silent && !hasRepository;

      return {
        ...state,
        isLoading: useFullLoading ? true : state.isLoading,
        isRefreshing: !options.silent && !useFullLoading ? true : state.isRefreshing,
        error: !options.silent ? null : state.error,
        refreshError: !options.silent ? null : state.refreshError,
      };
    });
  },

  finishRepositoryLoad() {
    appStore.setState((state) => ({
      ...state,
      isLoading: false,
      isRefreshing: false,
    }));
  },

  setRefreshError(refreshError: string | null) {
    appStore.setState((state) => ({
      ...state,
      refreshError,
    }));
  },

  setCliInstallState(cliInstallState: AppState["cliInstallState"], cliInstallMessage: string | null = null) {
    appStore.setState((state) => ({
      ...state,
      cliInstallState,
      cliInstallMessage,
    }));
  },

  setAnnotations({ annotations, reviewPath }: AnnotationsState) {
    appStore.setState((state) => ({
      ...state,
      annotations,
      reviewPath,
    }));
  },

  setAnnotationDraft(annotationDraft: AnnotationDraft | null) {
    appStore.setState((state) => ({
      ...state,
      annotationDraft,
    }));
  },

  setAnnotationsPanelOpen(annotationsPanelOpen: boolean) {
    appStore.setState((state) => ({
      ...state,
      annotationsPanelOpen,
    }));
  },

  toggleAnnotationsPanel() {
    appStore.setState((state) => ({
      ...state,
      annotationsPanelOpen: !state.annotationsPanelOpen,
    }));
  },

  requestAnnotationJump(file: string, side: AnnotationSide, line: number) {
    appStore.setState((state) => ({
      ...state,
      annotationJump: {
        file,
        side,
        line,
        nonce: (state.annotationJump?.nonce ?? 0) + 1,
      },
    }));
  },
};

import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { getStoredViewMode, storeViewMode } from "./preferences";
import type { DiffFile, RepositoryDiff } from "./types";

export type ViewMode = "file" | "code";

export interface AppState {
  repository: RepositoryDiff | null;
  selectedPath: string | null;
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
}

const initialState: AppState = {
  repository: null,
  selectedPath: null,
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

      return {
        ...state,
        repository,
        selectedPath,
      };
    });
  },

  clearRepository(error: string | null = null) {
    appStore.setState((state) => ({
      ...state,
      repository: null,
      selectedPath: null,
      error,
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
};

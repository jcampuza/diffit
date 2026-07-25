import { useEffect, useRef } from "react";
import { listenForAnnotationChanges } from "../annotationActions";
import {
  listenForRepositoryChanges,
  listenForRepositoryOpened,
  loadRepository,
  loadWindowRepository,
} from "../repositoryActions";
import { appActions, appStore } from "../store";

export function useAppLifecycle() {
  useInitialRepositoryLoad();
  useRepositoryChangeListener();
  useRepositoryOpenedListener();
  useAnnotationsChangeListener();
  useWindowFocusRefresh();
  useGlobalShortcuts();
}

function useInitialRepositoryLoad() {
  useEffect(() => {
    void loadWindowRepository();
  }, []);
}

function useRepositoryChangeListener() {
  useEffect(() => {
    const unlistenPromise = listenForRepositoryChanges();

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}

function useRepositoryOpenedListener() {
  useEffect(() => {
    const unlistenPromise = listenForRepositoryOpened();

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}

function useAnnotationsChangeListener() {
  useEffect(() => {
    const unlistenPromise = listenForAnnotationChanges();

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}

function useWindowFocusRefresh() {
  const lastFocusRefreshAtRef = useRef(0);

  useEffect(() => {
    lastFocusRefreshAtRef.current = Date.now();

    const onFocus = () => {
      const now = Date.now();
      const state = appStore.state;
      if (state.isLoading || now - lastFocusRefreshAtRef.current < 1_500) {
        return;
      }

      lastFocusRefreshAtRef.current = now;
      void loadRepository(state.repository?.cwd, { silent: true });
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "k" || key === "p") {
        event.preventDefault();
        appActions.toggleCommandOpen();
        return;
      }
      if (key === "e" && event.shiftKey) {
        event.preventDefault();
        appActions.requestFileTreeFocus();
        return;
      }
      if (key === "f") {
        event.preventDefault();
        appActions.setFindOpen(true);
        return;
      }
      if (key === "r") {
        event.preventDefault();
        void loadRepository(appStore.state.repository?.cwd, { silent: false });
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

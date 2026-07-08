import { DEFAULT_THEMES } from "@pierre/diffs";
import {
  useWorkerPool,
  WorkerPoolContextProvider,
  type WorkerInitializationRenderOptions,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DIFF_OPTIONS } from "./diffOptions";

const POOL_OPTIONS: WorkerPoolOptions = {
  poolSize: Math.min(Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1), 3),
  totalASTLRUCacheSize: 100,
  workerFactory() {
    return new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), {
      type: "module",
    });
  },
};

const HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  preferredHighlighter: "shiki-wasm",
  lineDiffType: DIFF_OPTIONS.lineDiffType ?? "word-alt",
  tokenizeMaxLineLength: DIFF_OPTIONS.tokenizeMaxLineLength ?? 1_000,
  langs: [
    "css",
    "go",
    "html",
    "java",
    "javascript",
    "json",
    "jsx",
    "markdown",
    "python",
    "rust",
    "shellscript",
    "swift",
    "toml",
    "tsx",
    "typescript",
    "yaml",
  ],
};

export function WorkerPoolProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider poolOptions={POOL_OPTIONS} highlighterOptions={HIGHLIGHTER_OPTIONS}>
      {children}
    </WorkerPoolContextProvider>
  );
}

export function useIsWorkerPoolReady() {
  const workerPool = useWorkerPool();
  const [isReady, setIsReady] = useState(() => workerPool?.isInitialized() ?? true);
  const isReadyRef = useRef(isReady);

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    return workerPool.subscribeToStatChanges((stats) => {
      const nextReady = stats.managerState === "initialized";
      if (nextReady !== isReadyRef.current) {
        isReadyRef.current = nextReady;
        setIsReady(nextReady);
      }
    });
  }, [workerPool]);

  return workerPool ? isReady : true;
}

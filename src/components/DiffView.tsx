import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import type { CodeViewItem } from "@pierre/diffs";
import { Binary, FileCode2, Files } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CODE_VIEW_OPTIONS } from "../diffOptions";
import type { ViewMode } from "../store";
import type { DiffFile, RepositoryDiff } from "../types";
import {
  buildCodeViewItems,
  CODE_VIEW_BATCH_COUNT,
  CODE_VIEW_INITIAL_BATCH,
  findMatchRange,
  getCodeViewItem,
  listRenderableFiles,
  pruneCodeViewItemCache,
  yieldToBrowser,
  type FindMatch,
} from "../utils/diff";
import { ViewModeSwitch } from "./ViewModeSwitch";

const FILE_CODE_VIEW_OPTIONS = {
  ...CODE_VIEW_OPTIONS,
  disableFileHeader: true,
};

interface DiffViewProps {
  activeFindMatch: FindMatch | null;
  file: DiffFile;
  repository: RepositoryDiff;
  viewMode: ViewMode;
}

export function DiffView({ activeFindMatch, file, repository, viewMode }: DiffViewProps) {
  if (viewMode === "file") {
    return <FileDiffView activeFindMatch={activeFindMatch} file={file} repository={repository} />;
  }

  return <CodeDiffView activeFindMatch={activeFindMatch} file={file} repository={repository} />;
}

function FileDiffView({ activeFindMatch, file, repository }: Omit<DiffViewProps, "viewMode">) {
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const codeViewItems = useMemo(() => buildCodeViewItems(repository.files, file.path), [file.path, repository.files]);
  const seedKey = `${repository.repoRoot}:${file.path}`;
  const remountKey = useUncontrolledCodeViewSync(codeViewRef, codeViewItems, seedKey);
  const selectedLines = useMemo(() => {
    if (!activeFindMatch || activeFindMatch.filePath !== file.path) {
      return null;
    }

    return {
      id: activeFindMatch.filePath,
      range: findMatchRange(activeFindMatch),
    };
  }, [activeFindMatch, file.path]);

  useEffect(() => {
    if (!activeFindMatch) {
      return;
    }

    codeViewRef.current?.scrollTo({
      type: "line",
      id: activeFindMatch.filePath,
      lineNumber: activeFindMatch.lineNumber,
      side: activeFindMatch.side,
      align: "center",
      behavior: "smooth-auto",
    });
  }, [activeFindMatch]);

  return (
    <DiffFrame
      additions={file.additions}
      deletions={file.deletions}
      heading={file.path}
      icon={<FileCode2 aria-hidden="true" size={17} />}
      status={file.status}
      subheading={file.oldPath && file.oldPath !== file.path ? file.oldPath : null}
      viewMode="file"
    >
      {file.binary ? (
        <BinaryFileState path={file.path} />
      ) : codeViewItems.length > 0 ? (
        <CodeView
          key={`file:${seedKey}:${remountKey}`}
          ref={codeViewRef}
          initialItems={codeViewItems}
          options={FILE_CODE_VIEW_OPTIONS}
          selectedLines={selectedLines}
          className="diff-renderer"
        />
      ) : (
        <NoTextChangesState />
      )}
    </DiffFrame>
  );
}

function CodeDiffView({ activeFindMatch, file, repository }: Omit<DiffViewProps, "viewMode">) {
  const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
  const codeViewItems = useBatchedCodeViewItems(repository.files);
  const remountKey = useUncontrolledCodeViewSync(codeViewRef, codeViewItems, repository.repoRoot);
  const selectedLines = useMemo(() => {
    if (!activeFindMatch) {
      return null;
    }

    return {
      id: activeFindMatch.filePath,
      range: findMatchRange(activeFindMatch),
    };
  }, [activeFindMatch]);

  useCodeModeFileScroll(codeViewRef, file.path, codeViewItems);

  useEffect(() => {
    if (!activeFindMatch) {
      return;
    }

    if (!codeViewItems.some((item) => item.id === activeFindMatch.filePath)) {
      return;
    }

    codeViewRef.current?.scrollTo({
      type: "line",
      id: activeFindMatch.filePath,
      lineNumber: activeFindMatch.lineNumber,
      side: activeFindMatch.side,
      align: "center",
      behavior: "smooth-auto",
    });
  }, [activeFindMatch, codeViewItems]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const changedFile of repository.files) {
      additions += changedFile.additions;
      deletions += changedFile.deletions;
    }
    return { additions, deletions };
  }, [repository.files]);

  return (
    <DiffFrame
      additions={totals.additions}
      deletions={totals.deletions}
      heading="All changed files"
      icon={<Files aria-hidden="true" size={17} />}
      status={`${repository.files.length} files`}
      viewMode="code"
    >
      {codeViewItems.length > 0 ? (
        <CodeView
          key={`code:${repository.repoRoot}:${remountKey}`}
          ref={codeViewRef}
          initialItems={codeViewItems}
          options={CODE_VIEW_OPTIONS}
          selectedLines={selectedLines}
          className="diff-renderer"
        />
      ) : (
        <NoTextChangesState />
      )}
    </DiffFrame>
  );
}

function useBatchedCodeViewItems(files: readonly DiffFile[]) {
  const renderableFiles = useMemo(() => listRenderableFiles(files), [files]);
  const filesKey = useMemo(
    () =>
      renderableFiles
        .map(
          (file) =>
            `${file.path}:${file.status}:${file.additions}:${file.deletions}:${file.oldContent.length}:${file.newContent.length}`,
        )
        .join("\0"),
    [renderableFiles],
  );
  const initialCount = Math.min(CODE_VIEW_INITIAL_BATCH, renderableFiles.length);
  const [batch, setBatch] = useState({ key: filesKey, count: initialCount });

  if (batch.key !== filesKey) {
    pruneCodeViewItemCache(files);
    setBatch({ key: filesKey, count: initialCount });
  }

  const readyCount = batch.key === filesKey ? batch.count : initialCount;

  useEffect(() => {
    if (readyCount >= renderableFiles.length) {
      return;
    }

    let cancelled = false;

    void (async () => {
      let count = readyCount;
      while (!cancelled && count < renderableFiles.length) {
        await yieldToBrowser();
        if (cancelled) {
          return;
        }

        count = Math.min(count + CODE_VIEW_BATCH_COUNT, renderableFiles.length);
        setBatch({ key: filesKey, count });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filesKey, readyCount, renderableFiles.length]);

  return useMemo(() => {
    const items: CodeViewItem<undefined>[] = [];
    for (const file of renderableFiles.slice(0, readyCount)) {
      const item = getCodeViewItem(file);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }, [readyCount, renderableFiles]);
}

function useCodeModeFileScroll(
  codeViewRef: React.RefObject<CodeViewHandle<undefined> | null>,
  filePath: string,
  codeViewItems: readonly CodeViewItem<undefined>[],
) {
  const previousPathRef = useRef<string | null>(null);
  const pendingPathRef = useRef<string | null>(filePath);

  useEffect(() => {
    pendingPathRef.current = filePath;
  }, [filePath]);

  useEffect(() => {
    const targetPath = pendingPathRef.current;
    if (!targetPath || !codeViewItems.some((item) => item.id === targetPath)) {
      return;
    }

    const isFirstScroll = previousPathRef.current == null;
    const pathChanged = previousPathRef.current !== targetPath;
    if (!isFirstScroll && !pathChanged) {
      return;
    }

    previousPathRef.current = targetPath;
    codeViewRef.current?.scrollTo({
      type: "item",
      id: targetPath,
      align: "start",
      // First landing uses instant to avoid fighting estimated heights; later
      // tree/file navigation matches diffshub's smooth item scroll.
      behavior: isFirstScroll ? "instant" : "smooth",
    });
  }, [codeViewItems, codeViewRef, filePath]);
}

/**
 * Seed via `initialItems`, then sync later changes through the imperative handle.
 * Remounts only when items are removed (CodeView has no remove API).
 */
function useUncontrolledCodeViewSync(
  codeViewRef: React.RefObject<CodeViewHandle<undefined> | null>,
  items: readonly CodeViewItem<undefined>[],
  seedKey: string,
) {
  const previousItemsRef = useRef<readonly CodeViewItem<undefined>[] | null>(null);
  const previousSeedKeyRef = useRef(seedKey);
  const [remountKey, setRemountKey] = useState(0);

  useEffect(() => {
    if (previousSeedKeyRef.current !== seedKey) {
      previousSeedKeyRef.current = seedKey;
      previousItemsRef.current = items;
      return;
    }

    const previousItems = previousItemsRef.current;
    if (previousItems == null) {
      previousItemsRef.current = items;
      return;
    }

    const viewer = codeViewRef.current;
    if (!viewer) {
      previousItemsRef.current = items;
      return;
    }

    const nextIds = new Set(items.map((item) => item.id));
    if (previousItems.some((item) => !nextIds.has(item.id))) {
      previousItemsRef.current = null;
      setRemountKey((value) => value + 1);
      return;
    }

    const previousById = new Map(previousItems.map((item) => [item.id, item]));
    const added: CodeViewItem<undefined>[] = [];

    for (const item of items) {
      const previous = previousById.get(item.id);
      if (!previous) {
        added.push(item);
        continue;
      }

      if (previous.version !== item.version) {
        viewer.updateItem(item);
      }
    }

    if (added.length > 0) {
      viewer.addItems(added);
    }

    previousItemsRef.current = items;
  }, [codeViewRef, items, seedKey]);

  return remountKey;
}

interface DiffFrameProps {
  additions: number;
  children: React.ReactNode;
  deletions: number;
  heading: string;
  icon: React.ReactNode;
  status: string;
  subheading?: string | null;
  viewMode: ViewMode;
}

function DiffFrame({ additions, children, deletions, heading, icon, status, subheading, viewMode }: DiffFrameProps) {
  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <div className="file-heading">
          {icon}
          <strong>{heading}</strong>
          {subheading ? <span>{subheading}</span> : null}
        </div>
        <div className="diff-toolbar-actions">
          <ViewModeSwitch value={viewMode} />
          <div className="change-counts" aria-label="Line changes">
            <span className="additions">+{additions}</span>
            <span className="deletions">-{deletions}</span>
            <span className={`status-pill status-${viewMode === "file" ? status : "code"}`}>{status}</span>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function BinaryFileState({ path }: { path: string }) {
  return (
    <div className="center-state">
      <Binary aria-hidden="true" size={28} />
      <h1>Binary file changed</h1>
      <p>{path}</p>
    </div>
  );
}

function NoTextChangesState() {
  return (
    <div className="center-state">
      <Binary aria-hidden="true" size={28} />
      <h1>No text changes to render</h1>
      <p>The changed files in this view are binary.</p>
    </div>
  );
}

import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel, GitStatusEntry } from "@pierre/trees";
import { Search } from "lucide-react";
import { useEffect, useMemo } from "react";
import { PIERRE_DARK_TREE_STYLE } from "../pierreTheme";
import { appActions, useAppSelector, useShallowAppSelector } from "../store";
import type { DiffFile } from "../types";
import { toTreeStatus } from "../utils/status";
import { EmptySidebar } from "./States";

export function Sidebar() {
  const { files, isLoading, repoRoot, selectedPath } = useShallowAppSelector((state) => ({
    files: state.repository?.files ?? [],
    isLoading: state.isLoading,
    repoRoot: state.repository?.repoRoot ?? null,
    selectedPath: state.selectedPath,
  }));

  return (
    <aside className="sidebar">
      <div className="sidebar-heading">
        <span>Files</span>
        <button className="search-button" type="button" onClick={() => appActions.setCommandOpen(true)}>
          <Search aria-hidden="true" size={14} />
          Jump
        </button>
      </div>
      {files.length > 0 && repoRoot ? (
        <FileTreePane
          key={`${repoRoot}:${files.map((file) => `${file.path}:${file.status}`).join("\0")}`}
          files={files}
          selectedPath={selectedPath}
        />
      ) : (
        <EmptySidebar isLoading={isLoading} />
      )}
    </aside>
  );
}

interface FileTreePaneProps {
  files: DiffFile[];
  selectedPath: string | null;
}

function FileTreePane({ files, selectedPath }: FileTreePaneProps) {
  const fileTreeFocusRequest = useAppSelector((state) => state.fileTreeFocusRequest);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => files.map((file) => ({ path: file.path, status: toTreeStatus(file.status) })),
    [files],
  );
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus,
    initialExpansion: "open",
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange: (selectedPaths) => {
      const nextPath = selectedPaths[selectedPaths.length - 1];
      if (nextPath) {
        appActions.selectPath(nextPath);
      }
    },
    paths,
    unsafeCSS: `
      button[data-type='item'] {
        border-radius: 6px;
        min-height: 26px;
      }
      button[data-type='item'][data-item-selected] {
        font-weight: 600;
      }
    `,
  });

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [model, selectedPath]);

  useEffect(() => {
    if (fileTreeFocusRequest === 0) {
      return;
    }

    const focusPath = selectedPath ?? paths[0] ?? null;
    focusRenderedTreePath(model, focusPath);
  }, [fileTreeFocusRequest, model, paths, selectedPath]);

  return (
    <div className="file-tree-scroll">
      <FileTree className="file-tree-host" model={model} style={PIERRE_DARK_TREE_STYLE} />
    </div>
  );
}

function focusRenderedTreePath(model: FileTreeModel, path: string | null): string | null {
  const resolvedPath = model.focusNearestPath(path);
  if (!resolvedPath) {
    model.getFileTreeContainer()?.focus({ preventScroll: true });
    return null;
  }

  model.scrollToPath(resolvedPath, { focus: false, offset: "nearest" });

  window.requestAnimationFrame(() => {
    if (focusTreeButton(model, resolvedPath)) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (!focusTreeButton(model, resolvedPath)) {
        model.getFileTreeContainer()?.focus({ preventScroll: true });
      }
    });
  });

  return resolvedPath;
}

function focusTreeButton(model: FileTreeModel, path: string): boolean {
  const shadowRoot = model.getFileTreeContainer()?.shadowRoot;
  if (!shadowRoot) {
    return false;
  }

  const rowButton = Array.from(shadowRoot.querySelectorAll("button[data-type='item']")).find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.dataset.itemPath === path && element.dataset.itemParked !== "true",
  );

  if (!rowButton) {
    return false;
  }

  rowButton.focus({ preventScroll: true });
  return shadowRoot.activeElement === rowButton;
}

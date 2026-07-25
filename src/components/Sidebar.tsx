import type { FileTreeRowDecorationRenderer } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { FileTree as FileTreeModel, GitStatusEntry } from "@pierre/trees";
import { PanelLeftClose, Search } from "lucide-react";
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PIERRE_DARK_TREE_STYLE } from "../pierreTheme";
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "../preferences";
import { appActions, useAppSelector, useShallowAppSelector } from "../store";
import type { DiffFile } from "../types";
import { toTreeStatus } from "../utils/status";
import { EmptySidebar } from "./States";

export function Sidebar() {
  const { files, isLoading, repoRoot, selectedPath, annotations, sidebarWidth } = useShallowAppSelector((state) => ({
    files: state.repository?.files ?? [],
    isLoading: state.isLoading,
    repoRoot: state.repository?.repoRoot ?? null,
    selectedPath: state.selectedPath,
    annotations: state.annotations,
    sidebarWidth: state.sidebarWidth,
  }));
  const sidebarRef = useRef<HTMLElement>(null);
  const openAnnotationCountByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const annotation of annotations) {
      if (annotation.status !== "open") {
        continue;
      }
      counts.set(annotation.file, (counts.get(annotation.file) ?? 0) + 1);
    }
    return counts;
  }, [annotations]);
  const annotationsKey = useMemo(
    () => [...openAnnotationCountByPath].map(([path, count]) => `${path}=${count}`).sort().join(","),
    [openAnnotationCountByPath],
  );

  return (
    <>
      <aside
        className="sidebar"
        ref={sidebarRef}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="sidebar-heading">
          <span>Files</span>
          <div className="sidebar-heading-actions">
            <button className="search-button" type="button" onClick={() => appActions.setCommandOpen(true)}>
              <Search aria-hidden="true" size={14} />
              Jump
            </button>
            <button
              className="sidebar-collapse-button"
              type="button"
              title="Hide files (⌘B)"
              aria-label="Hide files"
              onClick={() => appActions.setSidebarCollapsed(true)}
            >
              <PanelLeftClose aria-hidden="true" size={14} />
            </button>
          </div>
        </div>
        {files.length > 0 && repoRoot ? (
          <FileTreePane
            key={`${repoRoot}:${files.map((file) => `${file.path}:${file.status}`).join("\0")}:${annotationsKey}`}
            files={files}
            openAnnotationCountByPath={openAnnotationCountByPath}
            selectedPath={selectedPath}
          />
        ) : (
          <EmptySidebar isLoading={isLoading} />
        )}
      </aside>
      <SidebarResizeHandle sidebarRef={sidebarRef} />
    </>
  );
}

/** The stored width is capped against the window so the diff pane keeps room on small screens. */
function resolveMaxSidebarWidth() {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.round(window.innerWidth / 2));
}

function subscribeToViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

interface SidebarResizeHandleProps {
  sidebarRef: RefObject<HTMLElement | null>;
}

interface SidebarDragState {
  pointerId: number;
  sidebarLeft: number;
  width: number;
}

function SidebarResizeHandle({ sidebarRef }: SidebarResizeHandleProps) {
  const sidebarWidth = useAppSelector((state) => state.sidebarWidth);
  const maxWidth = useSyncExternalStore(subscribeToViewport, resolveMaxSidebarWidth);
  const dragRef = useRef<SidebarDragState | null>(null);

  // Collapsing mid-drag (Cmd-B) unmounts the handle before it sees pointerup, which
  // would strand the body class and leave the whole app unselectable.
  useEffect(() => () => document.body.classList.remove("sidebar-resizing"), []);

  const clampWidth = (width: number) => Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), maxWidth);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    document.body.classList.remove("sidebar-resizing");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Persisting once per drag keeps localStorage (and the store) out of the pointermove path.
    appActions.setSidebarWidth(drag.width);
  };

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file sidebar"
      aria-valuenow={Math.min(sidebarWidth, maxWidth)}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={maxWidth}
      tabIndex={0}
      onDoubleClick={() => appActions.setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 32 : 8;
        let next: number | null = null;
        if (event.key === "ArrowLeft") {
          next = sidebarWidth - step;
        } else if (event.key === "ArrowRight") {
          next = sidebarWidth + step;
        } else if (event.key === "Home") {
          next = SIDEBAR_MIN_WIDTH;
        } else if (event.key === "End") {
          next = maxWidth;
        }

        if (next === null) {
          return;
        }

        event.preventDefault();
        appActions.setSidebarWidth(clampWidth(next));
      }}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        const sidebar = sidebarRef.current;
        if (event.button !== 0 || !sidebar) {
          return;
        }

        event.preventDefault();
        dragRef.current = {
          pointerId: event.pointerId,
          sidebarLeft: sidebar.getBoundingClientRect().left,
          width: sidebarWidth,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add("sidebar-resizing");
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }

        // Drive the drag through a custom property so neither the file tree nor the diff re-renders per frame.
        drag.width = clampWidth(event.clientX - drag.sidebarLeft);
        sidebarRef.current?.style.setProperty("--sidebar-width", `${drag.width}px`);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}

interface FileTreePaneProps {
  files: DiffFile[];
  openAnnotationCountByPath: Map<string, number>;
  selectedPath: string | null;
}

function FileTreePane({ files, openAnnotationCountByPath, selectedPath }: FileTreePaneProps) {
  const fileTreeFocusRequest = useAppSelector((state) => state.fileTreeFocusRequest);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const renderRowDecoration = useMemo<FileTreeRowDecorationRenderer>(
    () => ({ item }) => {
      if (item.kind !== "file") {
        return null;
      }

      const count = openAnnotationCountByPath.get(item.path);
      if (!count) {
        return null;
      }

      return {
        text: String(count),
        title: `${count} open annotation${count === 1 ? "" : "s"}`,
      };
    },
    [openAnnotationCountByPath],
  );
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
    renderRowDecoration,
    unsafeCSS: `
      button[data-type='item'] {
        border-radius: 6px;
        min-height: 26px;
      }
      button[data-type='item'][data-item-selected] {
        font-weight: 600;
      }
      button[data-type='item'] [data-item-section='decoration'] span {
        min-width: 16px;
        height: 16px;
        padding: 0 5px;
        border-radius: 999px;
        color: #d9ede4;
        background: #35564b;
        font-size: 10px;
        font-weight: 600;
        line-height: 16px;
        text-align: center;
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

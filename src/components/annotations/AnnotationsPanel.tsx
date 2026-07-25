import { Check, GitPullRequestArrow, MessageSquareText, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { clearAnnotations, deleteAnnotation, setAnnotationStatus } from "../../annotationActions";
import { selectRevision } from "../../repositoryActions";
import { appActions, useShallowAppSelector } from "../../store";
import type { Annotation } from "../../types";
import { basename } from "../../utils/path";

interface AnnotationGroup {
  file: string;
  directory: string;
  name: string;
  annotations: Annotation[];
}

export function AnnotationsPanel() {
  const { annotations, diffPaths, open, viewingCommit } = useShallowAppSelector((state) => ({
    annotations: state.annotations,
    diffPaths: state.repository?.files.map((file) => file.path) ?? [],
    open: state.annotationsPanelOpen,
    // Comments anchor to working-tree line numbers, so they are not shown at all
    // against a commit's diff.
    viewingCommit: state.revision != null,
  }));

  const groups = useMemo(() => groupAnnotations(annotations), [annotations]);
  const diffPathSet = useMemo(() => new Set(diffPaths), [diffPaths]);
  const openCount = useMemo(
    () => annotations.filter((annotation) => annotation.status === "open").length,
    [annotations],
  );
  const hasResolved = useMemo(
    () => annotations.some((annotation) => annotation.status === "resolved"),
    [annotations],
  );

  if (!open) {
    return null;
  }

  return (
    <aside className="annotations-panel">
      <div className="annotations-panel-heading">
        <span>
          Comments
          {openCount > 0 && !viewingCommit ? <span className="annotations-panel-count">{openCount}</span> : null}
        </span>
        <div className="annotations-panel-heading-actions">
          {hasResolved && !viewingCommit ? (
            <ClearButton
              confirmLabel="Clear resolved?"
              label="Clear resolved"
              onConfirm={() => clearAnnotations(["resolved"])}
            />
          ) : null}
          {annotations.length > 0 && !viewingCommit ? (
            <ClearButton confirmLabel="Clear all?" label="Clear" onConfirm={() => clearAnnotations()} />
          ) : null}
          <button
            className="icon-button"
            type="button"
            title="Close comments panel"
            onClick={() => appActions.setAnnotationsPanelOpen(false)}
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      </div>
      <div className="annotations-panel-list">
        {viewingCommit ? (
          <CommitModeEmptyState />
        ) : groups.length > 0 ? (
          groups.map((group) => <AnnotationGroupSection key={group.file} diffPathSet={diffPathSet} group={group} />)
        ) : (
          <div className="annotations-panel-empty">
            <MessageSquareText aria-hidden="true" size={22} />
            <p>No review comments yet.</p>
            <p>Select a line in the diff gutter and click the comment button to add one.</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function CommitModeEmptyState() {
  return (
    <div className="annotations-panel-empty">
      <MessageSquareText aria-hidden="true" size={22} />
      <p>Comments apply to uncommitted changes.</p>
      <button className="annotation-action-button" type="button" onClick={() => void selectRevision(null)}>
        <GitPullRequestArrow aria-hidden="true" size={13} />
        View uncommitted changes
      </button>
    </div>
  );
}

function ClearButton({
  confirmLabel,
  label,
  onConfirm,
}: {
  confirmLabel: string;
  label: string;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <button
      className="annotations-panel-clear-button"
      type="button"
      onClick={() => {
        if (confirming) {
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          setConfirming(false);
          onConfirm();
          return;
        }

        setConfirming(true);
        timeoutRef.current = setTimeout(() => {
          setConfirming(false);
          timeoutRef.current = null;
        }, 3000);
      }}
    >
      {confirming ? confirmLabel : label}
    </button>
  );
}

function AnnotationGroupSection({
  diffPathSet,
  group,
}: {
  diffPathSet: ReadonlySet<string>;
  group: AnnotationGroup;
}) {
  return (
    <div className="annotations-panel-group">
      <div className="annotations-panel-group-heading">
        <strong>{group.name}</strong>
        {group.directory ? <span>{group.directory}</span> : null}
        <span className="annotations-panel-group-count">{group.annotations.length}</span>
      </div>
      {group.annotations.map((annotation) => (
        <AnnotationRow key={annotation.id} annotation={annotation} inDiff={diffPathSet.has(annotation.file)} />
      ))}
    </div>
  );
}

function AnnotationRow({ annotation, inDiff }: { annotation: Annotation; inDiff: boolean }) {
  const lineLabel =
    annotation.startLine === annotation.endLine
      ? `line ${annotation.startLine}`
      : `lines ${annotation.startLine}–${annotation.endLine}`;

  const jump = () => {
    appActions.selectPath(annotation.file);
    appActions.requestAnnotationJump(annotation.file, annotation.side, annotation.startLine);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      jump();
    }
  };

  return (
    <div
      className={`annotations-panel-row${inDiff ? "" : " annotations-panel-row-orphaned"}`}
      role={inDiff ? "button" : undefined}
      tabIndex={inDiff ? 0 : undefined}
      onClick={inDiff ? jump : undefined}
      onKeyDown={inDiff ? handleKeyDown : undefined}
    >
      <div className="annotations-panel-row-meta">
        <span className={`annotation-status-pill annotation-status-${annotation.status}`}>{annotation.status}</span>
        <span className="annotations-panel-row-line">
          {annotation.side === "old" ? `old ${lineLabel}` : lineLabel}
        </span>
        <span className="annotations-panel-row-meta-end">
          {!inDiff ? <span className="annotations-panel-row-not-in-diff">not in diff</span> : null}
          {annotation.replies.length > 0 ? (
            <span className="annotations-panel-row-replies">{annotation.replies.length} replies</span>
          ) : null}
          <span className="annotations-panel-row-actions">
            {annotation.status === "resolved" ? (
              <button
                className="annotations-panel-row-action"
                type="button"
                title="Reopen"
                onClick={(event) => {
                  event.stopPropagation();
                  void setAnnotationStatus(annotation.id, "open");
                }}
              >
                <RotateCcw aria-hidden="true" size={12} />
              </button>
            ) : (
              <button
                className="annotations-panel-row-action"
                type="button"
                title="Resolve"
                onClick={(event) => {
                  event.stopPropagation();
                  void setAnnotationStatus(annotation.id, "resolved");
                }}
              >
                <Check aria-hidden="true" size={12} />
              </button>
            )}
            <button
              className="annotations-panel-row-action annotations-panel-row-action-delete"
              type="button"
              title="Delete"
              onClick={(event) => {
                event.stopPropagation();
                void deleteAnnotation(annotation.id);
              }}
            >
              <Trash2 aria-hidden="true" size={12} />
            </button>
          </span>
        </span>
      </div>
      <p className="annotations-panel-row-comment">{annotation.comment}</p>
    </div>
  );
}

function groupAnnotations(annotations: readonly Annotation[]): AnnotationGroup[] {
  const byFile = new Map<string, Annotation[]>();
  for (const annotation of annotations) {
    const bucket = byFile.get(annotation.file);
    if (bucket) {
      bucket.push(annotation);
    } else {
      byFile.set(annotation.file, [annotation]);
    }
  }

  const groups: AnnotationGroup[] = [];
  for (const [file, fileAnnotations] of byFile) {
    fileAnnotations.sort((a, b) => a.startLine - b.startLine);
    groups.push({
      file,
      directory: dirname(file),
      name: basename(file),
      annotations: fileAnnotations,
    });
  }

  groups.sort((a, b) => a.file.localeCompare(b.file));
  return groups;
}

function dirname(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  segments.pop();
  return segments.join("/");
}

import { MessageSquareText, X } from "lucide-react";
import { useMemo } from "react";
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
  const { annotations, open } = useShallowAppSelector((state) => ({
    annotations: state.annotations,
    open: state.annotationsPanelOpen,
  }));

  const groups = useMemo(() => groupAnnotations(annotations), [annotations]);
  const openCount = useMemo(
    () => annotations.filter((annotation) => annotation.status === "open").length,
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
          {openCount > 0 ? <span className="annotations-panel-count">{openCount}</span> : null}
        </span>
        <button
          className="icon-button"
          type="button"
          title="Close comments panel"
          onClick={() => appActions.setAnnotationsPanelOpen(false)}
        >
          <X aria-hidden="true" size={15} />
        </button>
      </div>
      <div className="annotations-panel-list">
        {groups.length > 0 ? (
          groups.map((group) => <AnnotationGroupSection key={group.file} group={group} />)
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

function AnnotationGroupSection({ group }: { group: AnnotationGroup }) {
  return (
    <div className="annotations-panel-group">
      <div className="annotations-panel-group-heading">
        <strong>{group.name}</strong>
        {group.directory ? <span>{group.directory}</span> : null}
        <span className="annotations-panel-group-count">{group.annotations.length}</span>
      </div>
      {group.annotations.map((annotation) => (
        <AnnotationRow key={annotation.id} annotation={annotation} />
      ))}
    </div>
  );
}

function AnnotationRow({ annotation }: { annotation: Annotation }) {
  const lineLabel =
    annotation.startLine === annotation.endLine
      ? `line ${annotation.startLine}`
      : `lines ${annotation.startLine}–${annotation.endLine}`;

  return (
    <button
      className="annotations-panel-row"
      type="button"
      onClick={() => {
        appActions.selectPath(annotation.file);
        appActions.requestAnnotationJump(annotation.file, annotation.side, annotation.startLine);
      }}
    >
      <div className="annotations-panel-row-meta">
        <span className={`annotation-status-pill annotation-status-${annotation.status}`}>{annotation.status}</span>
        <span className="annotations-panel-row-line">
          {annotation.side === "old" ? `old ${lineLabel}` : lineLabel}
        </span>
        {annotation.replies.length > 0 ? (
          <span className="annotations-panel-row-replies">{annotation.replies.length} replies</span>
        ) : null}
      </div>
      <p className="annotations-panel-row-comment">{annotation.comment}</p>
    </button>
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

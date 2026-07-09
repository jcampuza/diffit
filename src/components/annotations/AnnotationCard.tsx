import { deleteAnnotation, setAnnotationStatus } from "../../annotationActions";
import type { Annotation } from "../../types";

interface AnnotationCardProps {
  annotation: Annotation;
}

export function AnnotationCard({ annotation }: AnnotationCardProps) {
  const isOutdated = annotation.status === "outdated";

  return (
    <article className={`annotation-card${isOutdated ? " annotation-card-outdated" : ""}`}>
      <header className="annotation-card-header">
        <span className={`annotation-status-pill annotation-status-${annotation.status}`}>{annotation.status}</span>
        <div className="annotation-card-actions">
          {annotation.status === "resolved" ? (
            <button className="annotation-action-button" type="button" onClick={() => void setAnnotationStatus(annotation.id, "open")}>
              Reopen
            </button>
          ) : (
            <button className="annotation-action-button" type="button" onClick={() => void setAnnotationStatus(annotation.id, "resolved")}>
              Resolve
            </button>
          )}
          <button className="annotation-action-button annotation-action-delete" type="button" onClick={() => void deleteAnnotation(annotation.id)}>
            Delete
          </button>
        </div>
      </header>
      {isOutdated ? (
        <p className="annotation-original-line">
          Original line: <code>{annotation.anchor.lineText || "(empty)"}</code>
        </p>
      ) : null}
      <p className="annotation-comment">{annotation.comment}</p>
      {annotation.replies.length > 0 ? (
        <ul className="annotation-replies">
          {annotation.replies.map((reply, index) => (
            <li key={index}>
              <span className="annotation-reply-author">{reply.author}</span>
              <span className="annotation-reply-text">{reply.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

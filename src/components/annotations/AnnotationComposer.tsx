import { useEffect, useRef, useState } from "react";
import { createAnnotation } from "../../annotationActions";
import { appActions, useAppSelector } from "../../store";

export function AnnotationComposer() {
  const draft = useAppSelector((state) => state.annotationDraft);
  const [comment, setComment] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        appActions.setAnnotationDraft(null);
        return;
      }

      if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && comment.trim() && draft) {
        event.preventDefault();
        void createAnnotation(draft, comment.trim());
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [comment, draft]);

  if (!draft) {
    return null;
  }

  const trimmedComment = comment.trim();

  return (
    <div className="annotation-composer">
      <textarea
        ref={textareaRef}
        className="annotation-composer-input"
        placeholder="Leave a review comment…"
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <div className="annotation-composer-actions">
        <button className="annotation-action-button" type="button" onClick={() => appActions.setAnnotationDraft(null)}>
          Cancel
        </button>
        <button
          className="annotation-action-button annotation-action-primary"
          disabled={!trimmedComment}
          type="button"
          onClick={() => void createAnnotation(draft, trimmedComment)}
        >
          Save
        </button>
      </div>
    </div>
  );
}

import { useCallback, useMemo, useState } from "react";
import type { CodeViewLineSelection } from "@pierre/diffs";
import type { CodeViewItem, DiffLineAnnotation, GetHoveredLineResult, LineAnnotation } from "@pierre/diffs";
import { appActions, useShallowAppSelector } from "../../store";
import type { Annotation, AnnotationSide, DiffFile } from "../../types";
import {
  annotationSideFromDiffSide,
  attachAnnotationsToItems,
  type AnnotationMeta,
  type FindMatch,
  findMatchRange,
} from "../../utils/diff";
import { AnnotationCard } from "./AnnotationCard";
import { AnnotationComposer } from "./AnnotationComposer";

const NO_ANNOTATIONS: readonly Annotation[] = [];
const renderNoGutterUtility = () => null;

interface UseAnnotationCodeViewOptions {
  activeFindMatch: FindMatch | null;
  baseItems: readonly CodeViewItem<undefined>[];
  files: readonly DiffFile[];
  findMatchFilePath?: string | null;
}

export function useAnnotationCodeView({
  activeFindMatch,
  baseItems,
  files,
  findMatchFilePath = null,
}: UseAnnotationCodeViewOptions) {
  const { annotationDraft, annotations, hidden } = useShallowAppSelector((state) => ({
    annotationDraft: state.annotationDraft,
    annotations: state.annotations,
    // Annotations anchor to working-tree line numbers, so nothing about them lines
    // up with a past commit's diff. Viewing a commit hides them entirely.
    hidden: state.revision != null,
  }));
  const [userSelectedLines, setUserSelectedLines] = useState<CodeViewLineSelection | null>(null);
  const filesByPath = useMemo(() => new Map(files.map((file) => [file.path, file])), [files]);

  const items = useMemo(
    () =>
      attachAnnotationsToItems(
        baseItems,
        filesByPath,
        hidden ? NO_ANNOTATIONS : annotations,
        hidden ? null : annotationDraft,
      ),
    [annotationDraft, annotations, baseItems, filesByPath, hidden],
  );

  const selectedLines = useMemo(() => {
    if (activeFindMatch) {
      if (findMatchFilePath != null && activeFindMatch.filePath !== findMatchFilePath) {
        return null;
      }

      return {
        id: activeFindMatch.filePath,
        range: findMatchRange(activeFindMatch),
      };
    }

    return userSelectedLines;
  }, [activeFindMatch, findMatchFilePath, userSelectedLines]);

  const renderAnnotation = useCallback(
    (annotation: LineAnnotation<AnnotationMeta> | DiffLineAnnotation<AnnotationMeta>) => {
      if (!annotation.metadata) {
        return null;
      }

      if ("draft" in annotation.metadata) {
        return <AnnotationComposer />;
      }

      return <AnnotationCard annotation={annotation.metadata.annotation} />;
    },
    [],
  );

  const renderGutterUtility = useCallback(
    (getHoveredLine: () => GetHoveredLineResult<"file"> | GetHoveredLineResult<"diff"> | undefined, item: CodeViewItem<AnnotationMeta>) => {
      return (
        <button
          aria-label="Add review comment"
          className="annotation-gutter-button"
          type="button"
          onClick={() => {
            const hovered = getHoveredLine();
            if (!hovered) {
              return;
            }

            const file = filesByPath.get(item.id);
            if (!file) {
              return;
            }

            let startLine = hovered.lineNumber;
            let endLine = hovered.lineNumber;
            let side: AnnotationSide = "new";

            if (item.type === "diff" && "side" in hovered) {
              side = annotationSideFromDiffSide(hovered.side);

              if (userSelectedLines?.id === item.id) {
                const range = userSelectedLines.range;
                const rangeSide = range.endSide ?? range.side;
                if (rangeSide && annotationSideFromDiffSide(rangeSide) === side) {
                  startLine = Math.min(range.start, range.end);
                  endLine = Math.max(range.start, range.end);
                }
              }
            } else if (userSelectedLines?.id === item.id) {
              startLine = Math.min(userSelectedLines.range.start, userSelectedLines.range.end);
              endLine = Math.max(userSelectedLines.range.start, userSelectedLines.range.end);
            }

            appActions.setAnnotationDraft({
              file: file.path,
              oldFile: file.oldPath,
              side,
              startLine,
              endLine,
            });
          }}
        >
          +
        </button>
      );
    },
    [filesByPath, userSelectedLines],
  );

  return {
    items,
    onSelectedLinesChange: setUserSelectedLines,
    renderAnnotation,
    renderGutterUtility: hidden ? renderNoGutterUtility : renderGutterUtility,
    selectedLines,
  };
}

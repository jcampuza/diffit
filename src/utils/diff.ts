import { parseDiffFromFile, type CodeViewItem, type DiffLineAnnotation, type LineAnnotation, type SelectedLineRange } from "@pierre/diffs";
import { DIFF_OPTIONS } from "../diffOptions";
import type { Annotation, AnnotationSide, DiffFile } from "../types";
import type { AnnotationDraft, ViewMode } from "../store";

export type AnnotationMeta = { annotation: Annotation } | { draft: true };

export interface FindMatch {
  filePath: string;
  lineNumber: number;
  side: "additions" | "deletions";
}

const ITEM_CACHE = new Map<number, CodeViewItem<undefined>>();
const ITEM_CACHE_LIMIT = 256;

export const CODE_VIEW_INITIAL_BATCH = 12;
export const CODE_VIEW_BATCH_COUNT = 25;

export function annotationSideFromDiffSide(side: "deletions" | "additions"): AnnotationSide {
  return side === "deletions" ? "old" : "new";
}

export function diffSideFromAnnotationSide(side: AnnotationSide): "deletions" | "additions" {
  return side === "old" ? "deletions" : "additions";
}

export function attachAnnotationsToCodeViewItem(
  base: CodeViewItem<undefined>,
  file: DiffFile,
  annotations: readonly Annotation[],
  draft: AnnotationDraft | null,
): CodeViewItem<AnnotationMeta> {
  const fileAnnotations = annotations.filter((annotation) => annotation.file === file.path);
  const fileDraft = draft?.file === file.path ? draft : null;
  const version = annotationItemVersion(base.version, fileAnnotations, fileDraft);

  if (base.type === "file") {
    const codeAnnotations = buildFileAnnotations(fileAnnotations, fileDraft);
    return {
      ...base,
      version,
      annotations: codeAnnotations.length > 0 ? codeAnnotations : undefined,
    };
  }

  const codeAnnotations = buildDiffAnnotations(fileAnnotations, fileDraft);
  return {
    ...base,
    version,
    annotations: codeAnnotations.length > 0 ? codeAnnotations : undefined,
  };
}

export function attachAnnotationsToItems(
  items: readonly CodeViewItem<undefined>[],
  filesByPath: ReadonlyMap<string, DiffFile>,
  annotations: readonly Annotation[],
  draft: AnnotationDraft | null,
): CodeViewItem<AnnotationMeta>[] {
  return items.map((item) => {
    const file = filesByPath.get(item.id);
    if (!file) {
      return item as CodeViewItem<AnnotationMeta>;
    }

    return attachAnnotationsToCodeViewItem(item, file, annotations, draft);
  });
}

function buildFileAnnotations(
  annotations: readonly Annotation[],
  draft: AnnotationDraft | null,
): LineAnnotation<AnnotationMeta>[] {
  const entries: LineAnnotation<AnnotationMeta>[] = [];

  for (const annotation of annotations) {
    if (annotation.side === "old") {
      continue;
    }

    entries.push({
      lineNumber: annotation.endLine,
      metadata: { annotation },
    });
  }

  if (draft) {
    entries.push({
      lineNumber: draft.endLine,
      metadata: { draft: true },
    });
  }

  return entries;
}

function buildDiffAnnotations(
  annotations: readonly Annotation[],
  draft: AnnotationDraft | null,
): DiffLineAnnotation<AnnotationMeta>[] {
  const entries: DiffLineAnnotation<AnnotationMeta>[] = [];

  for (const annotation of annotations) {
    entries.push({
      side: diffSideFromAnnotationSide(annotation.side),
      lineNumber: annotation.endLine,
      metadata: { annotation },
    });
  }

  if (draft) {
    entries.push({
      side: diffSideFromAnnotationSide(draft.side),
      lineNumber: draft.endLine,
      metadata: { draft: true },
    });
  }

  return entries;
}

function annotationItemVersion(
  baseVersion: number | undefined,
  annotations: readonly Annotation[],
  draft: AnnotationDraft | null,
): number {
  const suffix = hashString(JSON.stringify({ annotations, draft }));
  return ((baseVersion ?? 0) >>> 0) ^ suffix;
}

export function getCodeViewItem(file: DiffFile): CodeViewItem<undefined> | null {
  if (file.binary) {
    return null;
  }

  const version = diffFileVersion(file);
  const cached = ITEM_CACHE.get(version);
  if (cached && cached.id === file.path) {
    return cached;
  }

  const item = createCodeViewItem(file, version);
  rememberCodeViewItem(version, item);
  return item;
}

export function buildCodeViewItems(files: readonly DiffFile[], selectedPath: string | null): CodeViewItem<undefined>[] {
  const items: CodeViewItem<undefined>[] = [];

  for (const file of files) {
    if (selectedPath && file.path !== selectedPath) {
      continue;
    }

    const item = getCodeViewItem(file);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

export function listRenderableFiles(files: readonly DiffFile[]): DiffFile[] {
  return files.filter((file) => !file.binary);
}

export function pruneCodeViewItemCache(liveFiles: readonly DiffFile[]) {
  const liveVersions = new Set(liveFiles.filter((file) => !file.binary).map(diffFileVersion));
  for (const version of ITEM_CACHE.keys()) {
    if (!liveVersions.has(version)) {
      ITEM_CACHE.delete(version);
    }
  }
}

export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(settle, 50);
    window.requestAnimationFrame(settle);
  });
}

function createCodeViewItem(file: DiffFile, version: number): CodeViewItem<undefined> {
  const oldFile = {
    name: file.oldPath ?? file.path,
    contents: file.oldContent,
    cacheKey: fileContentCacheKey(file.oldPath ?? file.path, "old", file.oldContent),
  };
  const newFile = {
    name: file.path,
    contents: file.newContent,
    cacheKey: fileContentCacheKey(file.path, "new", file.newContent),
  };

  if (file.oldContent === file.newContent) {
    return {
      id: file.path,
      type: "file",
      file: newFile,
      version,
    };
  }

  return {
    id: file.path,
    type: "diff",
    fileDiff: parseDiffFromFile(oldFile, newFile, DIFF_OPTIONS.parseDiffOptions, true),
    version,
  };
}

function rememberCodeViewItem(version: number, item: CodeViewItem<undefined>) {
  ITEM_CACHE.set(version, item);
  if (ITEM_CACHE.size <= ITEM_CACHE_LIMIT) {
    return;
  }

  const oldest = ITEM_CACHE.keys().next().value;
  if (oldest != null) {
    ITEM_CACHE.delete(oldest);
  }
}

function fileContentCacheKey(path: string, side: "old" | "new", content: string) {
  return `${path}:${side}:${hashString(content)}`;
}

function diffFileVersion(file: DiffFile) {
  return hashString(
    [
      file.path,
      file.oldPath ?? "",
      file.status,
      file.oldContent,
      file.newContent,
      file.binary ? "1" : "0",
    ].join("\0"),
  );
}

function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function collectFindMatches(
  files: readonly DiffFile[],
  query: string,
  viewMode: ViewMode,
  selectedPath: string | null,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const matches: FindMatch[] = [];
  for (const file of files) {
    if (file.binary || (viewMode === "file" && file.path !== selectedPath)) {
      continue;
    }

    collectContentMatches(matches, file, file.oldContent, "deletions", needle);
    collectContentMatches(matches, file, file.newContent, "additions", needle);
  }

  return matches;
}

export function findMatchRange(match: FindMatch): SelectedLineRange {
  return {
    start: match.lineNumber,
    end: match.lineNumber,
    side: match.side,
    endSide: match.side,
  };
}

function collectContentMatches(
  matches: FindMatch[],
  file: DiffFile,
  content: string,
  side: FindMatch["side"],
  needle: string,
) {
  const lines = content.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].toLowerCase().includes(needle)) {
      matches.push({
        filePath: file.path,
        lineNumber: index + 1,
        side,
      });
    }
  }
}

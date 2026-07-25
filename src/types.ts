export type DiffStatus = "added" | "deleted" | "modified" | "renamed" | "untracked";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: DiffStatus;
  oldContent: string;
  newContent: string;
  binary: boolean;
  additions: number;
  deletions: number;
}

export interface CommitSummary {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  relativeDate: string;
  isoDate: string;
}

export interface RevisionInfo {
  sha: string;
  shortSha: string;
  subject: string;
}

export interface RepositoryDiff {
  cwd: string;
  repoRoot: string;
  branch: string;
  head: string;
  files: DiffFile[];
  revision: RevisionInfo | null;
}

export interface RepositoryChanged {
  cwd: string;
}

export interface WindowContext {
  cwd: string;
}

export interface TerminalInstallResult {
  path: string;
  directory: string;
  directoryInPath: boolean;
}

export interface SkillInstallResult {
  path: string;
}

/** Mirrors `UpdateStatus` in `src-tauri/src/updates.rs`. */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "upToDate" }
  | { state: "available"; version: string; notes: string | null }
  | { state: "downloading" }
  | { state: "ready"; version: string }
  | { state: "failed"; message: string };

export type AnnotationSide = "old" | "new";
export type AnnotationStatus = "open" | "resolved" | "outdated";

export interface AnnotationReply {
  author: string;
  text: string;
  at: string;
}

export interface AnnotationAnchor {
  contentHash: string;
  lineText: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface Annotation {
  id: string;
  file: string;
  oldFile?: string;
  side: AnnotationSide;
  startLine: number;
  endLine: number;
  comment: string;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt: string;
  anchor: AnnotationAnchor;
  replies: AnnotationReply[];
}

export interface AnnotationsState {
  annotations: Annotation[];
  reviewPath: string;
}

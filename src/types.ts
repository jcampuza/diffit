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

export interface RepositoryDiff {
  cwd: string;
  repoRoot: string;
  branch: string;
  head: string;
  files: DiffFile[];
}

export interface RepositoryChanged {
  cwd: string;
}

export interface TerminalInstallResult {
  path: string;
  directory: string;
  directoryInPath: boolean;
}

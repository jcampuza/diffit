import type { RepositoryDiff } from "../types";

export function repositorySignature(repository: RepositoryDiff) {
  return JSON.stringify({
    branch: repository.branch,
    cwd: repository.cwd,
    files: repository.files,
    head: repository.head,
    repoRoot: repository.repoRoot,
  });
}

import type { GitStatus } from "@pierre/trees";
import type { DiffStatus } from "../types";

export function toTreeStatus(status: DiffStatus): GitStatus {
  if (status === "added") {
    return "added";
  }
  if (status === "deleted") {
    return "deleted";
  }
  if (status === "renamed") {
    return "renamed";
  }
  if (status === "untracked") {
    return "untracked";
  }
  return "modified";
}

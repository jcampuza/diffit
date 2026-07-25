import { AlertCircle, FileCode2, FolderGit2, Loader2 } from "lucide-react";

export function EmptySidebar({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="sidebar-empty">
      {isLoading ? <Loader2 aria-hidden="true" size={18} className="spin" /> : <FileCode2 aria-hidden="true" size={18} />}
      <span>{isLoading ? "Loading changes" : "No changed files"}</span>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="center-state">
      <Loader2 aria-hidden="true" size={28} className="spin" />
      <h1>Loading repository changes</h1>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="center-state error-state">
      <AlertCircle aria-hidden="true" size={28} />
      <h1>Could not open diff</h1>
      <p>{message}</p>
    </div>
  );
}

export function CleanState({ revision }: { revision: string | null }) {
  return (
    <div className="center-state">
      <FolderGit2 aria-hidden="true" size={28} />
      <h1>{revision ? "This commit is empty" : "Working tree is clean"}</h1>
      <p>{revision ? "This commit does not change any files." : "No local changes were found in this repository."}</p>
    </div>
  );
}

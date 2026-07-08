import { Check, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, Loader2, RefreshCw, Terminal } from "lucide-react";
import { installCli, loadRepository, openRepositoryFolder } from "../repositoryActions";
import { appStore, useShallowAppSelector } from "../store";
import { basename } from "../utils/path";

export function TopBar() {
  const { branch, cliInstallState, filesCount, head, isRefreshing, repoRoot } = useShallowAppSelector((state) => ({
    branch: state.repository?.branch ?? null,
    cliInstallState: state.cliInstallState,
    filesCount: state.repository?.files.length ?? 0,
    head: state.repository?.head ?? null,
    isRefreshing: state.isRefreshing,
    repoRoot: state.repository?.repoRoot ?? null,
  }));

  return (
    <header className="top-bar">
      <div className="repo-title">
        <FolderGit2 aria-hidden="true" size={18} />
        <div>
          <strong>{repoRoot ? basename(repoRoot) : "Diffit"}</strong>
          <span>{repoRoot ?? "Open from a Git repository"}</span>
        </div>
      </div>
      {repoRoot ? (
        <div className="repo-meta">
          <span><GitBranch aria-hidden="true" size={14} />{branch}</span>
          <span><GitCommitHorizontal aria-hidden="true" size={14} />{head}</span>
          <span>{filesCount} files</span>
        </div>
      ) : null}
      {isRefreshing ? (
        <div className="refresh-indicator" role="status">
          <Loader2 aria-hidden="true" size={14} className="spin" />
          <span>Refreshing</span>
        </div>
      ) : null}
      <button className="text-icon-button" type="button" onClick={() => void openRepositoryFolder()}>
        <FolderOpen aria-hidden="true" size={15} />
        <span>Open folder</span>
      </button>
      <button className="text-icon-button" type="button" onClick={() => void installCli()} disabled={cliInstallState === "installing"}>
        {cliInstallState === "installing" ? <Loader2 aria-hidden="true" size={15} className="spin" /> : cliInstallState === "installed" ? <Check aria-hidden="true" size={15} /> : <Terminal aria-hidden="true" size={15} />}
        <span>{cliInstallState === "installed" ? "CLI installed" : "Install CLI"}</span>
      </button>
      <button className="icon-button" type="button" onClick={() => void loadRepository(appStore.state.repository?.cwd, { silent: false })} aria-label="Reload">
        <RefreshCw aria-hidden="true" size={16} />
      </button>
    </header>
  );
}

export function AppMessages() {
  const { cliInstallMessage, cliInstallState, refreshError } = useShallowAppSelector((state) => ({
    cliInstallMessage: state.cliInstallMessage,
    cliInstallState: state.cliInstallState,
    refreshError: state.refreshError,
  }));

  return (
    <>
      {cliInstallMessage ? (
        <div className={`cli-install-message cli-install-${cliInstallState}`} role="status">
          {cliInstallMessage}
        </div>
      ) : null}
      {refreshError ? (
        <div className="cli-install-message cli-install-error" role="status">
          {refreshError}
        </div>
      ) : null}
    </>
  );
}

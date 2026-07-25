import { FolderGit2, GitBranch, GitCommitHorizontal, Loader2, PanelLeftClose, PanelLeftOpen, RefreshCw, Undo2 } from "lucide-react";
import { loadRepository, selectRevision } from "../repositoryActions";
import { appActions, appStore, useAppSelector, useShallowAppSelector } from "../store";
import { basename } from "../utils/path";
import { CommitPicker } from "./CommitPicker";
import { TopBarMenu } from "./TopBarMenu";

function SidebarToggle() {
  const sidebarCollapsed = useAppSelector((state) => state.sidebarCollapsed);
  const label = sidebarCollapsed ? "Show files (⌘B)" : "Hide files (⌘B)";

  return (
    <button
      className="icon-button"
      type="button"
      aria-label={label}
      aria-pressed={!sidebarCollapsed}
      title={label}
      onClick={() => appActions.toggleSidebar()}
    >
      {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" size={16} /> : <PanelLeftClose aria-hidden="true" size={16} />}
    </button>
  );
}

export function TopBar() {
  const { branch, filesCount, head, isRefreshing, repoRoot, revision } = useShallowAppSelector((state) => ({
    branch: state.repository?.branch ?? null,
    filesCount: state.repository?.files.length ?? 0,
    head: state.repository?.head ?? null,
    isRefreshing: state.isRefreshing,
    repoRoot: state.repository?.repoRoot ?? null,
    revision: state.repository?.revision ?? null,
  }));

  return (
    <header className="top-bar">
      <SidebarToggle />
      <div className="repo-title">
        <FolderGit2 aria-hidden="true" size={18} />
        <div>
          <strong>{repoRoot ? basename(repoRoot) : "Diffit"}</strong>
          <span>{repoRoot ?? "Open from a Git repository"}</span>
        </div>
      </div>
      {repoRoot ? (
        <div className="repo-meta">
          {revision ? null : (
            <>
              <span>
                <GitBranch aria-hidden="true" size={14} />
                {branch}
              </span>
              {/* The picker only shows a sha for a selected commit, so HEAD lives here. */}
              <span>
                <GitCommitHorizontal aria-hidden="true" size={14} />
                {head}
              </span>
            </>
          )}
          <span>{filesCount} files</span>
        </div>
      ) : null}
      {repoRoot ? <CommitPicker /> : null}
      {repoRoot && revision ? (
        <button
          className="icon-button"
          type="button"
          aria-label="Back to uncommitted changes"
          title="Back to uncommitted changes"
          onClick={() => void selectRevision(null)}
        >
          <Undo2 aria-hidden="true" size={16} />
        </button>
      ) : null}
      {isRefreshing ? (
        <div className="refresh-indicator" role="status">
          <Loader2 aria-hidden="true" size={14} className="spin" />
          <span>Refreshing</span>
        </div>
      ) : null}
      <button
        className="icon-button"
        type="button"
        onClick={() => void loadRepository(appStore.state.repository?.cwd, { silent: false })}
        aria-label="Reload"
        title="Reload (⌘R)"
      >
        <RefreshCw aria-hidden="true" size={16} />
      </button>
      <TopBarMenu />
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

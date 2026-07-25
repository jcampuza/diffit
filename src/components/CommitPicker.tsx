import { Command } from "cmdk";
import { ChevronDown, GitCommitHorizontal, GitPullRequestArrow, Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { loadCommits, loadMoreCommits, selectRevision } from "../repositoryActions";
import { useShallowAppSelector } from "../store";

export function CommitPicker() {
  const { commandOpen, commits, commitsComplete, commitsError, commitsStatus, filesCount, findOpen, revision } =
    useShallowAppSelector((state) => ({
      commandOpen: state.commandOpen,
      commits: state.commits,
      commitsComplete: state.commitsComplete,
      commitsError: state.commitsError,
      commitsStatus: state.commitsStatus,
      filesCount: state.repository?.files.length ?? 0,
      findOpen: state.findOpen,
      revision: state.repository?.revision ?? null,
    }));
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();

  // The command palette and find bar take over the same keyboard focus, so the
  // popover must not stay mounted (and marked expanded) underneath them.
  if (open && (commandOpen || findOpen)) {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }

    setOpen(true);
    // Refetch every time: commits land while the window is open, and a first
    // failure would otherwise leave the list stuck. The cached list keeps
    // rendering until the new page arrives.
    void loadCommits();
  };

  const choose = (sha: string | null) => {
    close();
    void selectRevision(sha);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div className="commit-picker" ref={containerRef}>
      <button
        ref={triggerRef}
        className="commit-picker-trigger"
        type="button"
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={toggle}
      >
        {revision ? (
          <>
            <GitCommitHorizontal aria-hidden="true" size={14} />
            <span className="commit-picker-sha">{revision.shortSha}</span>
            <span className="commit-picker-trigger-label">{revision.subject}</span>
          </>
        ) : (
          <>
            <GitPullRequestArrow aria-hidden="true" size={14} />
            <span className="commit-picker-trigger-label">Uncommitted changes</span>
            <small>{filesCount}</small>
          </>
        )}
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open ? (
        <div className="commit-picker-popover" id={popoverId} onKeyDown={onKeyDown}>
          <Command filter={commitFilter} label="Select a revision">
            <div className="command-input-wrap">
              <Search aria-hidden="true" size={16} />
              <Command.Input autoFocus placeholder="Filter commits…" />
            </div>
            <Command.List>
              <Command.Empty>No commits match.</Command.Empty>
              <Command.Item
                value="uncommitted changes working tree"
                onSelect={() => choose(null)}
              >
                <GitPullRequestArrow aria-hidden="true" size={15} />
                <span>Uncommitted changes</span>
                <small>{revision ? "working tree" : `${filesCount} files`}</small>
              </Command.Item>
              {commits.map((commit) => (
                <Command.Item
                  key={commit.sha}
                  value={commit.sha}
                  keywords={[commit.shortSha, commit.subject]}
                  onSelect={() => choose(commit.sha)}
                >
                  <span className="commit-picker-sha">{commit.shortSha}</span>
                  <span>{commit.subject}</span>
                  <small>
                    {commit.author} · {commit.relativeDate}
                  </small>
                </Command.Item>
              ))}
              {commits.length > 0 && !commitsComplete ? (
                <Command.Item value="load more commits" onSelect={() => void loadMoreCommits()}>
                  {commitsStatus === "loading" ? (
                    <Loader2 aria-hidden="true" size={15} className="spin" />
                  ) : (
                    <ChevronDown aria-hidden="true" size={15} />
                  )}
                  <span>Load more commits</span>
                </Command.Item>
              ) : null}
            </Command.List>
          </Command>
          <CommitPickerNote
            commitCount={commits.length}
            error={commitsError}
            status={commitsStatus}
          />
        </div>
      ) : null}
    </div>
  );
}

function CommitPickerNote({
  commitCount,
  error,
  status,
}: {
  commitCount: number;
  error: string | null;
  status: "idle" | "loading" | "loaded" | "error";
}) {
  if (status === "loading" && commitCount === 0) {
    return (
      <p className="commit-picker-note">
        <Loader2 aria-hidden="true" size={14} className="spin" />
        Loading commits…
      </p>
    );
  }

  if (status === "error") {
    return <p className="commit-picker-note commit-picker-note-error">{error ?? "Could not list commits."}</p>;
  }

  if (status === "loaded" && commitCount === 0) {
    return <p className="commit-picker-note">This repository has no commits yet.</p>;
  }

  return null;
}

function commitFilter(value: string, search: string, keywords?: string[]) {
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return 1;
  }

  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(needle) ? 1 : 0;
}

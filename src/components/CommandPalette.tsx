import { Command } from "cmdk";
import { ClipboardCopy, MessageSquareText, Search, Sparkles } from "lucide-react";
import { copyAgentPrompt, installAgentSkill } from "../annotationActions";
import { appActions, useShallowAppSelector } from "../store";
import type { DiffFile } from "../types";
import { basename } from "../utils/path";

export function CommandPalette() {
  const { annotations, files, open } = useShallowAppSelector((state) => ({
    annotations: state.annotations,
    files: state.repository?.files ?? [],
    open: state.commandOpen,
  }));
  const hasOpenAnnotations = annotations.some((annotation) => annotation.status === "open");

  return (
    <Command.Dialog
      className="command-dialog"
      container={document.body}
      filter={fuzzyFilter}
      label="Jump to file"
      onOpenChange={appActions.setCommandOpen}
      open={open}
    >
      <div className="command-input-wrap">
        <Search aria-hidden="true" size={16} />
        <Command.Input autoFocus placeholder="Jump to file..." />
      </div>
      <Command.List>
        <Command.Empty>No changed files found.</Command.Empty>
        <Command.Group heading="Actions">
          {hasOpenAnnotations ? (
            <Command.Item
              value="copy agent prompt"
              keywords={["agent", "prompt", "review", "comments", "clipboard"]}
              onSelect={() => {
                void copyAgentPrompt();
                appActions.setCommandOpen(false);
              }}
            >
              <ClipboardCopy aria-hidden="true" size={15} />
              <span>Copy agent prompt</span>
            </Command.Item>
          ) : null}
          <Command.Item
            value="toggle comments panel"
            keywords={["annotations", "comments", "review", "panel"]}
            onSelect={() => {
              appActions.toggleAnnotationsPanel();
              appActions.setCommandOpen(false);
            }}
          >
            <MessageSquareText aria-hidden="true" size={15} />
            <span>Toggle comments panel</span>
          </Command.Item>
          <Command.Item
            value="install claude code skill"
            keywords={["agent", "skill", "claude", "install"]}
            onSelect={() => {
              void installAgentSkill();
              appActions.setCommandOpen(false);
            }}
          >
            <Sparkles aria-hidden="true" size={15} />
            <span>Install Claude Code skill</span>
          </Command.Item>
        </Command.Group>
        <Command.Group heading="Changed files">
          {files.map((file) => (
            <CommandFileItem key={file.path} file={file} />
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function CommandFileItem({ file }: { file: DiffFile }) {
  return (
    <Command.Item
      value={file.path}
      keywords={[basename(file.path), file.status]}
      onSelect={() => {
        appActions.selectPath(file.path);
        appActions.setCommandOpen(false);
      }}
    >
      <span className={`status-dot status-${file.status}`} />
      <span>{file.path}</span>
      <small>{file.additions + file.deletions}</small>
    </Command.Item>
  );
}

function fuzzyFilter(value: string, search: string, keywords?: string[]) {
  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase();
  const needle = search.trim().toLowerCase();
  if (!needle) {
    return 1;
  }

  let score = 0;
  let cursor = 0;
  for (const character of needle) {
    const matchIndex = haystack.indexOf(character, cursor);
    if (matchIndex === -1) {
      return 0;
    }
    score += matchIndex === cursor ? 2 : 1;
    cursor = matchIndex + 1;
  }

  return score / haystack.length;
}

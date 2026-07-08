import { Check, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { appActions, appStore, useShallowAppSelector } from "../store";
import { collectFindMatches, type FindMatch } from "../utils/diff";

export interface FindState {
  activeMatch: FindMatch | null;
  matches: FindMatch[];
  resolvedActiveIndex: number;
}

export function useFindState(): FindState {
  const { activeFindIndex, files, findQuery, selectedPath, viewMode } = useShallowAppSelector((state) => ({
    activeFindIndex: state.activeFindIndex,
    files: state.repository?.files ?? [],
    findQuery: state.findQuery,
    selectedPath: state.selectedPath,
    viewMode: state.viewMode,
  }));
  const matches = useMemo(
    () => collectFindMatches(files, findQuery, viewMode, selectedPath),
    [files, findQuery, selectedPath, viewMode],
  );
  const resolvedActiveIndex = matches.length === 0 ? 0 : Math.min(activeFindIndex, matches.length - 1);

  return {
    activeMatch: matches[resolvedActiveIndex] ?? null,
    matches,
    resolvedActiveIndex,
  };
}

export function FindBar({ findState }: { findState: FindState }) {
  const { findOpen, findQuery, viewMode } = useShallowAppSelector((state) => ({
    findOpen: state.findOpen,
    findQuery: state.findQuery,
    viewMode: state.viewMode,
  }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!findOpen) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [findOpen]);

  if (!findOpen) {
    return null;
  }

  const matchCount = findState.matches.length;

  return (
    <form
      className="find-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        goToFindMatch(findState, 1);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          appActions.setFindOpen(false);
          return;
        }
        if (event.key === "Enter" && event.shiftKey) {
          event.preventDefault();
          goToFindMatch(findState, -1);
        }
      }}
    >
      <Search aria-hidden="true" size={15} />
      <input
        ref={inputRef}
        value={findQuery}
        placeholder={`Find in ${viewMode === "code" ? "all files" : "current file"}`}
        onChange={(event) => appActions.setFindQuery(event.target.value)}
      />
      <span className="find-count">{findQuery.trim() ? (matchCount > 0 ? `${findState.resolvedActiveIndex + 1}/${matchCount}` : "0/0") : " "}</span>
      <button type="button" className="icon-button" onClick={() => goToFindMatch(findState, -1)} aria-label="Previous match" disabled={matchCount === 0}>
        <ChevronUp aria-hidden="true" size={15} />
      </button>
      <button type="button" className="icon-button" onClick={() => goToFindMatch(findState, 1)} aria-label="Next match" disabled={matchCount === 0}>
        <ChevronDown aria-hidden="true" size={15} />
      </button>
      <button type="button" className="icon-button" onClick={() => confirmFind(findState)} aria-label="Go to match" disabled={matchCount === 0}>
        <Check aria-hidden="true" size={15} />
      </button>
      <button type="button" className="icon-button" onClick={() => appActions.setFindOpen(false)} aria-label="Close find">
        <X aria-hidden="true" size={15} />
      </button>
    </form>
  );
}

export function goToFindMatch(findState: FindState, direction: 1 | -1) {
  if (findState.matches.length === 0) {
    return;
  }

  const next = (findState.resolvedActiveIndex + direction + findState.matches.length) % findState.matches.length;
  appStore.setState((state) => ({
    ...state,
    activeFindIndex: next,
    selectedPath: findState.matches[next].filePath,
  }));
}

function confirmFind(findState: FindState) {
  const match = findState.matches[findState.resolvedActiveIndex] ?? null;
  if (match) {
    appActions.selectPath(match.filePath);
  }
}

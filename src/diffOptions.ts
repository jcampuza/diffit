import type { CodeViewOptions, FileDiffOptions } from "@pierre/diffs";
import { PIERRE_DARK_THEME } from "./pierreTheme";

export const DIFF_OPTIONS: FileDiffOptions<undefined> = {
  diffStyle: "split",
  hunkSeparators: "line-info",
  lineDiffType: "word-alt",
  overflow: "scroll",
  stickyHeader: true,
  theme: PIERRE_DARK_THEME,
  themeType: "dark",
  tokenizeMaxLineLength: 1_000,
};

export const CODE_VIEW_OPTIONS: CodeViewOptions<undefined> = {
  diffStyle: "split",
  hunkSeparators: "line-info",
  lineDiffType: "word-alt",
  overflow: "scroll",
  stickyHeaders: true,
  theme: PIERRE_DARK_THEME,
  themeType: "dark",
  tokenizeMaxLineLength: 1_000,
  layout: {
    paddingTop: 0,
    gap: 1,
    paddingBottom: 0,
  },
};

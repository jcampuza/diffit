import pierreDark from "@pierre/theme/pierre-dark";
import { themeToTreeStyles } from "@pierre/trees";
import type { CSSProperties } from "react";

export const PIERRE_DARK_THEME = "pierre-dark";

export const PIERRE_DARK_TREE_STYLE = themeToTreeStyles(pierreDark) as CSSProperties;

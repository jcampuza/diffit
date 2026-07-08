import { FileCode2, Files } from "lucide-react";
import { appActions, type ViewMode } from "../store";

export function ViewModeSwitch({ value }: { value: ViewMode }) {
  return (
    <div className="view-mode-switch" aria-label="Diff view mode" role="group">
      <button type="button" className={value === "file" ? "active" : ""} onClick={() => appActions.setViewMode("file")} aria-pressed={value === "file"}>
        <FileCode2 aria-hidden="true" size={14} />
        <span>File</span>
      </button>
      <button type="button" className={value === "code" ? "active" : ""} onClick={() => appActions.setViewMode("code")} aria-pressed={value === "code"}>
        <Files aria-hidden="true" size={14} />
        <span>Code</span>
      </button>
    </div>
  );
}

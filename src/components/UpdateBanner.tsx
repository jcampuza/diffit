import { Download, Loader2, X } from "lucide-react";
import { appActions, useShallowAppSelector } from "../store";
import { installUpdate } from "../updateActions";

/**
 * Shown for the statuses the user has to act on or wait through. `idle`, `checking` and
 * `upToDate` are silent: the launch check runs on every start, and a banner saying
 * nothing happened would be noise on every launch.
 */
export function UpdateBanner() {
  const { update, updateDismissed } = useShallowAppSelector((state) => ({
    update: state.update,
    updateDismissed: state.updateDismissed,
  }));

  if (updateDismissed) {
    return null;
  }

  if (update.state === "available") {
    return (
      <div className="update-banner" role="status">
        <Download aria-hidden="true" size={15} />
        <span>
          Diffit {update.version} is available.
          {update.notes ? <em> {firstLine(update.notes)}</em> : null}
        </span>
        <button className="update-banner-action" type="button" onClick={() => void installUpdate()}>
          Install and restart
        </button>
        <DismissButton />
      </div>
    );
  }

  if (update.state === "downloading") {
    return (
      <div className="update-banner" role="status">
        <Loader2 aria-hidden="true" size={15} className="spin" />
        <span>Downloading the update…</span>
      </div>
    );
  }

  if (update.state === "ready") {
    return (
      <div className="update-banner" role="status">
        <Loader2 aria-hidden="true" size={15} className="spin" />
        <span>Diffit {update.version} is installed. Restarting…</span>
      </div>
    );
  }

  if (update.state === "failed") {
    return (
      <div className="update-banner update-banner-error" role="status">
        <span>{update.message}</span>
        <DismissButton />
      </div>
    );
  }

  return null;
}

function DismissButton() {
  return (
    <button className="icon-button" type="button" aria-label="Dismiss" onClick={() => appActions.dismissUpdate()}>
      <X aria-hidden="true" size={14} />
    </button>
  );
}

/** Release notes are a whole commit body; the banner has room for its first line. */
function firstLine(notes: string) {
  return notes.trim().split("\n")[0];
}

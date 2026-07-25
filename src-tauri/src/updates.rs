//! Self-updating against the `latest.json` published by the release workflow.
//!
//! Diffit runs one process with a window per repository, so the check and the install
//! happen once for the process and every window is told the result, rather than each
//! window running its own check and three of them racing to download the same bundle.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

const STATUS_EVENT: &str = "update-status";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub(crate) enum UpdateStatus {
    /// Nothing has been checked yet this process.
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        notes: Option<String>,
    },
    Downloading,
    /// Installed on disk; the app is about to restart into it.
    Ready {
        version: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Default)]
struct UpdateInner {
    status: UpdateStatus,
    /// A check or an install is in flight, so a second window must not start another.
    busy: bool,
    /// The automatic check already ran, so later windows opening does not re-check.
    checked: bool,
}

#[derive(Default)]
pub(crate) struct UpdateState {
    inner: Mutex<UpdateInner>,
}

impl UpdateState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, UpdateInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "Update state was poisoned.".to_string())
    }

    /// Records the status and tells every window about it.
    fn publish(&self, app: &AppHandle, status: UpdateStatus) -> Result<UpdateStatus, String> {
        self.lock()?.status = status.clone();
        let _ = app.emit(STATUS_EVENT, status.clone());
        Ok(status)
    }

    /// Clears the in-flight flag, then publishes, so a failed run does not wedge the state.
    fn finish(&self, app: &AppHandle, status: UpdateStatus) -> Result<UpdateStatus, String> {
        self.lock()?.busy = false;
        self.publish(app, status)
    }
}

/// The status a window renders before any event arrives, so a window opened after the
/// check still shows what the process already found.
#[tauri::command]
pub(crate) fn update_status(state: State<'_, UpdateState>) -> Result<UpdateStatus, String> {
    Ok(state.lock()?.status.clone())
}

/// Looks for a newer release.
///
/// `force` is the menu item: it re-checks even when the startup check already ran. The
/// startup check passes `false`, so only the first window to start actually checks.
#[tauri::command]
pub(crate) async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
    force: bool,
) -> Result<UpdateStatus, String> {
    // A development build carries the placeholder version from tauri.conf.json, which is
    // below every published release, so it would otherwise offer to replace itself with
    // the last release on every `tauri dev`.
    if tauri::is_dev() {
        return Ok(UpdateStatus::UpToDate);
    }

    {
        let mut inner = state.lock()?;
        if inner.busy || (!force && inner.checked) {
            return Ok(inner.status.clone());
        }
        inner.busy = true;
        inner.checked = true;
    }

    state.publish(&app, UpdateStatus::Checking)?;

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            return state.finish(&app, check_failed(force, "Could not start the updater", error));
        }
    };

    match updater.check().await {
        Ok(Some(update)) => state.finish(
            &app,
            UpdateStatus::Available {
                version: update.version,
                notes: update.body,
            },
        ),
        Ok(None) => state.finish(&app, UpdateStatus::UpToDate),
        Err(error) => state.finish(&app, check_failed(force, "Could not check for updates", error)),
    }
}

/// A check the user asked for reports why it failed; the one on launch stays quiet.
///
/// The launch check fails for reasons that are none of the user's business and that they
/// cannot act on — a laptop that is offline, GitHub being unreachable, or no release
/// having been published yet — and a banner about it on every launch would be noise.
fn check_failed(force: bool, context: &str, error: impl std::fmt::Display) -> UpdateStatus {
    if force {
        return failed(context, error);
    }

    eprintln!("{context}: {error}");
    UpdateStatus::Idle
}

/// Downloads and installs the newest release, then restarts into it.
///
/// The update is re-resolved rather than carried over from the check: it keeps the
/// (comparatively large) download handle out of the shared state, and the install always
/// applies whatever is current at the moment the user asked for it.
#[tauri::command]
pub(crate) async fn install_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<UpdateStatus, String> {
    {
        let mut inner = state.lock()?;
        if inner.busy {
            return Ok(inner.status.clone());
        }
        inner.busy = true;
    }

    state.publish(&app, UpdateStatus::Downloading)?;

    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            return state.finish(&app, failed("Could not start the updater", error));
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return state.finish(&app, UpdateStatus::UpToDate),
        Err(error) => {
            return state.finish(&app, failed("Could not check for updates", error));
        }
    };

    let version = update.version.clone();
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        return state.finish(&app, failed("Could not install the update", error));
    }

    // Published before restarting so the windows can show what is happening during the
    // moment between the install landing and the process going away.
    state.finish(&app, UpdateStatus::Ready { version })?;
    app.restart();
}

fn failed(context: &str, error: impl std::fmt::Display) -> UpdateStatus {
    UpdateStatus::Failed {
        message: format!("{context}: {error}"),
    }
}

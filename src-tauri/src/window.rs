use crate::git_text;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State, Window};

/// Label of the window declared in `tauri.conf.json`.
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

const WINDOW_TITLE: &str = "Diffit";
const WINDOW_WIDTH: f64 = 1280.0;
const WINDOW_HEIGHT: f64 = 820.0;
const WINDOW_MIN_WIDTH: f64 = 900.0;
const WINDOW_MIN_HEIGHT: f64 = 620.0;
const CASCADE_ORIGIN: f64 = 48.0;
const CASCADE_STEP: f64 = 32.0;
const CASCADE_WRAP: usize = 8;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowContext {
    cwd: String,
}

#[derive(Clone)]
struct WindowEntry {
    cwd: PathBuf,
    repo_root: Option<PathBuf>,
}

/// Maps window labels to the directory (and resolved repository root) they were opened for.
#[derive(Default)]
pub(crate) struct WindowRegistry {
    windows: Mutex<HashMap<String, WindowEntry>>,
}

impl WindowRegistry {
    fn entries(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, WindowEntry>>, String> {
        self.windows
            .lock()
            .map_err(|_| "Window registry state was poisoned.".to_string())
    }

    /// Records the directory `label` is showing.
    ///
    /// Returns `true` when this created a new entry, and `false` when it replaced one.
    pub(crate) fn register(
        &self,
        label: &str,
        cwd: &Path,
        repo_root: Option<&Path>,
    ) -> Result<bool, String> {
        let previous = self.entries()?.insert(
            label.to_string(),
            WindowEntry {
                cwd: cwd.to_path_buf(),
                repo_root: repo_root.map(Path::to_path_buf),
            },
        );

        Ok(previous.is_none())
    }

    pub(crate) fn remove(&self, label: &str) {
        if let Ok(mut entries) = self.entries() {
            entries.remove(label);
        }
    }

    fn cwd_for(&self, label: &str) -> Result<Option<PathBuf>, String> {
        Ok(self.entries()?.get(label).map(|entry| entry.cwd.clone()))
    }

    fn label_for_repo_root(&self, repo_root: &Path) -> Result<Option<String>, String> {
        Ok(self
            .entries()?
            .iter()
            .find(|(_, entry)| entry.repo_root.as_deref() == Some(repo_root))
            .map(|(label, _)| label.clone()))
    }

    /// Finds a window that is not showing any repository, so it can be reused.
    fn label_without_repository(&self) -> Result<Option<String>, String> {
        let entries = self.entries()?;
        let mut labels = entries
            .iter()
            .filter(|(_, entry)| entry.repo_root.is_none())
            .map(|(label, _)| label.clone())
            .collect::<Vec<_>>();
        labels.sort();

        Ok(labels.into_iter().next())
    }

    fn count(&self) -> Result<usize, String> {
        Ok(self.entries()?.len())
    }
}

/// Returns the directory the calling window was opened for.
#[tauri::command]
pub(crate) fn window_context(
    window: Window,
    registry: State<'_, WindowRegistry>,
) -> Result<WindowContext, String> {
    let cwd = window_cwd(&window, &registry)?;

    Ok(WindowContext {
        cwd: cwd.to_string_lossy().into_owned(),
    })
}

/// Resolves the directory for `window`, falling back to the process directory and
/// registering it so later lookups are stable.
pub(crate) fn window_cwd(window: &Window, registry: &WindowRegistry) -> Result<PathBuf, String> {
    if let Some(cwd) = registry.cwd_for(window.label())? {
        return Ok(cwd);
    }

    let cwd = env::current_dir()
        .map_err(|error| format!("Could not resolve the current directory: {error}"))?;
    let repo_root = resolve_repo_root(&cwd);
    registry.register(window.label(), &cwd, repo_root.as_deref())?;

    Ok(cwd)
}

/// Resolves the git repository root for `cwd`, if it is inside one.
pub(crate) fn resolve_repo_root(cwd: &Path) -> Option<PathBuf> {
    let repo_root = git_text(cwd, &["rev-parse", "--show-toplevel"]).ok()?;
    let repo_root = repo_root.trim();
    if repo_root.is_empty() {
        return None;
    }

    Some(PathBuf::from(repo_root))
}

/// Derives a deterministic, Tauri-legal window label for a repository root.
pub(crate) fn repo_window_label(repo_root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(repo_root.to_string_lossy().as_bytes());
    let digest = hasher.finalize();
    let hex = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();

    format!("repo-{hex}")
}

/// Registers the window that Tauri created from `tauri.conf.json` with the process directory.
pub(crate) fn register_startup_window(
    registry: &WindowRegistry,
    label: &str,
) -> Result<(), String> {
    let cwd = env::current_dir()
        .map_err(|error| format!("Could not resolve the current directory: {error}"))?;
    let repo_root = resolve_repo_root(&cwd);

    registry
        .register(label, &cwd, repo_root.as_deref())
        .map(|_| ())
}

/// Focuses the window already showing `repo_root`, or opens a new one for `cwd`.
///
/// Returns the label of the window that should load `cwd`.
pub(crate) fn focus_or_open_window(app: &tauri::AppHandle, cwd: &Path) -> Result<String, String> {
    let registry = app.state::<WindowRegistry>();
    let repo_root = resolve_repo_root(cwd);

    if let Some(repo_root) = repo_root.as_deref() {
        if let Some(label) = registry.label_for_repo_root(repo_root)? {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                return Ok(label);
            }

            // The window is gone but the entry lingered; drop it and open a fresh one.
            registry.remove(&label);
        }
    }

    let label = match repo_root.as_deref() {
        Some(repo_root) => repo_window_label(repo_root),
        None => repo_window_label(cwd),
    };

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        registry.register(&label, cwd, repo_root.as_deref())?;
        return Ok(label);
    }

    // A window opened outside a repository (from Finder, say) is idle; take it over
    // instead of leaving it stranded next to a freshly opened one.
    if let Some(idle_label) = registry.label_without_repository()? {
        if let Some(window) = app.get_webview_window(&idle_label) {
            registry.register(&idle_label, cwd, repo_root.as_deref())?;
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            return Ok(idle_label);
        }

        // The window is gone but the entry lingered; drop it and open a fresh one.
        registry.remove(&idle_label);
    }

    let offset = (registry.count()? % CASCADE_WRAP) as f64 * CASCADE_STEP;
    let registered_new_entry = registry.register(&label, cwd, repo_root.as_deref())?;

    let built = tauri::WebviewWindowBuilder::new(app, label.clone(), tauri::WebviewUrl::default())
        .title(WINDOW_TITLE)
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .min_inner_size(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)
        .position(CASCADE_ORIGIN + offset, CASCADE_ORIGIN + offset)
        .build();

    match built {
        Ok(window) => {
            let _ = window.set_focus();
            Ok(label)
        }
        Err(error) => {
            // A racing invocation may have built the window this label belongs to, so only
            // drop the entry when it is ours and no window answers to it.
            if registered_new_entry && app.get_webview_window(&label).is_none() {
                registry.remove(&label);
            }

            Err(format!(
                "Could not open a window for {}: {error}",
                cwd.display()
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{repo_window_label, WindowRegistry};
    use std::path::{Path, PathBuf};

    #[test]
    fn repo_window_labels_are_stable_for_the_same_root() {
        let root = PathBuf::from("/Users/example/code/diffit");
        assert_eq!(repo_window_label(&root), repo_window_label(&root));
    }

    #[test]
    fn repo_window_labels_differ_between_roots() {
        assert_ne!(
            repo_window_label(Path::new("/Users/example/code/diffit")),
            repo_window_label(Path::new("/Users/example/code/other")),
        );
    }

    #[test]
    fn repo_window_labels_only_use_characters_tauri_allows() {
        let label = repo_window_label(Path::new("/Users/example/code/my repo (1)/#weird"));
        assert!(label.starts_with("repo-"));
        assert!(label
            .chars()
            .all(|character| character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'
                || character == '/'));
    }

    #[test]
    fn registry_looks_windows_up_by_repository_root() {
        let registry = WindowRegistry::default();
        let cwd = PathBuf::from("/Users/example/code/diffit/src");
        let repo_root = PathBuf::from("/Users/example/code/diffit");

        registry
            .register("repo-abc", &cwd, Some(&repo_root))
            .expect("registering a window should succeed");

        assert_eq!(
            registry
                .label_for_repo_root(&repo_root)
                .expect("lookup should succeed"),
            Some("repo-abc".to_string()),
        );
        assert_eq!(
            registry.cwd_for("repo-abc").expect("lookup should succeed"),
            Some(cwd),
        );

        registry.remove("repo-abc");
        assert_eq!(
            registry
                .label_for_repo_root(&repo_root)
                .expect("lookup should succeed"),
            None,
        );
    }

    #[test]
    fn register_reports_whether_it_created_the_entry() {
        let registry = WindowRegistry::default();
        let cwd = PathBuf::from("/Users/example/code/diffit");

        assert!(registry
            .register("repo-abc", &cwd, Some(&cwd))
            .expect("registering a window should succeed"));
        assert!(!registry
            .register("repo-abc", &cwd, Some(&cwd))
            .expect("registering a window should succeed"));
    }

    #[test]
    fn registering_a_repository_moves_a_window_off_the_reuse_list() {
        let registry = WindowRegistry::default();
        let empty = PathBuf::from("/");
        let repo_root = PathBuf::from("/Users/example/code/diffit");

        registry
            .register("main", &empty, None)
            .expect("registering a window should succeed");
        assert_eq!(
            registry
                .label_without_repository()
                .expect("lookup should succeed"),
            Some("main".to_string()),
        );

        registry
            .register("main", &repo_root, Some(&repo_root))
            .expect("registering a window should succeed");
        assert_eq!(
            registry
                .label_without_repository()
                .expect("lookup should succeed"),
            None,
        );
        assert_eq!(
            registry
                .label_for_repo_root(&repo_root)
                .expect("lookup should succeed"),
            Some("main".to_string()),
        );
    }
}

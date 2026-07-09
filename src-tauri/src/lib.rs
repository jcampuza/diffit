mod anchor;
mod annotations;

use annotations::ensure_diffit_dir;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use similar::{ChangeTag, TextDiff};
use std::{
    cmp::Ordering,
    env, fs, io,
    path::{Component, Path, PathBuf},
    process::Command,
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};

const WATCHER_DEBOUNCE: Duration = Duration::from_millis(250);

/// Paths that change during `git status` / tooling and should not trigger a reload.
const IGNORED_WATCH_SEGMENTS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".references",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".vite",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".tox",
    ".idea",
    ".vscode",
    ".DS_Store",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryChanged {
    cwd: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryDiff {
    cwd: String,
    repo_root: String,
    branch: String,
    head: String,
    files: Vec<DiffFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiffFile {
    path: String,
    old_path: Option<String>,
    status: DiffStatus,
    old_content: String,
    new_content: String,
    binary: bool,
    additions: usize,
    deletions: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalInstallResult {
    path: String,
    directory: String,
    directory_in_path: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillInstallResult {
    path: String,
}

const DIFFIT_REVIEW_SKILL: &str = include_str!("../skills/diffit-review/SKILL.md");

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum DiffStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Untracked,
}

#[derive(Debug)]
struct StatusEntry {
    x: u8,
    y: u8,
    path: String,
    old_path: Option<String>,
}

#[derive(Default)]
struct RepositoryWatcherState {
    watcher: Mutex<Option<RepositoryWatcher>>,
}

struct RepositoryWatcher {
    repo_root: PathBuf,
    _repo_watcher: RecommendedWatcher,
    _annotations_watcher: RecommendedWatcher,
    repo_stop_tx: mpsc::Sender<()>,
    annotations_stop_tx: mpsc::Sender<()>,
    repo_worker: Option<JoinHandle<()>>,
    annotations_worker: Option<JoinHandle<()>>,
}

impl Drop for RepositoryWatcher {
    fn drop(&mut self) {
        let _ = self.repo_stop_tx.send(());
        let _ = self.annotations_stop_tx.send(());
        if let Some(worker) = self.repo_worker.take() {
            let _ = worker.join();
        }
        if let Some(worker) = self.annotations_worker.take() {
            let _ = worker.join();
        }
    }
}

#[tauri::command]
fn load_repository(
    app: AppHandle,
    watcher_state: State<'_, RepositoryWatcherState>,
    cwd: Option<String>,
) -> Result<RepositoryDiff, String> {
    let cwd = cwd
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(env::current_dir)
        .map_err(|error| format!("Could not resolve the current directory: {error}"))?;
    let repo_root = git_text(&cwd, &["rev-parse", "--show-toplevel"])?;
    let repo_root = PathBuf::from(repo_root.trim());
    let branch = current_branch(&repo_root)?;
    let head = git_text(&repo_root, &["rev-parse", "--short", "HEAD"])
        .unwrap_or_else(|_| "no commits".to_string());
    let statuses = git_bytes(
        &repo_root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let mut files = parse_status(&statuses)?
        .into_iter()
        .filter_map(|entry| read_diff_file(&repo_root, entry).transpose())
        .collect::<Result<Vec<_>, String>>()?;

    files.sort_by(|left, right| compare_tree_paths(&left.path, &right.path));

    watch_repository(&app, &watcher_state, &repo_root)?;

    Ok(RepositoryDiff {
        cwd: cwd.to_string_lossy().into_owned(),
        repo_root: repo_root.to_string_lossy().into_owned(),
        branch,
        head: head.trim().to_string(),
        files,
    })
}

#[tauri::command]
fn install_terminal_helper() -> Result<TerminalInstallResult, String> {
    let exe_path = env::current_exe()
        .map_err(|error| format!("Could not resolve the app executable: {error}"))?;
    let install_dir = resolve_cli_install_dir()?;
    fs::create_dir_all(&install_dir)
        .map_err(|error| format!("Could not create {}: {error}", install_dir.display()))?;

    let helper_path = install_dir.join("diffit");
    let script = format!(
        "#!/bin/sh\nnohup {} \"$@\" >/dev/null 2>&1 &\n",
        shell_quote(&exe_path)
    );
    fs::write(&helper_path, script)
        .map_err(|error| format!("Could not write {}: {error}", helper_path.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&helper_path)
            .map_err(|error| format!("Could not read {}: {error}", helper_path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&helper_path, permissions).map_err(|error| {
            format!(
                "Could not mark {} as executable: {error}",
                helper_path.display()
            )
        })?;
    }

    Ok(TerminalInstallResult {
        path: helper_path.to_string_lossy().into_owned(),
        directory: install_dir.to_string_lossy().into_owned(),
        directory_in_path: path_contains_dir(&install_dir),
    })
}

#[tauri::command]
fn install_agent_skill() -> Result<SkillInstallResult, String> {
    let home = home_dir()?;
    let skill_dir = home.join(".claude/skills/diffit-review");
    fs::create_dir_all(&skill_dir)
        .map_err(|error| format!("Could not create {}: {error}", skill_dir.display()))?;

    let skill_path = skill_dir.join("SKILL.md");
    fs::write(&skill_path, DIFFIT_REVIEW_SKILL)
        .map_err(|error| format!("Could not write {}: {error}", skill_path.display()))?;

    Ok(SkillInstallResult {
        path: skill_path.to_string_lossy().into_owned(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            let _ = app.emit(
                "repository-changed",
                RepositoryChanged {
                    cwd: cwd.to_string(),
                },
            );
        }));
    }

    builder
        .manage(RepositoryWatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            annotations::create_annotation,
            annotations::delete_annotation,
            annotations::load_annotations,
            annotations::update_annotation,
            install_agent_skill,
            install_terminal_helper,
            load_repository,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diffit");
}

fn watch_repository(
    app: &AppHandle,
    watcher_state: &State<'_, RepositoryWatcherState>,
    repo_root: &Path,
) -> Result<(), String> {
    let mut active_watcher = watcher_state
        .watcher
        .lock()
        .map_err(|_| "Repository watcher state was poisoned.".to_string())?;

    if active_watcher
        .as_ref()
        .is_some_and(|watcher| watcher.repo_root == repo_root)
    {
        return Ok(());
    }

    let (repo_event_tx, repo_event_rx) = mpsc::channel::<()>();
    let (annotations_event_tx, annotations_event_rx) = mpsc::channel::<()>();
    let (repo_stop_tx, repo_stop_rx) = mpsc::channel::<()>();
    let (annotations_stop_tx, annotations_stop_rx) = mpsc::channel::<()>();
    let cwd = repo_root.to_string_lossy().into_owned();
    let repo_worker = spawn_debounced_emitter(
        app.clone(),
        repo_stop_rx,
        repo_event_rx,
        "repository-changed",
        cwd.clone(),
    );
    let annotations_worker = spawn_debounced_emitter(
        app.clone(),
        annotations_stop_rx,
        annotations_event_rx,
        "annotations-changed",
        cwd,
    );

    let repo_notify_tx = repo_event_tx.clone();
    let watched_root = repo_root.to_path_buf();
    let mut repo_watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };

        if !should_emit_watch_event(&watched_root, &event.kind, &event.paths) {
            return;
        }

        let _ = repo_notify_tx.send(());
    })
    .map_err(|error| format!("Could not start repository watcher: {error}"))?;

    repo_watcher
        .watch(repo_root, RecursiveMode::Recursive)
        .map_err(|error| format!("Could not watch {}: {error}", repo_root.display()))?;

    let diffit_dir = ensure_diffit_dir(repo_root)?;
    let annotations_notify_tx = annotations_event_tx;
    let mut annotations_watcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else {
                return;
            };

            if !should_emit_annotations_watch_event(&event.kind, &event.paths) {
                return;
            }

            let _ = annotations_notify_tx.send(());
        })
        .map_err(|error| format!("Could not start annotations watcher: {error}"))?;

    annotations_watcher
        .watch(&diffit_dir, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Could not watch {}: {error}", diffit_dir.display()))?;

    *active_watcher = Some(RepositoryWatcher {
        repo_root: repo_root.to_path_buf(),
        _repo_watcher: repo_watcher,
        _annotations_watcher: annotations_watcher,
        repo_stop_tx,
        annotations_stop_tx,
        repo_worker: Some(repo_worker),
        annotations_worker: Some(annotations_worker),
    });

    Ok(())
}

fn spawn_debounced_emitter(
    app: AppHandle,
    stop_rx: mpsc::Receiver<()>,
    event_rx: mpsc::Receiver<()>,
    event_name: &'static str,
    cwd: String,
) -> JoinHandle<()> {
    thread::spawn(move || loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }

        if event_rx.recv_timeout(Duration::from_millis(100)).is_err() {
            continue;
        }

        loop {
            if stop_rx.try_recv().is_ok() {
                return;
            }

            match event_rx.recv_timeout(WATCHER_DEBOUNCE) {
                Ok(()) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = app.emit(
                        event_name,
                        RepositoryChanged {
                            cwd: cwd.clone(),
                        },
                    );
                    break;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    })
}

fn should_emit_annotations_watch_event(kind: &EventKind, paths: &[PathBuf]) -> bool {
    if matches!(kind, EventKind::Access(_) | EventKind::Other) {
        return false;
    }

    if paths.is_empty() {
        return true;
    }

    paths.iter().any(|path| {
        path.file_name()
            .is_some_and(|name| name == "review.json" || name == "review.json.tmp")
    })
}

fn should_emit_watch_event(repo_root: &Path, kind: &EventKind, paths: &[PathBuf]) -> bool {
    if matches!(kind, EventKind::Access(_) | EventKind::Other) {
        return false;
    }

    // Some backends omit paths; treat those as relevant if the kind is mutating.
    if paths.is_empty() {
        return true;
    }

    paths.iter().any(|path| !is_ignored_watch_path(repo_root, path))
}

fn is_ignored_watch_path(repo_root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(repo_root).unwrap_or(path);
    relative.components().any(|component| match component {
        Component::Normal(segment) => {
            let Some(segment) = segment.to_str() else {
                return false;
            };
            IGNORED_WATCH_SEGMENTS
                .iter()
                .any(|ignored| segment.eq_ignore_ascii_case(ignored))
                || segment.ends_with(".swp")
                || segment.ends_with(".swo")
                || segment.ends_with('~')
        }
        _ => false,
    })
}

fn compare_tree_paths(left: &str, right: &str) -> Ordering {
    let mut left_segments = left.split('/');
    let mut right_segments = right.split('/');

    loop {
        match (left_segments.next(), right_segments.next()) {
            (Some(left_segment), Some(right_segment)) if left_segment == right_segment => continue,
            (Some(left_segment), Some(right_segment)) => {
                let left_is_file_at_level = left_segments.clone().next().is_none();
                let right_is_file_at_level = right_segments.clone().next().is_none();

                return match (left_is_file_at_level, right_is_file_at_level) {
                    (true, false) => Ordering::Greater,
                    (false, true) => Ordering::Less,
                    _ => left_segment.cmp(right_segment),
                };
            }
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (None, None) => return Ordering::Equal,
        }
    }
}

fn resolve_cli_install_dir() -> Result<PathBuf, String> {
    let path_dirs = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();

    for preferred in preferred_cli_dirs()? {
        if path_dirs.iter().any(|dir| dir == &preferred) && is_writable_dir(&preferred) {
            return Ok(preferred);
        }
    }

    for dir in &path_dirs {
        if should_skip_path_dir(dir) {
            continue;
        }
        if is_writable_dir(dir) {
            return Ok(dir.clone());
        }
    }

    let fallback = home_dir()?.join(".local/bin");
    fs::create_dir_all(&fallback)
        .map_err(|error| format!("Could not create {}: {error}", fallback.display()))?;
    if is_writable_dir(&fallback) {
        return Ok(fallback);
    }

    Err("Could not find a writable directory for the `diffit` command.".to_string())
}

fn preferred_cli_dirs() -> Result<Vec<PathBuf>, String> {
    let mut dirs = vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    let home = home_dir()?;
    dirs.push(home.join(".local/bin"));
    dirs.push(home.join("bin"));
    Ok(dirs)
}

fn home_dir() -> Result<PathBuf, String> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the home directory.".to_string())
}

fn is_writable_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }

    let probe = dir.join(format!(".diffit-write-test-{}", std::process::id()));
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(_) => {
            let _ = fs::remove_file(probe);
            true
        }
        Err(error) => error.kind() == io::ErrorKind::AlreadyExists,
    }
}

fn should_skip_path_dir(dir: &Path) -> bool {
    matches!(
        dir.to_string_lossy().as_ref(),
        "/bin" | "/sbin" | "/usr/bin" | "/usr/sbin"
    )
}

fn path_contains_dir(target: &Path) -> bool {
    env::var_os("PATH")
        .map(|path| env::split_paths(&path).any(|dir| dir == target))
        .unwrap_or(false)
}

fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

fn current_branch(repo_root: &Path) -> Result<String, String> {
    let branch = git_text(repo_root, &["branch", "--show-current"])?;
    let branch = branch.trim();
    if !branch.is_empty() {
        return Ok(branch.to_string());
    }

    Ok(format!(
        "detached @ {}",
        git_text(repo_root, &["rev-parse", "--short", "HEAD"])?.trim()
    ))
}

fn read_diff_file(repo_root: &Path, entry: StatusEntry) -> Result<Option<DiffFile>, String> {
    let status = classify_status(&entry);
    let new_path = repo_root.join(&entry.path);
    let old_path = entry.old_path.as_deref().unwrap_or(&entry.path);
    let old_bytes = match status {
        DiffStatus::Added | DiffStatus::Untracked => Vec::new(),
        _ => git_bytes(repo_root, &["show", &format!("HEAD:{old_path}")]).unwrap_or_default(),
    };
    let new_bytes = match status {
        DiffStatus::Deleted => Vec::new(),
        _ => fs::read(&new_path).unwrap_or_default(),
    };

    let old_text = text_from_bytes(&old_bytes);
    let new_text = text_from_bytes(&new_bytes);
    let binary = old_text.is_none() || new_text.is_none();
    let (old_content, new_content) = match (old_text, new_text) {
        (Some(old_content), Some(new_content)) => (old_content, new_content),
        _ => (String::new(), String::new()),
    };

    if old_content == new_content && !matches!(status, DiffStatus::Renamed) {
        return Ok(None);
    }

    let (additions, deletions) = count_changes(&old_content, &new_content);

    Ok(Some(DiffFile {
        path: entry.path,
        old_path: entry.old_path,
        status,
        old_content,
        new_content,
        binary,
        additions,
        deletions,
    }))
}

fn classify_status(entry: &StatusEntry) -> DiffStatus {
    if entry.x == b'?' && entry.y == b'?' {
        return DiffStatus::Untracked;
    }
    if entry.x == b'R' || entry.y == b'R' {
        return DiffStatus::Renamed;
    }
    if entry.x == b'A' || entry.y == b'A' {
        return DiffStatus::Added;
    }
    if entry.x == b'D' || entry.y == b'D' {
        return DiffStatus::Deleted;
    }
    DiffStatus::Modified
}

fn count_changes(old_content: &str, new_content: &str) -> (usize, usize) {
    let diff = TextDiff::from_lines(old_content, new_content);
    let mut additions = 0;
    let mut deletions = 0;

    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Insert => additions += 1,
            ChangeTag::Delete => deletions += 1,
            ChangeTag::Equal => {}
        }
    }

    (additions, deletions)
}

fn text_from_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.iter().any(|byte| *byte == 0) {
        return None;
    }

    std::str::from_utf8(bytes).map(str::to_string).ok()
}

fn parse_status(bytes: &[u8]) -> Result<Vec<StatusEntry>, String> {
    let mut entries = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        let Some(next_nul) = bytes[index..].iter().position(|byte| *byte == 0) else {
            return Err("Git status output was not NUL-terminated.".to_string());
        };
        let raw = &bytes[index..index + next_nul];
        index += next_nul + 1;

        if raw.len() < 4 {
            continue;
        }

        let x = raw[0];
        let y = raw[1];
        let path = String::from_utf8_lossy(&raw[3..]).to_string();
        let old_path = if x == b'R' || y == b'R' || x == b'C' || y == b'C' {
            let Some(rename_nul) = bytes[index..].iter().position(|byte| *byte == 0) else {
                return Err("Git rename status output was not NUL-terminated.".to_string());
            };
            let previous = String::from_utf8_lossy(&bytes[index..index + rename_nul]).to_string();
            index += rename_nul + 1;
            Some(previous)
        } else {
            None
        };

        entries.push(StatusEntry {
            x,
            y,
            path,
            old_path,
        });
    }

    Ok(entries)
}

pub(crate) fn git_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let bytes = git_bytes(cwd, args)?;
    String::from_utf8(bytes).map_err(|error| format!("Git output was not UTF-8: {error}"))
}

pub(crate) fn git_bytes(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("Could not run git: {error}"))?;

    if output.status.success() {
        return Ok(output.stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(stderr.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{compare_tree_paths, is_ignored_watch_path, should_emit_watch_event};
    use notify::EventKind;
    use std::path::PathBuf;

    #[test]
    fn tree_path_order_puts_nested_directory_files_before_sibling_files() {
        let mut paths = vec![
            "matchnode/app-desktop/modules/profile-display/index.jsx",
            "matchnode/app-desktop/modules/profile-display/marketing-profiles/MarketingProfile.tsx",
            "matchnode/app-desktop/modules/profile-display/layout/types.ts",
            "matchnode/app-desktop/actions/profile/cards.js",
        ];

        paths.sort_by(|left, right| compare_tree_paths(left, right));

        assert_eq!(
            paths,
            vec![
                "matchnode/app-desktop/actions/profile/cards.js",
                "matchnode/app-desktop/modules/profile-display/layout/types.ts",
                "matchnode/app-desktop/modules/profile-display/marketing-profiles/MarketingProfile.tsx",
                "matchnode/app-desktop/modules/profile-display/index.jsx",
            ],
        );
    }

    #[test]
    fn ignored_watch_paths_skip_git_and_dependency_trees() {
        let repo = PathBuf::from("/tmp/repo");
        assert!(is_ignored_watch_path(
            &repo,
            &repo.join(".git/index")
        ));
        assert!(is_ignored_watch_path(
            &repo,
            &repo.join("node_modules/left-pad/index.js")
        ));
        assert!(is_ignored_watch_path(
            &repo,
            &repo.join(".references/pierre/README")
        ));
        assert!(!is_ignored_watch_path(
            &repo,
            &repo.join("src/components/DiffView.tsx")
        ));
    }

    #[test]
    fn watch_events_ignore_access_and_git_paths() {
        let repo = PathBuf::from("/tmp/repo");
        assert!(!should_emit_watch_event(
            &repo,
            &EventKind::Access(notify::event::AccessKind::Any),
            &[repo.join("src/App.tsx")],
        ));
        assert!(!should_emit_watch_event(
            &repo,
            &EventKind::Modify(notify::event::ModifyKind::Any),
            &[repo.join(".git/index")],
        ));
        assert!(should_emit_watch_event(
            &repo,
            &EventKind::Modify(notify::event::ModifyKind::Any),
            &[repo.join("src/App.tsx")],
        ));
    }
}

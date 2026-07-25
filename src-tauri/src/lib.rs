mod anchor;
mod annotations;
mod revision;
mod window;

use annotations::ensure_diffit_dir;
use revision::{CommitContext, RevisionInfo};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use similar::{ChangeTag, TextDiff};
use std::{
    cmp::Ordering,
    collections::HashMap,
    env, fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex},
    thread::{self, JoinHandle},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use window::{WindowRegistry, MAIN_WINDOW_LABEL};

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
    /// `None` when the diff is the working tree, otherwise the commit it came from.
    revision: Option<RevisionInfo>,
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
pub(crate) enum DiffStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Untracked,
}

#[derive(Debug)]
pub(crate) struct StatusEntry {
    pub(crate) x: u8,
    pub(crate) y: u8,
    pub(crate) path: String,
    pub(crate) old_path: Option<String>,
}

/// Where one side of a diff reads its content from.
enum ContentSource {
    /// The blob at `<rev>:<path>`.
    Blob(String),
    /// The file on disk, relative to the repository root.
    WorkTree,
}

/// The pair of content sources a diff is built from.
struct DiffSources {
    old: ContentSource,
    new: ContentSource,
}

impl DiffSources {
    /// Uncommitted changes: `HEAD` against the files on disk.
    fn working_tree() -> Self {
        Self {
            old: ContentSource::Blob("HEAD".to_string()),
            new: ContentSource::WorkTree,
        }
    }

    /// A commit against the tree it was based on.
    fn commit(context: &CommitContext) -> Self {
        Self {
            old: ContentSource::Blob(context.base.clone()),
            new: ContentSource::Blob(context.sha.clone()),
        }
    }
}

#[derive(Default)]
struct RepositoryWatcherState {
    watchers: Mutex<HashMap<String, WatcherSlot>>,
}

/// A watcher that is still being built, or one that is running.
///
/// Reserving the slot before the (comparatively slow) watcher is constructed keeps the
/// registry lock short without letting two loads for the same window both install one.
enum WatcherSlot {
    Pending(PathBuf),
    Active(Box<RepositoryWatcher>),
}

impl WatcherSlot {
    fn repo_root(&self) -> &Path {
        match self {
            Self::Pending(repo_root) => repo_root,
            Self::Active(watcher) => &watcher.repo_root,
        }
    }

    fn is_pending_for(&self, repo_root: &Path) -> bool {
        matches!(self, Self::Pending(pending) if pending.as_path() == repo_root)
    }

    /// Hands back the watcher whose `Drop` joins worker threads, so the caller can drop it
    /// away from the registry lock.
    fn into_watcher(self) -> Option<Box<RepositoryWatcher>> {
        match self {
            Self::Pending(_) => None,
            Self::Active(watcher) => Some(watcher),
        }
    }
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

/// Runs off the UI thread: a synchronous command body executes on the thread that
/// received the IPC message, which on macOS is the thread AppKit drives the windows
/// from, so a large diff would stall window switching until the load finished.
#[tauri::command(async)]
fn load_repository(
    app: AppHandle,
    window: tauri::Window,
    registry: State<'_, WindowRegistry>,
    watcher_state: State<'_, RepositoryWatcherState>,
    cwd: Option<String>,
    revision: Option<String>,
) -> Result<RepositoryDiff, String> {
    let cwd = match cwd {
        Some(cwd) => PathBuf::from(cwd),
        None => window::window_cwd(&window, &registry)?,
    };
    let repo_root = git_text(&cwd, &["rev-parse", "--show-toplevel"])?;
    let repo_root = PathBuf::from(repo_root.trim());
    let branch = current_branch(&repo_root)?;

    let context = match revision.as_deref() {
        Some(revision) => Some(revision::resolve_commit(&repo_root, revision)?),
        None => None,
    };

    let (head, entries, sources) = match context.as_ref() {
        Some(context) => (
            context.short_sha.clone(),
            revision::commit_status_entries(&repo_root, context)?,
            DiffSources::commit(context),
        ),
        None => {
            let head = git_text(&repo_root, &["rev-parse", "--short", "HEAD"])
                .unwrap_or_else(|_| "no commits".to_string());
            let statuses = git_bytes(
                &repo_root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            )?;
            (head, parse_status(&statuses)?, DiffSources::working_tree())
        }
    };

    let mut files = read_diff_files(&repo_root, &sources, entries);

    files.sort_by(|left, right| compare_tree_paths(&left.path, &right.path));

    // The window may have been pointed at a different repository since it was created,
    // so keep the registry in step with what it is actually showing.
    registry.register(window.label(), &cwd, Some(&repo_root))?;
    watch_repository(&app, &watcher_state, window.label(), &repo_root)?;

    Ok(RepositoryDiff {
        cwd: cwd.to_string_lossy().into_owned(),
        repo_root: repo_root.to_string_lossy().into_owned(),
        branch,
        head: head.trim().to_string(),
        files,
        revision: context.map(CommitContext::into_info),
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
            let cwd = PathBuf::from(cwd);
            let Ok(label) = window::focus_or_open_window(app, &cwd) else {
                return;
            };

            // Distinct from `repository-changed`: the user asked for this repository, so the
            // window should show its working tree rather than keep the commit it was on.
            let _ = app.emit_to(
                label.as_str(),
                "repository-opened",
                RepositoryChanged {
                    cwd: cwd.to_string_lossy().into_owned(),
                },
            );
        }));
    }

    builder
        .manage(RepositoryWatcherState::default())
        .manage(WindowRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let registry = app.state::<WindowRegistry>();
            if let Err(error) = window::register_startup_window(&registry, MAIN_WINDOW_LABEL) {
                eprintln!("{error}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::Destroyed) {
                return;
            }

            window.state::<WindowRegistry>().remove(window.label());
            release_watcher(&window.state::<RepositoryWatcherState>(), window.label());
        })
        .invoke_handler(tauri::generate_handler![
            annotations::clear_annotations,
            annotations::create_annotation,
            annotations::delete_annotation,
            annotations::load_annotations,
            annotations::update_annotation,
            install_agent_skill,
            install_terminal_helper,
            load_repository,
            revision::list_commits,
            window::window_context,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Diffit");
}

/// Drops the watcher for `label`, stopping its worker threads.
///
/// The drop joins the worker threads, so it runs off the window event thread.
fn release_watcher(watcher_state: &RepositoryWatcherState, label: &str) {
    let slot = watcher_state
        .watchers
        .lock()
        .ok()
        .and_then(|mut watchers| watchers.remove(label));

    drop_watcher_off_thread(slot.and_then(WatcherSlot::into_watcher));
}

/// Drops a watcher away from the caller's thread, because its `Drop` joins worker threads
/// that may be parked for a debounce interval.
fn drop_watcher_off_thread(watcher: Option<Box<RepositoryWatcher>>) {
    if let Some(watcher) = watcher {
        thread::spawn(move || drop(watcher));
    }
}

/// Releases the reservation `watch_repository` made, when building the watcher failed.
fn clear_pending_watcher(watcher_state: &RepositoryWatcherState, label: &str, repo_root: &Path) {
    if let Ok(mut active_watchers) = watcher_state.watchers.lock() {
        if active_watchers
            .get(label)
            .is_some_and(|slot| slot.is_pending_for(repo_root))
        {
            active_watchers.remove(label);
        }
    }
}

fn watch_repository(
    app: &AppHandle,
    watcher_state: &State<'_, RepositoryWatcherState>,
    label: &str,
    repo_root: &Path,
) -> Result<(), String> {
    let replaced = {
        let mut active_watchers = watcher_state
            .watchers
            .lock()
            .map_err(|_| "Repository watcher state was poisoned.".to_string())?;

        if active_watchers
            .get(label)
            .is_some_and(|slot| slot.repo_root() == repo_root)
        {
            return Ok(());
        }

        active_watchers.insert(
            label.to_string(),
            WatcherSlot::Pending(repo_root.to_path_buf()),
        )
    };

    drop_watcher_off_thread(replaced.and_then(WatcherSlot::into_watcher));

    let watcher = match build_repository_watcher(app, label, repo_root) {
        Ok(watcher) => watcher,
        Err(error) => {
            clear_pending_watcher(watcher_state, label, repo_root);
            return Err(error);
        }
    };

    let mut active_watchers = watcher_state
        .watchers
        .lock()
        .map_err(|_| "Repository watcher state was poisoned.".to_string())?;

    if !active_watchers
        .get(label)
        .is_some_and(|slot| slot.is_pending_for(repo_root))
    {
        // A later load, or the window closing, superseded this watcher before it was ready.
        drop(active_watchers);
        drop_watcher_off_thread(Some(Box::new(watcher)));
        return Ok(());
    }

    active_watchers.insert(label.to_string(), WatcherSlot::Active(Box::new(watcher)));

    Ok(())
}

/// Builds the repository and annotations watchers for `repo_root`, without holding any lock.
fn build_repository_watcher(
    app: &AppHandle,
    label: &str,
    repo_root: &Path,
) -> Result<RepositoryWatcher, String> {
    let (repo_event_tx, repo_event_rx) = mpsc::channel::<()>();
    let (annotations_event_tx, annotations_event_rx) = mpsc::channel::<()>();
    let (repo_stop_tx, repo_stop_rx) = mpsc::channel::<()>();
    let (annotations_stop_tx, annotations_stop_rx) = mpsc::channel::<()>();
    let cwd = repo_root.to_string_lossy().into_owned();
    let repo_worker = spawn_debounced_emitter(
        app.clone(),
        label.to_string(),
        repo_stop_rx,
        repo_event_rx,
        "repository-changed",
        cwd.clone(),
    );
    let annotations_worker = spawn_debounced_emitter(
        app.clone(),
        label.to_string(),
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

    Ok(RepositoryWatcher {
        repo_root: repo_root.to_path_buf(),
        _repo_watcher: repo_watcher,
        _annotations_watcher: annotations_watcher,
        repo_stop_tx,
        annotations_stop_tx,
        repo_worker: Some(repo_worker),
        annotations_worker: Some(annotations_worker),
    })
}

fn spawn_debounced_emitter(
    app: AppHandle,
    label: String,
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
                    let _ = app.emit_to(
                        label.as_str(),
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

/// Builds the diff for every changed file, reading all blobs in one batch.
fn read_diff_files(
    repo_root: &Path,
    sources: &DiffSources,
    entries: Vec<StatusEntry>,
) -> Vec<DiffFile> {
    let statuses = entries.iter().map(classify_status).collect::<Vec<_>>();

    let mut requests = Vec::with_capacity(entries.len() * 2);
    for (entry, status) in entries.iter().zip(&statuses) {
        let old_path = entry.old_path.as_deref().unwrap_or(&entry.path);
        requests.push(match status {
            DiffStatus::Added | DiffStatus::Untracked => SideRequest::Empty,
            _ => SideRequest::for_side(&sources.old, old_path),
        });
        requests.push(match status {
            DiffStatus::Deleted => SideRequest::Empty,
            _ => SideRequest::for_side(&sources.new, &entry.path),
        });
    }

    let mut sides = read_sides(repo_root, &requests).into_iter();

    entries
        .into_iter()
        .zip(statuses)
        .filter_map(|(entry, status)| {
            let old_bytes = sides.next().unwrap_or_default();
            let new_bytes = sides.next().unwrap_or_default();
            build_diff_file(entry, status, &old_bytes, &new_bytes)
        })
        .collect()
}

fn build_diff_file(
    entry: StatusEntry,
    status: DiffStatus,
    old_bytes: &[u8],
    new_bytes: &[u8],
) -> Option<DiffFile> {
    let old_text = text_from_bytes(old_bytes);
    let new_text = text_from_bytes(new_bytes);
    let binary = old_text.is_none() || new_text.is_none();
    let (old_content, new_content) = match (old_text, new_text) {
        (Some(old_content), Some(new_content)) => (old_content, new_content),
        _ => (String::new(), String::new()),
    };

    if old_content == new_content && !matches!(status, DiffStatus::Renamed) {
        return None;
    }

    let (additions, deletions) = count_changes(&old_content, &new_content);

    Some(DiffFile {
        path: entry.path,
        old_path: entry.old_path,
        status,
        old_content,
        new_content,
        binary,
        additions,
        deletions,
    })
}

/// One side of one file, before its content has been read.
enum SideRequest {
    /// The file does not exist on this side.
    Empty,
    /// A `<rev>:<path>` object spec.
    Blob(String),
    /// A path relative to the repository root.
    WorkTree(String),
}

impl SideRequest {
    fn for_side(source: &ContentSource, path: &str) -> Self {
        match source {
            ContentSource::Blob(rev) => Self::Blob(format!("{rev}:{path}")),
            ContentSource::WorkTree => Self::WorkTree(path.to_string()),
        }
    }
}

/// Resolves every side of every file. A missing blob or file reads as empty, as it does
/// for files git cannot show.
fn read_sides(repo_root: &Path, requests: &[SideRequest]) -> Vec<Vec<u8>> {
    let specs = requests
        .iter()
        .filter_map(|request| match request {
            SideRequest::Blob(spec) => Some(spec.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>();

    let mut blobs = read_blobs(repo_root, &specs).into_iter();

    requests
        .iter()
        .map(|request| match request {
            SideRequest::Empty => Vec::new(),
            SideRequest::Blob(_) => blobs.next().unwrap_or_default(),
            SideRequest::WorkTree(path) => fs::read(repo_root.join(path)).unwrap_or_default(),
        })
        .collect()
}

/// Reads every object in a single `git cat-file --batch`.
///
/// Starting a `git show` per file costs milliseconds of process start-up each, which
/// dominates the load of a repository with many changed files. Batch input is newline
/// separated, so a path containing a newline falls back to one `git show` per object,
/// as does any batch git could not complete.
fn read_blobs(repo_root: &Path, specs: &[&str]) -> Vec<Vec<u8>> {
    if specs.is_empty() {
        return Vec::new();
    }

    if !specs.iter().any(|spec| spec.contains(['\n', '\r'])) {
        if let Ok(blobs) = batch_read_blobs(repo_root, specs) {
            if blobs.len() == specs.len() {
                return blobs;
            }
        }
    }

    specs
        .iter()
        .map(|spec| git_bytes(repo_root, &["show", spec]).unwrap_or_default())
        .collect()
}

fn batch_read_blobs(repo_root: &Path, specs: &[&str]) -> Result<Vec<Vec<u8>>, String> {
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .current_dir(repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not run git: {error}"))?;

    let mut input = String::new();
    for spec in specs {
        input.push_str(spec);
        input.push('\n');
    }

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Could not write to git.".to_string())?;
    // git stops reading once its own output pipe fills, so the write has to overlap the read.
    let writer = thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not run git: {error}"))?;
    let _ = writer.join();

    if !output.status.success() {
        return Err("Could not read the repository contents.".to_string());
    }

    parse_cat_file_batch(&output.stdout, specs.len())
}

/// Parses `git cat-file --batch` output.
///
/// Each request answers with either `<oid> <type> <size>` followed by that many bytes and
/// a newline, or a header without a size (`missing`, `ambiguous`) and no content at all.
fn parse_cat_file_batch(bytes: &[u8], expected: usize) -> Result<Vec<Vec<u8>>, String> {
    let mut blobs = Vec::with_capacity(expected);
    let mut index = 0;

    while blobs.len() < expected {
        let Some(rest) = bytes.get(index..) else {
            return Err("Git object output ended early.".to_string());
        };
        let Some(newline) = rest.iter().position(|byte| *byte == b'\n') else {
            return Err("Git object output ended early.".to_string());
        };
        let header = String::from_utf8_lossy(&rest[..newline]);
        index += newline + 1;

        let Some(size) = header
            .rsplit(' ')
            .next()
            .and_then(|size| size.parse::<usize>().ok())
        else {
            blobs.push(Vec::new());
            continue;
        };

        if index + size > bytes.len() {
            return Err("Git object output was truncated.".to_string());
        }

        blobs.push(bytes[index..index + size].to_vec());
        // Skip the content and the newline git writes after it.
        index += size + 1;
    }

    Ok(blobs)
}

pub(crate) fn classify_status(entry: &StatusEntry) -> DiffStatus {
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
    use super::{
        compare_tree_paths, is_ignored_watch_path, parse_cat_file_batch, should_emit_watch_event,
    };
    use notify::EventKind;
    use std::path::PathBuf;

    #[test]
    fn cat_file_batch_reads_content_by_its_declared_size() {
        let raw = b"1111111 blob 6\nhello\n\n2222222 blob 3\na\nb\n";
        let blobs = parse_cat_file_batch(raw, 2).expect("parsing should succeed");

        assert_eq!(blobs.len(), 2);
        assert_eq!(blobs[0], b"hello\n");
        assert_eq!(blobs[1], b"a\nb");
    }

    #[test]
    fn cat_file_batch_reads_missing_objects_as_empty() {
        let raw = b"HEAD:gone.txt missing\n3333333 blob 2\nhi\n";
        let blobs = parse_cat_file_batch(raw, 2).expect("parsing should succeed");

        assert!(blobs[0].is_empty());
        assert_eq!(blobs[1], b"hi");
    }

    #[test]
    fn cat_file_batch_reads_an_empty_object() {
        let raw = b"4444444 blob 0\n\n";
        let blobs = parse_cat_file_batch(raw, 1).expect("parsing should succeed");

        assert_eq!(blobs.len(), 1);
        assert!(blobs[0].is_empty());
    }

    #[test]
    fn cat_file_batch_stops_at_the_requested_count() {
        let raw = b"5555555 blob 1\nx\n6666666 blob 1\ny\n";
        assert_eq!(
            parse_cat_file_batch(raw, 1).expect("parsing should succeed"),
            vec![b"x".to_vec()],
        );
    }

    #[test]
    fn cat_file_batch_rejects_short_and_truncated_output() {
        assert!(parse_cat_file_batch(b"", 1).is_err());
        assert!(parse_cat_file_batch(b"7777777 blob 1\nx\n", 2).is_err());
        assert!(parse_cat_file_batch(b"8888888 blob 40\nshort\n", 1).is_err());
    }

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

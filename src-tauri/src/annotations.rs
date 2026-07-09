use crate::anchor::{active_strategy, AnchorOutcome, AnchorSnapshot};
use crate::git_bytes;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;

const ID_CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
static ID_COUNTER: AtomicU64 = AtomicU64::new(0);
static WRITE_TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static REVIEW_FILE_LOCK: Mutex<()> = Mutex::new(());

fn acquire_review_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    REVIEW_FILE_LOCK
        .lock()
        .map_err(|_| "Review file lock was poisoned.".to_string())
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationSide {
    Old,
    New,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationStatus {
    Open,
    Resolved,
    Outdated,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationAnchor {
    pub content_hash: String,
    pub line_text: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationReply {
    pub author: String,
    pub text: String,
    pub at: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_file: Option<String>,
    pub side: AnnotationSide,
    pub start_line: usize,
    pub end_line: usize,
    pub comment: String,
    pub status: AnnotationStatus,
    pub created_at: String,
    pub updated_at: String,
    pub anchor: AnnotationAnchor,
    pub replies: Vec<AnnotationReply>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationsFile {
    pub version: u32,
    pub annotations: Vec<Annotation>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationsState {
    pub annotations: Vec<Annotation>,
    pub review_path: String,
}

pub(crate) fn resolve_review_path(repo_root: &Path) -> Result<PathBuf, String> {
    let git_dir = crate::git_text(repo_root, &["rev-parse", "--absolute-git-dir"])?;
    Ok(PathBuf::from(git_dir.trim()).join("diffit").join("review.json"))
}

pub(crate) fn ensure_diffit_dir(repo_root: &Path) -> Result<PathBuf, String> {
    let git_dir = crate::git_text(repo_root, &["rev-parse", "--absolute-git-dir"])?;
    let diffit_dir = PathBuf::from(git_dir.trim()).join("diffit");
    fs::create_dir_all(&diffit_dir)
        .map_err(|error| format!("Could not create {}: {error}", diffit_dir.display()))?;
    Ok(diffit_dir)
}

fn resolve_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    cwd.map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(std::env::current_dir)
        .map_err(|error| format!("Could not resolve the current directory: {error}"))
}

fn resolve_repo_root(cwd: &Path) -> Result<PathBuf, String> {
    let repo_root = crate::git_text(cwd, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(repo_root.trim()))
}

fn read_annotations_file(path: &Path) -> Result<AnnotationsFile, String> {
    if !path.exists() {
        return Ok(AnnotationsFile {
            version: 1,
            annotations: Vec::new(),
            extra: serde_json::Map::new(),
        });
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Could not parse {}: {error}", path.display()))
}

fn write_annotations_file(path: &Path, file: &AnnotationsFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Could not resolve parent of {}.", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

    let counter = WRITE_TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp_path = parent.join(format!(
        "review.json.{}.{}.tmp",
        std::process::id(),
        counter
    ));
    let json = serde_json::to_string_pretty(file)
        .map_err(|error| format!("Could not serialize annotations: {error}"))?;
    fs::write(&tmp_path, json)
        .map_err(|error| format!("Could not write {}: {error}", tmp_path.display()))?;
    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!("Could not replace {}: {error}", path.display()));
    }
    Ok(())
}

fn split_lines(content: &str) -> Vec<String> {
    content
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
        .collect()
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn build_anchor_snapshot(content: &str, start_line: usize) -> AnnotationAnchor {
    let lines = split_lines(content);
    let line_text = lines
        .get(start_line.saturating_sub(1))
        .cloned()
        .unwrap_or_default();

    let mut context_before = Vec::new();
    for offset in (1..=3).rev() {
        if start_line > offset {
            if let Some(line) = lines.get(start_line - 1 - offset) {
                context_before.push(line.clone());
            }
        }
    }

    let mut context_after = Vec::new();
    for offset in 1..=3 {
        if let Some(line) = lines.get(start_line - 1 + offset) {
            context_after.push(line.clone());
        }
    }

    AnnotationAnchor {
        content_hash: content_hash(content),
        line_text,
        context_before,
        context_after,
        extra: serde_json::Map::new(),
    }
}

fn read_side_content(
    repo_root: &Path,
    file: &str,
    old_file: Option<&str>,
    side: AnnotationSide,
) -> String {
    match side {
        AnnotationSide::New => fs::read_to_string(repo_root.join(file)).unwrap_or_default(),
        AnnotationSide::Old => {
            let path = old_file.unwrap_or(file);
            String::from_utf8(git_bytes(repo_root, &["show", &format!("HEAD:{path}")]).unwrap_or_default())
                .unwrap_or_default()
        }
    }
}

fn anchor_snapshot_from_annotation(anchor: &AnnotationAnchor) -> AnchorSnapshot {
    AnchorSnapshot {
        line_text: anchor.line_text.clone(),
        context_before: anchor.context_before.clone(),
        context_after: anchor.context_after.clone(),
    }
}

fn clamp_end_line(end_line: usize, line_count: usize) -> usize {
    end_line.max(1).min(line_count.max(1))
}

fn reanchor_annotations(repo_root: &Path, annotations: &mut [Annotation]) -> bool {
    let strategy = active_strategy();
    let mut changed = false;

    for annotation in annotations.iter_mut() {
        if annotation.status == AnnotationStatus::Resolved {
            continue;
        }

        let content = read_side_content(
            repo_root,
            &annotation.file,
            annotation.old_file.as_deref(),
            annotation.side,
        );
        let current_hash = content_hash(&content);

        if current_hash == annotation.anchor.content_hash {
            continue;
        }

        let lines = split_lines(&content);
        let line_refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        let snapshot = anchor_snapshot_from_annotation(&annotation.anchor);

        match strategy.resolve(&snapshot, &line_refs, annotation.start_line) {
            AnchorOutcome::Matched { start_line } => {
                let delta = start_line as i64 - annotation.start_line as i64;
                let new_start = start_line;
                let new_end = ((annotation.end_line as i64 + delta).max(1)) as usize;
                let line_count = lines.len().max(1);
                let new_end = clamp_end_line(new_end, line_count).max(new_start);

                annotation.start_line = new_start;
                annotation.end_line = new_end;
                annotation.anchor = build_anchor_snapshot(&content, new_start);
                if annotation.status == AnnotationStatus::Outdated {
                    annotation.status = AnnotationStatus::Open;
                }
                changed = true;
            }
            AnchorOutcome::Outdated => {
                if annotation.status == AnnotationStatus::Open {
                    annotation.status = AnnotationStatus::Outdated;
                    changed = true;
                }
            }
        }
    }

    changed
}

fn load_state(repo_root: &Path, review_path: &Path) -> Result<AnnotationsState, String> {
    let _guard = acquire_review_lock()?;
    let mut file = read_annotations_file(review_path)?;
    if reanchor_annotations(repo_root, &mut file.annotations) {
        write_annotations_file(review_path, &file)?;
    }

    Ok(AnnotationsState {
        annotations: file.annotations,
        review_path: review_path.to_string_lossy().into_owned(),
    })
}

fn generate_id(existing: &HashSet<String>) -> String {
    loop {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let counter = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut value = nanos ^ counter as u128;

        let mut id = String::with_capacity(8);
        for _ in 0..8 {
            id.push(ID_CHARS[(value % 36) as usize] as char);
            value /= 36;
        }

        if !existing.contains(&id) {
            return id;
        }
    }
}

fn utc_rfc3339_now() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format_rfc3339_utc(duration.as_secs())
}

fn format_rfc3339_utc(unix_secs: u64) -> String {
    let days = unix_secs / 86_400;
    let time_of_day = unix_secs % 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    let hour = time_of_day / 3_600;
    let minute = (time_of_day % 3_600) / 60;
    let second = time_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

fn parse_side(side: &str) -> Result<AnnotationSide, String> {
    match side {
        "old" => Ok(AnnotationSide::Old),
        "new" => Ok(AnnotationSide::New),
        _ => Err(format!("Unknown annotation side: {side}.")),
    }
}

fn parse_status(status: &str) -> Result<AnnotationStatus, String> {
    match status {
        "open" => Ok(AnnotationStatus::Open),
        "resolved" => Ok(AnnotationStatus::Resolved),
        "outdated" => Ok(AnnotationStatus::Outdated),
        _ => Err(format!("Unknown annotation status: {status}.")),
    }
}

#[command]
pub fn load_annotations(cwd: Option<String>) -> Result<AnnotationsState, String> {
    let cwd = resolve_cwd(cwd)?;
    let repo_root = resolve_repo_root(&cwd)?;
    let review_path = resolve_review_path(&repo_root)?;
    load_state(&repo_root, &review_path)
}

#[command]
pub fn create_annotation(
    cwd: Option<String>,
    file: String,
    old_file: Option<String>,
    side: String,
    start_line: usize,
    end_line: usize,
    comment: String,
) -> Result<AnnotationsState, String> {
    let cwd = resolve_cwd(cwd)?;
    let repo_root = resolve_repo_root(&cwd)?;
    let review_path = resolve_review_path(&repo_root)?;
    let side = parse_side(&side)?;

    let _guard = acquire_review_lock()?;
    let mut annotations_file = read_annotations_file(&review_path)?;
    reanchor_annotations(&repo_root, &mut annotations_file.annotations);

    let content = read_side_content(&repo_root, &file, old_file.as_deref(), side);
    let existing_ids: HashSet<String> = annotations_file
        .annotations
        .iter()
        .map(|annotation| annotation.id.clone())
        .collect();
    let now = utc_rfc3339_now();

    annotations_file.annotations.push(Annotation {
        id: generate_id(&existing_ids),
        file,
        old_file,
        side,
        start_line,
        end_line,
        comment,
        status: AnnotationStatus::Open,
        created_at: now.clone(),
        updated_at: now,
        anchor: build_anchor_snapshot(&content, start_line),
        replies: Vec::new(),
        extra: serde_json::Map::new(),
    });

    write_annotations_file(&review_path, &annotations_file)?;

    Ok(AnnotationsState {
        annotations: annotations_file.annotations,
        review_path: review_path.to_string_lossy().into_owned(),
    })
}

#[command]
pub fn update_annotation(
    cwd: Option<String>,
    id: String,
    comment: Option<String>,
    status: Option<String>,
) -> Result<AnnotationsState, String> {
    let cwd = resolve_cwd(cwd)?;
    let repo_root = resolve_repo_root(&cwd)?;
    let review_path = resolve_review_path(&repo_root)?;

    let _guard = acquire_review_lock()?;
    let mut annotations_file = read_annotations_file(&review_path)?;
    reanchor_annotations(&repo_root, &mut annotations_file.annotations);

    let annotation = annotations_file
        .annotations
        .iter_mut()
        .find(|annotation| annotation.id == id)
        .ok_or_else(|| format!("Could not find annotation {id}."))?;

    if let Some(comment) = comment {
        annotation.comment = comment;
    }
    if let Some(status) = status {
        annotation.status = parse_status(&status)?;
    }
    annotation.updated_at = utc_rfc3339_now();

    write_annotations_file(&review_path, &annotations_file)?;

    Ok(AnnotationsState {
        annotations: annotations_file.annotations,
        review_path: review_path.to_string_lossy().into_owned(),
    })
}

#[command]
pub fn delete_annotation(cwd: Option<String>, id: String) -> Result<AnnotationsState, String> {
    let cwd = resolve_cwd(cwd)?;
    let repo_root = resolve_repo_root(&cwd)?;
    let review_path = resolve_review_path(&repo_root)?;

    let _guard = acquire_review_lock()?;
    let mut annotations_file = read_annotations_file(&review_path)?;
    reanchor_annotations(&repo_root, &mut annotations_file.annotations);

    let index = annotations_file
        .annotations
        .iter()
        .position(|annotation| annotation.id == id)
        .ok_or_else(|| format!("Could not find annotation {id}."))?;
    annotations_file.annotations.remove(index);

    write_annotations_file(&review_path, &annotations_file)?;

    Ok(AnnotationsState {
        annotations: annotations_file.annotations,
        review_path: review_path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_lines_strips_trailing_carriage_returns() {
        assert_eq!(
            split_lines("a\r\nb\nc\r"),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn build_anchor_snapshot_collects_context_lines() {
        let content = "one\ntwo\nthree\nfour\nfive";
        let anchor = build_anchor_snapshot(content, 3);
        assert_eq!(anchor.line_text, "three");
        assert_eq!(anchor.context_before, vec!["one", "two"]);
        assert_eq!(anchor.context_after, vec!["four", "five"]);
    }

    #[test]
    fn clamp_end_line_respects_file_length() {
        assert_eq!(clamp_end_line(10, 6), 6);
        assert_eq!(clamp_end_line(0, 6), 1);
    }
}

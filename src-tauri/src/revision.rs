use crate::{git_bytes, git_text, StatusEntry};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// The well-known hash of git's empty tree, used as the base for root commits.
pub(crate) const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Number of commits `list_commits` returns when the caller does not ask for a limit.
const DEFAULT_COMMIT_LIMIT: usize = 50;

/// NUL-separated fields, one record per commit: sha, short sha, author, relative date, ISO date, subject.
const COMMIT_LOG_FORMAT: &str = "--pretty=format:%H%x00%h%x00%an%x00%ar%x00%aI%x00%s";

/// Number of fields `COMMIT_LOG_FORMAT` emits per commit.
const COMMIT_LOG_FIELDS: usize = 6;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitSummary {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
    pub(crate) author: String,
    pub(crate) relative_date: String,
    pub(crate) iso_date: String,
}

/// The commit a `RepositoryDiff` was produced from, when it is not the working tree.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RevisionInfo {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
}

/// A resolved commit plus the tree its diff is taken against.
pub(crate) struct CommitContext {
    pub(crate) sha: String,
    pub(crate) short_sha: String,
    pub(crate) subject: String,
    /// First parent, or the empty tree for a root commit.
    pub(crate) base: String,
}

impl CommitContext {
    pub(crate) fn into_info(self) -> RevisionInfo {
        RevisionInfo {
            sha: self.sha,
            short_sha: self.short_sha,
            subject: self.subject,
        }
    }
}

/// Returns the most recent commits reachable from `HEAD`.
///
/// A repository with no commits yet yields an empty list rather than an error.
/// Runs off the UI thread, like [`crate::load_repository`]: it shells out to git.
#[tauri::command(async)]
pub(crate) fn list_commits(cwd: String, limit: Option<usize>) -> Result<Vec<CommitSummary>, String> {
    let repo_root = resolve_repo_root(Path::new(&cwd))?;
    let limit = limit.unwrap_or(DEFAULT_COMMIT_LIMIT);
    if limit == 0 || !has_commits(&repo_root) {
        return Ok(Vec::new());
    }

    let max_count = format!("--max-count={limit}");
    let output = git_bytes(
        &repo_root,
        &["log", "-z", "--no-color", &max_count, COMMIT_LOG_FORMAT],
    )?;

    Ok(parse_commit_log(&output))
}

/// Resolves `revision` to a commit and works out the tree to diff it against.
pub(crate) fn resolve_commit(repo_root: &Path, revision: &str) -> Result<CommitContext, String> {
    let revision = revision.trim();
    if !is_safe_revision(revision) {
        return Err(format!("Could not resolve the revision `{revision}`."));
    }

    let spec = format!("{revision}^{{commit}}");
    let sha = git_text(
        repo_root,
        &["rev-parse", "--verify", "--end-of-options", &spec],
    )
    .map_err(|error| format!("Could not resolve the revision `{revision}`: {error}"))?;
    let sha = sha.trim().to_string();

    let details = git_bytes(
        repo_root,
        &["log", "-n", "1", "--pretty=format:%h%x00%s%x00%P", &sha, "--"],
    )
    .map_err(|error| format!("Could not read the commit `{revision}`: {error}"))?;
    let mut fields = details.split(|byte| *byte == 0);
    let short_sha = next_field(&mut fields);
    let subject = next_field(&mut fields);
    let parents = next_field(&mut fields);

    let base = parents
        .split_whitespace()
        .next()
        .map(str::to_string)
        .unwrap_or_else(|| EMPTY_TREE.to_string());

    Ok(CommitContext {
        short_sha: if short_sha.is_empty() {
            sha.chars().take(7).collect()
        } else {
            short_sha
        },
        subject,
        base,
        sha,
    })
}

/// Lists the files a commit touched relative to `base`.
pub(crate) fn commit_status_entries(
    repo_root: &Path,
    context: &CommitContext,
) -> Result<Vec<StatusEntry>, String> {
    let output = git_bytes(
        repo_root,
        &[
            "diff-tree",
            "-r",
            "-z",
            "--no-commit-id",
            "--name-status",
            "-M",
            &context.base,
            &context.sha,
        ],
    )
    .map_err(|error| format!("Could not read the commit `{}`: {error}", context.sha))?;

    parse_name_status(&output)
}

fn resolve_repo_root(cwd: &Path) -> Result<PathBuf, String> {
    let repo_root = git_text(cwd, &["rev-parse", "--show-toplevel"])?;
    Ok(PathBuf::from(repo_root.trim()))
}

fn has_commits(repo_root: &Path) -> bool {
    git_text(
        repo_root,
        &["rev-parse", "--quiet", "--verify", "HEAD^{commit}"],
    )
    .is_ok_and(|sha| !sha.trim().is_empty())
}

/// Rejects revisions that git could mistake for an option or that cannot be a rev at all.
fn is_safe_revision(revision: &str) -> bool {
    !revision.is_empty()
        && !revision.starts_with('-')
        && !revision.chars().any(char::is_control)
        && !revision.chars().any(char::is_whitespace)
}

fn next_field<'a>(fields: &mut impl Iterator<Item = &'a [u8]>) -> String {
    fields
        .next()
        .map(|field| String::from_utf8_lossy(field).trim_end_matches('\n').to_string())
        .unwrap_or_default()
}

/// Parses `git log -z` output produced with [`COMMIT_LOG_FORMAT`].
///
/// `-z` separates records with NUL and the format separates fields with NUL, so the
/// stream is a flat run of fields split into fixed-size records.
pub(crate) fn parse_commit_log(bytes: &[u8]) -> Vec<CommitSummary> {
    let mut fields: Vec<&[u8]> = bytes.split(|byte| *byte == 0).collect();
    // `-z` separates records rather than terminating them, so a trailing empty field is
    // padding — unless it completes a record, in which case it is an empty subject.
    while fields.len() % COMMIT_LOG_FIELDS != 0 && fields.last().is_some_and(|f| f.is_empty()) {
        fields.pop();
    }

    fields
        .chunks_exact(COMMIT_LOG_FIELDS)
        .map(|record| CommitSummary {
            sha: lossy(record[0]),
            short_sha: lossy(record[1]),
            author: lossy(record[2]),
            relative_date: lossy(record[3]),
            iso_date: lossy(record[4]),
            subject: lossy(record[5]),
        })
        .collect()
}

/// Parses `git diff-tree -z --name-status` output.
///
/// Each record is a NUL-terminated status field followed by a NUL-terminated path.
/// Rename and copy records carry two paths: the old one first, then the new one.
pub(crate) fn parse_name_status(bytes: &[u8]) -> Result<Vec<StatusEntry>, String> {
    let mut entries = Vec::new();
    let mut fields = bytes.split(|byte| *byte == 0);

    while let Some(status) = fields.next() {
        if status.is_empty() {
            continue;
        }

        let letter = status[0];
        let Some(first_path) = fields.next().filter(|path| !path.is_empty()) else {
            return Err("Git diff-tree output was not NUL-terminated.".to_string());
        };
        let first_path = lossy(first_path);

        let (path, old_path) = if matches!(letter, b'R' | b'C') {
            let Some(new_path) = fields.next().filter(|path| !path.is_empty()) else {
                return Err("Git diff-tree rename output was not NUL-terminated.".to_string());
            };
            (lossy(new_path), Some(first_path))
        } else {
            (first_path, None)
        };

        entries.push(StatusEntry {
            x: normalize_letter(letter),
            y: b' ',
            path,
            old_path,
        });
    }

    Ok(entries)
}

/// Maps `diff-tree` status letters onto the letters `classify_status` understands.
///
/// A copy produces a file that did not exist before, so it reads as an addition; a
/// type change (`T`) is a content change like any other modification.
fn normalize_letter(letter: u8) -> u8 {
    match letter {
        b'C' => b'A',
        b'T' => b'M',
        other => other,
    }
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_commit_log, parse_name_status, CommitSummary};
    use crate::DiffStatus;

    #[test]
    fn name_status_parses_renames_deletes_and_edits() {
        let raw = b"R100\0a.txt\0b.txt\0D\0d.txt\0M\0m.txt\0A\0n.txt\0";
        let entries = parse_name_status(raw).expect("parsing should succeed");

        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].path, "b.txt");
        assert_eq!(entries[0].old_path.as_deref(), Some("a.txt"));
        assert!(matches!(
            crate::classify_status(&entries[0]),
            DiffStatus::Renamed
        ));

        assert_eq!(entries[1].path, "d.txt");
        assert_eq!(entries[1].old_path, None);
        assert!(matches!(
            crate::classify_status(&entries[1]),
            DiffStatus::Deleted
        ));

        assert_eq!(entries[2].path, "m.txt");
        assert!(matches!(
            crate::classify_status(&entries[2]),
            DiffStatus::Modified
        ));

        assert_eq!(entries[3].path, "n.txt");
        assert!(matches!(
            crate::classify_status(&entries[3]),
            DiffStatus::Added
        ));
    }

    #[test]
    fn name_status_maps_copies_and_type_changes() {
        let raw = b"C75\0src/original.ts\0src/copy.ts\0T\0link\0";
        let entries = parse_name_status(raw).expect("parsing should succeed");

        assert_eq!(entries[0].path, "src/copy.ts");
        assert_eq!(entries[0].old_path.as_deref(), Some("src/original.ts"));
        assert!(matches!(
            crate::classify_status(&entries[0]),
            DiffStatus::Added
        ));
        assert!(matches!(
            crate::classify_status(&entries[1]),
            DiffStatus::Modified
        ));
    }

    #[test]
    fn name_status_accepts_empty_output() {
        assert!(parse_name_status(b"")
            .expect("parsing should succeed")
            .is_empty());
    }

    #[test]
    fn name_status_rejects_a_truncated_record() {
        assert!(parse_name_status(b"M\0").is_err());
    }

    #[test]
    fn commit_log_parses_subjects_with_unusual_characters() {
        let raw = concat!(
            "b924ad08e30afca2f06bbd64827773cc2dfeb5d1\0b924ad0\0Ada Lovelace\0",
            "2 weeks ago\02026-07-09T10:04:58-05:00\0",
            "fix: strip \t tabs, | pipes, \"quotes\" & emoji \u{1f600} from --pretty\0",
            "f59aaa8c0de29903d717684b319acbe8f101d66c\0f59aaa8\0Ada Lovelace\0",
            "3 weeks ago\02026-06-30T08:00:00-05:00\0first",
        );

        let commits = parse_commit_log(raw.as_bytes());

        assert_eq!(commits.len(), 2);
        assert_eq!(
            commits[0],
            CommitSummary {
                sha: "b924ad08e30afca2f06bbd64827773cc2dfeb5d1".to_string(),
                short_sha: "b924ad0".to_string(),
                author: "Ada Lovelace".to_string(),
                relative_date: "2 weeks ago".to_string(),
                iso_date: "2026-07-09T10:04:58-05:00".to_string(),
                subject: "fix: strip \t tabs, | pipes, \"quotes\" & emoji \u{1f600} from --pretty"
                    .to_string(),
            }
        );
        assert_eq!(commits[1].subject, "first");
    }

    #[test]
    fn commit_log_tolerates_a_trailing_separator_and_empty_output() {
        let raw = b"sha\0short\0author\0relative\0iso\0subject\0";
        assert_eq!(parse_commit_log(raw).len(), 1);
        assert!(parse_commit_log(b"").is_empty());
    }

    #[test]
    fn commit_log_keeps_a_commit_whose_subject_is_empty() {
        let raw = b"sha\0short\0author\0relative\0iso\0";
        let commits = parse_commit_log(raw);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "");
    }
}

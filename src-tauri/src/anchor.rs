pub struct AnchorSnapshot {
    pub line_text: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
}

pub enum AnchorOutcome {
    Matched { start_line: usize },
    Outdated,
}

pub trait AnchorStrategy: Send + Sync {
    fn resolve(
        &self,
        anchor: &AnchorSnapshot,
        lines: &[&str],
        original_start: usize,
    ) -> AnchorOutcome;
}

pub struct ContextMatchStrategy;

impl AnchorStrategy for ContextMatchStrategy {
    fn resolve(
        &self,
        anchor: &AnchorSnapshot,
        lines: &[&str],
        original_start: usize,
    ) -> AnchorOutcome {
        let blank_line = anchor.line_text.trim().is_empty();
        let mut best: Option<(usize, usize, usize)> = None;

        for (index, line) in lines.iter().enumerate() {
            if *line != anchor.line_text {
                continue;
            }

            let score = context_match_score(anchor, lines, index);
            if blank_line && score == 0 {
                continue;
            }

            let line_number = index + 1;
            let distance = original_start.abs_diff(line_number);
            match best {
                None => best = Some((score, distance, line_number)),
                Some((best_score, best_distance, best_line)) => {
                    if score > best_score
                        || (score == best_score && distance < best_distance)
                        || (score == best_score
                            && distance == best_distance
                            && line_number < best_line)
                    {
                        best = Some((score, distance, line_number));
                    }
                }
            }
        }

        match best {
            Some((_, _, line_number)) => AnchorOutcome::Matched {
                start_line: line_number,
            },
            None => AnchorOutcome::Outdated,
        }
    }
}

pub struct AlwaysOutdatedStrategy;

impl AnchorStrategy for AlwaysOutdatedStrategy {
    fn resolve(
        &self,
        _anchor: &AnchorSnapshot,
        _lines: &[&str],
        _original_start: usize,
    ) -> AnchorOutcome {
        AnchorOutcome::Outdated
    }
}

#[allow(dead_code)]
enum ActiveStrategyKind {
    ContextMatch,
    AlwaysOutdated,
}

const ACTIVE_STRATEGY: ActiveStrategyKind = ActiveStrategyKind::ContextMatch;

pub fn active_strategy() -> &'static dyn AnchorStrategy {
    match ACTIVE_STRATEGY {
        ActiveStrategyKind::ContextMatch => &ContextMatchStrategy,
        ActiveStrategyKind::AlwaysOutdated => &AlwaysOutdatedStrategy,
    }
}

fn context_match_score(anchor: &AnchorSnapshot, lines: &[&str], candidate_index: usize) -> usize {
    let mut score = 0;

    for (offset, context_line) in anchor.context_before.iter().enumerate() {
        let distance = anchor.context_before.len() - offset;
        let line_index = candidate_index.checked_sub(distance);
        if line_index.is_some_and(|index| lines.get(index) == Some(&context_line.as_str())) {
            score += 1;
        }
    }

    for (offset, context_line) in anchor.context_after.iter().enumerate() {
        let line_index = candidate_index + offset + 1;
        if lines.get(line_index) == Some(&context_line.as_str()) {
            score += 1;
        }
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(line_text: &str, before: &[&str], after: &[&str]) -> AnchorSnapshot {
        AnchorSnapshot {
            line_text: line_text.to_string(),
            context_before: before.iter().map(|line| (*line).to_string()).collect(),
            context_after: after.iter().map(|line| (*line).to_string()).collect(),
        }
    }

    #[test]
    fn context_match_finds_line_after_shift() {
        let strategy = ContextMatchStrategy;
        let anchor = snapshot("target", &["alpha", "beta"], &["gamma"]);
        let lines = vec![
            "alpha",
            "beta",
            "target",
            "gamma",
            "other",
            "alpha",
            "beta",
            "target",
            "gamma",
        ];
        let line_refs: Vec<&str> = lines.iter().copied().collect();

        match strategy.resolve(&anchor, &line_refs, 3) {
            AnchorOutcome::Matched { start_line } => assert_eq!(start_line, 3),
            AnchorOutcome::Outdated => panic!("expected a match at the original location"),
        }

        match strategy.resolve(&anchor, &line_refs, 8) {
            AnchorOutcome::Matched { start_line } => assert_eq!(start_line, 8),
            AnchorOutcome::Outdated => panic!("expected a match after lines shifted"),
        }
    }

    #[test]
    fn context_match_breaks_ties_by_proximity() {
        let strategy = ContextMatchStrategy;
        let anchor = snapshot("dup", &["shared"], &[]);
        let lines = vec!["shared", "dup", "noise", "shared", "dup"];
        let line_refs: Vec<&str> = lines.iter().copied().collect();

        match strategy.resolve(&anchor, &line_refs, 5) {
            AnchorOutcome::Matched { start_line } => assert_eq!(start_line, 5),
            AnchorOutcome::Outdated => panic!("expected the nearer duplicate to win"),
        }
    }

    #[test]
    fn context_match_blank_line_requires_context() {
        let strategy = ContextMatchStrategy;
        let anchor = snapshot("", &["before"], &["after"]);
        let lines = vec!["before", "", "after", "", "after"];
        let line_refs: Vec<&str> = lines.iter().copied().collect();

        match strategy.resolve(&anchor, &line_refs, 2) {
            AnchorOutcome::Matched { start_line } => assert_eq!(start_line, 2),
            AnchorOutcome::Outdated => panic!("expected a contextual blank-line match"),
        }

        let isolated = vec!["", "", "solo"];
        let isolated_refs: Vec<&str> = isolated.iter().copied().collect();
        assert!(matches!(
            strategy.resolve(&anchor, &isolated_refs, 1),
            AnchorOutcome::Outdated
        ));
    }

    #[test]
    fn context_match_returns_outdated_when_no_candidate() {
        let strategy = ContextMatchStrategy;
        let anchor = snapshot("missing", &["before"], &["after"]);
        let lines = vec!["before", "after", "else"];
        let line_refs: Vec<&str> = lines.iter().copied().collect();

        assert!(matches!(
            strategy.resolve(&anchor, &line_refs, 1),
            AnchorOutcome::Outdated
        ));
    }

    #[test]
    fn always_outdated_strategy_never_matches() {
        let strategy = AlwaysOutdatedStrategy;
        let anchor = snapshot("target", &["before"], &["after"]);
        let lines = vec!["before", "target", "after"];
        let line_refs: Vec<&str> = lines.iter().copied().collect();

        assert!(matches!(
            strategy.resolve(&anchor, &line_refs, 2),
            AnchorOutcome::Outdated
        ));
    }
}

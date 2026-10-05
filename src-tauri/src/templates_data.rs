//! Immutable built-in template definitions, variable expansion, and id generation.
//!
//! Variable replacement uses one captured local timestamp so `date`, `time`, and
//! `day_of_week` cannot straddle clock ticks. A daily or weekly note's `date` and
//! `day_of_week` are its own day, not the day it was created. Generated ids are lowercase ASCII
//! slugs and serve as filenames only after command-layer validation.

use chrono::{Local, NaiveDate, NaiveDateTime, Weekday};

use crate::types::Template;

pub(crate) fn get_default_templates() -> Vec<Template> {
    vec![
        Template {
            id: "meeting-notes".to_string(),
            name: "Meeting Notes".to_string(),
            description: "Structured template for meeting documentation".to_string(),
            icon: "users".to_string(),
            is_default: true,
            content: include_str!("templates/meeting-notes.md").to_string(),
        },
        Template {
            id: "daily-log".to_string(),
            name: "Daily Log".to_string(),
            description: "Track your daily goals, accomplishments, and reflections".to_string(),
            icon: "calendar".to_string(),
            is_default: true,
            content: include_str!("templates/daily-log.md").to_string(),
        },
        Template {
            id: "project-plan".to_string(),
            name: "Project Plan".to_string(),
            description: "Plan and track project goals, timeline, and resources".to_string(),
            icon: "clipboard".to_string(),
            is_default: true,
            content: include_str!("templates/project-plan.md").to_string(),
        },
    ]
}

pub(crate) fn replace_template_variables(content: String) -> String {
    replace_template_variables_at(content, Local::now().naive_local())
}

/// Expand a template for a note dated `day`, keeping the current time.
pub(crate) fn replace_template_variables_on(content: String, day: Option<NaiveDate>) -> String {
    let now = Local::now().naive_local();
    replace_template_variables_at(content, day.map_or(now, |day| day.and_time(now.time())))
}

/// The day a dated note is for: a daily `YYYY-MM-DD.md`, or the Monday of a
/// weekly `YYYY-Www.md`.
pub(crate) fn dated_note_day(filename: &str, is_daily: bool, is_weekly: bool) -> Option<NaiveDate> {
    let stem = filename.strip_suffix(".md")?;
    if is_daily {
        return NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok();
    }
    if is_weekly {
        let (year, week) = stem.split_once("-W")?;
        return NaiveDate::from_isoywd_opt(year.parse().ok()?, week.parse().ok()?, Weekday::Mon);
    }
    None
}

fn replace_template_variables_at(content: String, now: NaiveDateTime) -> String {
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();
    let day_of_week = now.format("%A").to_string();

    content
        .replace("{{date}}", &date)
        .replace("{{time}}", &time)
        .replace("{{day_of_week}}", &day_of_week)
}

pub(crate) fn generate_template_id(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn template_id_slugifies_name() {
        assert_eq!(generate_template_id("My Template"), "my-template");
        assert_eq!(generate_template_id("  Spaces  "), "spaces");
        assert_eq!(
            generate_template_id("Special: Chars / Go!"),
            "special-chars-go"
        );
    }

    #[test]
    fn template_id_collapses_runs_of_non_alnum() {
        assert_eq!(generate_template_id("hello---world"), "hello-world");
        assert_eq!(generate_template_id("a / b / c"), "a-b-c");
    }

    #[test]
    fn template_variable_substitution_replaces_placeholders() {
        let out =
            replace_template_variables("Today is {{date}} ({{day_of_week}}) at {{time}}.".into());
        assert!(!out.contains("{{date}}"));
        assert!(!out.contains("{{day_of_week}}"));
        assert!(!out.contains("{{time}}"));
    }

    #[test]
    fn template_variable_substitution_leaves_unknown_placeholders() {
        let out = replace_template_variables("Hello {{name}}".into());
        assert_eq!(out, "Hello {{name}}");
    }

    #[test]
    fn template_variables_are_correct_at_iso_week_53_year_boundary() {
        let boundary =
            NaiveDateTime::parse_from_str("2020-12-31 23:59:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let out =
            replace_template_variables_at("{{date}}|{{time}}|{{day_of_week}}".into(), boundary);
        assert_eq!(out, "2020-12-31|23:59|Thursday");
        assert_eq!(boundary.date().iso_week().week(), 53);
    }

    #[test]
    fn one_megabyte_template_expands_without_truncation() {
        let boundary =
            NaiveDateTime::parse_from_str("2021-01-01 00:01:00", "%Y-%m-%d %H:%M:%S").unwrap();
        let content = format!("{}{{{{date}}}}", "x".repeat(1024 * 1024));
        let out = replace_template_variables_at(content, boundary);
        assert_eq!(out.len(), 1024 * 1024 + 10);
        assert!(out.ends_with("2021-01-01"));
        assert_eq!(boundary.date().iso_week().week(), 53);
    }

    #[test]
    fn a_dated_note_is_expanded_for_its_own_day() {
        let daily = dated_note_day("2026-09-01.md", true, false);
        assert_eq!(daily, NaiveDate::from_ymd_opt(2026, 9, 1));
        let out = replace_template_variables_on("# {{day_of_week}}, {{date}}".into(), daily);
        assert_eq!(out, "# Tuesday, 2026-09-01");

        let weekly = dated_note_day("2026-W40.md", false, true);
        assert_eq!(weekly, NaiveDate::from_ymd_opt(2026, 9, 28));
        assert_eq!(
            dated_note_day("2020-W53.md", false, true),
            NaiveDate::from_ymd_opt(2020, 12, 28)
        );
    }

    #[test]
    fn other_notes_and_unreadable_names_use_today() {
        assert_eq!(dated_note_day("2026-09-01.md", false, false), None);
        assert_eq!(dated_note_day("Meeting.md", true, false), None);
        assert_eq!(dated_note_day("2026-13-01.md", true, false), None);
        assert_eq!(dated_note_day("2026-W54.md", false, true), None);
        assert_eq!(dated_note_day("2026-09-01", true, false), None);

        let before = Local::now().date_naive().to_string();
        let out = replace_template_variables_on("{{date}}".into(), None);
        let after = Local::now().date_naive().to_string();
        assert!(out == before || out == after);
    }

    #[test]
    fn default_templates_have_expected_ids() {
        let ids: Vec<String> = get_default_templates().into_iter().map(|t| t.id).collect();
        assert!(ids.contains(&"meeting-notes".to_string()));
        assert!(ids.contains(&"daily-log".to_string()));
        assert!(ids.contains(&"project-plan".to_string()));
    }
}

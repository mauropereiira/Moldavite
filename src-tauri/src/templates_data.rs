//! Built-in templates and helpers for template variable expansion.

use chrono::Local;

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
    let now = Local::now();
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

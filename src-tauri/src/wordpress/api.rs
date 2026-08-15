//! The WordPress.com REST surface Moldavite uses.
//!
//! With a WordPress.com token, posts go through `public-api.wordpress.com`
//! rather than the site's own `/wp-json`. That is what makes this work for
//! Simple sites, which have no Application Passwords and no reachable
//! `wp-json` for third-party credentials.

use serde::{Deserialize, Serialize};

const API_BASE: &str = "https://public-api.wordpress.com/rest/v1.1";

/// A site the signed-in account can post to.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordPressSite {
    pub id: u64,
    pub name: String,
    pub url: String,
}

#[derive(Deserialize)]
struct SitesEnvelope {
    sites: Vec<RawSite>,
}

#[derive(Deserialize)]
struct RawSite {
    #[serde(rename = "ID")]
    id: u64,
    name: Option<String>,
    #[serde(rename = "URL")]
    url: Option<String>,
    #[serde(default)]
    capabilities: Capabilities,
}

#[derive(Default, Deserialize)]
struct Capabilities {
    #[serde(default)]
    publish_posts: bool,
}

#[derive(Deserialize)]
struct PostResponse {
    #[serde(rename = "ID")]
    id: u64,
    #[serde(rename = "URL")]
    url: Option<String>,
}

/// What the app tells the user after a publish.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedPost {
    pub id: u64,
    pub url: Option<String>,
    pub updated: bool,
}

async fn authed(token: &str, url: String) -> reqwest::RequestBuilder {
    reqwest::Client::new()
        .get(url)
        .bearer_auth(token)
        .header("accept", "application/json")
}

/// Sites the account can actually publish to. A site the user can only read is
/// worse than absent in a picker: it looks like a choice and fails on use.
pub async fn list_sites(token: &str) -> Result<Vec<WordPressSite>, String> {
    let response = authed(
        token,
        format!("{API_BASE}/me/sites?fields=ID,name,URL,capabilities"),
    )
    .await
    .send()
    .await
    .map_err(|e| format!("Could not reach WordPress.com: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response.status()));
    }
    let envelope: SitesEnvelope = response
        .json()
        .await
        .map_err(|e| format!("WordPress.com returned an unreadable site list: {e}"))?;

    Ok(envelope
        .sites
        .into_iter()
        .filter(|site| site.capabilities.publish_posts)
        .map(|site| WordPressSite {
            id: site.id,
            name: site.name.unwrap_or_else(|| "Untitled site".into()),
            url: site.url.unwrap_or_default(),
        })
        .collect())
}

/// Create a draft, or update the post a previous publish created.
///
/// An update deliberately sends no `status`: a post the user has since
/// published themselves must not be dragged back to draft by a re-publish.
pub async fn publish(
    token: &str,
    site_id: u64,
    title: &str,
    content: &str,
    existing_post_id: Option<u64>,
) -> Result<PublishedPost, String> {
    let updating = existing_post_id.is_some();
    let url = match existing_post_id {
        Some(post_id) => format!("{API_BASE}/sites/{site_id}/posts/{post_id}"),
        None => format!("{API_BASE}/sites/{site_id}/posts/new"),
    };

    let mut form: Vec<(&str, String)> = vec![
        ("title", title.to_string()),
        ("content", content.to_string()),
    ];
    if !updating {
        form.push(("status", "draft".to_string()));
    }

    let response = reqwest::Client::new()
        .post(url)
        .bearer_auth(token)
        .header("accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Could not reach WordPress.com: {e}"))?;

    if !response.status().is_success() {
        return Err(describe_failure(response.status()));
    }
    let post: PostResponse = response
        .json()
        .await
        .map_err(|e| format!("WordPress.com returned an unreadable post: {e}"))?;

    Ok(PublishedPost {
        id: post.id,
        url: post.url,
        updated: updating,
    })
}

/// Say what the user can do about it, not what the status code was.
fn describe_failure(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => {
            "WordPress.com refused that. Disconnect and sign in again from Settings.".into()
        }
        404 => "That site or post no longer exists on WordPress.com.".into(),
        429 => "WordPress.com is rate limiting this account. Try again shortly.".into(),
        500..=599 => "WordPress.com had a problem. Try again shortly.".into(),
        other => format!("WordPress.com returned an unexpected response ({other})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_sites_the_user_can_publish_to_are_offered() {
        let json = r#"{"sites":[
            {"ID":1,"name":"Mine","URL":"https://a.com","capabilities":{"publish_posts":true}},
            {"ID":2,"name":"Read only","URL":"https://b.com","capabilities":{"publish_posts":false}},
            {"ID":3,"name":"No caps","URL":"https://c.com"}
        ]}"#;
        let envelope: SitesEnvelope = serde_json::from_str(json).unwrap();
        let usable: Vec<u64> = envelope
            .sites
            .into_iter()
            .filter(|s| s.capabilities.publish_posts)
            .map(|s| s.id)
            .collect();
        assert_eq!(usable, vec![1]);
    }

    #[test]
    fn a_site_without_a_name_still_appears() {
        let json = r#"{"sites":[{"ID":9,"capabilities":{"publish_posts":true}}]}"#;
        let envelope: SitesEnvelope = serde_json::from_str(json).unwrap();
        let site = envelope.sites.into_iter().next().unwrap();
        assert_eq!(
            site.name.unwrap_or_else(|| "Untitled site".into()),
            "Untitled site"
        );
    }

    #[test]
    fn failures_are_described_in_terms_of_what_to_do() {
        assert!(describe_failure(reqwest::StatusCode::UNAUTHORIZED).contains("sign in again"));
        assert!(describe_failure(reqwest::StatusCode::NOT_FOUND).contains("no longer exists"));
        assert!(describe_failure(reqwest::StatusCode::TOO_MANY_REQUESTS).contains("rate limiting"));
        assert!(describe_failure(reqwest::StatusCode::BAD_GATEWAY).contains("Try again"));
        // An unmapped code still has to say something, not render a bare number.
        assert!(describe_failure(reqwest::StatusCode::IM_A_TEAPOT).contains("unexpected"));
    }
}

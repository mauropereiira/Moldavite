# Publish to WordPress

Moldavite's first-party reference plugin publishes the active note to the
WordPress REST API. New posts are created as drafts. Publishing the same
Forge-relative note path again updates its existing post instead of creating a
duplicate.

## Setup

1. In WordPress, open your profile and create an **Application Password**.
2. Run **Configure WordPress publishing** from Moldavite's command palette.
3. Enter the WordPress site URL, username, and Application Password.
4. Review Moldavite's host-access dialog. Credentials are verified before they
   are saved to this plugin's macOS Keychain namespace.
5. Open a note and run **Publish note to WordPress…**.

Self-hosted WordPress and WordPress.com Jetpack/Atomic sites are supported when
Application Passwords and the standard `wp-json/wp/v2` REST API are available.

## Known limitation

WordPress.com Simple sites require OAuth with a registered WordPress.com client
ID. This plugin intentionally does not embed or pretend to provide one, so
Simple sites are not supported. Move the site to an Application
Password-capable plan or use a separately registered OAuth integration.

## Security and storage

- The plugin worker has no direct network access. Every request goes through
  `api.net.fetch`, including manual redirect validation and response limits.
- The site host is approved by the user at runtime and can be revoked under
  **Settings → Plugins → View permissions**.
- The username, Application Password, and path-to-post map are stored through
  `api.secrets`; they are not written into the Forge or plugin folder.
- WordPress errors are reduced to their API message before being shown in a
  Moldavite toast.

The dependency-free `plugin.js` is deliberately commented and readable so it
can serve as a practical Plugin API v2 example.

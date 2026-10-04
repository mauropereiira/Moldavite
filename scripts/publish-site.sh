#!/usr/bin/env bash
# Publish the website in docs/ to Spacefast.
#
# docs/ also holds the project's internal documentation (Markdown, plans,
# store listings), so this copies only the files the site serves into
# .site-build/ and publishes that. Sign in once first with:
#   npx spacefast login
# Extra arguments pass through to `sf publish`, for example --dry-run.
set -euo pipefail

cd "$(dirname "$0")/.."
out=.site-build
space="${SPACEFAST_SPACE:-moldavite}"

rm -rf "$out"
mkdir -p "$out"
cp docs/index.html docs/guide.html docs/plugins.html docs/privacy.html docs/demo.html docs/skills.html docs/404.html "$out"/
cp docs/sitemap.xml docs/robots.txt docs/_redirects docs/_headers "$out"/
cp docs/styles.css docs/site.js docs/demo.js "$out"/
cp docs/*.webp docs/favicon.png docs/icon.png docs/og-image.png "$out"/
cp -R docs/fonts "$out"/

# The version note defaults to the last commit's subject; --message overrides it.
export SPACEFAST_PUBLISH_MESSAGE="${SPACEFAST_PUBLISH_MESSAGE:-$(git log -1 --pretty=%s)}"
npx -y spacefast publish "$out" --space "$space" "$@"

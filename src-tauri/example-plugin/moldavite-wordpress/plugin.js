// Publish to WordPress — first-party Plugin API v2 reference implementation.
//
// The worker has no direct fetch or storage access. User interaction, network
// calls, and credentials all cross Moldavite's host-enforced RPC boundary.

/* global URL, TextEncoder, btoa */

const CONFIG_KEY = 'wordpress-config';
const POST_MAP_KEY = 'wordpress-post-map';

export default function register(api) {
  api.commands.add({
    id: 'configure-wordpress',
    label: 'Configure WordPress publishing',
    handler: async () => configure(api),
  });

  api.commands.add({
    id: 'publish-wordpress',
    label: 'Publish note to WordPress…',
    handler: async () => publishActiveNote(api),
  });
}

async function configure(api) {
  try {
    const values = await api.ui.prompt({
      title: 'Configure WordPress publishing',
      message:
        'Use a WordPress username and Application Password. Credentials are verified before saving.',
      fields: [
        {
          name: 'siteUrl',
          label: 'Site URL',
          type: 'url',
          placeholder: 'https://example.com',
          required: true,
        },
        { name: 'username', label: 'Username', type: 'text', required: true },
        {
          name: 'appPassword',
          label: 'Application Password',
          type: 'password',
          required: true,
        },
      ],
      confirmLabel: 'Verify and save',
    });
    if (!values) return;

    const config = {
      siteUrl: normalizeSiteUrl(values.siteUrl),
      username: values.username.trim(),
      appPassword: values.appPassword,
    };
    if (!config.username || !config.appPassword)
      throw new Error('Username and Application Password are required.');

    const site = new URL(config.siteUrl);
    const granted = await api.net.requestHostAccess(site.hostname);
    if (!granted) return;

    const response = await wordpressRequest(api, config, '/users/me?context=edit');
    requireSuccess(response, 'WordPress rejected these credentials');
    await api.secrets.set(CONFIG_KEY, JSON.stringify(config));
    await api.ui.toast(`WordPress publishing configured for ${site.hostname}`, 'success');
  } catch (error) {
    await api.ui.toast(errorMessage(error), 'error');
  }
}

async function publishActiveNote(api) {
  try {
    const config = await readJsonSecret(api, CONFIG_KEY, null);
    if (!isConfig(config)) {
      throw new Error('Configure WordPress publishing before publishing a note.');
    }

    const note = await api.editor.getActiveNote();
    if (!note) throw new Error('Open a note before publishing.');

    const postMap = await readJsonSecret(api, POST_MAP_KEY, {});
    const existingId = Number.isInteger(postMap[note.path]) ? postMap[note.path] : null;
    const content = looksLikeHtml(note.content) ? note.content : markdownToHtml(note.content);
    const payload = {
      title: note.title,
      content,
      ...(existingId ? {} : { status: 'draft' }),
    };
    const path = existingId ? `/posts/${existingId}` : '/posts';
    const response = await wordpressRequest(api, config, path, {
      method: existingId ? 'PUT' : 'POST',
      body: JSON.stringify(payload),
    });
    const post = requireSuccess(
      response,
      existingId ? 'Could not update the WordPress post' : 'Could not create the WordPress draft'
    );
    if (!Number.isInteger(post.id))
      throw new Error('WordPress returned a post without a valid id.');

    postMap[note.path] = post.id;
    await api.secrets.set(POST_MAP_KEY, JSON.stringify(postMap));
    const editLink = `${config.siteUrl}/wp-admin/post.php?post=${post.id}&action=edit`;
    await api.ui.toast(
      `${existingId ? 'Updated' : 'Created'} WordPress draft: ${editLink}`,
      'success'
    );
  } catch (error) {
    await api.ui.toast(errorMessage(error), 'error');
  }
}

function normalizeSiteUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a complete WordPress URL, including https://.');
  }
  if (url.protocol !== 'https:') throw new Error('The WordPress site URL must use HTTPS.');
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('The site URL cannot contain credentials, a custom port, query, or fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`;
}

async function wordpressRequest(api, config, path, options = {}) {
  const headers = {
    accept: 'application/json',
    authorization: `Basic ${base64Utf8(`${config.username}:${config.appPassword}`)}`,
    ...(options.body ? { 'content-type': 'application/json' } : {}),
  };
  return api.net.fetch(`${config.siteUrl}/wp-json/wp/v2${path}`, { ...options, headers });
}

function requireSuccess(response, fallback) {
  let body = null;
  try {
    body = response.bodyText ? JSON.parse(response.bodyText) : null;
  } catch {
    // Some WordPress proxies return an HTML/text error; use a safe short form.
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(cleanText(body?.message || response.bodyText || fallback));
  }
  if (!body || typeof body !== 'object') throw new Error('WordPress returned an invalid response.');
  return body;
}

async function readJsonSecret(api, key, fallback) {
  const value = await api.secrets.get(key);
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isConfig(value) {
  return (
    value &&
    typeof value.siteUrl === 'string' &&
    typeof value.username === 'string' &&
    typeof value.appPassword === 'string'
  );
}

function base64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

// Small dependency-free fallback for hosts that provide Markdown rather than
// editor HTML. It intentionally covers common note constructs, not full GFM.
function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown).replace(
    /```([\s\S]*?)```/g,
    (_, code) => `<pre><code>${code.trim()}</code></pre>`
  );
  return escaped
    .split(/\n{2,}/)
    .map((block) => {
      const heading = block.match(/^(#{1,6})\s+([\s\S]+)$/);
      if (heading)
        return `<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`;
      const lines = block.split('\n');
      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${inlineMarkdown(block).replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');
}

function inlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanText(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function errorMessage(error) {
  return (
    cleanText(error instanceof Error ? error.message : error) || 'WordPress publishing failed.'
  );
}

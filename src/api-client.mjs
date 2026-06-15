const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

const PLURALS = {
  "BlogPosting": "blog-postings",
  "Person": "persons",
  "WebPage": "web-pages",
  "ImageObject": "image-objects",
  "CategoryCode": "category-codes",
  "CategoryCodeSet": "category-code-sets",
  "DefinedTerm": "defined-terms",
  "DefinedTermSet": "defined-term-sets",
  "Comment": "comments",
  "WebSite": "web-sites",
};

export function pluralOf(entity) {
  if (PLURALS[entity]) return PLURALS[entity];
  throw new Error(`Unknown entity for plural lookup: ${entity}`);
}

// Raised when a bound request gets 401 from the API — the session is invalid or
// expired upstream. The server catches it, clears the cookie, and redirects to
// the login page.
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired.');
    this.name = 'SessionExpiredError';
  }
}

async function request(method, path, { token, body } = {}) {
  const url = new URL(path, API_BASE_URL);
  const headers = { Accept: 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    init.body = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); }
    catch { parsed = { raw: text }; }
  }
  return { status: res.status, body: parsed, etag: res.headers.get('etag') };
}

// Auth routes — driven by the server's login/logout flow, not by the views.
// They return the raw status so the server can map credentials to cookies.
export function login(username, password) {
  return request('POST', '/auth/login', { body: { username, password } });
}

export function logout(token) {
  return request('POST', '/auth/logout', { token });
}

export function me(token) {
  return request('GET', '/auth/me', { token });
}

// A session-bound client. Every entity call carries the bearer token; a 401
// becomes a SessionExpiredError.
export function apiFor(token) {
  async function authed(method, path, body) {
    const r = await request(method, path, { token, body });
    if (r.status === 401) throw new SessionExpiredError();
    return r;
  }
  return {
    list(entity, query = {}) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        sp.set(k, String(v));
      }
      const qs = sp.toString();
      return authed('GET', `/${pluralOf(entity)}${qs ? '?' + qs : ''}`);
    },
    get(entity, id) {
      return authed('GET', `/${pluralOf(entity)}/${encodeURIComponent(id)}`);
    },
    create(entity, payload) {
      return authed('POST', `/${pluralOf(entity)}`, payload);
    },
    update(entity, id, payload) {
      return authed('PUT', `/${pluralOf(entity)}/${encodeURIComponent(id)}`, payload);
    },
    remove(entity, id) {
      return authed('DELETE', `/${pluralOf(entity)}/${encodeURIComponent(id)}`);
    },
  };
}

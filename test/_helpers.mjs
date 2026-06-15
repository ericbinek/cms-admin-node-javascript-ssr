import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockApi, ADMIN_USERNAME, ADMIN_PASSWORD } from './_mock-api.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Cookie names the admin server sets — kept in sync with src/auth.mjs.
export const SESSION_COOKIE = 'cms_session';
export const CSRF_COOKIE = 'cms_csrf';

export const PLURALS = {
  "BlogPosting": "blog-postings",
  "Person": "persons",
  "WebPage": "web-pages",
  "ImageObject": "image-objects",
  "CategoryCode": "category-codes",
  "CategoryCodeSet": "category-code-sets",
  "DefinedTerm": "defined-terms",
  "DefinedTermSet": "defined-term-sets",
  "Comment": "comments",
  "WebSite": "web-sites"
};
export const SAMPLES = {
  "BlogPosting": {
    "headline": "sample",
    "articleBody": "sample",
    "author": {
      "__ref": "Person"
    }
  },
  "Person": {
    "name": "sample"
  },
  "WebPage": {
    "headline": "sample"
  },
  "ImageObject": {
    "contentUrl": "https://example.com/x"
  },
  "CategoryCode": {
    "name": "sample",
    "codeValue": "sample",
    "inCodeSet": {
      "__ref": "CategoryCodeSet"
    }
  },
  "CategoryCodeSet": {
    "name": "sample"
  },
  "DefinedTerm": {
    "name": "sample",
    "termCode": "sample",
    "inDefinedTermSet": {
      "__ref": "DefinedTermSet"
    }
  },
  "DefinedTermSet": {
    "name": "sample"
  },
  "Comment": {
    "text": "sample",
    "author": {
      "__ref": "Person"
    },
    "about": {
      "__ref": "BlogPosting"
    }
  },
  "WebSite": {
    "name": "sample",
    "url": "https://example.com/x"
  }
};
export const ENTITIES = ["BlogPosting","Person","WebPage","ImageObject","CategoryCode","CategoryCodeSet","DefinedTerm","DefinedTermSet","Comment","WebSite"];

let portCounter = 15000 + Math.floor(Math.random() * 1000);

export async function startAdmin({ apiBaseUrl }) {
  const port = portCounter++;
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), API_BASE_URL: apiBaseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  const baseUrl = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(baseUrl + '/health');
      if (r.ok) {
        return {
          baseUrl,
          async stop() {
            child.kill('SIGTERM');
            await new Promise((res) => child.on('exit', res));
          },
        };
      }
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 50));
  }
  child.kill('SIGTERM');
  throw new Error('Admin server did not start within 5 seconds');
}

export async function startStack() {
  const mock = await startMockApi();
  const admin = await startAdmin({ apiBaseUrl: mock.baseUrl });
  return {
    apiBaseUrl: mock.baseUrl,
    adminBaseUrl: admin.baseUrl,
    async stop() {
      await admin.stop();
      await mock.stop();
    },
  };
}

// --- Cookie jar (a plain name -> value map) -------------------------------

function applySetCookies(jar, res) {
  for (const sc of res.headers.getSetCookie()) {
    const pair = sc.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '') delete jar[name]; // Max-Age=0 clears with an empty value
    else jar[name] = value;
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

export function apiToken(jar) {
  return jar[SESSION_COOKIE];
}

export async function adminGet(stack, path, jar) {
  const res = await fetch(stack.adminBaseUrl + path, {
    headers: jar ? { Cookie: cookieHeader(jar) } : {},
    redirect: 'manual',
  });
  if (jar) applySetCookies(jar, res);
  return res;
}

export async function adminPostForm(stack, path, body, jar, { withCsrf = true } = {}) {
  let finalBody = body || '';
  if (withCsrf && jar && jar[CSRF_COOKIE] && !new URLSearchParams(finalBody).has('_csrf')) {
    finalBody = (finalBody ? finalBody + '&' : '') + '_csrf=' + encodeURIComponent(jar[CSRF_COOKIE]);
  }
  const res = await fetch(stack.adminBaseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(jar ? { Cookie: cookieHeader(jar) } : {}) },
    body: finalBody,
    redirect: 'manual',
  });
  if (jar) applySetCookies(jar, res);
  return res;
}

// Full browser-like login: GET /login to obtain the csrf cookie, then POST the
// credentials. Returns a cookie jar carrying the session and csrf cookies.
export async function loginAdmin(stack) {
  const jar = {};
  await adminGet(stack, '/login', jar);
  const res = await adminPostForm(
    stack, '/login',
    'username=' + encodeURIComponent(ADMIN_USERNAME) + '&password=' + encodeURIComponent(ADMIN_PASSWORD),
    jar,
  );
  if (res.status !== 303) {
    throw new Error('loginAdmin failed: expected 303, got ' + res.status);
  }
  return jar;
}

// --- Seeding goes straight to the mock API with the admin bearer token -----

function encodeOne(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.__ref) return '__needs_resolve__';
    if (value['@type'] === 'Language') return String(value.alternateName || '');
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

async function resolveRefs(stack, jar, sample) {
  const resolved = {};
  for (const [key, value] of Object.entries(sample)) {
    if (Array.isArray(value)) {
      const out = [];
      for (const v of value) {
        if (v && typeof v === 'object' && v.__ref) out.push(await ensureEntity(stack, v.__ref, jar));
        else out.push(v);
      }
      resolved[key] = out;
    } else if (value && typeof value === 'object' && value.__ref) {
      resolved[key] = await ensureEntity(stack, value.__ref, jar);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

const seededIds = new Map();

async function seedToMock(stack, jar, entityName, payload) {
  const r = await fetch(stack.apiBaseUrl + '/' + PLURALS[entityName], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiToken(jar) },
    body: JSON.stringify(payload),
  });
  if (r.status !== 201) {
    const text = await r.text();
    throw new Error('seed(' + entityName + ') failed: ' + r.status + ' ' + text);
  }
  return (await r.json()).id;
}

export async function ensureEntity(stack, entityName, jar) {
  if (seededIds.has(entityName)) return seededIds.get(entityName);
  const sample = await resolveRefs(stack, jar, SAMPLES[entityName]);
  const id = await seedToMock(stack, jar, entityName, sample);
  seededIds.set(entityName, id);
  return id;
}

export function resetSeedCache() {
  seededIds.clear();
}

export async function seedWith(stack, entityName, overrides, jar) {
  const sample = await resolveRefs(stack, jar, SAMPLES[entityName]);
  return seedToMock(stack, jar, entityName, { ...sample, ...overrides });
}

export async function formBodyFor(stack, entityName, jar) {
  const sample = await resolveRefs(stack, jar, SAMPLES[entityName]);
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(sample)) {
    if (Array.isArray(value)) {
      for (const v of value) sp.append(key, encodeOne(v));
    } else {
      sp.append(key, encodeOne(value));
    }
  }
  return sp.toString();
}

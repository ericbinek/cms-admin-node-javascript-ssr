import { layout, escapeHtml, csrfField, renderField, parseFormBody, formValuesFromItem, displayName, errorPage } from '../layout.mjs';

const ENTITY = "BlogPosting";
const BASE = "/blog-postings";
const PROPERTIES = [
  { name: "headline", kind: 'InlineScalar', use: "Text", cardinality: "one", required: true, maxLength: 256 },
  { name: "alternativeHeadline", kind: 'InlineScalar', use: "Text", cardinality: "one", required: false, maxLength: 256 },
  { name: "description", kind: 'InlineScalar', use: "Text", cardinality: "one", required: false, maxLength: 5000, multiline: true },
  { name: "articleBody", kind: 'InlineScalar', use: "Text", cardinality: "one", required: true, maxLength: 65536, multiline: true },
  { name: "author", kind: 'Ref', targets: ["Person"], cardinality: "one", required: true },
  { name: "publisher", kind: 'Ref', targets: ["Organization"], cardinality: "one", required: false },
  { name: "image", kind: 'Ref', targets: ["ImageObject"], cardinality: "many", required: false },
  { name: "video", kind: 'Ref', targets: ["VideoObject"], cardinality: "many", required: false },
  { name: "audio", kind: 'Ref', targets: ["AudioObject"], cardinality: "many", required: false },
  { name: "keywords", kind: 'Ref', targets: ["DefinedTerm"], cardinality: "many", required: false },
  { name: "about", kind: 'Ref', targets: ["CategoryCode"], cardinality: "many", required: false },
  { name: "datePublished", kind: 'InlineScalar', use: "DateTime", cardinality: "one", required: false },
  { name: "dateModified", kind: 'InlineScalar', use: "DateTime", cardinality: "one", required: false },
  { name: "dateCreated", kind: 'InlineScalar', use: "DateTime", cardinality: "one", required: false },
  { name: "url", kind: 'InlineScalar', use: "URL", cardinality: "one", required: true, maxLength: 2048 },
  { name: "inLanguage", kind: 'Embed', use: "Language", cardinality: "one", required: false },
  { name: "isAccessibleForFree", kind: 'InlineScalar', use: "Boolean", cardinality: "one", required: false },
  { name: "wordCount", kind: 'InlineScalar', use: "Integer", cardinality: "one", required: false },
  { name: "creativeWorkStatus", kind: 'Enum', values: ["Draft","Pending","Published","Archived"], cardinality: "one", required: false },
];

async function loadRefOptions(api) {
  const out = {};
  for (const prop of PROPERTIES) {
    if (prop.kind !== 'Ref') continue;
    const collected = [];
    for (const target of prop.targets) {
      const r = await api.list(target, { limit: 100 });
      if (r.status === 200 && r.body && Array.isArray(r.body.items)) {
        for (const item of r.body.items) {
          collected.push({ value: item.id, label: target + ': ' + displayName(item, target) });
        }
      }
    }
    out[prop.name] = collected;
  }
  return out;
}

function extractErrorList(body) {
  if (!body) return ['Request failed.'];
  if (Array.isArray(body.details) && body.details.length) return body.details;
  if (typeof body.message === 'string') return [body.message];
  return ['Request failed.'];
}

export async function renderForm({ id, api, csrf, user, values, errors = [], fieldErrors = {} } = {}) {
  let initial = values;
  if (!initial) {
    const { status, body } = await api.get(ENTITY, id);
    if (status === 404) return errorPage(404, ENTITY + ' not found.', user);
    if (status !== 200) return errorPage(status, body?.message || 'Failed to load.', user);
    initial = formValuesFromItem(body, PROPERTIES);
  }
  const refOptions = await loadRefOptions(api);
  const fields = PROPERTIES.map((p) =>
    renderField({ prop: p, value: initial[p.name], refOptions, errors: fieldErrors[p.name] || [] })).join('\n');
  const errorBlock = errors.length
    ? `<div role="alert"><p>Could not save:</p><ul>${errors.map((e) => '<li>' + escapeHtml(e) + '</li>').join('')}</ul></div>`
    : '';
  return {
    status: errors.length ? 400 : 200,
    html: layout({
      title: 'Edit ' + ENTITY,
      currentEntity: ENTITY,
      user,
      csrf,
      body: `
${errorBlock}
<form method="POST" action="${BASE}/${escapeHtml(id)}/edit">
${csrfField(csrf)}
${fields}
<p><button type="submit">Save</button> · <a href="${BASE}/${escapeHtml(id)}">Cancel</a></p>
</form>`,
    }),
  };
}

export async function handleSubmit({ api, id, form, user }) {
  const payload = parseFormBody(form, PROPERTIES);
  const { status, body } = await api.update(ENTITY, id, payload);
  if (status === 200) {
    return { status: 303, redirect: BASE + '/' + id };
  }
  if (status === 404) return errorPage(404, ENTITY + ' not found.', user);
  return { status: 400, errors: extractErrorList(body), values: payload };
}

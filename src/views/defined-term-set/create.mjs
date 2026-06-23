import { layout, escapeHtml, csrfField, renderField, parseFormBody, displayName } from '../layout.mjs';

const ENTITY = "DefinedTermSet";
const BASE = "/defined-term-sets";
const PROPERTIES = [
  { name: "name", kind: 'InlineScalar', use: "Text", cardinality: "one", required: true, maxLength: 256 },
  { name: "description", kind: 'InlineScalar', use: "Text", cardinality: "one", required: false, maxLength: 5000, multiline: true },
  { name: "url", kind: 'InlineScalar', use: "URL", cardinality: "one", required: false, maxLength: 2048 },
];

async function loadRefOptions() { return {}; }

function extractErrorList(body) {
  if (!body) return ['Request failed.'];
  if (Array.isArray(body.details) && body.details.length) return body.details;
  if (typeof body.message === 'string') return [body.message];
  return ['Request failed.'];
}

export async function renderForm({ api, csrf, user, values = {}, errors = [], fieldErrors = {} } = {}) {
  const refOptions = await loadRefOptions(api);
  const fields = PROPERTIES.map((p) =>
    renderField({ prop: p, value: values[p.name], refOptions, errors: fieldErrors[p.name] || [] })).join('\n');
  const errorBlock = errors.length
    ? `<div role="alert"><p>Could not save:</p><ul>${errors.map((e) => '<li>' + escapeHtml(e) + '</li>').join('')}</ul></div>`
    : '';
  return {
    status: errors.length ? 400 : 200,
    html: layout({
      title: 'New ' + ENTITY,
      currentEntity: ENTITY,
      user,
      csrf,
      body: `
${errorBlock}
<form method="POST" action="${BASE}/new">
${csrfField(csrf)}
${fields}
<p><button type="submit">Create</button> · <a href="${BASE}">Cancel</a></p>
</form>`,
    }),
  };
}

export async function handleSubmit({ api, form }) {
  const payload = parseFormBody(form, PROPERTIES);
  const { status, body } = await api.create(ENTITY, payload);
  if (status === 201 && body && body.id) {
    return { status: 303, redirect: BASE + '/' + body.id };
  }
  return { status: 400, errors: extractErrorList(body), values: payload };
}

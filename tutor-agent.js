/* Agent picker of the Socratic tutors (math panel and experiments tab).
 *
 * Each tutor's composer holds one provider select (#<prefix>Provider), one
 * model select (#<prefix>Model) and a free-text model field shown only for
 * "Other…" (#<prefix>ModelOther). The providers come from
 * GET /api/terminal/tutor/providers ("Automatic" first, a missing CLI greyed
 * out); the models of the provider in use from
 * GET /api/terminal/tutor/models/<provider> ("CLI default" first, "Other…"
 * last). The choice is kept in localStorage and shared by both tutors; a turn
 * carries it only when the reader made one, so "Automatic" with the CLI's
 * default model posts what it always did.
 *
 * Public surface (window): TutorAgent.{choice(), load(), mount(prefix), KEY}.
 */
(function () {
  'use strict';

  // The dashboard catalogue (i18n.js); a bare key where it is not loaded.
  const t = (key, vars) => (window.i18n ? window.i18n.t(key, vars) : key);
  const HEADERS = { 'Content-Type': 'application/json', 'X-Papersmith-Terminal': '1' };
  const KEY = 'papersmith.tutorAgent';
  const OTHER = '__other__';
  const pickers = [];
  // provider id -> 'loading' while its list is read, then its [{id, label}].
  const models = {};
  let providers = [];
  let other = false;
  let saved = read();

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function read() {
    try {
      const value = JSON.parse(window.localStorage.getItem(KEY) || '{}');
      return {
        provider: typeof value.provider === 'string' ? value.provider : '',
        model: typeof value.model === 'string' ? value.model : '',
      };
    } catch (_) { return { provider: '', model: '' }; }
  }

  function write() {
    try { window.localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) { /* private mode */ }
  }

  // What a turn adds to its body: nothing for "Automatic" and the CLI default.
  function choice() {
    const out = {};
    if (saved.provider) out.provider = saved.provider;
    const model = saved.model.trim();
    if (model) out.model = model;
    return out;
  }

  // "Automatic" runs the first installed CLI, so its models are that one's.
  function inUse() {
    if (saved.provider) return saved.provider;
    const first = providers.find((p) => p.available);
    return first ? first.id : '';
  }

  function providerOptions() {
    return [`<option value="">${escapeHtml(t('tutor.agent.auto'))}</option>`, ...providers.map((p) => (p.available
      ? `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`
      : `<option value="${escapeHtml(p.id)}" disabled>${escapeHtml(t('tutor.agent.notInstalled', { label: p.label }))}</option>`))].join('');
  }

  function modelOptions(list) {
    const middle = list === 'loading'
      ? [`<option value="" disabled>${escapeHtml(t('tutor.agent.loadingModels'))}</option>`]
      : (list || []).map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`);
    return [`<option value="">${escapeHtml(t('tutor.agent.modelDefault'))}</option>`, ...middle,
      `<option value="${OTHER}">${escapeHtml(t('tutor.agent.other'))}</option>`].join('');
  }

  function modelValue(list) {
    if (other) return OTHER;
    if (!saved.model) return '';
    // A model the list does not hold (or not yet) is shown as typed text.
    return Array.isArray(list) && list.some((m) => m.id === saved.model) ? saved.model : OTHER;
  }

  function paint() {
    const list = models[inUse()];
    const options = providerOptions();
    const modelHtml = modelOptions(list);
    const value = modelValue(list);
    pickers.forEach(({ provider, model, typed }) => {
      provider.innerHTML = options;
      provider.value = saved.provider;
      model.innerHTML = modelHtml;
      model.value = value;
      typed.hidden = value !== OTHER;
      if (value === OTHER && typed.value !== saved.model) typed.value = saved.model;
      typed.placeholder = t('tutor.agent.otherPlaceholder');
    });
  }

  async function loadModels(provider) {
    if (!provider || models[provider]) return;
    models[provider] = 'loading';
    paint();
    let list = [];
    try {
      const res = await fetch(`/api/terminal/tutor/models/${encodeURIComponent(provider)}`, { headers: HEADERS });
      list = res.ok ? ((await res.json()).models || []) : [];
    } catch (_) { /* offline: offer only the default and "Other…" */ }
    // An empty list (missing CLI, failed listing, no session) is not kept, so the
    // next load asks again; meanwhile "Other…" still takes a typed model.
    if (list.length) models[provider] = list;
    else delete models[provider];
    paint();
  }

  async function load() {
    try {
      const res = await fetch('/api/terminal/tutor/providers', { headers: HEADERS });
      // Without the terminal secret the tutor cannot run either: keep "Automatic".
      providers = res.ok ? ((await res.json()).providers || []) : [];
    } catch (_) { providers = []; }
    // A provider uninstalled since it was chosen would refuse every turn.
    if (saved.provider && !providers.some((p) => p.id === saved.provider && p.available)) {
      saved = { provider: '', model: '' };
      write();
    }
    paint();
    await loadModels(inUse());
  }

  function mount(prefix) {
    const provider = document.getElementById(`${prefix}Provider`);
    const model = document.getElementById(`${prefix}Model`);
    const typed = document.getElementById(`${prefix}ModelOther`);
    if (!provider || !model || !typed) return;
    pickers.push({ provider, model, typed });
    // Model ids differ per CLI, so a new provider starts from its default model.
    provider.addEventListener('change', () => {
      saved = { provider: provider.value, model: '' };
      other = false;
      write();
      paint();
      return loadModels(inUse());
    });
    model.addEventListener('change', () => {
      other = model.value === OTHER;
      saved.model = other ? typed.value : model.value;
      write();
      paint();
    });
    typed.addEventListener('input', () => { saved.model = typed.value; write(); paint(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    mount('tutor');
    mount('xtutor');
    paint();
  });

  document.addEventListener('languagechange', paint);

  window.TutorAgent = { choice, load, mount, KEY };
})();

const els = {
  btnPickDirectory: document.getElementById('btnPickDirectory'),
  fileInput: document.getElementById('fileInput'),
  btnClear: document.getElementById('btnClear'),

  searchBox: document.getElementById('searchBox'),
  chkCaseSensitive: document.getElementById('chkCaseSensitive'),
  chkRegex: document.getElementById('chkRegex'),
  regexError: document.getElementById('regexError'),

  sortMode: document.getElementById('sortMode'),
  chkHideReadOnlyNoise: document.getElementById('chkHideReadOnlyNoise'),
  chkHighlightMatches: document.getElementById('chkHighlightMatches'),

  badgeFiltered: document.getElementById('badgeFiltered'),
  activeFilters: document.getElementById('activeFilters'),

  btnResetFilters: document.getElementById('btnResetFilters'),
  btnClearFieldFilters: document.getElementById('btnClearFieldFilters'),

  themeSelect: document.getElementById('themeSelect'),

  status: document.getElementById('status'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),

  fileList: document.getElementById('fileList'),
  fileMeta: document.getElementById('fileMeta'),
  eventPanel: document.getElementById('eventPanel'),

  fieldSearch: document.getElementById('fieldSearch'),
  fieldList: document.getElementById('fieldList'),

  paneLeft: document.getElementById('paneLeft'),
  paneRight: document.getElementById('paneRight'),
  barLeft: document.getElementById('barLeft'),
  barRight: document.getElementById('barRight'),
};

const state = {
  files: [],
  events: [],
  filteredEvents: [],
  currentIndex: -1,
  activeFileId: null,

  fieldFilters: {},
  fieldCatalog: {},
  filteredFiles: [],

  leftW: 330,
  rightW: 380,

  quickFilterRegex: null, // compiled RegExp or null
};

const LS_THEME = 'cloudtrailViewer.theme';

// ---------- utils ----------
function safeParseDate(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateTime(d) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(d);
  } catch { return d.toISOString(); }
}

function isReadOnlyNoise(eventName) {
  if (!eventName || typeof eventName !== 'string') return false;
  return /^(Get|List|Describe)([A-Z]|$)/.test(eventName);
}

function shallowSearchHaystack(rec) {
  const parts = [];
  const push = (v) => { if (v !== undefined && v !== null) parts.push(String(v)); };

  push(rec.eventTime);
  push(rec.eventName);
  push(rec.eventSource);
  push(rec.awsRegion);
  push(rec.sourceIPAddress);
  push(rec.userAgent);
  push(rec.errorCode);
  push(rec.errorMessage);

  if (rec.userIdentity) {
    push(rec.userIdentity.type);
    push(rec.userIdentity.userName);
    push(rec.userIdentity.arn);
    push(rec.userIdentity.accountId);
    push(rec.userIdentity.principalId);
    push(rec.userIdentity.invokedBy);
  }

  return parts.join(' | ');
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(t) { els.status.textContent = t; }

function setNavEnabled() {
  const n = state.filteredEvents.length;
  const i = state.currentIndex;
  els.btnPrev.disabled = !(n > 0 && i > 0);
  els.btnNext.disabled = !(n > 0 && i >= 0 && i < n - 1);
}

function statusText() {
  if (state.files.length === 0) return 'No data loaded.';
  const totalEvents = state.events.length;
  const filtered = state.filteredEvents.length;
  const idx = state.currentIndex >= 0 ? (state.currentIndex + 1) : 0;
  return filtered !== totalEvents
    ? `${filtered.toLocaleString()} / ${totalEvents.toLocaleString()} events (filtered). Showing ${idx.toLocaleString()}.`
    : `${totalEvents.toLocaleString()} events loaded. Showing ${idx.toLocaleString()}.`;
}

// ---------- theme ----------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(LS_THEME, theme); } catch {}
}

function initTheme() {
  let t = 'cumulus-dark';
  try { t = localStorage.getItem(LS_THEME) || t; } catch {}
  els.themeSelect.value = t;
  applyTheme(t);
}

// ---------- sorting ----------
function sortEvents(rows) {
  const mode = els.sortMode.value;
  const copy = rows.slice();
  copy.sort((a, b) => {
    const fa = a.fileLastModified ?? 0;
    const fb = b.fileLastModified ?? 0;
    const ta = a.eventTimeMs ?? 0;
    const tb = b.eventTimeMs ?? 0;

    if (mode === 'fileThenTime') {
      if (fa !== fb) return fa - fb;
      if (ta !== tb) return ta - tb;
    } else {
      if (ta !== tb) return ta - tb;
      if (fa !== fb) return fa - fb;
    }
    if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
    return a.recordIndex - b.recordIndex;
  });
  return copy;
}

// ---------- splitter ----------
function clampWidths({ leftW, rightW }) {
  const viewport = document.documentElement.clientWidth;
  const minLeft = 220;
  const minRight = 260;
  const minCenter = 360;
  const reserved = 12 + 12 + minCenter + 40;
  const maxTotalSide = Math.max(minLeft + minRight, viewport - reserved);

  leftW = Math.max(minLeft, leftW);
  rightW = Math.max(minRight, rightW);

  const total = leftW + rightW;
  if (total > maxTotalSide) {
    const excess = total - maxTotalSide;
    const shrinkRight = Math.min(excess, rightW - minRight);
    rightW -= shrinkRight;
    const remaining = excess - shrinkRight;
    if (remaining > 0) leftW = Math.max(minLeft, leftW - remaining);
  }

  return { leftW, rightW };
}

function applySplitter() {
  const c = clampWidths({ leftW: state.leftW, rightW: state.rightW });
  state.leftW = c.leftW;
  state.rightW = c.rightW;

  els.paneLeft.style.width = `${state.leftW}px`;
  els.paneLeft.style.flex = '0 0 auto';

  els.paneRight.style.width = `${state.rightW}px`;
  els.paneRight.style.flex = '0 0 auto';
}

function wireSplitter() {
  const startDrag = (bar, which) => (e) => {
    bar.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');

    const onMove = (ev) => {
      if (which === 'left') {
        state.leftW = ev.clientX;
      } else {
        const viewport = document.documentElement.clientWidth;
        state.rightW = Math.max(0, viewport - ev.clientX);
      }
      applySplitter();
    };

    const onUp = () => {
      document.body.classList.remove('is-resizing');
      bar.removeEventListener('pointermove', onMove);
      bar.removeEventListener('pointerup', onUp);
      bar.removeEventListener('pointercancel', onUp);
    };

    bar.addEventListener('pointermove', onMove);
    bar.addEventListener('pointerup', onUp);
    bar.addEventListener('pointercancel', onUp);
  };

  els.barLeft.addEventListener('pointerdown', startDrag(els.barLeft, 'left'));
  els.barRight.addEventListener('pointerdown', startDrag(els.barRight, 'right'));
  window.addEventListener('resize', () => applySplitter());
  applySplitter();
}

// ---------- quick filter (case/regex) ----------
function updateQuickFilterRegex() {
  const raw = (els.searchBox.value || '');
  const useRegex = !!els.chkRegex.checked;

  els.regexError.style.display = 'none';
  state.quickFilterRegex = null;

  if (!raw.trim()) return;

  if (!useRegex) return;

  try {
    const flags = els.chkCaseSensitive.checked ? 'g' : 'gi';
    state.quickFilterRegex = new RegExp(raw, flags);
  } catch {
    els.regexError.style.display = 'inline-flex';
    state.quickFilterRegex = null;
  }
}

function matchesQuickFilter(haystack) {
  const raw = els.searchBox.value || '';
  const q = raw.trim();
  if (!q) return true;

  if (els.chkRegex.checked) {
    // invalid regex => treat as no matches (but show error)
    if (!state.quickFilterRegex) return false;
    return state.quickFilterRegex.test(haystack);
  }

  // plain substring
  if (els.chkCaseSensitive.checked) {
    return haystack.includes(q);
  }
  return haystack.toLowerCase().includes(q.toLowerCase());
}

// ---------- field filtering ----------
function flattenRecord(record) {
  const out = {};
  const MAX_KEYS = 350;
  const MAX_VALUES_PER_KEY = 40;
  const MAX_DEPTH = 8;

  const add = (k, v) => {
    if (!k) return;
    if (Object.keys(out).length > MAX_KEYS && !(k in out)) return;
    if (!out[k]) out[k] = [];
    if (out[k].length >= MAX_VALUES_PER_KEY) return;
    const s = String(v);
    if (!out[k].includes(s)) out[k].push(s);
  };

  const walk = (node, path, depth) => {
    if (node === null || node === undefined) return;
    if (depth > MAX_DEPTH) { add(path, '[MaxDepth]'); return; }
    const t = typeof node;
    if (t === 'string' || t === 'number' || t === 'boolean') { add(path, node); return; }
    if (Array.isArray(node)) {
      for (const item of node) {
        if (item && typeof item === 'object') walk(item, path, depth + 1);
        else add(path, item);
      }
      return;
    }
    if (t === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const next = path ? `${path}.${k}` : k;
        walk(v, next, depth + 1);
      }
    }
  };

  walk(record, '', 0);
  return out;
}

function buildFieldCatalog(events) {
  const catalog = {};
  for (const ev of events) {
    for (const [k, values] of Object.entries(ev.flat)) {
      if (!catalog[k]) catalog[k] = { key: k, values: new Map() };
      const m = catalog[k].values;
      for (const v of values) m.set(v, (m.get(v) || 0) + 1);
    }
  }
  state.fieldCatalog = catalog;
  for (const k of Object.keys(catalog)) {
    if (!state.fieldFilters[k]) state.fieldFilters[k] = { mode: 'any', selected: new Set(), valueSearch: '' };
  }
}

function doesEventMatchFieldFilters(ev) {
  for (const [field, cfg] of Object.entries(state.fieldFilters)) {
    if (cfg.mode === 'any') continue;
    if (!cfg.selected || cfg.selected.size === 0) continue;
    const values = ev.flat[field] || [];
    const hasAny = values.some(v => cfg.selected.has(v));
    if (cfg.mode === 'include' && !hasAny) return false;
    if (cfg.mode === 'exclude' && hasAny) return false;
  }
  return true;
}

function getActiveFiltersSummary() {
  const parts = [];

  const q = (els.searchBox.value || '').trim();
  if (q) parts.push(els.chkRegex.checked ? `regex:/${q}/` : `text:"${q}"`);
  if (els.chkCaseSensitive.checked && q) parts.push('case');
  if (els.chkHideReadOnlyNoise.checked) parts.push('hide-readonly');

  const fieldsActive = Object.entries(state.fieldFilters)
    .filter(([, cfg]) => cfg.mode !== 'any' && cfg.selected && cfg.selected.size > 0)
    .map(([field, cfg]) => `${field}:${cfg.mode}(${cfg.selected.size})`);

  if (fieldsActive.length) parts.push(...fieldsActive.slice(0, 6));
  if (fieldsActive.length > 6) parts.push(`+${fieldsActive.length - 6} more`);

  if (els.chkHighlightMatches.checked) parts.push('highlight:on');

  return parts.length ? parts.join(' • ') : 'none';
}

function updateFilterBadges() {
  const total = state.events.length;
  const filtered = state.filteredEvents.length;
  els.badgeFiltered.textContent = `Filtered: ${filtered.toLocaleString()} / ${total.toLocaleString()}`;
  els.activeFilters.textContent = `Active filters: ${getActiveFiltersSummary()}`;
}

// ---------- file filtering ----------
function computeFilteredFiles() {
  const counts = new Map();
  for (const e of state.filteredEvents) counts.set(e.fileId, (counts.get(e.fileId) || 0) + 1);
  state.filteredFiles = state.files
    .filter(f => counts.has(f.id))
    .map(f => ({ ...f, filteredCount: counts.get(f.id) || 0 }));
}

// ---------- apply filters ----------
function applyAllFilters(keepIndexIfPossible = true) {
  updateQuickFilterRegex();

  const hideNoise = !!els.chkHideReadOnlyNoise.checked;
  const prevKey = state.filteredEvents[state.currentIndex]?.key;

  const filtered = state.events.filter((row) => {
    if (hideNoise && isReadOnlyNoise(row.record?.eventName)) return false;
    if (!matchesQuickFilter(row.haystack)) return false;
    if (!doesEventMatchFieldFilters(row)) return false;
    return true;
  });

  state.filteredEvents = sortEvents(filtered);

  if (state.filteredEvents.length === 0) state.currentIndex = -1;
  else if (keepIndexIfPossible && prevKey) {
    const idx = state.filteredEvents.findIndex(r => r.key === prevKey);
    state.currentIndex = idx >= 0 ? idx : 0;
  } else state.currentIndex = 0;

  computeFilteredFiles();

  if (state.activeFileId && !state.filteredFiles.some(f => f.id === state.activeFileId)) {
    state.activeFileId = state.filteredFiles[0]?.id ?? null;
  }

  renderAll();
}

// ---------- highlighting ----------
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedJson(rawJsonString) {
  let html = escapeHtml(rawJsonString);
  if (!els.chkHighlightMatches.checked) return html;

  const qRaw = (els.searchBox.value || '').trim();
  const isRegex = !!els.chkRegex.checked;

  // highlight quick filter
  if (qRaw) {
    if (isRegex) {
      if (state.quickFilterRegex) {
        // Create a non-global version for replacement loops
        let re;
        try {
          re = new RegExp(state.quickFilterRegex.source, state.quickFilterRegex.flags.includes('i') ? 'gi' : 'g');
          html = html.replace(re, (m) => `<span class="mark">${m}</span>`);
        } catch {
          // ignore
        }
      }
    } else {
      const flags = els.chkCaseSensitive.checked ? 'g' : 'gi';
      const re = new RegExp(escapeRegExp(qRaw), flags);
      html = html.replace(re, (m) => `<span class="mark">${m}</span>`);
    }
  }

  // highlight selected field filter values (simple value-based highlighting)
  const incVals = [];
  const excVals = [];

  for (const cfg of Object.values(state.fieldFilters)) {
    if (!cfg.selected || cfg.selected.size === 0) continue;
    const arr = Array.from(cfg.selected);
    if (cfg.mode === 'include') incVals.push(...arr);
    if (cfg.mode === 'exclude') excVals.push(...arr);
  }

  const MAX_TOKENS = 60;

  const highlightTokens = (tokens, cls) => {
    const uniq = Array.from(new Set(tokens)).slice(0, MAX_TOKENS);
    uniq.sort((a,b)=>b.length-a.length);
    for (const t of uniq) {
      if (!t || t.length < 2) continue;
      const re = new RegExp(escapeRegExp(t), 'g');
      html = html.replace(re, (m) => `<span class="${cls}">${m}</span>`);
    }
  };

  highlightTokens(incVals, 'mark mark--inc');
  highlightTokens(excVals, 'mark mark--exc');

  return html;
}

// ---------- rendering ----------
function renderFiles() {
  els.fileList.innerHTML = '';

  if (state.files.length === 0) {
    els.fileMeta.textContent = '';
    return;
  }

  const anyFieldActive = Object.values(state.fieldFilters).some(cfg => cfg.mode !== 'any' && cfg.selected && cfg.selected.size > 0);
  const filtersActive =
    ((els.searchBox.value || '').trim() !== '') ||
    els.chkHideReadOnlyNoise.checked ||
    anyFieldActive;

  const list = filtersActive ? state.filteredFiles : state.files.map(f => ({ ...f, filteredCount: f.recordsCount }));

  const totalRecords = list.reduce((acc, f) => acc + (f.filteredCount ?? 0), 0);
  els.fileMeta.textContent = filtersActive
    ? `${list.length} files, ${totalRecords.toLocaleString()} matching events`
    : `${state.files.length} files, ${state.files.reduce((a,f)=>a+f.recordsCount,0).toLocaleString()} records`;

  for (const f of list) {
    const div = document.createElement('div');
    div.className = 'file' + (state.activeFileId === f.id ? ' file--active' : '');
    div.innerHTML = `
      <div class="file__name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
      <div class="file__meta">
        <span>Modified: ${escapeHtml(fmtDateTime(new Date(f.lastModified)))}</span>
        <span>${(f.filteredCount ?? f.recordsCount).toLocaleString()} match</span>
      </div>
    `;
    div.addEventListener('click', () => {
      state.activeFileId = f.id;
      renderFiles();
      const idx = state.filteredEvents.findIndex(e => e.fileId === f.id);
      if (idx >= 0) { state.currentIndex = idx; renderEvent(); }
    });
    els.fileList.appendChild(div);
  }
}

function renderEvent() {
  const n = state.filteredEvents.length;
  const i = state.currentIndex;
  setNavEnabled();

  if (n === 0 || i < 0) {
    els.eventPanel.className = 'panel panel--empty';
    els.eventPanel.innerHTML = `<div class="empty"><div class="empty__title">No matching events</div></div>`;
    updateFilterBadges();
    setStatus(statusText());
    return;
  }

  const row = state.filteredEvents[i];
  const rec = row.record || {};

  if (row.fileId && state.activeFileId !== row.fileId) {
    state.activeFileId = row.fileId;
    renderFiles();
  }

  const raw = JSON.stringify(rec, null, 2);
  const rawHtml = renderHighlightedJson(raw);

  els.eventPanel.className = 'panel';
  els.eventPanel.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:12px;">
      <div>
        <div style="font-weight:700; font-size:1.1rem;">${escapeHtml(rec.eventName || '(unknown eventName)')}</div>
        <div style="color:rgba(255,255,255,.65); font-family:var(--mono); margin-top:6px;">
          ${escapeHtml(rec.eventTime || '')}
        </div>
        <div style="margin-top:8px; color:rgba(255,255,255,.65); font-family:var(--mono);">
          ${escapeHtml(rec.eventSource || '')} • ${escapeHtml(rec.awsRegion || '')}
        </div>
      </div>
      <div style="text-align:right; color:rgba(255,255,255,.45); font-family:var(--mono); font-size:.85rem;">
        <div>Event ${i + 1} / ${n}</div>
        <div>${escapeHtml(row.fileName)}</div>
      </div>
    </div>

    <div style="margin-top:12px;">
      <pre id="rawJson">${rawHtml}</pre>
    </div>
  `;

  updateFilterBadges();
  setStatus(statusText());
}

function renderFieldsPanel() {
  const keys = Object.keys(state.fieldCatalog);
  if (keys.length === 0) {
    els.fieldList.innerHTML = `<div style="color: rgba(255,255,255,.45); padding: 12px;">Load data to see fields.</div>`;
    return;
  }

  const q = (els.fieldSearch.value || '').trim().toLowerCase();
  const list = keys.filter(k => !q || k.toLowerCase().includes(q)).sort((a,b)=>a.localeCompare(b));

  const MAX_FIELDS = 60;
  const renderKeys = list.slice(0, MAX_FIELDS);

  els.fieldList.innerHTML = '';

  for (const k of renderKeys) {
    const entry = state.fieldCatalog[k];
    const cfg = state.fieldFilters[k];

    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'field';

    const name = document.createElement('div');
    name.className = 'field__name';
    name.textContent = k;
    name.title = k;

    const toggle = document.createElement('div');
    toggle.className = 'toggle';

    const mkBtn = (label, mode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toggle__btn' + (cfg.mode === mode ? ' toggle__btn--active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { cfg.mode = mode; applyAllFilters(true); });
      return b;
    };

    toggle.append(mkBtn('Any','any'), mkBtn('Include','include'), mkBtn('Exclude','exclude'));

    const valueSearch = document.createElement('input');
    valueSearch.className = 'input input--small';
    valueSearch.placeholder = 'Search values...';
    valueSearch.value = cfg.valueSearch || '';
    valueSearch.addEventListener('input', () => { cfg.valueSearch = valueSearch.value; renderFieldsPanel(); });

    const valuesBox = document.createElement('div');
    valuesBox.className = 'values';

    const valuesArr = Array.from(entry.values.entries())
      .map(([v,count])=>({v,count}))
      .sort((a,b)=>(b.count-a.count)||a.v.localeCompare(b.v));

    const vq = (cfg.valueSearch || '').trim().toLowerCase();
    const filteredVals = valuesArr.filter(x => !vq || x.v.toLowerCase().includes(vq)).slice(0, 80);

    for (const { v, count } of filteredVals) {
      const row = document.createElement('label');
      row.className = 'value';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = cfg.selected.has(v);
      cb.addEventListener('change', () => {
        if (cb.checked) cfg.selected.add(v); else cfg.selected.delete(v);
        applyAllFilters(true);
      });

      const text = document.createElement('span');
      text.textContent = `${v} (${count})`;

      row.append(cb, text);
      valuesBox.appendChild(row);
    }

    fieldDiv.append(name, toggle, valueSearch, valuesBox);
    els.fieldList.appendChild(fieldDiv);
  }
}

function renderAll() {
  renderFiles();
  renderFieldsPanel();
  renderEvent();
  setNavEnabled();
  updateFilterBadges();
}

// ---------- reset helpers ----------
function clearAllFieldFilters() {
  for (const cfg of Object.values(state.fieldFilters)) {
    cfg.mode = 'any';
    cfg.selected = new Set();
    cfg.valueSearch = '';
  }
}

function resetFilters() {
  els.searchBox.value = '';
  els.chkCaseSensitive.checked = false;
  els.chkRegex.checked = false;
  els.regexError.style.display = 'none';
  state.quickFilterRegex = null;

  els.chkHideReadOnlyNoise.checked = false;
  els.chkHighlightMatches.checked = false;

  els.fieldSearch.value = '';
  clearAllFieldFilters();
  applyAllFilters(false);
}

// ---------- navigation ----------
function move(delta) {
  const n = state.filteredEvents.length;
  if (n === 0) return;
  const next = Math.max(0, Math.min(n - 1, state.currentIndex + delta));
  if (next !== state.currentIndex) { state.currentIndex = next; renderEvent(); }
}

// ---------- load ----------
async function readFileAsJson(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function extractRecords(json) {
  if (!json) return [];
  if (Array.isArray(json.Records)) return json.Records;
  if (Array.isArray(json)) return json;
  return [];
}

async function loadFromFileList(fileList) {
  const files = Array.from(fileList).filter(f => f.name.toLowerCase().endsWith('.json'));
  if (files.length === 0) return;

  files.sort((a,b)=>(a.lastModified-b.lastModified)||a.name.localeCompare(b.name));
  setStatus(`Loading ${files.length} files...`);

  state.files = [];
  state.events = [];
  state.filteredEvents = [];
  state.currentIndex = -1;
  state.activeFileId = null;
  state.fieldFilters = {};
  state.fieldCatalog = {};
  state.filteredFiles = [];

  for (const file of files) {
    let json;
    try { json = await readFileAsJson(file); }
    catch { continue; }

    const records = extractRecords(json);
    const fileId = crypto.randomUUID();

    state.files.push({ id: fileId, name: file.name, lastModified: file.lastModified || 0, recordsCount: records.length });

    const withTimes = records.map((r, idx) => {
      const d = safeParseDate(r?.eventTime);
      return { r, idx, t: d ? d.getTime() : null };
    }).sort((a,b)=>((a.t??0)-(b.t??0)) || (a.idx-b.idx));

    for (const { r, idx, t } of withTimes) {
      const flat = flattenRecord(r);
      const hay = shallowSearchHaystack(r) + ' | ' + JSON.stringify(r);

      state.events.push({
        key: `${file.name}::${idx}`,
        fileId,
        fileName: file.name,
        fileLastModified: file.lastModified || 0,
        recordIndex: idx,
        eventTimeMs: t,
        record: r,
        haystack: hay,
        flat,
      });
    }
  }

  state.events = sortEvents(state.events);
  state.activeFileId = state.files[0]?.id ?? null;

  buildFieldCatalog(state.events);
  resetFilters();
}

// ---------- directory picker ----------
async function pickDirectory() {
  if (!window.showDirectoryPicker) { els.fileInput.click(); return; }

  const dirHandle = await window.showDirectoryPicker();
  const files = [];

  async function walk(handle, path = '') {
    for await (const [name, child] of handle.entries()) {
      const childPath = path ? `${path}/${name}` : name;
      if (child.kind === 'file') {
        const f = await child.getFile();
        const wrapped = new File([await f.arrayBuffer()], childPath, {
          type: f.type || 'application/json',
          lastModified: f.lastModified,
        });
        files.push(wrapped);
      } else if (child.kind === 'directory') {
        await walk(child, childPath);
      }
    }
  }
  await walk(dirHandle);
  await loadFromFileList(files);
}

// ---------- wiring ----------
function wire() {
  initTheme();
  wireSplitter();

  els.themeSelect.addEventListener('change', () => applyTheme(els.themeSelect.value));

  els.btnPickDirectory.addEventListener('click', async () => { try { await pickDirectory(); } catch {} });

  els.fileInput.addEventListener('change', async () => {
    if (!els.fileInput.files) return;
    await loadFromFileList(els.fileInput.files);
    els.fileInput.value = '';
  });

  els.btnClear.addEventListener('click', () => location.reload());

  // quick filter changes
  els.searchBox.addEventListener('input', () => applyAllFilters(true));
  els.chkCaseSensitive.addEventListener('change', () => applyAllFilters(true));
  els.chkRegex.addEventListener('change', () => applyAllFilters(true));

  els.sortMode.addEventListener('change', () => applyAllFilters(true));
  els.chkHideReadOnlyNoise.addEventListener('change', () => applyAllFilters(true));

  // highlight affects rendering only
  els.chkHighlightMatches.addEventListener('change', () => renderEvent());

  els.fieldSearch.addEventListener('input', () => renderFieldsPanel());

  els.btnResetFilters.addEventListener('click', () => resetFilters());
  els.btnClearFieldFilters.addEventListener('click', () => { clearAllFieldFilters(); applyAllFilters(true); });

  els.btnPrev.addEventListener('click', () => move(-1));
  els.btnNext.addEventListener('click', () => move(+1));

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || document.activeElement?.isContentEditable) return;
    if (e.key === 'ArrowLeft' || e.key === 'k' || e.key === 'p') move(-1);
    if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'n') move(+1);
  });

  setStatus('No data loaded.');
  renderAll();
}

wire();
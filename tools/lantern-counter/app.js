'use strict';

// UI for the Lantern Counter: file input, summary/results rendering, search
// and sort, CSV download, and the print roster. Counting lives in lantern-rules.js.

import { toCSV } from '../../assets/js/csv.js';
import { LANTERN_THRESHOLD, processRoster, searchCampers } from './lantern-rules.js';

const fileInput = document.getElementById('csvFile');
const clearBtn = document.getElementById('clearBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const resizeHandle = document.getElementById('resizeHandle');
const summaryPanel = document.getElementById('summaryPanel');
const summaryEl = document.getElementById('summary');
const downloadBtn = document.getElementById('downloadBtn');
const printRosterBtn = document.getElementById('printRosterBtn');
const printRoster = document.getElementById('printRoster');
const warningsPanel = document.getElementById('warningsPanel');
const warningsEl = document.getElementById('warnings');
const resultsPanel = document.getElementById('resultsPanel');
const searchBox = document.getElementById('searchBox');
const lanternsOnlyBox = document.getElementById('lanternsOnly');
const yearsFilterChip = document.getElementById('yearsFilterChip');
const resultsCount = document.getElementById('resultsCount');
const resultsList = document.getElementById('resultsList');
const reviewPanel = document.getElementById('reviewPanel');
const reviewLog = document.getElementById('reviewLog');
const logPanel = document.getElementById('logPanel');
const logToggleBtn = document.getElementById('logToggleBtn');
const logEl = document.getElementById('log');

const MAX_SEARCH_RESULTS = 50;

let resultCSV = null;
let resultName = 'roster_with_lantern_years.csv';
let allCampers = [];
let namesAvailable = false;
let yearsFilter = null; // summer count selected by clicking a chart column
let chartSlots = [];
let chartPlot = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => run(file.name, reader.result);
  reader.onerror = () => showError(`Could not read "${file.name}". Is it open in another program?`);
  reader.readAsText(file);
});

function resetUI() {
  resultCSV = null;
  allCampers = [];
  namesAvailable = false;
  downloadBtn.disabled = true;
  printRosterBtn.disabled = true;
  printRoster.innerHTML = '';
  summaryPanel.hidden = true;
  summaryEl.innerHTML = '';
  warningsPanel.hidden = true;
  warningsEl.innerHTML = '';
  resultsPanel.hidden = true;
  searchBox.value = '';
  lanternsOnlyBox.checked = false;
  resultsList.innerHTML = '';
  reviewPanel.hidden = true;
  logPanel.hidden = true;
  logEl.hidden = true;
  logToggleBtn.textContent = 'Show log';
  yearsFilter = null;
  chartSlots = [];
  chartPlot = null;
  yearsFilterChip.hidden = true;
  setFullscreen(false);
}

function run(fileName, text) {
  resetUI();
  clearBtn.disabled = false;
  summaryPanel.hidden = false;

  let result;
  try {
    result = processRoster(text);
  } catch (err) {
    showError(err.message);
    renderLog([
      ['info', `Loaded "${fileName}".`],
      ['error', err.message],
    ]);
    return;
  }

  resultCSV = toCSV(result.outRows);
  resultName = fileName.replace(/\.csv$/i, '') + '_with_lantern_years.csv';
  allCampers = result.campers;
  namesAvailable = result.hasNames;

  summaryEl.innerHTML = '';
  summaryEl.append(
    buildStatRow(result),
    buildDistributionChart(result.distribution),
    buildStatusChip(result)
  );
  if (!result.hasNames) {
    summaryEl.appendChild(
      el('p', 'muted', 'No nameFirst/nameLast columns found — camper search is unavailable for this file.')
    );
  }
  downloadBtn.disabled = false;
  printRosterBtn.disabled = result.lanternCount === 0;

  if (result.warnings.length) {
    for (const w of result.warnings) {
      const div = document.createElement('div');
      div.className = 'warning-item';
      const p = document.createElement('p');
      p.textContent = w.message;
      div.appendChild(p);
      if (w.samples.length) {
        const pre = document.createElement('pre');
        pre.textContent = w.samples.join('\n');
        div.appendChild(pre);
      }
      warningsEl.appendChild(div);
    }
    warningsPanel.hidden = false;
  }

  searchBox.hidden = !namesAvailable;
  resultsPanel.hidden = false;
  renderResults();

  if (result.reviewLines.length) {
    reviewLog.textContent = result.reviewLines.join('\n');
    reviewPanel.hidden = false;
  }

  renderLog([['info', `Loaded "${fileName}".`], ...result.log]);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildStatRow(result) {
  const row = el('div', 'stat-row');
  const tile = (label, value) => {
    const t = el('div', 'stat-tile');
    t.append(el('div', 'stat-label', label), el('div', 'stat-value', String(value)));
    return t;
  };
  row.append(
    tile('Campers processed', result.camperCount),
    tile(`Lanterns · ${LANTERN_THRESHOLD}+ summers`, result.lanternCount)
  );
  return row;
}

// Column chart of campers per summer count; lantern buckets (5+) use the accent
// color. Clicking a column filters the results list to that count.
function buildDistributionChart(distribution) {
  const wrap = el('div', 'chart');
  wrap.appendChild(el('div', 'chart-title', 'Campers by number of valid summers — click a column to filter the results'));

  const maxYears = Math.max(...distribution.keys());
  const maxN = Math.max(...distribution.values());
  const plot = el('div', 'chart-plot');
  const ticks = el('div', 'chart-ticks');
  chartPlot = plot;
  chartSlots = [];

  for (let y = 0; y <= maxYears; y++) {
    const n = distribution.get(y) || 0;
    const slot = el('div', 'col-slot' + (y >= LANTERN_THRESHOLD ? ' lantern' : ''));
    slot.dataset.tip = `${n} camper${n === 1 ? '' : 's'} · ${y} summer${y === 1 ? '' : 's'}`;
    slot.dataset.years = y;
    slot.addEventListener('click', () => setYearsFilter(yearsFilter === y ? null : y));
    const bar = el('div', 'col-bar');
    bar.style.height = n === 0 ? '0' : Math.max(3, Math.round((n / maxN) * 110)) + 'px';
    slot.append(el('div', 'col-value', String(n)), bar);
    plot.appendChild(slot);
    chartSlots.push(slot);
    ticks.appendChild(el('div', 'col-tick', String(y)));
  }
  wrap.append(plot, ticks, el('div', 'chart-x-label', 'valid summers'));

  const legend = el('div', 'chart-legend');
  const legendItem = (swatchClass, label) => {
    const item = el('span', 'legend-item');
    item.append(el('span', 'legend-swatch ' + swatchClass), el('span', '', label));
    return item;
  };
  legend.append(
    legendItem('swatch-muted', `under ${LANTERN_THRESHOLD} summers`),
    legendItem('swatch-accent', `${LANTERN_THRESHOLD}+ summers — lantern`)
  );
  wrap.appendChild(legend);
  return wrap;
}

function buildStatusChip(result) {
  const issues = result.warnings.length + (result.reviewLines.length ? 1 : 0);
  const chip = el('div', 'status-chip ' + (issues ? 'warn' : 'good'));
  chip.textContent = issues
    ? `⚠ ${issues} data check issue${issues === 1 ? '' : 's'} — see details below`
    : '✔ Data checks passed — the file matches the expected export format';
  return chip;
}

function renderLog(entries) {
  const prefix = { info: '·', warn: '⚠', error: '✘' };
  logEl.textContent = entries.map(([level, text]) => `${prefix[level]} ${text}`).join('\n');
  logPanel.hidden = false; // panel shows; the log text stays collapsed until toggled
}

function showError(msg) {
  summaryPanel.hidden = false;
  summaryEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = '✘ ' + msg;
  summaryEl.appendChild(p);
}

// An expandable row per camper: summary line plus a per-registration breakdown.
function camperDetails(c) {
  const isLantern = c.count >= LANTERN_THRESHOLD;
  const det = document.createElement('details');
  det.className = 'camper' + (isLantern ? ' lantern' : '');

  const sum = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'result-name';
  name.textContent = c.name || `Row ${c.rowNum}`;
  const years = document.createElement('span');
  years.className = 'result-years';
  years.textContent = c.count === 0
    ? 'no valid summers'
    : `${c.count} summer${c.count === 1 ? '' : 's'} (${c.years.join(', ')})`;
  const badge = document.createElement('span');
  badge.className = 'result-badge';
  badge.textContent = isLantern ? '🏮 Lantern' : `row ${c.rowNum}`;
  sum.append(name, years, badge);
  det.appendChild(sum);

  const body = document.createElement('div');
  body.className = 'camper-entries';
  if (c.entries.length === 0 && c.unparsed.length === 0) {
    const div = document.createElement('div');
    div.className = 'entry-line muted';
    div.textContent = '(empty ReservationHistory)';
    body.appendChild(div);
  }
  for (const group of groupEntriesByYear(c.entries)) {
    body.appendChild(yearGroupEl(group));
  }
  for (const u of c.unparsed) {
    const div = document.createElement('div');
    div.className = 'entry-line muted';
    div.textContent = `~ ignored, no date: ${u}`;
    body.appendChild(div);
  }
  det.appendChild(body);
  return det;
}

function groupEntriesByYear(entries) {
  const order = [];
  const byYear = new Map();
  for (const e of entries) {
    if (!byYear.has(e.year)) { byYear.set(e.year, []); order.push(e.year); }
    byYear.get(e.year).push(e);
  }
  return order.map(year => ({ year, entries: byYear.get(year) }));
}

// One summer's registrations. In a multi-session summer only the earliest valid
// one counts; it's marked "counts" and the rest are flagged as already covered.
function yearGroupEl(group) {
  const counts = group.entries.some(e => e.counted);
  const multi = group.entries.length > 1;

  const wrap = el('div', 'year-group' + (counts ? ' counts' : '') + (multi ? ' multi' : ''));

  const header = el('div', 'year-group-header');
  header.append(el('span', 'year-group-year', String(group.year)));
  if (multi) {
    header.appendChild(el('span', 'year-group-badge',
      `${group.entries.length} sessions this summer`));
  }
  header.appendChild(el('span', 'year-group-badge ' + (counts ? 'badge-counts' : 'badge-nocounts'),
    counts ? '→ 1 lantern year' : 'no valid registration'));
  wrap.appendChild(header);

  for (const e of group.entries) {
    const div = el('div', 'entry-line ' + e.verdict + (e.counted ? ' counted' : ''));
    const mark = e.verdict === 'valid' ? '✔' : e.verdict === 'excluded' ? '✘' : '⚠';
    let tag = '';
    if (e.counted) tag = '  ★ counts';
    else if (e.verdict === 'valid') tag = '  (same summer — already counted)';
    div.textContent = `${mark} ${e.title}  (${e.reason})${tag}`;
    wrap.appendChild(div);
  }
  return wrap;
}

// By last name; by lantern years (desc, last name breaks ties); or row order
// for files without name columns.
const byLastName = (a, b) =>
  a.last.localeCompare(b.last) || a.first.localeCompare(b.first) || a.rowNum - b.rowNum;
const byYears = (a, b) => b.count - a.count || byLastName(a, b);
const byRow = (a, b) => a.rowNum - b.rowNum;

const SORTS = { name: byLastName, years: byYears, row: byRow };

let sortMode = 'row';

function setYearsFilter(years) {
  yearsFilter = years;
  if (chartPlot) chartPlot.classList.toggle('filtered', years !== null);
  for (const slot of chartSlots) {
    slot.classList.toggle('selected', Number(slot.dataset.years) === years);
  }
  yearsFilterChip.hidden = years === null;
  if (years !== null) {
    yearsFilterChip.textContent = `${years} summer${years === 1 ? '' : 's'} ✕`;
  }
  renderResults();
}

function renderResults() {
  const query = namesAvailable ? searchBox.value.trim() : '';
  let list = searchCampers(allCampers, query);
  if (lanternsOnlyBox.checked) list = list.filter(c => c.count >= LANTERN_THRESHOLD);
  if (yearsFilter !== null) list = list.filter(c => c.count === yearsFilter);

  const total = list.length;
  // Sort by the active mode, then cap how many search results are shown.
  const sorted = [...list].sort(SORTS[sortMode]);
  const capped = query ? sorted.slice(0, MAX_SEARCH_RESULTS) : sorted;

  resultsList.innerHTML = '';
  if (total === 0) {
    resultsCount.textContent = query ? 'No campers match that name.' : 'No campers to show.';
    return;
  }
  resultsCount.textContent =
    (query ? `${total} match${total === 1 ? '' : 'es'}` : `${total} camper${total === 1 ? '' : 's'}`) +
    (yearsFilter !== null ? ` with ${yearsFilter} summer${yearsFilter === 1 ? '' : 's'}` : '') +
    (capped.length < total ? ` — showing top ${capped.length}` : '') +
    ' · click a camper to see how their count was calculated';

  const frag = document.createDocumentFragment();
  for (const c of capped) frag.appendChild(camperDetails(c));
  resultsList.appendChild(frag);
}

searchBox.addEventListener('input', renderResults);
lanternsOnlyBox.addEventListener('change', renderResults);
yearsFilterChip.addEventListener('click', () => setYearsFilter(null));

const sortButtons = {
  name: document.getElementById('sortByName'),
  years: document.getElementById('sortByYears'),
  row: document.getElementById('sortByRow'),
};

function setSortMode(mode) {
  sortMode = mode;
  for (const [m, btn] of Object.entries(sortButtons)) {
    btn.classList.toggle('active', m === mode);
  }
  renderResults();
}

for (const [mode, btn] of Object.entries(sortButtons)) {
  btn.addEventListener('click', () => setSortMode(mode));
}

logToggleBtn.addEventListener('click', () => {
  logEl.hidden = !logEl.hidden;
  logToggleBtn.textContent = logEl.hidden ? 'Show log' : 'Hide log';
});

clearBtn.addEventListener('click', () => {
  fileInput.value = '';
  resetUI();
  clearBtn.disabled = true;
});

function setFullscreen(on) {
  resultsPanel.classList.toggle('fullscreen', on);
  document.body.classList.toggle('no-scroll', on);
  fullscreenBtn.textContent = on ? 'Exit fullscreen' : 'Fullscreen';
}

fullscreenBtn.addEventListener('click', () =>
  setFullscreen(!resultsPanel.classList.contains('fullscreen')));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && resultsPanel.classList.contains('fullscreen')) setFullscreen(false);
});

resizeHandle.addEventListener('pointerdown', e => {
  e.preventDefault();
  const startY = e.clientY;
  const startHeight = resultsList.getBoundingClientRect().height;
  resizeHandle.setPointerCapture(e.pointerId);

  const onMove = ev => {
    const h = Math.max(120, startHeight + ev.clientY - startY);
    resultsList.style.maxHeight = 'none';
    resultsList.style.height = h + 'px';
  };
  const onUp = () => {
    resizeHandle.removeEventListener('pointermove', onMove);
  };
  resizeHandle.addEventListener('pointermove', onMove);
  resizeHandle.addEventListener('pointerup', onUp, { once: true });
});

downloadBtn.addEventListener('click', () => {
  if (!resultCSV) return;
  const blob = new Blob([resultCSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = resultName;
  a.click();
  URL.revokeObjectURL(url);
});

// Clean lantern-only roster (last/first name + summers, sorted by last name).
// The @media print rules in lantern.css hide the app UI and show #printRoster.
function renderPrintRoster() {
  const lanterns = allCampers
    .filter(c => c.count >= LANTERN_THRESHOLD)
    .sort(byLastName);

  printRoster.innerHTML = '';

  const header = el('div', 'print-header');
  header.appendChild(el('h1', 'print-title', 'Lantern Roster'));
  const dateStr = new Date().toLocaleDateString('en-US',
    { year: 'numeric', month: 'long', day: 'numeric' });
  header.appendChild(el('p', 'print-meta',
    `YMCA Camp Colman · ${lanterns.length} lantern${lanterns.length === 1 ? '' : 's'} ` +
    `(${LANTERN_THRESHOLD}+ summers) · ${dateStr}`));
  printRoster.appendChild(header);

  const table = el('table', 'print-table');
  const thead = el('thead');
  const headRow = el('tr');
  headRow.append(
    el('th', null, 'Last name'),
    el('th', null, 'First name'),
    el('th', 'col-years', 'Summers')
  );
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const c of lanterns) {
    const tr = el('tr');
    tr.append(
      el('td', null, c.last || '—'),
      el('td', null, c.first || '—'),
      el('td', 'col-years', String(c.count))
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  printRoster.appendChild(table);

  printRoster.appendChild(el('p', 'print-note',
    'Names come from registration records and may differ from the name a camper goes by at camp.'));
}

printRosterBtn.addEventListener('click', () => {
  if (printRosterBtn.disabled) return;
  renderPrintRoster();
  window.print();
});

'use strict';

// Lantern Counter — counts distinct valid summers per camper from the
// ReservationHistory column of a roster export. Rules: see RULES.md.

// Generic CSV helpers live in the shared module (used across tools).
import { parseCSV, toCSV } from '../../assets/js/csv.js';

// Exclusions run first (order per RULES.md), so "Family Camp - Session F"
// is rejected even though it carries a lettered session code.
const EXCLUDE_RULES = [
  ['family camp', /family camp|exceptional families|families weekend/i],
  ['Camp Orkila', /orkila/i],
  ['BOLD/GOLD trip', /\bbold\b|\bgold\b/i],
  ['day camp', /\bweek\s*\d|\(day camp\)/i],
  ['event / non-session', /open house|orientation|values awards|yesc|cabin rental|first-?time camper|wellness weekend/i],
  // "Holdover Night for Sessions F-G" — a between-session stay, not a session.
  ['holdover', /holdover/i],
  // "- " keeps this from matching the valid "All Gender Mini Camp"
  ['All Gender expedition', /all gender - /i],
  ['numbered session (Orkila)', /session\s+\d+[a-z]?\b/i],
];

const INCLUDE_RULES = [
  ['lettered session', /session\s+[a-h]{1,2}\d?\b/i],
  ['Mini Session', /mini session/i],
  // "Session I - Mini Camp": Mini Camp is valid even when the session letter
  // falls outside A-H, so match the program name directly.
  ['Mini Camp', /mini camp/i],
  ['legacy bare-letter title', /^[a-h]\d? - /i],
];

// -> { verdict: 'valid' | 'excluded' | 'review', reason }
function classifyTitle(title) {
  for (const [reason, re] of EXCLUDE_RULES) {
    if (re.test(title)) return { verdict: 'excluded', reason };
  }
  for (const [reason, re] of INCLUDE_RULES) {
    if (re.test(title)) return { verdict: 'valid', reason };
  }
  return { verdict: 'review', reason: 'unrecognized title' };
}

// "7/6/2025 2025 CAMP - Session A - ..." — the year that counts is the
// date's year; older titles have no year prefix. Two date formats appear in
// exports: legacy US "M/D/YYYY" and newer ISO "YYYY-MM-DD"; support both.
const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/;
const LINE_RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(.+)$/;

// Titles like "2025 CAMP - ..." start with a year; it should always equal
// the date's year. A mismatch means the export format drifted.
const TITLE_YEAR_RE = /^((?:19|20)\d{2})\b/;

// Count distinct calendar years with at least one valid registration.
function processHistory(history) {
  const years = new Set();
  const entries = [];
  const unparsed = [];
  const reviews = [];
  const yearMismatches = [];
  const implausibleYears = [];
  const maxPlausibleYear = new Date().getFullYear() + 1;

  for (const rawLine of String(history ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // Try US "M/D/YYYY" first, then ISO "YYYY-MM-DD"; the two swap the
    // year/month/day capture order, so read them from the right groups.
    const mUS = LINE_RE.exec(line);
    const mISO = mUS ? null : LINE_RE_ISO.exec(line);
    const m = mUS || mISO;
    if (!m) { unparsed.push(line); continue; }
    const month = Number(mUS ? m[1] : m[2]);
    const day = Number(mUS ? m[2] : m[3]);
    const year = Number(mUS ? m[3] : m[1]);
    const title = m[4].trim();

    const titleYear = TITLE_YEAR_RE.exec(title);
    if (titleYear && Number(titleYear[1]) !== year) yearMismatches.push(line);
    if (year < 1990 || year > maxPlausibleYear) implausibleYears.push(line);

    const { verdict, reason } = classifyTitle(title);
    entries.push({ year, month, day, title, verdict, reason });
    if (verdict === 'valid') years.add(year);
    if (verdict === 'review') reviews.push(title);
  }

  // Only one registration per summer counts (RULES.md): the earliest-dated
  // valid one. Tag it on each entry so the UI can show which registration
  // in a multi-session summer is the one actually contributing to the count.
  const earliestValidByYear = new Map();
  for (const e of entries) {
    if (e.verdict !== 'valid') continue;
    const cur = earliestValidByYear.get(e.year);
    if (!cur || e.month < cur.month || (e.month === cur.month && e.day < cur.day)) {
      earliestValidByYear.set(e.year, e);
    }
  }
  for (const e of earliestValidByYear.values()) e.counted = true;

  return {
    count: years.size, years: [...years].sort(), entries, unparsed, reviews,
    yearMismatches, implausibleYears,
  };
}

const LANTERN_THRESHOLD = 5;

function findColumn(header, name) {
  return header.findIndex(h => h.toLowerCase() === name.toLowerCase());
}

function processRoster(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) {
    throw new Error('The file is empty. Make sure you exported the roster as a CSV.');
  }
  if (rows.length === 1) {
    throw new Error('The file only contains a header row — no camper rows found.');
  }

  const header = rows[0].map(h => h.replace(/^﻿/, '').trim());
  const colIdx = findColumn(header, 'ReservationHistory');
  if (colIdx === -1) {
    throw new Error(
      'No "ReservationHistory" column found — this doesn\'t look like the right export. ' +
      'Columns present: ' + (header.filter(Boolean).join(', ') || '(none)')
    );
  }

  // Name columns are optional; results and search degrade gracefully without them.
  const firstIdx = findColumn(header, 'nameFirst');
  const lastIdx = findColumn(header, 'nameLast');
  const hasNames = firstIdx !== -1 || lastIdx !== -1;

  const log = [];
  log.push(['info', `Parsed ${rows.length - 1} camper row${rows.length === 2 ? '' : 's'} (${header.length} column${header.length === 1 ? '' : 's'}).`]);
  log.push(['info', `Found "ReservationHistory" (column ${colIdx + 1}).`]);
  log.push(hasNames
    ? ['info', 'Name columns: ' + [firstIdx !== -1 && 'nameFirst', lastIdx !== -1 && 'nameLast'].filter(Boolean).join(', ') + '.']
    : ['warn', 'No nameFirst/nameLast columns — campers listed by row number, search disabled.']);

  const outRows = [[...rows[0], 'LanternYears']];
  const reviewLines = [];
  const distribution = new Map();
  const campers = [];

  // Aggregated format-drift signals, reported as loud warnings after the loop.
  const unparsedSamples = [];
  const mismatchSamples = [];
  const implausibleSamples = [];
  let unparsedTotal = 0;
  let mismatchTotal = 0;
  let implausibleTotal = 0;
  let extraCellRows = 0;
  let parsedLineTotal = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const result = processHistory(row[colIdx]);

    // pad ragged rows so LanternYears always lands in the same column
    const padded = [...row];
    while (padded.length < header.length) padded.push('');
    padded.push(String(result.count));
    outRows.push(padded);

    const rowNum = r + 1; // matches Excel: header is row 1, data starts at 2
    const first = firstIdx !== -1 ? (row[firstIdx] ?? '').trim() : '';
    const last = lastIdx !== -1 ? (row[lastIdx] ?? '').trim() : '';
    const name = [first, last].filter(Boolean).join(' ');
    const label = name ? `Row ${rowNum} — ${name}` : `Row ${rowNum}`;

    campers.push({
      rowNum, name, first, last,
      count: result.count, years: result.years,
      entries: result.entries, unparsed: result.unparsed,
    });
    distribution.set(result.count, (distribution.get(result.count) || 0) + 1);

    parsedLineTotal += result.entries.length;
    if (row.length > header.length) {
      extraCellRows++;
      log.push(['warn', `${label}: row has ${row.length} cells but the header has ${header.length}.`]);
    }
    const collect = (items, samples, total, logText) => {
      for (const item of items) {
        if (samples.length < 5) samples.push(`${label}: ${item}`);
        log.push(['warn', `${label}: ${logText}: "${item}"`]);
      }
      return total + items.length;
    };
    unparsedTotal = collect(result.unparsed, unparsedSamples, unparsedTotal, 'ignored line (no M/D/YYYY date)');
    mismatchTotal = collect(result.yearMismatches, mismatchSamples, mismatchTotal, 'date year and title year disagree');
    implausibleTotal = collect(result.implausibleYears, implausibleSamples, implausibleTotal, 'implausible year');
    for (const t of result.reviews) {
      reviewLines.push(`${label}: ${t}`);
      log.push(['warn', `${label}: unrecognized title (not counted): "${t}"`]);
    }
  }

  // Format-drift warnings. The tool is hardcoded to the current export
  // format, so anything unexpected gets reported loudly instead of being
  // silently ignored or miscounted.
  const warnings = [];
  const sampleNote = (total, samples) =>
    total > samples.length ? [...samples, `…and ${total - samples.length} more (see log)`] : samples;

  if (unparsedTotal > 0) {
    warnings.push({
      message: `${unparsedTotal} history line${unparsedTotal === 1 ? ' was' : 's were'} IGNORED because ` +
        `${unparsedTotal === 1 ? 'it' : 'they'} didn't start with a M/D/YYYY date. If the export's date format ` +
        'changed, counts will be too low.',
      samples: sampleNote(unparsedTotal, unparsedSamples),
    });
  }
  if (mismatchTotal > 0) {
    warnings.push({
      message: `${mismatchTotal} line${mismatchTotal === 1 ? '' : 's'} where the date's year and the title's year ` +
        'disagree. This tool trusts the date, but that assumption held until now — verify which one is right.',
      samples: sampleNote(mismatchTotal, mismatchSamples),
    });
  }
  if (implausibleTotal > 0) {
    warnings.push({
      message: `${implausibleTotal} line${implausibleTotal === 1 ? '' : 's'} with an implausible year ` +
        `(before 1990 or after ${new Date().getFullYear() + 1}). The date format may have changed.`,
      samples: sampleNote(implausibleTotal, implausibleSamples),
    });
  }
  if (extraCellRows > 0) {
    warnings.push({
      message: `${extraCellRows} row${extraCellRows === 1 ? ' has' : 's have'} more columns than the header. ` +
        'The CSV may be malformed — the LanternYears column may not line up on those rows.',
      samples: [],
    });
  }
  const zeroCount = distribution.get(0) || 0;
  const camperCount = rows.length - 1;
  if (camperCount >= 10 && zeroCount / camperCount > 0.5) {
    warnings.push({
      message: `${zeroCount} of ${camperCount} campers (${Math.round(100 * zeroCount / camperCount)}%) have zero ` +
        'valid summers. That is unusually high — session titles or the file format may have changed, ' +
        'and valid registrations may no longer be recognized.',
      samples: [],
    });
  }
  if (parsedLineTotal === 0 && camperCount > 0) {
    warnings.push({
      message: 'No registration lines could be parsed in the entire file. This is almost certainly the wrong ' +
        'file or a changed export format — do not trust these counts.',
      samples: [],
    });
  }

  const lanternCount = campers.filter(c => c.count >= LANTERN_THRESHOLD).length;
  log.push(['info', `Done: ${lanternCount} lantern-eligible campers out of ${camperCount}.`]);
  if (warnings.length === 0 && reviewLines.length === 0) {
    log.push(['info', 'Data checks passed.']);
  }

  return {
    outRows, reviewLines, warnings, distribution, campers, hasNames,
    camperCount, lanternCount, log,
  };
}

// Fuzzy name matching: substring matches score highest (earlier and
// word-start matches win ties), then in-order subsequence matches.
function fuzzyScore(query, target) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q || !t) return -1;

  const idx = t.indexOf(q);
  if (idx !== -1) {
    const wordStart = idx === 0 || t[idx - 1] === ' ' ? 50 : 0;
    return 1000 - idx + wordStart;
  }

  let ti = 0, streak = 0, gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return -1;
    if (found === ti && ti > 0) streak += 5; else gaps++;
    ti = found + 1;
  }
  return 200 + streak - gaps * 10 - t.length;
}

function searchCampers(campers, query) {
  const q = query.trim();
  if (!q) return campers;
  return campers
    .map(c => {
      // match against both name orders so "smith jo" and "jo smith" both work
      const score = Math.max(
        fuzzyScore(q, `${c.first} ${c.last}`),
        fuzzyScore(q, `${c.last} ${c.first}`)
      );
      return { camper: c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.camper);
}

// UI wiring

const fileInput = document.getElementById('csvFile');
const clearBtn = document.getElementById('clearBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const resizeHandle = document.getElementById('resizeHandle');
const summaryPanel = document.getElementById('summaryPanel');
const summaryEl = document.getElementById('summary');
const downloadBtn = document.getElementById('downloadBtn');
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
let yearsFilter = null;   // summer count selected by clicking a chart column
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

// Clears all output panels and state; used before each run and by Clear.
function resetUI() {
  resultCSV = null;
  allCampers = [];
  namesAvailable = false;
  downloadBtn.disabled = true;
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

// Column chart of campers per summer count. Emphasis form: lantern buckets
// (5+) in the accent, the rest in the de-emphasis gray; a legend carries the
// distinction, value caps carry the numbers (so no y-axis is needed).
// Clicking a column filters the results list to that summer count.
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
  logPanel.hidden = false; // panel visible, log text stays collapsed until toggled
}

function showError(msg) {
  summaryPanel.hidden = false;
  summaryEl.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = '✘ ' + msg;
  summaryEl.appendChild(p);
}

// One expandable row per camper: summary line with name/count/badge,
// registration-by-registration breakdown inside.
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

// Bundles a camper's entries into one group per summer, in order of first
// appearance, so same-year registrations render together.
function groupEntriesByYear(entries) {
  const order = [];
  const byYear = new Map();
  for (const e of entries) {
    if (!byYear.has(e.year)) { byYear.set(e.year, []); order.push(e.year); }
    byYear.get(e.year).push(e);
  }
  return order.map(year => ({ year, entries: byYear.get(year) }));
}

// One summer's worth of registrations. When more than one session was
// registered in the same year, they're visually bracketed together and the
// entry that actually counts (earliest valid) is marked "counts" — the rest
// are marked as extra sessions that don't add a second lantern year.
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

// Sorting: by last name, or by lantern years (highest first) with last
// name breaking ties. Files without name columns fall back to row order.
const byLastName = (a, b) =>
  a.last.localeCompare(b.last) || a.first.localeCompare(b.first) || a.rowNum - b.rowNum;
const byYears = (a, b) => b.count - a.count || byLastName(a, b);
const byRow = (a, b) => a.rowNum - b.rowNum;

const SORTS = { name: byLastName, years: byYears, row: byRow };

let sortMode = 'row';

// Applies the chart-column filter and keeps the chart/chip in sync with it.
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
  // when searching, relevance picks which results survive the cap; the
  // chosen sort then orders what's shown
  const capped = query ? list.slice(0, MAX_SEARCH_RESULTS) : [...list];
  capped.sort(SORTS[sortMode]);

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

// Drag the handle under the results list to resize it.
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

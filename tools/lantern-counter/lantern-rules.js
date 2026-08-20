'use strict';

// Counting logic for the Lantern Counter: from a roster CSV, count each
// camper's distinct valid summers. What counts as valid is defined in RULES.md.
// This module is DOM-free; app.js handles the UI.

import { parseCSV } from '../../assets/js/csv.js';

// Exclusions run before inclusions (order matters per RULES.md), so a title
// like "Family Camp - Session F" is rejected despite its lettered session code.
const EXCLUDE_RULES = [
  ['family camp', /family camp|exceptional families|families weekend/i],
  ['Camp Orkila', /orkila/i],
  ['BOLD/GOLD trip', /\bbold\b|\bgold\b/i],
  ['day camp', /\bweek\s*\d|\(day camp\)/i],
  ['event / non-session', /open house|orientation|values awards|yesc|cabin rental|first-?time camper|wellness weekend/i],
  ['holdover', /holdover/i], // between-session stay, e.g. "Holdover Night for Sessions F-G"
  ['All Gender expedition', /all gender - /i], // "- " avoids matching the valid "All Gender Mini Camp"
  ['numbered session (Orkila)', /session\s+\d+[a-z]?\b/i],
];

const INCLUDE_RULES = [
  ['lettered session', /session\s+[a-h]{1,2}\d?\b/i],
  ['Mini Session', /mini session/i],
  ['Mini Camp', /mini camp/i], // valid even when the letter is outside A-H, e.g. "Session I - Mini Camp"
  ['legacy bare-letter title', /^[a-h]\d? - /i],
];

function classifyTitle(title) {
  for (const [reason, re] of EXCLUDE_RULES) {
    if (re.test(title)) return { verdict: 'excluded', reason };
  }
  for (const [reason, re] of INCLUDE_RULES) {
    if (re.test(title)) return { verdict: 'valid', reason };
  }
  return { verdict: 'review', reason: 'unrecognized title' };
}

// The season is the year of the line's date, not the title (older titles have
// no year prefix). Exports carry two date formats, so match both.
const LINE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/;   // US M/D/YYYY
const LINE_RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(.+)$/; // ISO YYYY-MM-DD

// A "2025 CAMP - ..." title's leading year should equal the date's year; a
// mismatch means the export format drifted.
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
    // The two formats swap the year/month/day group order, so read each from
    // the right capture group.
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

  // Only the earliest-dated valid registration per summer counts (RULES.md).
  // Tag it so the UI can show which one contributed in a multi-session summer.
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

export const LANTERN_THRESHOLD = 5;

function findColumn(header, name) {
  return header.findIndex(h => h.toLowerCase() === name.toLowerCase());
}

export function processRoster(text) {
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

  // Cabin is optional; when present it's shown in the roster and printout.
  const cabinIdx = findColumn(header, 'Cabin');
  const hasCabin = cabinIdx !== -1;

  const log = [];
  log.push(['info', `Parsed ${rows.length - 1} camper row${rows.length === 2 ? '' : 's'} (${header.length} column${header.length === 1 ? '' : 's'}).`]);
  log.push(['info', `Found "ReservationHistory" (column ${colIdx + 1}).`]);
  log.push(hasNames
    ? ['info', 'Name columns: ' + [firstIdx !== -1 && 'nameFirst', lastIdx !== -1 && 'nameLast'].filter(Boolean).join(', ') + '.']
    : ['warn', 'No nameFirst/nameLast columns — campers listed by row number, search disabled.']);
  if (hasCabin) log.push(['info', `Found "Cabin" (column ${cabinIdx + 1}).`]);

  const outRows = [[...rows[0], 'LanternYears']];
  const reviewLines = [];
  const distribution = new Map();
  const campers = [];

  // Format-drift signals, aggregated and surfaced as loud warnings after the loop.
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

    // pad ragged rows so LanternYears lands in the same column everywhere
    const padded = [...row];
    while (padded.length < header.length) padded.push('');
    padded.push(String(result.count));
    outRows.push(padded);

    const rowNum = r + 1; // matches Excel: header is row 1, data starts at 2
    const first = firstIdx !== -1 ? (row[firstIdx] ?? '').trim() : '';
    const last = lastIdx !== -1 ? (row[lastIdx] ?? '').trim() : '';
    const cabin = cabinIdx !== -1 ? (row[cabinIdx] ?? '').trim() : '';
    const name = [first, last].filter(Boolean).join(' ');
    const label = name ? `Row ${rowNum} — ${name}` : `Row ${rowNum}`;

    campers.push({
      rowNum, name, first, last, cabin,
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
    outRows, reviewLines, warnings, distribution, campers, hasNames, hasCabin,
    camperCount, lanternCount, log,
  };
}

// Plain case-insensitive substring match over the camper's name (Ctrl-F style).
export function searchCampers(campers, query) {
  const q = query.trim().toLowerCase();
  if (!q) return campers;
  return campers.filter(c => `${c.first} ${c.last}`.toLowerCase().includes(q));
}

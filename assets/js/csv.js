// Shared CSV helpers for icepop.org tools. Generic and roster-agnostic:
// any tool that ingests an UltraCamp-style export can import these.

// RFC 4180 parser: some cells (e.g. ReservationHistory) contain embedded
// newlines, so newlines only end a row when we're outside a quoted field.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();
  return rows;
}

export function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCSV(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

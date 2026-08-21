const express = require('express');
const { v4: uuidv4 } = require('uuid');
const XLSX = require('xlsx');
const db = require('../db');

const router = express.Router();

// ─── Spreadsheet import caps ──────────────────────────────────────────────────
const IMPORT_MAX_COLS = 50;
const IMPORT_MAX_ROWS = 5000;
const IMPORT_MAX_BYTES = 10 * 1024 * 1024; // decoded

// Turn a header cell into a stable, unique field id: lowercase, snake_case,
// no leading digit, deduped with numeric suffixes ("qty", "qty_2", ...).
function sanitizeFieldId(header, index, used) {
  let id = String(header ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) id = `column_${index + 1}`;
  if (/^[0-9]/.test(id)) id = `f_${id}`;
  let candidate = id;
  let n = 2;
  while (used.has(candidate)) candidate = `${id}_${n++}`;
  used.add(candidate);
  return candidate;
}

function isNumericCell(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && Number.isFinite(Number(t));
  }
  return false;
}

function isBlankCell(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

router.get('/', (req, res) => {
  const tables = db.prepare('SELECT * FROM tables WHERE company_id = ? ORDER BY name').all(req.companyId);
  res.json(tables.map(t => ({
    ...t,
    fields: JSON.parse(t.fields),
    record_count: db.prepare('SELECT COUNT(*) as c FROM table_records WHERE table_id = ?').get(t.id).c
  })));
});

router.post('/', (req, res) => {
  const { name, description = '', fields = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO tables (id, name, description, fields, company_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, description, JSON.stringify(fields), req.companyId);
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
  res.status(201).json({ ...table, fields: JSON.parse(table.fields), record_count: 0 });
});

// POST /api/tables/import — create a table (+ records) from an uploaded
// .xlsx/.csv sent as base64. First sheet only; first row = headers → fields;
// column types inferred (number when every non-empty cell is numeric).
// Writes use the exact same shapes as POST '/' and POST '/:id/records' so an
// imported table is indistinguishable from a hand-made one. The supervisor+
// write gate comes from the router mount (writeRole in index.js), same as
// every other write here.
router.post('/import', (req, res) => {
  const { name, data, filename = '' } = req.body || {};
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'data (base64 file content) required' });

  // Reject before decoding when the base64 alone proves the file is oversized.
  if (data.length > Math.ceil(IMPORT_MAX_BYTES * 4 / 3) + 4) {
    return res.status(400).json({ error: `File too large — max ${IMPORT_MAX_BYTES / (1024 * 1024)} MB` });
  }
  let buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch {
    return res.status(400).json({ error: 'data is not valid base64' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'File is empty' });
  if (buffer.length > IMPORT_MAX_BYTES) {
    return res.status(400).json({ error: `File too large — max ${IMPORT_MAX_BYTES / (1024 * 1024)} MB` });
  }

  let rows;
  try {
    const isCsv = /\.csv$/i.test(String(filename));
    const workbook = XLSX.read(buffer, { type: 'buffer', ...(isCsv ? { raw: true } : {}) });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return res.status(400).json({ error: 'File contains no sheets' });
    rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, blankrows: false });
  } catch {
    return res.status(400).json({ error: 'Could not parse file — expected .xlsx or .csv' });
  }

  if (!rows.length) return res.status(400).json({ error: 'File has no rows' });
  const headerRow = rows[0];
  const dataRows = rows.slice(1);
  if (!Array.isArray(headerRow) || headerRow.every(isBlankCell)) {
    return res.status(400).json({ error: 'First row must contain column headers' });
  }

  // Column indexes worth keeping: a header, or at least one data cell. This
  // drops phantom columns from trailing commas / over-wide sheet ranges.
  const columns = headerRow
    .map((header, i) => ({ header, i }))
    .filter(({ header, i }) => !isBlankCell(header) || dataRows.some(r => Array.isArray(r) && !isBlankCell(r[i])));

  if (columns.length === 0) {
    return res.status(400).json({ error: 'First row must contain column headers' });
  }
  if (columns.length > IMPORT_MAX_COLS) {
    return res.status(400).json({ error: `Too many columns — max ${IMPORT_MAX_COLS}` });
  }
  if (dataRows.length > IMPORT_MAX_ROWS) {
    return res.status(400).json({ error: `Too many rows — max ${IMPORT_MAX_ROWS}` });
  }

  // Headers → fields with inferred types. A column is 'number' only when it
  // has at least one non-empty cell and every non-empty cell parses as one.
  const usedIds = new Set();
  const fields = columns.map(({ header, i }, pos) => {
    const cells = dataRows.map(r => (Array.isArray(r) ? r[i] : null)).filter(v => !isBlankCell(v));
    const type = cells.length > 0 && cells.every(isNumericCell) ? 'number' : 'text';
    return {
      id: sanitizeFieldId(header, pos, usedIds),
      name: isBlankCell(header) ? `Column ${pos + 1}` : String(header).trim(),
      type,
      col: i, // stripped before persisting
    };
  });

  const tableName = (typeof name === 'string' && name.trim())
    || String(filename).replace(/\.[^.]+$/, '').trim()
    || 'Imported table';

  const tableId = uuidv4();
  const persistedFields = fields.map(({ id, name: fieldName, type }) => ({ id, name: fieldName, type }));
  const insertAll = db.transaction(() => {
    // Same shapes as POST '/' and POST '/:id/records' above.
    db.prepare('INSERT INTO tables (id, name, description, fields, company_id) VALUES (?, ?, ?, ?, ?)')
      .run(tableId, tableName, `Imported from ${filename || 'spreadsheet'}`, JSON.stringify(persistedFields), req.companyId);
    const insertRecord = db.prepare('INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)');
    for (const row of dataRows) {
      const recordData = {};
      for (const field of fields) {
        const cell = Array.isArray(row) ? row[field.col] : null;
        if (isBlankCell(cell)) continue;
        recordData[field.id] = field.type === 'number'
          ? Number(typeof cell === 'string' ? cell.trim() : cell)
          : String(cell);
      }
      insertRecord.run(uuidv4(), tableId, JSON.stringify(recordData));
    }
  });
  insertAll();

  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
  res.status(201).json({ ...table, fields: JSON.parse(table.fields), record_count: dataRows.length });
});


router.get('/:id', (req, res) => {
  const table = db.prepare('SELECT * FROM tables WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!table) return res.status(404).json({ error: 'Not found' });
  res.json({ ...table, fields: JSON.parse(table.fields) });
});

router.put('/:id', (req, res) => {
  const { name, description, fields } = req.body;
  const table = db.prepare('SELECT * FROM tables WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!table) return res.status(404).json({ error: 'Not found' });
  const updates = {
    name: name ?? table.name,
    description: description ?? table.description,
    fields: fields !== undefined ? JSON.stringify(fields) : table.fields,
  };
  db.prepare(`UPDATE tables SET name=?, description=?, fields=?, updated_at=datetime('now') WHERE id=?`)
    .run(updates.name, updates.description, updates.fields, req.params.id);
  const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
  res.json({ ...updated, fields: JSON.parse(updated.fields) });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM tables WHERE id = ? AND company_id = ?').run(req.params.id, req.companyId);
  res.json({ success: true });
});

// Records scope through their parent table's company_id
function ownedTable(req) {
  return db.prepare('SELECT * FROM tables WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
}

router.get('/:id/records', (req, res) => {
  if (!ownedTable(req)) return res.status(404).json({ error: 'Not found' });
  const records = db.prepare('SELECT * FROM table_records WHERE table_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(records.map(r => ({ ...r, data: JSON.parse(r.data) })));
});

router.post('/:id/records', (req, res) => {
  const { data = {} } = req.body;
  if (!ownedTable(req)) return res.status(404).json({ error: 'Table not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO table_records (id, table_id, data) VALUES (?, ?, ?)').run(id, req.params.id, JSON.stringify(data));
  const record = db.prepare('SELECT * FROM table_records WHERE id = ?').get(id);
  res.status(201).json({ ...record, data: JSON.parse(record.data) });
});

router.put('/:id/records/:recordId', (req, res) => {
  const { data } = req.body;
  if (!ownedTable(req)) return res.status(404).json({ error: 'Not found' });
  const record = db.prepare('SELECT * FROM table_records WHERE id = ? AND table_id = ?').get(req.params.recordId, req.params.id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE table_records SET data=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(data), req.params.recordId);
  const updated = db.prepare('SELECT * FROM table_records WHERE id = ?').get(req.params.recordId);
  res.json({ ...updated, data: JSON.parse(updated.data) });
});

router.delete('/:id/records/:recordId', (req, res) => {
  if (!ownedTable(req)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM table_records WHERE id = ? AND table_id = ?').run(req.params.recordId, req.params.id);
  res.json({ success: true });
});

module.exports = router;

// ─── Partial-update helper ────────────────────────────────────────────────────
// Routes used to write every editable column as `col = COALESCE(?, col)`, which
// collapses two different intentions into one value: a field the client left
// out (leave it alone) and a field the client deliberately emptied (clear it)
// both arrive as NULL, so the clear was silently discarded. Blanking a
// champion, a target date or a department looked like a save that worked and
// then came back on the next load.
//
// buildUpdate decides per COLUMN whether the client mentioned it at all, using
// the parsed body's own keys, and only writes the ones it did. An absent key is
// untouched; a key present as null or '' clears the column to NULL.

/**
 * @param {object} body      The parsed request body.
 * @param {string[]} columns Columns the caller is allowed to update.
 * @returns {{ sql: string, params: any[], touched: string[] }}
 *          `sql` is a comma-separated assignment list ready to splice into
 *          `UPDATE … SET <sql>`, empty when the client named no column.
 */
function buildUpdate(body, columns) {
  const src = body && typeof body === 'object' ? body : {};
  const assignments = [];
  const params = [];
  const touched = [];

  for (const col of columns) {
    if (!Object.prototype.hasOwnProperty.call(src, col)) continue;
    const raw = src[col];
    // The client cannot send `undefined` over JSON, but a hand-built body can.
    if (raw === undefined) continue;
    assignments.push(`${col} = ?`);
    // '' is how a text input reports "emptied"; store it as NULL so the column
    // reads the same whether it was never set or was cleared.
    params.push(raw === '' ? null : raw);
    touched.push(col);
  }

  return { sql: assignments.join(', '), params, touched };
}

/**
 * Pick the value a column will end up with after buildUpdate runs — for the
 * derived timestamps (completed_at, closed_at) that key off the NEW status.
 */
function nextValue(body, column, current) {
  const src = body && typeof body === 'object' ? body : {};
  if (!Object.prototype.hasOwnProperty.call(src, column)) return current;
  const raw = src[column];
  if (raw === undefined) return current;
  return raw === '' ? null : raw;
}

module.exports = { buildUpdate, nextValue };

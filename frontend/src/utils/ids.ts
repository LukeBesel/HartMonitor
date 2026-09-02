// ─── Human ids ────────────────────────────────────────────────────────────────
// Every globally-unique id a demo/sandbox company mints carries a six-hex-digit
// company tag so two sandboxes can hold "WO-1001" at the same time without
// colliding on a UNIQUE column: `6BDD57-WO-1001`, `6BDD57-NCR-101`,
// `6BDD57-M6KIT-BAG`.
//
// The tag is a database concern. On the floor the traveller says WO-1001, the
// barcode says WO-1001 and the operator says WO-1001, so that is what a cell
// shows — with the stored id kept in the `title` attribute, because the id in
// the database is what a support ticket has to quote.
//
// Nothing else strips it: strip the tag in the one place, then use it wherever
// an id is printed, or the same work order reads two ways on two screens.

/** The company tag a sandbox prefixes its human ids with: six uppercase hex
 *  digits (`crypto.randomBytes(3).toString('hex').toUpperCase()`) and a dash.
 *  Anchored and exact-length on purpose — a real part number like
 *  `AB12-BRACKET` (four chars) or `ASSY-100` (non-hex) is left alone. */
const COMPANY_TAG = /^[0-9A-F]{6}-(?=.)/;

/**
 * What a person reads: the id without the company tag it was minted with.
 * Anything that is not tag-prefixed comes back untouched, and a missing id
 * comes back as an empty string so a caller can fall back to '—' itself.
 */
export function displayId(fullId: string | null | undefined): string {
  if (!fullId) return '';
  return String(fullId).replace(COMPANY_TAG, '');
}

/**
 * True when `fullId` actually carried a tag — i.e. when the `title` attribute
 * telling the reader the stored id would say something they cannot already see.
 */
export function hasCompanyTag(fullId: string | null | undefined): boolean {
  return !!fullId && COMPANY_TAG.test(String(fullId));
}

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
// This is for a cell that holds ONE id and nothing else. A part number, a SKU,
// or a composite label ("NCR-101 · Solder bridging on control board") is
// printed verbatim: those are the customer's own strings, and a rule that
// trims a leading group from them eats real data.
//
// Nothing else strips it: strip the tag in the one place, then use it wherever
// an id is printed, or the same work order reads two ways on two screens.

/** The company tag a sandbox prefixes its human ids with: six uppercase hex
 *  digits (`crypto.randomBytes(3).toString('hex').toUpperCase()`) and a dash,
 *  followed by one of the id families the product mints.
 *
 *  The prefix families are the point. Six hex digits and a dash is a shape a
 *  real PART NUMBER can have — `100234-01` is a part, and stripping its first
 *  group left the cell reading "01" — so the tag is only recognised when what
 *  follows is an id this product issues. Anything else is somebody's own
 *  numbering and is printed exactly as it was typed. */
const COMPANY_TAG = /^[0-9A-F]{6}-(?=(?:WO|NCR|MWO|PO|CAPA|SN)-)/;

/**
 * What a person reads: the id without the company tag it was minted with.
 * Anything that is not a tagged id of a known family — a part number, a SKU, a
 * composite label — comes back untouched, and a missing id comes back as an
 * empty string so a caller can fall back to '—' itself.
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

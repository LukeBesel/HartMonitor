'use strict';
// ─── What a role is CALLED ────────────────────────────────────────────────────
// The stored role vocabulary ('developer', 'manager', …) is a permission level
// and a CHECK constraint; it is not a job title, and one of its values is a
// word no plant has ever used for a person. The account creator is stored as
// 'developer' — the highest level — and calling that person a "developer" in
// the users grid told a plant manager they were something they are not.
//
// So the stored value never moves (no migration, no CHECK change, no role
// checks to re-audit) and the API hands out a `display_role` beside it: the
// ONE name a screen is allowed to print for a role. Add a role here the day
// you add it to VALID_ROLES, not the day a screen needs a label for it.

const DISPLAY_ROLES = {
  developer:  'Owner',
  manager:    'Manager',
  supervisor: 'Supervisor',
  operator:   'Operator',
  viewer:     'Viewer',
};

/** The name to print for a stored role. Unknown roles fall back to their own
 *  capitalised value rather than to nothing — a new role shows up as itself. */
function displayRole(role) {
  if (!role) return '';
  return DISPLAY_ROLES[role] || (String(role).charAt(0).toUpperCase() + String(role).slice(1));
}

/** `{ ...user, display_role }` — for any row that carries a `role`. */
function withDisplayRole(row) {
  if (!row) return row;
  return { ...row, display_role: displayRole(row.role) };
}

module.exports = { DISPLAY_ROLES, displayRole, withDisplayRole };

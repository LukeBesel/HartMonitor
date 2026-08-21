// ─── Andon team vocabulary (one source of truth) ─────────────────────────────
// `team` is the routing dimension for a call for help. `type` stays the legacy
// andon_calls CHECK vocabulary ('help','quality','material','maintenance',
// 'safety') so rows written before teams existed, older clients and the board's
// existing type filters all keep working unchanged.

const TEAMS = {
  quality:     { label: 'Quality',     type: 'quality' },
  supervisor:  { label: 'Supervisor',  type: 'help' },
  maintenance: { label: 'Maintenance', type: 'maintenance' },
  materials:   { label: 'Materials',   type: 'material' },
};

// Fallback so EVERY row (including pre-team rows) reports a team the UI can
// render — a page config map must never be handed an unknown key.
const TEAM_BY_TYPE = {
  quality: 'quality',
  maintenance: 'maintenance',
  material: 'materials',
  help: 'supervisor',
  safety: 'supervisor',
};

function teamOf(row) {
  return TEAMS[row?.team] ? row.team : (TEAM_BY_TYPE[row?.type] || 'supervisor');
}

function teamLabel(team) {
  return TEAMS[team]?.label || 'Team';
}

module.exports = { TEAMS, TEAM_BY_TYPE, teamOf, teamLabel };

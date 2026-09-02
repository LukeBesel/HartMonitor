// ─── Andon team vocabulary (frontend mirror of backend/src/andonTeams.js) ────
// Every surface that renders a team — the Call-for-help tiles in the player and
// the app shell, the Andon Board chips, the Command Center attention rows —
// reads it from here, so labels and colors can never drift between screens.

import { ShieldCheck, UserCog, Wrench, Package, HelpCircle, type LucideIcon } from 'lucide-react';
import type { AndonTeam } from '../types';

/** Who a call is aimed at: one of the four function teams, or one of the
 *  company's own departments. */
export type AlertTarget =
  | { kind: 'team'; team: AndonTeam }
  | { kind: 'department'; id: string; name: string };

export interface AndonTeamConfig {
  /** Short name used in chips, subjects and banners ("Quality has been called"). */
  label: string;
  /** Longer name for the big player tiles, where there is room to be explicit. */
  tileLabel: string;
  /** What this team is for, shown under the tile so operators pick correctly. */
  hint: string;
  icon: LucideIcon;
  /** Workbench (light) classes. */
  chip: string;
  dot: string;
  /** Player (dark) tokens — plain colors so they work inside [data-player]. */
  playerColor: string;
  playerTint: string;
}

export const ANDON_TEAMS: Record<AndonTeam, AndonTeamConfig> = {
  quality: {
    label: 'Quality',
    tileLabel: 'Quality',
    hint: 'Inspection, spec question, suspect part',
    icon: ShieldCheck,
    chip: 'bg-purple-50 text-purple-700 border-purple-200',
    dot: 'bg-purple-500',
    playerColor: '#c4b5fd',
    playerTint: 'rgba(167, 139, 250, 0.16)',
  },
  supervisor: {
    label: 'Supervisor',
    tileLabel: 'Supervisor',
    hint: 'Manager — approvals, priorities, anything else',
    icon: UserCog,
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
    playerColor: '#93c5fd',
    playerTint: 'rgba(96, 165, 250, 0.16)',
  },
  maintenance: {
    label: 'Maintenance',
    tileLabel: 'Maintenance',
    hint: 'Station fault, tooling, breakdown',
    icon: Wrench,
    chip: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    playerColor: '#fdba74',
    playerTint: 'rgba(251, 146, 60, 0.16)',
  },
  materials: {
    label: 'Materials',
    tileLabel: 'Materials',
    hint: 'Missing parts, short kit, refill',
    icon: Package,
    chip: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
    playerColor: '#fcd34d',
    playerTint: 'rgba(251, 191, 36, 0.16)',
  },
};

export const ANDON_TEAM_ORDER: AndonTeam[] = ['quality', 'supervisor', 'maintenance', 'materials'];

/** Fallback so an unknown/legacy team value still renders (never blank). */
export const ANDON_TEAM_FALLBACK: AndonTeamConfig = {
  label: 'Team',
  tileLabel: 'Team',
  hint: 'Call for help',
  icon: HelpCircle,
  chip: 'bg-gray-100 text-gray-700 border-gray-200',
  dot: 'bg-gray-400',
  playerColor: '#c0c9d5',
  playerTint: 'rgba(192, 201, 213, 0.16)',
};

export function teamConfig(team: string | undefined | null): AndonTeamConfig {
  return ANDON_TEAMS[team as AndonTeam] ?? ANDON_TEAM_FALLBACK;
}

/** The request body for one target — the single place team/department maps onto
 *  the API contract, so the player and the shell can never diverge. */
export function targetPayload(target: AlertTarget): { team?: AndonTeam; target_type?: 'department'; department_id?: string } {
  return target.kind === 'team'
    ? { team: target.team }
    : { target_type: 'department', department_id: target.id };
}

export function targetLabel(target: AlertTarget): string {
  return target.kind === 'team' ? ANDON_TEAMS[target.team].label : target.name;
}

/** Compact age/duration for chips: 45s · 12m · 2h 05m. */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

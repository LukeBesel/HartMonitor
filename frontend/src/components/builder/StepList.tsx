// ─── Step list — left panel of the four-region builder (spec §4.1) ────────────
// Collapsible groups (cosmetic organization; navigation order stays the flat
// step sequence), dnd-kit drag between/within groups (one level, no nesting),
// ⋯ menu (duplicate / delete / group / make kit step), gold "current
// selection" motif on the active step.

import { useState } from 'react';
import {
  ChevronDown, ChevronRight, Clock3, Copy, FolderPlus, GripVertical,
  MoreHorizontal, PackageCheck, Plus, Trash2, Ungroup, ArrowRightToLine,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { App, Step, StepGroup, Trigger, Widget } from '../../types';
import { v4 as uuidv4 } from '../../utils/uuid';
import { stepTaktSeconds } from '../player/runtime';

/** Authored (non-synthesized) trigger count for a step, widgets included. */
export function stepTriggerCount(step: Step): number {
  const authored = (ts?: Trigger[]) => (ts ?? []).filter(t => !t.id.startsWith('legacy_')).length;
  return authored(step.triggers) + step.widgets.reduce((n, w) => n + authored(w.triggers), 0);
}

function cloneWidget(w: Widget): Widget {
  const id = uuidv4();
  return {
    ...w,
    id,
    config: { ...w.config },
    layout: w.layout ? { ...w.layout } : undefined,
    triggers: (w.triggers ?? []).map(t => ({ ...t, id: uuidv4(), conditions: t.conditions.map(c => ({ ...c })), actions: t.actions.map(a => ({ ...a })) })),
  };
}

function fmtTakt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec ? `${m}m${sec}s` : `${m}m`;
}

export default function StepList({ app, activeStepIdx, onSelectStep, onChangeApp, canEdit }: {
  app: App;
  activeStepIdx: number;
  onSelectStep: (idx: number) => void;
  onChangeApp: (updater: (prev: App) => App) => void;
  canEdit: boolean;
}) {
  const groups = app.step_groups ?? [];
  const groupById = new Map(groups.map(g => [g.id, g]));
  const [menuStepId, setMenuStepId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const remapOrder = (steps: Step[]): Step[] => steps.map((s, i) => ({ ...s, order: i }));

  // ── Step ops ────────────────────────────────────────────────────────────────

  const addStep = () => {
    onChangeApp(prev => {
      const lastGroup = prev.steps[prev.steps.length - 1]?.group_id;
      const step: Step = {
        id: uuidv4(),
        name: `Step ${prev.steps.length + 1}`,
        order: prev.steps.length,
        widgets: [],
        layoutMode: 'canvas',
        canvasHeight: 560,
        canvasBackground: '#ffffff',
        group_id: lastGroup,
        triggers: [],
      };
      return { ...prev, steps: [...prev.steps, step] };
    });
    onSelectStep(app.steps.length);
  };

  const addGroup = () => {
    onChangeApp(prev => {
      const gs = prev.step_groups ?? [];
      return {
        ...prev,
        step_groups: [...gs, { id: uuidv4(), name: `Group ${gs.length + 1}`, order: gs.length }],
      };
    });
  };

  const duplicateStep = (idx: number) => {
    onChangeApp(prev => {
      const src = prev.steps[idx];
      if (!src) return prev;
      const copy: Step = {
        ...src,
        id: uuidv4(),
        name: `${src.name} (copy)`,
        widgets: src.widgets.map(cloneWidget),
        triggers: (src.triggers ?? []).map(t => ({ ...t, id: uuidv4(), conditions: t.conditions.map(c => ({ ...c })), actions: t.actions.map(a => ({ ...a })) })),
        parts_list: src.parts_list?.map(p => ({ ...p })),
      };
      const steps = [...prev.steps];
      steps.splice(idx + 1, 0, copy);
      return { ...prev, steps: remapOrder(steps) };
    });
    onSelectStep(idx + 1);
  };

  const removeStep = (idx: number) => {
    if (app.steps.length <= 1) return;
    onChangeApp(prev => ({ ...prev, steps: remapOrder(prev.steps.filter((_, i) => i !== idx)) }));
    // Keep the selection on the same step (or its nearest surviving neighbor).
    const next = idx < activeStepIdx ? activeStepIdx - 1 : Math.min(activeStepIdx, app.steps.length - 2);
    onSelectStep(Math.max(0, next));
  };

  const toggleKit = (idx: number) => {
    onChangeApp(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === idx
        ? { ...s, step_type: s.step_type === 'kit' ? 'standard' : 'kit' }
        : s),
    }));
  };

  /** Move a step into a group (or out of any group), keeping the group's run
   *  contiguous in the flat sequence. */
  const moveToGroup = (idx: number, groupId: string | undefined) => {
    const activeId = app.steps[activeStepIdx]?.id;
    let nextSteps: Step[] | null = null;
    onChangeApp(prev => {
      const steps = [...prev.steps];
      const [step] = steps.splice(idx, 1);
      const moved: Step = { ...step, group_id: groupId };
      let insertAt = steps.length;
      if (groupId) {
        // After the last current member of the target group; else at the end.
        const lastMember = steps.map(s => s.group_id).lastIndexOf(groupId);
        insertAt = lastMember >= 0 ? lastMember + 1 : steps.length;
      }
      steps.splice(insertAt, 0, moved);
      nextSteps = remapOrder(steps);
      return { ...prev, steps: nextSteps };
    });
    // Keep the selection pinned to the same step after the reshuffle.
    if (activeId && nextSteps) {
      const newIdx = (nextSteps as Step[]).findIndex(s => s.id === activeId);
      if (newIdx >= 0 && newIdx !== activeStepIdx) onSelectStep(newIdx);
    }
  };

  // ── Group ops ───────────────────────────────────────────────────────────────

  const updateGroup = (id: string, patch: Partial<StepGroup>) => {
    onChangeApp(prev => ({
      ...prev,
      step_groups: (prev.step_groups ?? []).map(g => g.id === id ? { ...g, ...patch } : g),
    }));
  };

  const deleteGroup = (id: string) => {
    onChangeApp(prev => ({
      ...prev,
      step_groups: (prev.step_groups ?? []).filter(g => g.id !== id),
      steps: prev.steps.map(s => s.group_id === id ? { ...s, group_id: undefined } : s),
    }));
  };

  // ── Drag reorder — flat sequence; a dropped step adopts its neighbor's group ─

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChangeApp(prev => {
      const oldIdx = prev.steps.findIndex(s => s.id === active.id);
      const newIdx = prev.steps.findIndex(s => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const targetGroup = prev.steps[newIdx].group_id;
      const moved = arrayMove(prev.steps, oldIdx, newIdx)
        .map(s => s.id === active.id ? { ...s, group_id: targetGroup } : s);
      return { ...prev, steps: remapOrder(moved) };
    });
    // Keep the selection pinned to the same step id after the move.
    const activeId = app.steps[activeStepIdx]?.id;
    const oldIdx = app.steps.findIndex(s => s.id === active.id);
    const newIdx = app.steps.findIndex(s => s.id === over.id);
    if (activeId && oldIdx !== -1 && newIdx !== -1) {
      const ids = arrayMove(app.steps.map(s => s.id), oldIdx, newIdx);
      const to = ids.indexOf(activeId);
      if (to >= 0 && to !== activeStepIdx) onSelectStep(to);
    }
  };

  // ── Display model: contiguous group runs get one header; empty groups tail ──

  type Row =
    | { kind: 'header'; group: StepGroup }
    | { kind: 'step'; step: Step; idx: number; hidden: boolean };

  const rows: Row[] = [];
  const seenGroups = new Set<string>();
  let currentRun: string | undefined;
  app.steps.forEach((step, idx) => {
    const gid = step.group_id && groupById.has(step.group_id) ? step.group_id : undefined;
    if (gid !== currentRun) {
      currentRun = gid;
      if (gid) {
        rows.push({ kind: 'header', group: groupById.get(gid)! });
        seenGroups.add(gid);
      }
    }
    const collapsed = gid ? !!groupById.get(gid)?.collapsed : false;
    rows.push({ kind: 'step', step, idx, hidden: collapsed });
  });
  const emptyGroups = groups.filter(g => !seenGroups.has(g.id)).sort((a, b) => a.order - b.order);

  return (
    // Below lg the list becomes a capped-height strip above the canvas.
    <div className="flex flex-col w-full max-h-40 border-b lg:h-full lg:w-[240px] lg:max-h-none lg:border-b-0 lg:border-r flex-shrink-0 bg-surface-1 border-border-subtle">
      <div className="px-3.5 pt-3 pb-2 flex-shrink-0">
        <span className="wb-label">Steps</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-2" onClick={() => setMenuStepId(null)}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={app.steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {rows.map(row => row.kind === 'header' ? (
              <GroupHeader
                key={`g_${row.group.id}`}
                group={row.group}
                canEdit={canEdit}
                onToggle={() => updateGroup(row.group.id, { collapsed: !row.group.collapsed })}
                onRename={name => updateGroup(row.group.id, { name })}
                onDelete={() => deleteGroup(row.group.id)}
              />
            ) : row.hidden ? (
              // Collapsed member — keep it registered with dnd-kit but invisible.
              <div key={row.step.id} className="hidden" />
            ) : (
              <StepRow
                key={row.step.id}
                step={row.step}
                idx={row.idx}
                grouped={!!(row.step.group_id && groupById.has(row.step.group_id))}
                active={row.idx === activeStepIdx}
                canEdit={canEdit}
                canDelete={app.steps.length > 1}
                groups={groups}
                menuOpen={menuStepId === row.step.id}
                onOpenMenu={open => setMenuStepId(open ? row.step.id : null)}
                onSelect={() => onSelectStep(row.idx)}
                onDuplicate={() => duplicateStep(row.idx)}
                onDelete={() => removeStep(row.idx)}
                onToggleKit={() => toggleKit(row.idx)}
                onMoveToGroup={gid => moveToGroup(row.idx, gid)}
              />
            ))}
          </SortableContext>
        </DndContext>

        {emptyGroups.map(g => (
          <GroupHeader
            key={`g_${g.id}`}
            group={g}
            empty
            canEdit={canEdit}
            onToggle={() => updateGroup(g.id, { collapsed: !g.collapsed })}
            onRename={name => updateGroup(g.id, { name })}
            onDelete={() => deleteGroup(g.id)}
          />
        ))}
      </div>

      {canEdit && (
        <div className="px-2.5 py-2.5 border-t border-grid flex-shrink-0 space-y-1.5">
          {/* Prominent, always-visible add — the main way to grow the app. */}
          <button
            onClick={addStep}
            className="wb-btn-primary w-full justify-center !min-h-[38px] !text-[13px]"
          >
            <Plus size={14} /> New step
          </button>
          <button onClick={addGroup} className="wb-btn w-full justify-center !min-h-[30px] !text-[12px]">
            <FolderPlus size={13} /> Group
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Group header row ─────────────────────────────────────────────────────────

function GroupHeader({ group, empty, canEdit, onToggle, onRename, onDelete }: {
  group: StepGroup;
  empty?: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const Chevron = group.collapsed ? ChevronRight : ChevronDown;
  return (
    <div
      className="group/hdr flex items-center gap-1 pl-2 pr-1.5 mt-1.5"
      style={{ borderBottom: '1px solid var(--baseline)', paddingBottom: 3 }}
    >
      <button onClick={onToggle} className="p-0.5 text-muted hover:text-ink rounded" aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}>
        <Chevron size={13} />
      </button>
      <input
        className="flex-1 min-w-0 bg-transparent outline-none wb-label !normal-case tracking-normal hover:bg-surface-2 focus:bg-surface-2 rounded px-1"
        style={{ fontSize: 12, fontWeight: 650, color: 'var(--ink-2)' }}
        value={group.name}
        readOnly={!canEdit}
        onChange={e => onRename(e.target.value)}
      />
      {empty && <span className="text-muted" style={{ fontSize: 10 }}>empty</span>}
      {canEdit && (
        <button
          onClick={onDelete}
          title="Delete group (steps stay, ungrouped)"
          className="opacity-0 group-hover/hdr:opacity-100 p-0.5 text-muted hover:text-bad rounded transition-opacity"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// ─── Sortable step row ────────────────────────────────────────────────────────

function StepRow({ step, idx, grouped, active, canEdit, canDelete, groups, menuOpen, onOpenMenu, onSelect, onDuplicate, onDelete, onToggleKit, onMoveToGroup }: {
  step: Step;
  idx: number;
  grouped: boolean;
  active: boolean;
  canEdit: boolean;
  canDelete: boolean;
  groups: StepGroup[];
  menuOpen: boolean;
  onOpenMenu: (open: boolean) => void;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleKit: () => void;
  onMoveToGroup: (groupId: string | undefined) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: !canEdit });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.45 : 1 };
  const triggers = stepTriggerCount(step);
  const takt = stepTaktSeconds(step);

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <div
        onClick={onSelect}
        onContextMenu={e => { if (canEdit) { e.preventDefault(); onOpenMenu(!menuOpen); } }}
        className={`group/row flex items-center gap-1.5 pr-1 py-1.5 cursor-pointer transition-colors ${grouped ? 'pl-4' : 'pl-2'} ${active ? 'bg-gold-wash' : 'hover:bg-surface-2'}`}
        style={active ? { boxShadow: 'inset 2px 0 0 var(--gold)' } : undefined}
      >
        <button
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          className={`p-0.5 text-baseline hover:text-muted cursor-grab active:cursor-grabbing flex-shrink-0 ${canEdit ? '' : 'invisible'}`}
          aria-label="Drag to reorder"
        >
          <GripVertical size={12} />
        </button>
        <span className="tnum flex-shrink-0 text-muted" style={{ fontSize: 11, fontWeight: 650, width: 16, textAlign: 'right' }}>{idx + 1}</span>
        <div className="flex-1 min-w-0">
          <div className={`truncate ${active ? 'text-ink' : 'text-ink-2'}`} style={{ fontSize: 13, fontWeight: active ? 650 : 550 }}>
            {step.name || `Step ${idx + 1}`}
          </div>
          {/* stepTaktSeconds, not step.takt_time_seconds: the seed and older
              apps store the legacy `takt_time` key, so reading only the new one
              left this list showing no takt while the canvas and the player both
              showed it for the same step. */}
          {(triggers > 0 || step.step_type === 'kit' || takt) ? (
            <div className="flex items-center gap-1 mt-0.5">
              {step.step_type === 'kit' && (
                <span title="Kit verification step" className="inline-flex items-center text-accent"><PackageCheck size={11} /></span>
              )}
              {triggers > 0 && <span className="trigger-pill" style={{ fontSize: 9.5, padding: '0 5px' }}>⚡ {triggers}</span>}
              {!!takt && (
                <span className="tnum inline-flex items-center gap-0.5 text-muted" style={{ fontSize: 10 }}>
                  <Clock3 size={9} /> {fmtTakt(takt)}
                </span>
              )}
            </div>
          ) : null}
        </div>
        {canEdit && (
          <button
            onClick={e => { e.stopPropagation(); onOpenMenu(!menuOpen); }}
            className={`p-1 rounded text-muted hover:text-ink hover:bg-surface-2 flex-shrink-0 transition-opacity ${menuOpen ? '' : 'opacity-0 group-hover/row:opacity-100'}`}
            aria-label="Step menu"
          >
            <MoreHorizontal size={13} />
          </button>
        )}
      </div>

      {menuOpen && (
        <div
          className="absolute right-1 top-full z-30 w-52 bg-surface-1 rounded-ctrl border border-border-subtle shadow-pop py-1"
          onClick={e => e.stopPropagation()}
        >
          <MenuItem icon={Copy} label="Duplicate step" onClick={() => { onDuplicate(); onOpenMenu(false); }} />
          <MenuItem
            icon={PackageCheck}
            label={step.step_type === 'kit' ? 'Make standard step' : 'Make kit step'}
            onClick={() => { onToggleKit(); onOpenMenu(false); }}
          />
          {groups.length > 0 && <div className="my-1 border-t border-grid" />}
          {groups.map(g => g.id !== step.group_id && (
            <MenuItem key={g.id} icon={ArrowRightToLine} label={`Move to ${g.name}`} onClick={() => { onMoveToGroup(g.id); onOpenMenu(false); }} />
          ))}
          {step.group_id && (
            <MenuItem icon={Ungroup} label="Remove from group" onClick={() => { onMoveToGroup(undefined); onOpenMenu(false); }} />
          )}
          <div className="my-1 border-t border-grid" />
          <MenuItem icon={Trash2} label="Delete step" danger disabled={!canDelete} onClick={() => { onDelete(); onOpenMenu(false); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger, disabled }: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${danger ? 'text-bad hover:bg-red-50' : 'text-ink-2 hover:bg-surface-2'}`}
      style={{ fontSize: 12.5, fontWeight: 550 }}
    >
      <Icon size={13} /> {label}
    </button>
  );
}

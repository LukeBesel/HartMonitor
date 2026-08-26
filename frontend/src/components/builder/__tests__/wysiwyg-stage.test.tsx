// ─── WYSIWYG builder stage ───────────────────────────────────────────────────
// The builder canvas must draw the player's real widgets, not a schematic of
// them, and it must do so without the player behaving any differently for a
// real operator. Both halves are asserted here:
//
//   1. BuilderStage renders PlayerWidget markup (.p-card / .p-input / .p-label)
//      inside an inert, pointer-inert wrapper, under builder chrome.
//   2. PlayerWidget's new `readOnly` flag changes NOTHING when it is absent —
//      the scan field still autofocuses, the timer still auto-starts. That is
//      the operator-facing path; only the builder passes readOnly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { App, Step, Widget } from '../../../types';
import BuilderStage, { previewVariables } from '../BuilderStage';
import PlayerWidget from '../../player/PlayerWidgets';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('../../../api/client', () => ({
  api: {
    getTable: vi.fn(() => Promise.resolve({ id: 't1', name: 'T', fields: [] })),
    getRecords: vi.fn(() => Promise.resolve([])),
    uploadImage: vi.fn(),
  },
}));

function widget(type: Widget['type'], label: string, config: Widget['config'] = {}, order = 0): Widget {
  return { id: `w_${type}`, type, label, order, config, triggers: [] };
}

function step(widgets: Widget[]): Step {
  return { id: 's1', name: 'Safety Check', order: 0, layoutMode: 'flow', widgets, triggers: [] };
}

function app(s: Step): App {
  return {
    id: 'a1', name: 'Bracket Assembly', description: '', status: 'published',
    steps: [s], variables: [], created_at: '', updated_at: '',
  };
}

const noop = () => {};

function renderStage(widgets: Widget[]) {
  const s = step(widgets);
  return render(
    <BuilderStage
      app={app(s)}
      step={s}
      selectedWidgetId={null}
      canEdit
      onSelectWidget={noop}
      onRemoveWidget={noop}
      onReorder={noop}
    />
  );
}

describe('BuilderStage renders the player, not a schematic', () => {
  it('draws a checkbox with the player\'s own markup', () => {
    const { container } = renderStage([widget('checkbox', 'PPE On (glasses + gloves)', { required: true })]);
    // The player's checkbox is a 64px-min button carrying the widget label.
    const btn = screen.getByText('PPE On (glasses + gloves)');
    expect(btn).toBeInTheDocument();
    expect(container.querySelector('.wb-stage-item')).toBeTruthy();
    // …and NOT the old schematic caption, which paired a type name with the label.
    expect(screen.queryByText('Checkbox · PPE On (glasses + gloves)')).toBeNull();
  });

  it('uses the player component classes for inputs and cards', () => {
    const { container } = renderStage([
      widget('text-input', 'Serial', { placeholder: 'Scan the serial' }, 0),
      widget('pass-fail', 'Visual Inspection', {}, 1),
      widget('timer', 'Cure', { duration: 300 }, 2),
    ]);
    expect(container.querySelector('.p-input')).toBeTruthy();
    expect(container.querySelector('.p-label')).toBeTruthy();
    // pass-fail and timer are both player cards
    expect(container.querySelectorAll('.p-card').length).toBeGreaterThanOrEqual(2);
    // The timer shows its full duration — it must not be running on the canvas.
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  it('swallows input: every widget sits inside an inert, pointer-inert wrapper', () => {
    const { container } = renderStage([
      widget('text-input', 'Serial', { placeholder: 'Scan the serial' }, 0),
      widget('checkbox', 'PPE', {}, 1),
    ]);
    const wrappers = container.querySelectorAll('.wb-stage-item > div[inert]');
    expect(wrappers.length).toBe(2);
    wrappers.forEach(w => {
      expect((w as HTMLElement).style.pointerEvents).toBe('none');
    });
    // The real field is inside that wrapper, so it can't take the author's keys.
    const field = container.querySelector('.p-input');
    expect(field?.closest('[inert]')).toBeTruthy();
  });

  it('keeps the editing affordances around the widget', () => {
    const { container } = renderStage([widget('button', '', { buttonText: 'Start Assembly' })]);
    const item = container.querySelector('.wb-stage-item');
    expect(item).toBeTruthy();
    // Selection ring is an overlay sibling, not a replacement for the widget.
    expect(item?.querySelector('.wb-stage-ring')).toBeTruthy();
    // Drag grip + delete live in the floating tool chip.
    expect(screen.getByLabelText('Drag to reorder Button')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete Button')).toBeInTheDocument();
    // …and the real button is still drawn.
    expect(screen.getByText('Start Assembly')).toBeInTheDocument();
  });

  it('seeds variables the way a fresh run does — declared defaults only', () => {
    const a: App = {
      ...app(step([])),
      variables: [
        { id: 'v1', name: 'torque_value', type: 'number' },
        { id: 'v2', name: 'line', type: 'text', defaultValue: 'L1' },
      ],
    };
    expect(previewVariables(a)).toEqual({ line: 'L1' });
  });
});

// ─── The player itself is untouched when readOnly is absent ──────────────────

describe('PlayerWidget default (operator) behavior is unchanged', () => {
  const base = {
    step: step([]),
    value: undefined,
    variables: {},
    appInfo: {},
    preview: false,
    onChange: noop,
    onButtonPress: noop,
    onTimerDone: noop,
    onTimerTick: noop,
    onScanCode: noop,
    onRequestCameraScan: noop,
    renderKit: () => null,
  };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never grabs focus — the keyboard waits for a tap, on canvas and floor alike', () => {
    // The owner's rule, verbatim: "Never auto pop up keyboard. always have
    // them click the field to make it pop up." On a tablet an autofocused
    // input throws the keyboard over half the step the moment it loads.
    const scan = widget('scan-input', 'Scan Code', { placeholder: 'Scan or type a code…' });

    const run = render(<PlayerWidget {...base} widget={scan} />);
    expect(document.activeElement).not.toBe(run.container.querySelector('input'));
    run.unmount();

    const canvas = render(<PlayerWidget {...base} widget={scan} readOnly />);
    expect(document.activeElement).not.toBe(canvas.container.querySelector('input'));
  });

  it('auto-starts the timer for an operator, and holds it on the canvas', () => {
    const timer = widget('timer', 'Cure', { duration: 120, autoStart: true });

    const run = render(<PlayerWidget {...base} widget={timer} />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(run.getByText('01:57')).toBeInTheDocument();
    run.unmount();

    const canvas = render(<PlayerWidget {...base} widget={timer} readOnly />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(canvas.getByText('02:00')).toBeInTheDocument();
  });
});

// ─── Shapes widget + professional button upgrades ────────────────────────────
// Covers: shape defaultWidget factory shape, button config back-compat
// (no variant → solid / md / rounded), and a render smoke for each shape kind
// in both render paths (builder WidgetView, player PlayerWidgets).

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Step, Widget } from '../../../types';

// The global test-setup mocks ResizeObserver with an arrow function, which
// some consumers invoke with `new`. Override with a constructable class here
// (same convention as builder.test.tsx).
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

vi.mock('../../../api/client', () => ({
  api: {
    getTables: vi.fn(() => Promise.resolve([])),
    getTable: vi.fn(() => Promise.resolve({ id: 't1', name: 'T', fields: [] })),
    getRecords: vi.fn(() => Promise.resolve([])),
    uploadImage: vi.fn(),
  },
}));

import { defaultWidget, WIDGET_META } from '../WidgetPalette';
import { WidgetView, ShapeSVG, buttonAppearance, BUTTON_ICONS } from '../../app/WidgetView';
import PlayerWidget from '../../player/PlayerWidgets';

const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow'] as const;

function shapeWidget(kind: (typeof SHAPE_KINDS)[number]): Widget {
  return {
    id: `shape-${kind}`, type: 'shape', label: '', order: 0,
    config: { shapeKind: kind, fill: '#e0e7ff', stroke: '#6366f1', strokeWidth: 2, cornerRadius: 8, opacity: 0.9 },
  };
}

function step(widgets: Widget[]): Step {
  return { id: 's1', name: 'Step', order: 0, widgets };
}

function renderPlayerWidget(widget: Widget) {
  return render(
    <PlayerWidget
      widget={widget}
      step={step([widget])}
      value={undefined}
      variables={{}}
      appInfo={{}}
      preview={false}
      onChange={vi.fn()}
      onButtonPress={vi.fn()}
      onTimerDone={vi.fn()}
      onTimerTick={vi.fn()}
      onScanCode={vi.fn()}
      onRequestCameraScan={vi.fn()}
      renderKit={() => null}
    />
  );
}

// ─── Shape widget ─────────────────────────────────────────────────────────────

describe('shape widget', () => {
  it('defaultWidget("shape") produces a soft indigo rect under Display', () => {
    const w = defaultWidget('shape');
    expect(w.type).toBe('shape');
    expect(w.config).toEqual({
      shapeKind: 'rect',
      fill: '#e0e7ff',
      stroke: '#6366f1',
      strokeWidth: 1.5,
      cornerRadius: 12,
      opacity: 1,
    });
    expect(WIDGET_META['shape'].group).toBe('Display');
    expect(WIDGET_META['shape'].label).toBe('Shape');
  });

  it.each(SHAPE_KINDS)('renders %s as pure SVG in the builder path (WidgetView)', kind => {
    const { container } = render(<WidgetView widget={shapeWidget(kind)} />);
    const svg = container.querySelector('svg[data-shape-kind]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('data-shape-kind')).toBe(kind);
    if (kind === 'rect') {
      const rect = svg?.querySelector('rect');
      expect(rect).not.toBeNull();
      expect(rect?.getAttribute('rx')).toBe('8');
      expect(rect?.getAttribute('fill')).toBe('#e0e7ff');
    }
    if (kind === 'ellipse') {
      expect(svg?.querySelector('ellipse')?.getAttribute('fill')).toBe('#e0e7ff');
    }
    if (kind === 'line') {
      const line = svg?.querySelector('line');
      expect(line?.getAttribute('stroke')).toBe('#6366f1');
      expect(line?.getAttribute('marker-end')).toBeNull();
    }
    if (kind === 'arrow') {
      const line = svg?.querySelector('line');
      expect(line?.getAttribute('marker-end')).toMatch(/^url\(#/);
      expect(svg?.querySelector('marker path')).not.toBeNull();
    }
  });

  it.each(SHAPE_KINDS)('renders %s as pure SVG in the player path (PlayerWidgets)', kind => {
    const { container } = renderPlayerWidget(shapeWidget(kind));
    const svg = container.querySelector('svg[data-shape-kind]');
    expect(svg?.getAttribute('data-shape-kind')).toBe(kind);
    // No interactive elements — shapes are decoration only.
    expect(container.querySelector('button, input, select, textarea')).toBeNull();
  });

  it('ShapeSVG defaults to a rect when shapeKind is absent', () => {
    const { container } = render(<ShapeSVG config={{}} />);
    expect(container.querySelector('svg')?.getAttribute('data-shape-kind')).toBe('rect');
    expect(container.querySelector('rect')).not.toBeNull();
  });
});

// ─── Button upgrades ──────────────────────────────────────────────────────────

describe('button upgrades', () => {
  it('back-compat: a config with no variant/size/shape resolves to solid / md / rounded', () => {
    const ap = buttonAppearance({ buttonText: 'Next', buttonType: 'next', buttonColor: '#3b82f6' });
    expect(ap.variant).toBe('solid');
    expect(ap.size).toBe('md');
    expect(ap.shape).toBe('rounded');
    expect(ap.radius).toBe(12);
    expect(ap.icon).toBeUndefined();
  });

  it('resolves configured variant/size/shape/icon; unknown icon names resolve to nothing (safe lookup)', () => {
    const ap = buttonAppearance({ buttonVariant: 'outline', buttonSize: 'xl', buttonShape: 'pill', buttonIcon: 'check' });
    expect(ap.variant).toBe('outline');
    expect(ap.size).toBe('xl');
    expect(ap.radius).toBe(999);
    expect(ap.icon).toBe(BUTTON_ICONS['check']);
    // Never a dynamic import: unknown names simply yield no icon.
    expect(buttonAppearance({ buttonIcon: 'not-a-real-icon' }).icon).toBeUndefined();
    // legacy explicit borderRadius still wins over the shape default
    expect(buttonAppearance({ buttonShape: 'square', borderRadius: 6 }).radius).toBe(6);
  });

  it('legacy button renders full-width solid in the player with its v1 look', () => {
    const widget: Widget = {
      id: 'b1', type: 'button', label: '', order: 0,
      config: { buttonText: 'Done', buttonType: 'complete', buttonColor: '#3b82f6' },
    };
    const { getByRole } = renderPlayerWidget(widget);
    const btn = getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(btn.className).toContain('w-full');
    expect(btn.style.minHeight).toBe('60px');
    expect(btn.style.borderRadius).toBe('12px');
  });

  it('player touch target never drops below 44px and honors size/shape/fullWidth', () => {
    const widget: Widget = {
      id: 'b2', type: 'button', label: '', order: 0,
      config: { buttonText: 'Go', buttonSize: 'sm', buttonShape: 'pill', buttonVariant: 'ghost', fullWidth: false },
    };
    const { getByRole } = renderPlayerWidget(widget);
    const btn = getByRole('button', { name: 'Go' }) as HTMLButtonElement;
    expect(parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    expect(btn.style.borderRadius).toBe('999px');
    expect(btn.className).not.toContain('w-full');
  });

  it('builder render path honors variant, shape and icon', () => {
    const widget: Widget = {
      id: 'b3', type: 'button', label: '', order: 0,
      config: { buttonText: 'Print', buttonVariant: 'outline', buttonShape: 'square', buttonIcon: 'printer', buttonColor: '#3b82f6' },
    };
    const { getByRole } = render(<WidgetView widget={widget} />);
    const btn = getByRole('button', { name: /Print/ }) as HTMLButtonElement;
    expect(btn.style.borderRadius).toBe('2px');
    expect(btn.style.border).toContain('2px solid');
    expect(btn.querySelector('svg')).not.toBeNull(); // curated lucide icon rendered
  });
});

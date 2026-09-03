import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import WipSearch from '../WipSearch';

vi.mock('../../../api/floor', () => ({ getWip: vi.fn(() => new Promise(() => {})) }));

// ─── The box has to say what it answers to ────────────────────────────────────
//
// The server asks three questions of what is typed — work-order number, part
// number, part NAME — and the name is the one printed beside the number on
// every screen. A supervisor looking at "Standard Bracket" who is told the box
// takes a number goes and looks the number up, which is the errand the box was
// added to save. The two screens that mount this component pass no placeholder,
// so the default is what both of them print.

describe('WipSearch', () => {
  it('names all three things the search answers to', () => {
    render(<WipSearch />);

    const box = screen.getByLabelText('Where is a job?') as HTMLInputElement;
    expect(box.placeholder).toBe('Work order number, part number or part name…');
  });

  it('keeps its label and never takes the cursor', () => {
    // Every input keeps its sub-text, and no screen may open the on-screen
    // keyboard on a manager who only arrived at the page.
    render(<WipSearch />);

    const box = screen.getByLabelText('Where is a job?');
    expect(screen.getByText('Where is a job?')).toBeTruthy();
    expect(document.activeElement).not.toBe(box);
    expect(box.hasAttribute('autofocus')).toBe(false);
  });
});

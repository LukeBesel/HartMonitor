import { describe, it, expect } from 'vitest';
import { interpolate, MISSING_PLACEHOLDER } from '../interpolate';

describe('interpolate', () => {
  it('replaces a single {{variable}} token', () => {
    expect(interpolate('Hello {{name}}', { name: 'Alice' })).toBe('Hello Alice');
  });

  it('replaces multiple tokens in one string', () => {
    expect(interpolate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 })).toBe('1 + 2 = 3');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('{{  name  }}', { name: 'x' })).toBe('x');
  });

  it('renders numbers and booleans as strings', () => {
    expect(interpolate('n={{n}} b={{b}}', { n: 42, b: false })).toBe('n=42 b=false');
    expect(interpolate('{{ok}}', { ok: true })).toBe('true');
  });

  it('resolves variables before app_info when both define a name', () => {
    expect(interpolate('{{operator}}', { operator: 'from-var' }, { operator: 'from-info' }))
      .toBe('from-var');
  });

  it('falls back to app_info when no variable matches', () => {
    expect(interpolate('WO {{work_order_number}}', {}, { work_order_number: 'WO-100' }))
      .toBe('WO WO-100');
  });

  it('renders an em dash for unknown refs', () => {
    expect(interpolate('value: {{missing}}', {}, {})).toBe(`value: ${MISSING_PLACEHOLDER}`);
    expect(MISSING_PLACEHOLDER).toBe('—');
  });

  it('renders an em dash per unknown token, resolving the rest', () => {
    expect(interpolate('{{a}}/{{nope}}/{{b}}', { a: 'A', b: 'B' })).toBe(`A/${MISSING_PLACEHOLDER}/B`);
  });

  it('leaves text without tokens untouched', () => {
    expect(interpolate('no tokens here', { a: 1 })).toBe('no tokens here');
  });

  it('leaves malformed or empty braces alone', () => {
    expect(interpolate('{{}} {{ }} {{1bad}} {not one}', { a: 1 })).toBe('{{}} {{ }} {{1bad}} {not one}');
  });

  it('treats a zero / empty-string variable value as resolved, not missing', () => {
    expect(interpolate('q={{qty}}', { qty: 0 })).toBe('q=0');
    expect(interpolate('s=[{{s}}]', { s: '' })).toBe('s=[]');
  });

  it('defaults both scopes to empty objects', () => {
    expect(interpolate('{{x}}')).toBe(MISSING_PLACEHOLDER);
  });
});

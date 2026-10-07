import { describe, expect, it } from 'vitest';
import { normalizeTheme, resolveThemeColor, applyThemeColor } from './theme';
import { vi } from 'vitest';

describe('standard application palette', () => {
  it('ignores legacy saved colors and applies the same shared palette', () => {
    const values = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (key: string, value: string) => values.set(key, value) } };
    vi.stubGlobal('document', { documentElement: root });
    try {
      for (const saved of ['pastel', 'blue', '#00875a', undefined]) {
        expect(applyThemeColor(saved)).toBe('#c94f08');
        expect(root.dataset.palette).toBe('slate-orange');
        expect(values.get('--teal')).toBe('#c94f08');
        expect(values.get('--app-secondary')).toBe('#1d4ed8');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('pastel theme migration', () => {
  it('replaces every retired green preset', () => {
    for (const theme of ['emerald', 'forest', 'matcha', 'teal']) {
      expect(normalizeTheme(theme)).toBe('pastel');
      expect(resolveThemeColor(theme)).toBe('#ad3973');
    }
  });
  it('replaces custom green accents but preserves other colors', () => {
    expect(normalizeTheme('#00875a')).toBe('pastel');
    expect(normalizeTheme('#007f89')).toBe('#007f89');
    expect(resolveThemeColor('rose')).toBe('#be4a5f');
    expect(resolveThemeColor('#4f46b8')).toBe('#ad3973');
  });
  it('uses pink when the theme is missing, iris or invalid', () => {
    expect(resolveThemeColor(undefined)).toBe('#ad3973');
    expect(resolveThemeColor('indigo')).toBe('#ad3973');
    expect(resolveThemeColor('unknown')).toBe('#ad3973');
  });
  it('migrates saved copper presets and custom colors', () => {
    for (const theme of ['coffee', 'amber', '#8a5a34', '#b45309', '#914300']) {
      expect(normalizeTheme(theme)).toBe('pastel');
      expect(resolveThemeColor(theme)).toBe('#ad3973');
    }
    expect(resolveThemeColor('blue')).toBe('#1976d2');
    expect(resolveThemeColor('violet')).toBe('#7c5cbf');
  });
});
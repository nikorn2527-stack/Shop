import { describe, expect, it } from 'vitest';
import { normalizeTheme, resolveThemeColor, applyThemeColor } from './theme';
import { vi } from 'vitest';

describe('standard application palette', () => {
  it('migrates legacy saved colors to the shared orange and LINE green palette', () => {
    const values = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (key: string, value: string) => values.set(key, value) } };
    vi.stubGlobal('document', { documentElement: root });
    try {
      for (const saved of ['navy-slate', 'orange-teal', 'pastel', 'blue', '#00875a', undefined]) {
        expect(applyThemeColor(saved)).toBe('#c2410c');
        expect(root.dataset.palette).toBe('orange-line');
        expect(values.get('--teal')).toBe('#c2410c');
        expect(values.get('--teal-dark')).toBe('#9a3412');
        expect(values.get('--teal-soft')).toBe('#ffedd5');
        expect(values.get('--teal-mist')).toBe('#fff7ed');
        expect(values.get('--canvas-gradient')).toContain('linear-gradient');
        expect(values.get('--workspace-gradient')).toContain('linear-gradient');
        expect(values.get('--sidebar-gradient')).toContain('linear-gradient');
        expect(values.get('--surface-gradient')).toContain('linear-gradient');
        expect(values.get('--accent-gradient')).toContain('#ffedd5');
        expect(values.get('--app-secondary')).toBe('#c2410c');
        expect(values.get('--app-health')).toBe('#15803d');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('orange and LINE green theme migration', () => {
  it('maps every legacy preset and custom colour to the standard palette', () => {
    for (const theme of ['pastel', 'indigo', 'emerald', 'forest', 'matcha', 'teal', 'coffee', 'amber', 'rose', 'violet', '#00875a', '#4f46b8', undefined]) {
      expect(normalizeTheme(theme)).toBe('orange-line');
      expect(resolveThemeColor(theme)).toBe('#c2410c');
    }
  });
});
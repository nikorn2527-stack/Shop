import { describe, expect, it } from 'vitest';
import { normalizeTheme, resolveThemeColor, applyThemeColor } from './theme';
import { vi } from 'vitest';

describe('standard application palette', () => {
  it('migrates legacy saved colors to the shared navy slate palette', () => {
    const values = new Map<string, string>();
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (key: string, value: string) => values.set(key, value) } };
    vi.stubGlobal('document', { documentElement: root });
    try {
      for (const saved of ['pastel', 'blue', '#00875a', undefined]) {
        expect(applyThemeColor(saved)).toBe('#29435F');
        expect(root.dataset.palette).toBe('navy-slate');
        expect(values.get('--teal')).toBe('#29435F');
        expect(values.get('--teal-dark')).toBe('#17283D');
        expect(values.get('--teal-soft')).toBe('#DCE3EA');
        expect(values.get('--teal-mist')).toBe('#F3F5F7');
        expect(values.get('--canvas-gradient')).toContain('linear-gradient');
        expect(values.get('--workspace-gradient')).toContain('linear-gradient');
        expect(values.get('--sidebar-gradient')).toContain('linear-gradient');
        expect(values.get('--surface-gradient')).toContain('linear-gradient');
        expect(values.get('--accent-gradient')).toContain('#17283D');
        expect(values.get('--app-secondary')).toBe('#0f766e');
        expect(values.get('--app-health')).toBe('#15803d');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('navy slate theme migration', () => {
  it('maps every legacy preset and custom colour to the standard palette', () => {
    for (const theme of ['pastel', 'indigo', 'emerald', 'forest', 'matcha', 'teal', 'coffee', 'amber', 'rose', 'violet', '#00875a', '#4f46b8', undefined]) {
      expect(normalizeTheme(theme)).toBe('navy-slate');
      expect(resolveThemeColor(theme)).toBe('#29435F');
    }
  });
});
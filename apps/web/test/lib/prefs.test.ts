import { describe, it, expect } from 'vitest';
import { applyPrefs } from '../../src/lib/prefs.js';

describe('applyPrefs', () => {
  it('sets theme and font attributes', () => {
    applyPrefs({ theme: 'dark', font: 'rubik', panel: true, callMode: true, sidebarExpanded: false });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.font).toBe('rubik');
  });
  it('follows the system when theme is null', () => {
    applyPrefs({ theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false });
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
    expect(document.documentElement.dataset.font).toBe('plex');
  });
});

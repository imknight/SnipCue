import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const options = [
  { value: 'system', label: 'System', icon: '🖥︎' },
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
] as const;

function readTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')!.content = theme === 'system' ? 'light dark' : theme;
  try {
    if (theme === 'system') localStorage.removeItem('snipcue-theme');
    else localStorage.setItem('snipcue-theme', theme);
  } catch { /* The storage setting still applies to open pages. */ }
}

export function ThemePicker() {
  const [theme, setTheme] = useState(() => readTheme(document.documentElement.dataset.theme));
  useEffect(() => {
    let active = true;
    let changed = false;
    function sync(value: unknown) {
      const next = readTheme(value);
      applyTheme(next);
      setTheme(next);
    }
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'local' && changes.theme) {
        changed = true;
        sync(changes.theme.newValue);
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    void (async () => {
      const { theme: saved } = await chrome.storage.local.get('theme');
      if (active && !changed) sync(saved);
    })();
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return (
    <fieldset className="theme-picker">
      <legend>Theme</legend>
      <div className="segments">
        {options.map(({ value, label, icon }) => (
          <label key={value}>
            <input className="visually-hidden" type="radio" name="theme" value={value}
              checked={theme === value} aria-checked={theme === value} onChange={() => void chrome.storage.local.set({ theme: value })} />
            <span><span aria-hidden="true">{icon}</span> {label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { CHANGE_CHANNEL, loadSnapshot } from '../core/library';
import type { LibrarySnapshot } from '../core/types';

export function useLibrary() {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const channel = new BroadcastChannel(CHANGE_CHANNEL);
    const reload = async () => {
      try {
        setSnapshot(await loadSnapshot());
        setError('');
      } catch (e) {
        setError((e as Error).message);
      }
    };
    channel.onmessage = () => void reload();
    void reload();
    return () => channel.close();
  }, []);
  return { snapshot, error };
}

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'err';
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++n.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3000);
  }, []);
  return { toasts, push };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

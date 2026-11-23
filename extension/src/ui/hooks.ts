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
  undo?: () => Promise<boolean>;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok', undo?: Toast['undo']) => {
    const id = ++n.current;
    setToasts((t) => [...t.filter((item, i) => item.undo || i >= t.length - 2), { id, text, kind, undo }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((item) => item.id !== id)), []);
  return { toasts, push, dismiss };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

import { useState } from 'react';
import { addBackup, loadSnapshot, recordsToAdd } from '../core/library';
import { buildBackup, parseBackup } from '../core/portable';
import type { DraftProduct, LibrarySnapshot } from '../core/types';
import type { Notify } from '../ui/PasteAnswers';

export function timeAgo(timestamp: number, clock = Date.now()): string {
  const minutes = Math.max(0, Math.floor((clock - timestamp) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60);
  if (days) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (hours) return `${hours} hr ago`;
  return minutes ? `${minutes} min ago` : 'just now';
}

export function downloadBackup(snapshot: LibrarySnapshot, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(buildBackup(snapshot), null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ImportExport({ snapshot, notify, lastExportAt }: { snapshot: LibrarySnapshot; notify: Notify; lastExportAt: number }) {
  const [incoming, setIncoming] = useState<DraftProduct[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const additions = incoming ? recordsToAdd(snapshot, incoming) : null;
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function download() {
    try {
      downloadBackup(await loadSnapshot(), `snipcue-backup-${new Date().toISOString().slice(0, 10)}.json`);
      await chrome.storage.local.set({ lastExportAt: Date.now() });
    } catch (e) {
      notify((e as Error).message, 'err');
    }
  }

  async function apply() {
    if (!incoming) return;
    setBusy(true);
    setError('');
    try {
      const added = await addBackup(incoming);
      notify(`Added ${count(added.products, 'product')}, ${count(added.questions, 'question')}, and ${count(added.answers, 'answer')}.`);
      setIncoming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h1>Backup &amp; restore</h1>
      <p className="small muted">Last exported: {lastExportAt ? timeAgo(lastExportAt) : 'Never'}</p>
      <div><button type="button" onClick={download}>Export backup</button></div>
      <label>
        Import backup
        <input type="file" accept=".json,application/json" disabled={busy || !!incoming} onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          setError('');
          setBusy(true);
          try {
            setIncoming(parseBackup(await file.text()));
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }} />
      </label>
      {error && <p className="notice err" role="alert">{error}</p>}
      {additions && (
        <>
          <p role="status">
            This will add {count(additions.products.length, 'product')} / {count(additions.questions.length, 'question')} / {count(additions.answers.length, 'answer')}.
          </p>
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy || !(additions.products.length || additions.questions.length || additions.answers.length)}
              onClick={apply}
            >
              Add
            </button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setIncoming(null); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}

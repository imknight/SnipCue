import { vi } from 'vitest';
import { createProduct, loadSnapshot } from '../src/core/library';

it('registers the selection menu, then routes captures, deduplicates, and clears the badge', async () => {
  let productId: string | undefined;
  const onInstalled = vi.fn();
  const onClicked = vi.fn();
  const createMenu = vi.fn();
  const openTab = vi.fn();
  const badge = vi.fn();
  const pending = vi.fn();
  vi.stubGlobal('chrome', {
    action: { onClicked: { addListener: vi.fn() }, setBadgeText: vi.fn(async (value) => { badge(value); }) },
    contextMenus: { onClicked: { addListener: onClicked }, create: createMenu, removeAll: (done: () => void) => done() },
    runtime: { onInstalled: { addListener: onInstalled }, getURL: (path: string) => path },
    storage: {
      local: { get: async () => ({ productId }), remove: async () => undefined },
      session: { set: pending },
    },
    tabs: { create: openTab },
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

  try {
    await import('../src/background/sw');
    onInstalled.mock.calls[0][0]({ reason: 'update' });
    expect(createMenu).toHaveBeenCalledWith({ id: 'snipcue-save-question', title: 'Save as question in SnipCue', contexts: ['selection'] });
    const click = (selectionText: string) => onClicked.mock.calls[0][0]({ menuItemId: 'snipcue-save-question', selectionText }, { id: 4 });

    await click('  Can I\n export notes? ');
    expect(Object.values(pending.mock.calls[0][0])).toEqual(['Can I export notes?']);
    expect(openTab).toHaveBeenCalledWith({ url: expect.stringMatching(/^library\/library\.html#capture=/) });

    const first = await createProduct('First');
    await click('Can I export notes?');
    await click(' CAN I EXPORT  NOTES? ');
    expect(badge.mock.calls.slice(-2).map(([value]) => value.text)).toEqual(['+1', '0']);
    expect((await loadSnapshot()).questions).toMatchObject([{ product_id: first.id, question: 'Can I export notes?' }]);

    const second = await createProduct('Second');
    productId = second.id;
    await click('Can I export notes?');
    expect((await loadSnapshot()).questions.map((q) => q.product_id).sort()).toEqual([first.id, second.id].sort());
    await vi.advanceTimersByTimeAsync(2000);
    expect(badge).toHaveBeenLastCalledWith({ tabId: 4, text: '' });
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

import { getDb } from '../core/db';
import { createQuestion } from '../core/library';
import { uuid } from '../core/util';
import { readQuestion } from '../core/validate';

const menuId = 'snipcue-save-question';
const badgeTimers = new Map<number, ReturnType<typeof setTimeout>>();

chrome.action.onClicked.addListener((tab) => {
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.warn);
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: menuId, title: 'Save as question in SnipCue', contexts: ['selection'] });
  });
  void chrome.storage.local.remove('installation').catch(console.warn);
  if (reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') }).catch(console.warn);
  }
});

function showBadge(tabId: number | undefined, text: string) {
  if (tabId === undefined) return;
  clearTimeout(badgeTimers.get(tabId));
  void chrome.action.setBadgeText({ tabId, text }).catch(console.warn);
  badgeTimers.set(tabId, setTimeout(() => {
    badgeTimers.delete(tabId);
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(console.warn);
  }, 2000));
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== menuId || !info.selectionText?.trim()) return;
  try {
    const question = readQuestion(info.selectionText);
    const [{ productId }, products] = await Promise.all([
      chrome.storage.local.get('productId'),
      (await getDb()).getAll('products'),
    ]);
    const product = products.find((p) => p.id === productId) ?? (products.length === 1 ? products[0] : undefined);
    if (product) {
      showBadge(tab?.id, await createQuestion(product.id, question) ? '+1' : '0');
    } else {
      const id = uuid();
      await chrome.storage.session.set({ [`question:${id}`]: question });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`library/library.html#capture=${id}`) });
    }
  } catch (e) {
    console.warn('[snipcue] could not save the selected question', (e as Error).message);
    showBadge(tab?.id, '!');
  }
});

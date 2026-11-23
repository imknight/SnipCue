import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const dist = process.argv[2] ?? fileURLToPath(new URL('../../dist', import.meta.url));
const out = process.argv[3] ?? mkdtempSync(join(tmpdir(), 'sc-shots-'));
const errors = [];
const sessions = [];
const watchdog = setTimeout(() => { console.error('Chrome smoke test timed out'); process.exit(2); }, 75_000).unref();

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'sc-chrome-'));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
  });
  sessions.push({ browser, profile });
  const id = await browser.installExtension(dist);
  const origin = `chrome-extension://${id}`;
  const background = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(origin), { timeout: 10_000 });
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-sanitized-write']);

  async function open(path, width = 1100, height = 800) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${origin}/${path}`);
    await page.bringToFront();
    return page;
  }
  return { browser, id, origin, open, background };
}

const click = (page, label) => page.locator(`::-p-xpath(//button[normalize-space(.)="${label}"])`).setTimeout(8000).click();
const clickProduct = (page, name) => page.locator(`::-p-xpath(//nav//button[span[@class="nav-product-name" and normalize-space(.)="${name}"]])`).setTimeout(8000).click();
const toggleQuestion = (page, text) => page.locator(`::-p-xpath(//button[contains(@class, "question-toggle") and .//strong[normalize-space(.)="${text}"]])`).setTimeout(8000).click();
const waitText = (page, selector, text) => page.waitForFunction(
  (s, t) => [...document.querySelectorAll(s)].some((el) => el.textContent.includes(t)),
  { timeout: 8000 }, selector, text,
);
const search = 'input[aria-label="Search or save a question"]';
const more = 'button.more-trigger';
const actions = '#product-actions:popover-open';
const productPicker = 'select[aria-label="Product"]';
const questionToggle = '.question-toggle';
const filterInput = 'input[aria-label="Filter questions"]';
const productActions = '[aria-label="More product actions"][popovertarget]';
const question = 'Can I use Field Notes offline?';
const openQuestion = 'Do I need an account?';
const suppliedAnswer = 'No account is required.';
const original = 'Yes. Your notes remain available offline.';
const localized = '可以离线阅读和编辑笔记。';
const data = 'Your notes are stored on this device.';
const extra = 'Changes sync after you reconnect.';
const reply = (answers) => JSON.stringify({ product: 'Field Notes', answers });

async function createProduct(page, name) {
  await click(page, '+ New product');
  await page.locator('[aria-label="New product name"]').fill(name);
  await page.keyboard.press('Enter');
  await waitText(page, '.product-name', name);
}

async function menuAction(page, trigger, name) {
  const button = await page.waitForSelector(trigger, { visible: true, timeout: 8000 });
  const target = await button.evaluate((node) => node.getAttribute('popovertarget'));
  await button.click();
  const menu = await page.waitForSelector(`[id="${target}"]:popover-open`, { visible: true, timeout: 8000 });
  const labels = [];
  for (const item of await menu.$$('button')) {
    const text = await item.evaluate((node) => node.textContent);
    if (text === name) return item.click();
    labels.push(text);
  }
  assert.fail(`Missing menu action: ${name}. Found: ${labels.join(', ')}`);
}

async function checkTheme(page, theme) {
  await page.waitForFunction((theme) => {
    const root = document.documentElement;
    return (root.dataset.theme ?? 'system') === theme && getComputedStyle(root).colorScheme === (theme === 'system' ? 'light dark' : theme);
  }, { timeout: 8000, polling: 50 }, theme);
}

async function openActions(page) {
  await page.locator(more).click();
  await page.waitForSelector(actions, { visible: true, timeout: 8000 });
}

async function pasteReply(page, text) {
  await page.bringToFront();
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.$eval('#ai-reply', (box) => { box.focus(); box.select(); });
  await page.keyboard.press('v', { commands: ['Paste'] });
  assert.equal(await page.$eval('#ai-reply', (box) => box.value), text);
  await click(page, 'Review answers');
}

async function screenshots(page, prefix) {
  await page.waitForSelector('.toast', { hidden: true, timeout: 8000 });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.screenshot({ path: join(out, `${prefix}-${scheme}.png`) });
  }
}

try {
  const { browser, origin, id, open, background } = await launch();
  console.log(await browser.version());
  const lib = await open('library/library.html');
  await waitText(lib, 'main h1', 'Add a product');
  assert.equal(await lib.$('[aria-label="New product name"]'), null);
  const worker = await background.worker();
  assert.equal(await worker.evaluate(() => new Promise((resolve) => {
    chrome.contextMenus.update('snipcue-save-question', { visible: true }, () => {
      resolve(chrome.runtime.lastError?.message ?? null);
    });
  })), null, 'Chrome registered the selection menu');
  const panel = await open('sidepanel/sidepanel.html', 320, 760);
  await panel.waitForSelector(search);
  assert.equal(await panel.$eval(search, (input) => input === document.activeElement), true);
  assert.equal(await panel.$$eval('input', (inputs) => inputs.filter((input) => input.getClientRects().length > 0).length), 1);
  assert.deepEqual(await panel.$eval(productPicker, (select) => [...select.options].map((option) => option.text)), ['Choose a product', '+ New product']);

  await panel.locator(search).fill('  Do I need   an account?  ');
  await waitText(panel, '#save-question', 'Create a product to save');
  await panel.keyboard.press('Enter');
  await panel.locator('form[aria-label="New product"] input').fill('Field Notes');
  await click(panel, 'Add product');
  await waitText(panel, '.toast-region', "Saved — it'll be in your next AI prompt");
  assert.equal(await panel.$eval(search, (input) => input.value), '');
  assert.equal(await panel.$('.open-question'), null);
  assert.equal(await panel.$eval(more, (button) => button.getAttribute('aria-label')), 'More, 1 open question');

  await panel.locator(search).fill(openQuestion.toUpperCase());
  await waitText(panel, '.open-question', openQuestion);
  await waitText(panel, '.open-question', 'No answer yet');
  assert.equal(await panel.$('#save-question'), null);
  assert.equal(await panel.$('.answer-head'), null);
  await screenshots(panel, 'open-questions');
  await panel.keyboard.press('Escape');
  assert.equal(await panel.$eval(search, (input) => input.value), '');
  assert.equal(await panel.$('.open-question'), null);

  await lib.bringToFront();
  await clickProduct(lib, 'Field Notes');
  await waitText(lib, questionToggle, openQuestion);
  await click(lib, 'Add question');
  await lib.locator('form[aria-label="New question"] input[type=text]').fill(question);
  await lib.locator('form[aria-label="New question"] textarea').fill(original);
  await click(lib, 'Save question');
  await waitText(lib, questionToggle, question);
  const firstQuestion = await lib.$eval(questionToggle, (summary) => summary.textContent);
  assert.ok(firstQuestion.includes(openQuestion));
  assert.ok(firstQuestion.includes('0 answers'));
  assert.equal(await lib.$('.question[data-open=true]'), null);
  await waitText(lib, '.question-preview', original);
  assert.equal(await lib.$('.question textarea'), null);
  await lib.click('label:has(input[name="question-status"][value="open"])');
  assert.equal(await lib.$$eval(questionToggle, (rows) => rows.length), 1);
  await click(lib, 'Copy AI prompt for these 1');
  await waitText(lib, '.toast-region', 'Prompt copied');
  assert.match(await lib.evaluate(() => navigator.clipboard.readText()), /Do I need an account\?/);
  await lib.click('label:has(input[name="question-status"][value="answered"])');
  assert.equal(await lib.$$eval(questionToggle, (rows) => rows.length), 1);
  await waitText(lib, questionToggle, question);
  await lib.click('label:has(input[name="question-status"][value="all"])');

  await panel.bringToFront();
  await panel.focus(more);
  await panel.keyboard.press('Enter');
  await panel.waitForSelector(actions, { visible: true, timeout: 8000 });
  await panel.keyboard.press('Tab');
  assert.equal(await panel.evaluate(() => document.activeElement.textContent), 'Copy AI prompt · 1 open');
  await panel.keyboard.press('Escape');
  await panel.waitForSelector(actions, { hidden: true, timeout: 8000 });
  await openActions(panel);
  await panel.click(search, { offset: { x: 20, y: 16 } });
  await panel.waitForSelector(actions, { hidden: true, timeout: 8000 });
  await openActions(panel);
  await click(panel, 'Copy AI prompt · 1 open');
  await waitText(panel, '.toast-region', 'Prompt copied');
  const prompt = await panel.evaluate(() => navigator.clipboard.readText());
  assert.match(prompt, /Answer these questions\n- "Do I need an account\?"[\s\S]*Already answered \(don't repeat\)\n- "Can I use Field Notes offline\?"/);
  const sample = JSON.parse(prompt.slice(prompt.indexOf('{\n')));
  assert.deepEqual(Object.keys(sample), ['product', 'answers']);
  assert.equal(sample.product, 'Field Notes');

  await openActions(panel);
  await click(panel, 'Paste from AI');
  await pasteReply(panel, '{ invalid');
  await waitText(panel, '[role=alert]', 'valid JSON object');
  await click(panel, 'Copy error for AI');
  await waitText(panel, '.toast-region', 'Error copied');
  assert.match(await panel.evaluate(() => navigator.clipboard.readText()), /Return only the corrected JSON/);
  await pasteReply(panel, JSON.stringify({ ...sample, product: 'Ink Pad' }));
  await waitText(panel, '[role=alert]', 'Field Notes');
  const items = [
    { question: `  ${question.toUpperCase()}  `, answers: [{ text: original }, { label: '中文', text: localized }, { text: 'Skip this answer.' }] },
    { question: 'Where are my notes stored?', answers: [{ label: 'Privacy', text: data }] },
    { question: openQuestion.toUpperCase(), answers: [{ text: suppliedAnswer }] },
  ];
  await pasteReply(panel, ['Here are the replies.', '```json', reply(items), '```', 'Ready to save.'].join('\n'));
  await waitText(panel, '#paste-title', 'Review AI answers');
  await waitText(panel, '.paste-answer', 'Already saved');
  assert.equal(await lib.$$eval('.question', (rows) => rows.length), 2);
  const check = await panel.$$('input[type=checkbox]');
  await check[1].click();
  await click(panel, 'Save selected answers');
  await waitText(panel, '.toast-region', 'Saved 3 answers.');
  await lib.bringToFront();
  await waitText(lib, questionToggle, 'Where are my notes stored?');
  assert.equal(await lib.$$eval('.question', (rows) => rows.length), 3);
  console.log('PASS single search/save box, inline product creation, menu keyboard and outside dismissal, prompt and paste');

  await panel.bringToFront();
  await panel.waitForSelector(`${more}[aria-label="More"]`);
  assert.equal(await panel.$('.open-question'), null);
  await waitText(panel, '.answer-head', suppliedAnswer);
  await waitText(panel, '.results', localized);
  assert.equal(await panel.$eval(productPicker, (select) => select.selectedOptions[0].text), 'Field Notes');
  await panel.locator(search).fill('中文');
  await waitText(panel, '[aria-label="Answers"] [role=status]', '1 answer');
  await panel.click('.answer-head');
  await waitText(panel, '.answer-head .copy-feedback', 'Copied ✓');
  assert.equal(await panel.$eval('.answer-toggle', (button) => button.getAttribute('aria-expanded')), 'false');
  assert.equal(await panel.evaluate(() => navigator.clipboard.readText()), localized);
  await panel.evaluate(() => navigator.clipboard.writeText('Before keyboard copy'));
  await panel.focus(search);
  await panel.keyboard.press('ArrowDown');
  assert.equal(await panel.evaluate(() => document.activeElement.getAttribute('aria-label')), `Copy answer: ${question}`);
  await panel.keyboard.press('ArrowUp');
  assert.equal(await panel.evaluate(() => document.activeElement.id), 'save-question');
  await panel.keyboard.press('ArrowDown');
  await panel.keyboard.press('Enter');
  await panel.waitForFunction(async (expected) => await navigator.clipboard.readText() === expected, { timeout: 5000 }, localized);
  await panel.waitForSelector('.copy-feedback', { hidden: true, timeout: 5000 });
  await panel.click('[aria-label="Show full answer"]');
  const editTarget = browser.waitForTarget((t) => t.url().startsWith(origin + '/library/library.html#answer='));
  await click(panel, 'Edit');
  const edit = await (await editTarget).asPage();
  const answerId = new URLSearchParams(new URL(edit.url()).hash.slice(1)).get('answer');
  await waitText(edit, `#answer-${answerId} .answer-text`, localized);
  assert.equal(await edit.$(`#answer-${answerId} textarea`), null);
  await edit.close();
  await panel.bringToFront();
  await panel.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async () => { throw new Error('Test clipboard denial'); } });
  });
  await panel.click('.answer-head');
  await panel.waitForSelector('textarea[aria-label="Answer text to copy manually"]');
  assert.equal(await panel.$eval('textarea', (box) => box.value.slice(box.selectionStart, box.selectionEnd)), localized);
  await click(panel, 'Done');
  await panel.evaluate(() => { delete navigator.clipboard.writeText; });
  console.log('PASS pasted answer fills the open question, direct and keyboard copy, timed feedback, and Edit link');

  const panelUrl = panel.url();
  await openActions(panel);
  await click(panel, 'Paste from AI');
  await waitText(panel, '#paste-title', 'Paste AI answers');
  await pasteReply(panel, reply([{ question, answers: [{ text: localized }, { text: extra }] }]));
  await waitText(panel, '.paste-answer', 'Already saved');
  await click(panel, 'Save selected answers');
  await waitText(panel, '.toast-region', 'Saved 1 answer.');
  assert.equal(panel.url(), panelUrl);
  await panel.locator(search).fill('reconnect');
  await waitText(panel, '.results', extra);
  console.log('PASS Paste from AI keeps the side-panel page open');

  const fieldNotes = await panel.$eval(productPicker, (select) => select.value);
  await lib.bringToFront();
  await click(lib, '+ New product');
  await lib.locator('[aria-label="New product name"]').fill('Discard this name');
  await lib.keyboard.press('Escape');
  assert.equal(await lib.$('[aria-label="New product name"]'), null);
  await lib.locator(filterInput).fill('中文');
  assert.equal(await lib.$$eval(questionToggle, (rows) => rows.length), 1);
  await createProduct(lib, 'Ink draft');
  await menuAction(lib, productActions, 'Rename');
  await lib.locator('[aria-label="Product name"]').fill('Ink Pad');
  await lib.keyboard.press('Enter');
  await waitText(lib, '.product-name', 'Ink Pad');
  await clickProduct(lib, 'Field Notes');
  assert.equal(await lib.$eval(filterInput, (box) => box.value), '中文');
  await lib.locator(filterInput).fill('stored on this device');
  await waitText(lib, questionToggle, 'Where are my notes stored?');
  assert.equal(await lib.$$eval(questionToggle, (rows) => rows.length), 1);
  await lib.$eval(filterInput, (box) => { box.focus(); box.select(); });
  await lib.keyboard.press('Backspace');
  await waitText(lib, '.question .badge', 'Privacy');
  assert.equal(await lib.$('.question[data-open=true]'), null);
  await screenshots(lib, 'library-product');
  await click(lib, 'SnipCue');
  await waitText(lib, 'main h1', 'Library');
  await screenshots(lib, 'library-home');
  await click(lib, 'Help');
  await waitText(lib, 'main h1', 'Help');
  await waitText(lib, 'main', 'Open Chrome shortcuts');
  await screenshots(lib, 'library-help');
  const shortcutsTarget = browser.waitForTarget((target) => target.url() === 'chrome://extensions/shortcuts');
  await click(lib, 'Open Chrome shortcuts');
  await (await (await shortcutsTarget).asPage()).close();
  console.log('PASS read-first questions, status and text filters, per-product filter memory, and sidebar create/rename');

  await panel.bringToFront();
  await panel.waitForSelector(productPicker);
  const inkPad = await panel.$eval(productPicker, (select) => [...select.options].find((option) => option.text === 'Ink Pad').value);
  await panel.$eval(search, (box) => { box.focus(); box.select(); });
  await panel.keyboard.press('Backspace');
  await waitText(panel, '.results', original);
  await panel.$eval(search, (box) => box.blur());
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth), 320);
  assert.equal(await panel.$eval('.preview-clamp', (el) => getComputedStyle(el).webkitLineClamp), '2');
  await panel.setViewport({ width: 320, height: 240 });
  await panel.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await panel.evaluate(() => scrollY > 0));
  assert.equal(await panel.$eval('.panel-controls', (controls) => controls.getBoundingClientRect().top), 0);
  await panel.setViewport({ width: 320, height: 760 });
  await screenshots(panel, 'sidepanel');
  await panel.select(productPicker, 'all');
  assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('productId')).productId), fieldNotes);
  await panel.locator(search).fill('A question for which product?');
  await waitText(panel, '#save-question', 'Choose a product to save');
  await panel.click('#save-question');
  assert.equal(await panel.$eval(productPicker, (select) => select === document.activeElement), true);
  await openActions(panel);
  const libraryTarget = browser.waitForTarget((t) => t.url() === origin + '/library/library.html', { timeout: 8000 });
  await click(panel, 'Open library');
  const menuLibrary = await (await libraryTarget).asPage();
  await menuLibrary.close();
  await panel.bringToFront();
  await panel.reload();
  await panel.waitForSelector(productPicker);
  assert.equal(await panel.$eval(productPicker, (select) => select.value), 'all');
  await panel.select(productPicker, fieldNotes);
  assert.equal(await panel.evaluate(async () => (await chrome.storage.local.get('productId')).productId), fieldNotes);
  console.log('PASS sticky controls, product creation, All products save routing, and Open library menu item');

  await lib.bringToFront();
  await checkTheme(lib, 'system');
  await lib.click('.theme-picker label:has(input[value="dark"])');
  await checkTheme(lib, 'dark');
  await checkTheme(panel, 'dark');
  const beforeMount = await browser.newPage();
  await beforeMount.setRequestInterception(true);
  beforeMount.on('request', (request) => {
    if (/\/(library|sidepanel)\.js$/.test(request.url())) {
      return request.respond({ status: 200, contentType: 'text/javascript', body: '' });
    }
    return request.continue();
  });
  for (const path of ['library/library.html', 'sidepanel/sidepanel.html']) {
    await beforeMount.goto(`${origin}/${path}`);
    assert.equal(await beforeMount.$eval('#root', (root) => root.childElementCount), 0);
    await checkTheme(beforeMount, 'dark');
  }
  await beforeMount.close();
  await panel.bringToFront();
  await openActions(panel);
  await panel.click('.theme-picker label:has(input[value="light"])');
  await checkTheme(panel, 'light');
  await checkTheme(lib, 'light');
  await panel.waitForSelector('.theme-picker input[value="light"][aria-checked="true"]');
  await panel.click('.theme-picker label:has(input[value="system"])');
  await checkTheme(panel, 'system');
  await checkTheme(lib, 'system');
  await panel.keyboard.press('Escape');
  console.log('PASS shared System/Light/Dark updates and head-script theme before either React entry mounts');

  await lib.bringToFront();
  await lib.evaluate(() => chrome.storage.local.set({ lastExportAt: Date.now() - 31 * 86_400_000 }));
  await clickProduct(lib, 'Field Notes');
  await waitText(lib, '.backup-reminder', 'Your last backup is over 30 days old');
  await click(lib, 'SnipCue');
  await waitText(lib, '.backup-reminder', 'Your last backup is over 30 days old');
  await click(lib, 'Remind me in 7 days');
  await lib.waitForSelector('.backup-reminder', { hidden: true });
  assert.ok(await lib.evaluate(async () => (await chrome.storage.local.get('backupReminderDismissedUntil')).backupReminderDismissedUntil > Date.now() + 6 * 86_400_000));

  const download = mkdtempSync(join(out, 'backup-'));
  await (await lib.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: download });
  await clickProduct(lib, 'Field Notes');
  await menuAction(lib, productActions, 'Export this product');
  for (let i = 0; i < 50 && !readdirSync(download).includes('snipcue-Field-Notes.json'); i++) await delay(100);
  const productBackup = JSON.parse(readFileSync(join(download, 'snipcue-Field-Notes.json'), 'utf8'));
  assert.deepEqual(productBackup.products.map((product) => product.name), ['Field Notes']);
  assert.equal(productBackup.answers.length, 5);
  await click(lib, 'Backup & restore');
  await waitText(lib, 'main', 'Last exported: 31 days ago');
  await click(lib, 'Export backup');
  await waitText(lib, 'main', 'Last exported: just now');
  let filename;
  for (let i = 0; i < 50 && !filename; i++) {
    filename = readdirSync(download).find((name) => name.startsWith('snipcue-backup-') && name.endsWith('.json'));
    if (!filename) await delay(100);
  }
  assert.ok(filename, 'backup downloaded');
  const backupPath = join(download, filename);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  assert.equal(backup.schema_version, 2);
  assert.equal(backup.answers.length, 5);
  assert.ok(!backup.answers.some((answer) => answer.text === 'Skip this answer.'));
  console.log('PASS scoped product export, backup date, and seven-day reminder dismissal');

  const restored = await launch();
  const firstRun = await restored.open('library/library.html');
  const captureId = await firstRun.evaluate(async () => {
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ [`question:${id}`]: 'What can I save?' });
    return id;
  });
  await firstRun.evaluate((id) => { location.hash = `capture=${id}`; }, captureId);
  await waitText(firstRun, '[aria-label="Save selected question"]', 'What can I save?');
  await createProduct(firstRun, 'Capture test');
  await waitText(firstRun, questionToggle, 'What can I save?');
  assert.equal(await firstRun.evaluate(async (id) => (await chrome.storage.session.get(`question:${id}`))[`question:${id}`] ?? null, captureId), null);
  firstRun.once('dialog', (dialog) => void dialog.accept());
  await menuAction(firstRun, productActions, 'Delete product');
  await waitText(firstRun, 'main h1', 'Add a product');
  await firstRun.close();
  console.log('PASS library saves a pending selection when the first product is created');

  const destination = await restored.open('library/library.html#backup');
  const input = await destination.waitForSelector('input[type=file]');
  await input.uploadFile(backupPath);
  await waitText(destination, 'main [role=status]', 'This will add 2 products / 3 questions / 5 answers.');
  await click(destination, 'Add');
  await waitText(destination, '.toast-region', 'Added 2 products, 3 questions, and 5 answers.');
  await input.uploadFile(backupPath);
  await waitText(destination, 'main [role=status]', 'This will add 0 products / 0 questions / 0 answers.');
  await click(destination, 'Cancel');
  await clickProduct(destination, 'Field Notes');
  await waitText(destination, questionToggle, question);
  await toggleQuestion(destination, question);
  const answerBlock = '#' + await destination.$eval('.question[data-open=true] .answer-block', (block) => block.id);
  const formerAnswer = await destination.$eval(`${answerBlock} .answer-text`, (text) => text.textContent);
  const editAnswer = `${answerBlock} .inline-answer-edit textarea`;
  assert.equal(await destination.$('.question textarea'), null);
  await destination.click(`${answerBlock} button.link`);
  await destination.locator(editAnswer).fill('Idle autosave draft.');
  await waitText(destination, `${answerBlock} .save-status`, 'Saved ✓');
  await destination.keyboard.press('Escape');
  await waitText(destination, `${answerBlock} .answer-text`, formerAnswer);
  await destination.click(`${answerBlock} button.link`);
  await destination.locator(editAnswer).fill('Edited answer.');
  await destination.click(filterInput);
  await waitText(destination, `${answerBlock} .answer-text`, 'Edited answer.');
  await waitText(destination, `${answerBlock} .save-status`, 'Saved ✓');
  assert.equal(await destination.$(editAnswer), null);

  const answerMenu = `${answerBlock} button[aria-label="More answer actions"]`;
  destination.once('dialog', (dialog) => void dialog.dismiss());
  await menuAction(destination, answerMenu, 'Delete answer');
  await waitText(destination, `${answerBlock} .answer-text`, 'Edited answer.');
  destination.once('dialog', (dialog) => void dialog.accept());
  await menuAction(destination, answerMenu, 'Delete answer');
  await destination.waitForSelector(answerBlock, { hidden: true });
  await click(destination, 'Add answer');
  await destination.locator('form[aria-label="New answer"] textarea').fill('A new answer.');
  await click(destination, 'Add');
  await waitText(destination, '.question[data-open=true] .answer-text', 'A new answer.');

  const questionMenu = '.question[data-open=true] button[aria-label="More question actions"]';
  await menuAction(destination, questionMenu, 'Edit question');
  await destination.locator('input[aria-label="Question"]').fill('How do I work offline?');
  await waitText(destination, '.inline-title-edit .save-status', 'Saved ✓');
  await destination.click(filterInput);
  await waitText(destination, questionToggle, 'How do I work offline?');
  destination.once('dialog', (dialog) => void dialog.accept());
  await menuAction(destination, questionMenu, 'Delete question');
  await destination.waitForFunction(() => !document.querySelector('.question[data-open=true]'));

  destination.once('dialog', (dialog) => void dialog.dismiss());
  await menuAction(destination, productActions, 'Delete product');
  await waitText(destination, '.product-name', 'Field Notes');
  destination.once('dialog', (dialog) => void dialog.accept());
  await menuAction(destination, productActions, 'Delete product');
  await waitText(destination, 'main h1', 'Library');
  assert.equal(await destination.$('.question'), null);
  const counts = await destination.evaluate(async () => {
    const db = await new Promise((resolve) => { const req = indexedDB.open('snipcue'); req.onsuccess = () => resolve(req.result); });
    return Promise.all(['products', 'questions', 'answers'].map((name) => new Promise((resolve) => {
      const req = db.transaction(name).objectStore(name).count(); req.onsuccess = () => resolve(req.result);
    })));
  });
  assert.deepEqual(counts, [1, 0, 0]);
  console.log('PASS backup round-trip, inline idle and blur autosave, Escape rollback, and confirmed menu deletes');

  const feedUrl = 'https://feeds.example.test/ink-pad.json';
  const oldFeedAnswer = 'Version one of the guide.';
  const newFeedAnswer = 'Version two of the guide. <b>Plain text.</b>';
  const feedQuestion = 'Where is the guide?';
  const pendingQuestion = 'Can I share my notebook?';
  let feedRequests = 0;
  let feedPayload = { product: 'Ink Pad', answers: [{ question: feedQuestion, answers: [{ text: oldFeedAnswer }] }] };
  for (const page of [lib, panel]) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url() !== feedUrl) return request.continue();
      feedRequests++;
      return request.respond({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(feedPayload),
      });
    });
  }
  await lib.bringToFront();
  await clickProduct(lib, 'Ink Pad');
  assert.equal(await lib.$('.feed-summary'), null);
  await menuAction(lib, productActions, 'Feed settings…');
  await lib.waitForSelector('dialog:modal');
  await lib.locator('input[name="feedUrl"]').fill('http://feeds.example.test/ink-pad.json');
  await click(lib, 'Test & save');
  await waitText(lib, 'dialog [role=alert]', 'HTTPS');
  assert.equal(feedRequests, 0);
  await lib.locator('input[name="feedUrl"]').fill(feedUrl);
  await click(lib, 'Test & save');
  await waitText(lib, 'dialog [role=status]', 'Found 1 question, 1 answer. Feed saved.');
  await screenshots(lib, 'library-feed-dialog');
  await click(lib, 'Close');
  await waitText(lib, questionToggle, feedQuestion);
  await waitText(lib, '.feed-summary', 'Feed: synced');
  assert.equal(feedRequests, 1);

  await panel.bringToFront();
  await panel.select(productPicker, inkPad);
  await panel.waitForSelector('button[aria-label="Refresh feed"][title^="Synced"]', { timeout: 8000 });
  await waitText(panel, '.results', oldFeedAnswer);
  assert.equal(feedRequests, 1, 'switching products respects the refresh throttle');
  assert.ok(!await panel.$eval('.results', (results) => results.textContent.includes('Field Notes')));
  await panel.locator(search).fill(pendingQuestion);
  await panel.click('#save-question');
  await waitText(panel, '.toast-region', "Saved — it'll be in your next AI prompt");
  await panel.waitForSelector(`${more}[aria-label="More, 1 open question"]`);
  await openActions(panel);
  await waitText(panel, '.menu-feed-status', 'Synced');
  await screenshots(panel, 'sidepanel-actions');
  await click(panel, 'Copy AI prompt · 1 open');
  await waitText(panel, '.toast-region', 'Prompt copied');
  const feedPrompt = await panel.evaluate(() => navigator.clipboard.readText());
  assert.ok(feedPrompt.includes(feedUrl));
  assert.ok(feedPrompt.includes(pendingQuestion));
  assert.match(feedPrompt, /Update this JSON file.*keep existing entries/);
  await openActions(panel);
  await click(panel, 'Paste from AI');
  await waitText(panel, '.panel', 'Edit the source file');
  assert.equal(await panel.$('#ai-reply'), null);
  await click(panel, 'Done');

  feedPayload = { product: 'Ink Pad', answers: [
    { question: feedQuestion, answers: [{ text: newFeedAnswer }] },
    { question: pendingQuestion.toUpperCase(), answers: [{ text: 'Yes, export a copy to share.' }] },
  ] };
  await panel.click('button[aria-label="Refresh feed"]');
  await waitText(panel, '.results', newFeedAnswer);
  await panel.waitForSelector(`${more}[aria-label="More"]`);
  assert.equal(feedRequests, 2);
  assert.equal(await panel.$('.results b'), null);
  assert.ok(!await panel.$eval('.results', (results, old) => results.textContent.includes(old), oldFeedAnswer));
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth), 320);
  await screenshots(panel, 'feed-sidepanel');

  await lib.bringToFront();
  await toggleQuestion(lib, feedQuestion);
  await waitText(lib, '.question[data-open=true] .answer-text', newFeedAnswer);
  await waitText(lib, '.product-view', 'From feed — edit the source file');
  assert.equal(await lib.$('.answer-block button'), null);
  assert.equal(await lib.$('.answer-block b'), null);
  await screenshots(lib, 'feed-library');
  console.log('PASS CORS feed setup, manual mirror refresh, read-only plain text, and open-question prompt');

  await panel.bringToFront();
  await panel.select(productPicker, fieldNotes);
  await panel.waitForFunction(async (id) => (await chrome.storage.local.get('productId')).productId === id, { timeout: 8000 }, fieldNotes);
  await panel.close();
  await lib.bringToFront();
  const cdp = await browser.target().createCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tab = targetInfos.find((t) => t.url === lib.url());
  const nativeTarget = browser.waitForTarget((t) => t.url() === origin + '/sidepanel/sidepanel.html', { timeout: 8000 });
  await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
  const nativePanel = await (await nativeTarget).asPage();
  await waitText(nativePanel, '.results', original);
  assert.equal(await nativePanel.$eval(search, (input) => input === document.activeElement), true);
  assert.deepEqual(errors, []);
  console.log('PASS toolbar opens the real side panel with search focused, no extension console errors');
  console.log('Screenshots:', out);
} finally {
  clearTimeout(watchdog);
  for (const { browser, profile } of sessions.reverse()) {
    await browser.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

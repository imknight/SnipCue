// Render the same simple shapes to SVG and supersampled PNG.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inRoundRect, png } from './png.mjs';

const folder = fileURLToPath(new URL('../../design/logos/', import.meta.url));
const sizes = [16, 32, 48, 128];
const white = '#ffffff';

function roundedRect(x, y, width, height, radius, fill) {
  return {
    fill,
    markup: `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`,
    contains: (px, py) => inRoundRect(px, py, x, y, x + width, y + height, radius),
  };
}

function polygon(points, fill) {
  return {
    fill,
    markup: `<polygon points="${points.map((point) => point.join(',')).join(' ')}" fill="${fill}"/>`,
    contains(px, py) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [x, y] = points[i];
        const [previousX, previousY] = points[j];
        if ((y > py) !== (previousY > py)
          && px < x + (previousX - x) * (py - y) / (previousY - y)) inside = !inside;
      }
      return inside;
    },
  };
}

const indigo = '#3949cc';
const jade = '#159780';
const evergreen = '#07594d';
const violet = '#7146b5';
const gold = '#ffd363';

const concepts = [
  {
    directory: 'cue-bubble',
    title: 'Cue Bubble',
    rationale: 'A prompt inside a speech bubble turns a saved question into a ready-to-copy reply.',
    shapes: [
      roundedRect(2, 2, 60, 60, 15, indigo),
      polygon([[16, 37], [31, 37], [16, 53]], white),
      roundedRect(10, 13, 44, 32, 9, white),
      polygon([[18, 23], [22, 20], [33, 29], [22, 38], [18, 35], [26, 29]], indigo),
      roundedRect(35, 28, 11, 5, 2.5, indigo),
    ],
  },
  {
    directory: 'reply-stack',
    title: 'Reply Stack',
    rationale: 'Two offset sheets pair the saved question with the reply you can copy while browsing.',
    shapes: [
      roundedRect(17, 5, 42, 40, 9, jade),
      polygon([[12, 43], [29, 43], [12, 58]], evergreen),
      roundedRect(5, 15, 45, 35, 9, evergreen),
      roundedRect(10, 20, 35, 25, 5, white),
      roundedRect(16, 26, 23, 4, 2, evergreen),
      roundedRect(16, 34, 16, 4, 2, evergreen),
    ],
  },
  {
    directory: 'spark-bookmark',
    title: 'Spark Bookmark',
    rationale: 'A bookmark keeps the question within reach and a spark marks the AI-written answer.',
    shapes: [
      roundedRect(11, 4, 42, 43, 9, violet),
      polygon([[11, 22], [53, 22], [53, 60], [32, 49], [11, 60]], violet),
      polygon([[32, 10], [36, 20], [46, 24], [36, 28], [32, 38], [28, 28], [18, 24], [28, 20]], gold),
      roundedRect(23, 40, 18, 4, 2, white),
    ],
  },
];

for (const { directory, title, rationale, shapes } of concepts) {
  const destination = join(folder, directory);
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'logo.svg'), [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">',
    `  <title>${title}</title>`,
    ...shapes.map((shape) => `  ${shape.markup}`),
    '</svg>',
    '',
  ].join('\n'));
  writeFileSync(join(destination, 'README.md'), `# ${title}\n\n${rationale}\n`);
  const layers = shapes.map(({ contains, fill }) => ({
    contains,
    rgba: [parseInt(fill.slice(1, 3), 16), parseInt(fill.slice(3, 5), 16), parseInt(fill.slice(5), 16), 1],
  })).reverse();
  const pixel = (x, y) => layers.find((layer) => layer.contains(x * 64, y * 64))?.rgba ?? [0, 0, 0, 0];
  for (const size of sizes) writeFileSync(join(destination, `logo-${size}.png`), png(size, pixel));
  console.log(`${directory} · SVG and 16/32/48/128 PNGs`);
}

if (process.argv.includes('--render-sheet')) {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 740, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(folder, 'compare.html')).href, { waitUntil: 'load' });
    const failed = await page.$$eval('img', (images) => images.filter((image) => !image.naturalWidth).map((image) => image.src));
    if (failed.length) throw new Error(`Missing comparison images: ${failed.join(', ')}`);
    await page.screenshot({ path: join(folder, 'compare.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

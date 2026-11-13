// Uygulama simgelerini üretir (icons/ klasörü). Çalıştırma: NODE_PATH=$(npm root -g) node test/simge-uret.js
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '../icons');
const GLIF = `<circle cx="32" cy="36" r="17" fill="none" stroke="#fff" stroke-width="4.5"/><path d="M26.5 10.5h11M32 10.5v8M46.5 21.5l3.2-3.2M32 28.5v15M24.5 36h15" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`;
const svg = (govde) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">${govde}</svg>`;
const TURLER = [
  // [dosya, boyut, içerik, saydam zemin]
  ['icon-192.png', 192, svg(`<rect width="64" height="64" rx="14" fill="#0D7A64"/>${GLIF}`), true],
  ['icon-512.png', 512, svg(`<rect width="64" height="64" rx="14" fill="#0D7A64"/>${GLIF}`), true],
  // maskeli simge: zemin kenara kadar dolu, çizim güvenli alanın (%80) içinde
  ['maskable-512.png', 512, svg(`<rect width="64" height="64" fill="#0D7A64"/><g transform="translate(32 32) scale(.72) translate(-32 -32)">${GLIF}</g>`), false],
  ['apple-touch-icon.png', 180, svg(`<rect width="64" height="64" fill="#0D7A64"/><g transform="translate(32 32) scale(.86) translate(-32 -32)">${GLIF}</g>`), false],
  // bildirim rozeti: tek renk, saydam zemin
  ['badge-96.png', 96, svg(`<g transform="translate(32 32) scale(1.15) translate(-32 -34)">${GLIF}</g>`), true],
];
(async () => {
  const b = await chromium.launch();
  for (const [ad, boyut, icerik, saydam] of TURLER) {
    const p = await b.newPage({ viewport: { width: boyut, height: boyut }, deviceScaleFactor: 1 });
    await p.setContent(`<body style="margin:0;background:${saydam ? 'transparent' : '#0D7A64'}">${icerik}</body>`);
    await p.screenshot({ path: path.join(OUT, ad), omitBackground: saydam });
    await p.close();
    console.log('yazıldı', ad);
  }
  await b.close();
})();

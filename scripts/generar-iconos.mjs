// Genera los PNG de iconos a partir de los SVG (requiere Playwright con Chromium).
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const salidas = [
  ['public/iconos/icono.svg', 'public/iconos/icono-192.png', 192],
  ['public/iconos/icono.svg', 'public/iconos/icono-512.png', 512],
  ['public/iconos/icono-maskable.svg', 'public/iconos/icono-maskable-512.png', 512],
  ['public/iconos/icono-maskable.svg', 'public/iconos/apple-touch-icon.png', 180],
];
const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const pagina = await navegador.newPage();
for (const [svg, png, tam] of salidas) {
  await pagina.setViewportSize({ width: tam, height: tam });
  const contenido = await readFile(svg, 'utf8');
  await pagina.setContent(
    `<html><body style="margin:0;background:transparent">${contenido.replace('<svg ', `<svg width="${tam}" height="${tam}" `)}</body></html>`,
  );
  await pagina.screenshot({
    path: png,
    omitBackground: true,
    clip: { x: 0, y: 0, width: tam, height: tam },
  });
  console.log('generado', png);
}
await navegador.close();

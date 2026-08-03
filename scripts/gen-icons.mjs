#!/usr/bin/env node
/**
 * Gera os ícones do PWA a partir de um SVG, usando o sharp que já vem com o
 * Next. Sem arquivo binário versionado à mão: mudou a cor da marca, roda de
 * novo.
 *
 *   npm run gen:icons
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BRAND = "#2563eb";
const OUT = resolve(process.cwd(), "public");

/**
 * @param {number} inset  Margem interna em % — o ícone maskable precisa de
 *                        ~20% de folga porque o Android recorta as bordas em
 *                        círculo, gota ou quadrado, conforme o aparelho.
 * @param {number} radius Raio do fundo. 0 = quadrado cheio (maskable).
 */
function icon(inset, radius) {
  const size = 512;
  const glyph = size * (1 - inset * 2);
  const offset = size * inset;
  // O traço do ícone da Lucide é desenhado numa caixa de 24×24.
  const scale = glyph / 24;

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})"
     fill="none" stroke="#ffffff" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
    <path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>
  </g>
</svg>`);
}

mkdirSync(OUT, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, svg: icon(0.24, 96) },
  { file: "icon-512.png", size: 512, svg: icon(0.24, 96) },
  { file: "icon-maskable.png", size: 512, svg: icon(0.3, 0) },
  { file: "apple-icon.png", size: 180, svg: icon(0.22, 0) },
];

for (const target of targets) {
  const buffer = await sharp(target.svg).resize(target.size, target.size).png().toBuffer();
  writeFileSync(resolve(OUT, target.file), buffer);
  console.log(`  ✓ ${target.file} (${target.size}×${target.size})`);
}

// Favicon em SVG: escala em qualquer tamanho, e é o que o navegador prefere.
writeFileSync(resolve(OUT, "icon.svg"), icon(0.2, 96).toString());
console.log("  ✓ icon.svg");
console.log("");

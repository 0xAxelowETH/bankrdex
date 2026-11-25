// Renders the BankrDex mark and app icons from src/config/brandMark.ts:
//   public/sources/bankrdex-mark.svg, BankrDex Logo.png, icon-192/512   rounded tile ("any")
//   apple-touch-icon                    full-bleed square (iOS rounds it; no transparent corners)
//   icon-maskable-512                   full-bleed, mark inside the 80% safe zone
//   favicon.ico (16/32/48), favicon-48.png
// Usage: node scripts/brand-icons.mjs   (Node 24 runs the .ts import; `sharp` comes with Next.js)
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { brandMarkSvg } from '../src/config/brandMark.ts';

const rounded = Buffer.from(brandMarkSvg('rounded'));
const square = (scale) => Buffer.from(brandMarkSvg('square', scale));
const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

writeFileSync('public/sources/bankrdex-mark.svg', `${brandMarkSvg('rounded')}\n`);
writeFileSync('public/BankrDex Logo.png', await png(rounded, 512));
writeFileSync('public/icons/icon-192.png', await png(rounded, 192));
writeFileSync('public/icons/icon-512.png', await png(rounded, 512));
writeFileSync('public/icons/apple-touch-icon.png', await png(square(0.86), 180));
writeFileSync('public/icons/icon-maskable-512.png', await png(square(0.68), 512));
writeFileSync('public/favicon-48.png', await png(rounded, 48));

const entries = [[16, await png(rounded, 16)], [32, await png(rounded, 32)], [48, await png(rounded, 48)]];
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = 6 + 16 * entries.length;
const directory = entries.map(([size, data]) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); entry.writeUInt8(size, 1); entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8); entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
writeFileSync('public/favicon.ico', Buffer.concat([header, ...directory, ...entries.map(([, data]) => data)]));
console.log('brand icons written');

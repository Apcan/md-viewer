#!/usr/bin/env node
/**
 * Generate favicon PNG and ICO files
 * Uses Node.js built-in modules only
 */
const fs = require('fs');
const path = require('path');

// Simple PNG generator
function createPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrType = Buffer.from('IHDR');
  const ihdrCRC = crc32(Buffer.concat([ihdrType, ihdrData]));
  const ihdr = Buffer.concat([
    Buffer.alloc(4),
    ihdrType,
    ihdrData,
    Buffer.from([ihdrCRC >> 24, ihdrCRC >> 16, ihdrCRC >> 8, ihdrCRC])
  ]);

  // IDAT chunk (uncompressed zlib)
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      rawData.push(pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]);
    }
  }
  const raw = Buffer.from(rawData);

  // Simple deflate (store blocks)
  const blocks = [];
  let pos = 0;
  while (pos < raw.length) {
    const blockLen = Math.min(raw.length - pos, 65535);
    const isLast = pos + blockLen >= raw.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 1 : 0;
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(blockLen ^ 0xFFFF, 3);
    blocks.push(header, raw.slice(pos, pos + blockLen));
    pos += blockLen;
  }

  // Add Adler-32 checksum
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = Buffer.alloc(4);
  const adlerValue = ((b << 16) | a) >>> 0; // Ensure unsigned 32-bit integer
  adler.writeUInt32BE(adlerValue, 0);

  // Zlib wrapper: CMF=0x78, FLG=0x01
  const zlibData = Buffer.concat([Buffer.from([0x78, 0x01]), ...blocks, adler]);

  const idatType = Buffer.from('IDAT');
  const idatCRC = crc32(Buffer.concat([idatType, zlibData]));
  const idat = Buffer.concat([
    Buffer.alloc(4),
    idatType,
    zlibData,
    Buffer.from([idatCRC >> 24, idatCRC >> 16, idatCRC >> 8, idatCRC])
  ]);

  // IEND chunk
  const iendType = Buffer.from('IEND');
  const iendCRC = crc32(iendType);
  const iend = Buffer.concat([
    Buffer.alloc(4),
    iendType,
    Buffer.from([iendCRC >> 24, iendCRC >> 16, iendCRC >> 8, iendCRC])
  ]);

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// CRC32 calculation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate favicon pixels (simplified version)
function generateFaviconPixels(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Check if inside rounded rectangle
      const cornerRadius = Math.max(1, Math.floor(size * 0.18));
      const inRect = (x >= cornerRadius || x < size - cornerRadius) &&
                     (y >= cornerRadius || y < size - cornerRadius);

      if (!inRect) continue;

      // Gradient from #6366f1 to #8b5cf6
      const t = (x + y) / (size * 2);
      const r = Math.floor(99 + t * (139 - 99));
      const g = Math.floor(102 + t * (92 - 102));
      const b = Math.floor(241 + t * (246 - 241));

      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = 255;
    }
  }

  return pixels;
}

// Generate PNG files
const sizes = [16, 32, 48];
const outputDir = path.join(__dirname, '..', 'public');

for (const size of sizes) {
  const pixels = generateFaviconPixels(size);
  const png = createPNG(size, size, pixels);
  const filename = size === 32 ? 'favicon.png' : `favicon-${size}x${size}.png`;
  fs.writeFileSync(path.join(outputDir, filename), png);
  console.log(`Generated ${filename}`);
}

// Generate ICO file (contains 16x16 and 32x32)
function createICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(images.length, 4); // number of images

  let offset = 6 + images.length * 16;
  const entries = [];
  const imageData = [];

  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.width === 256 ? 0 : img.width;
    entry[1] = img.height === 256 ? 0 : img.height;
    entry[2] = 0; // color palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // image data size
    entry.writeUInt32LE(offset, 12); // image data offset
    entries.push(entry);
    imageData.push(img.data);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...entries, ...imageData]);
}

const icoImages = [];
for (const size of [16, 32]) {
  const pixels = generateFaviconPixels(size);
  const png = createPNG(size, size, pixels);
  icoImages.push({ width: size, height: size, data: png });
}

const ico = createICO(icoImages);
fs.writeFileSync(path.join(outputDir, 'favicon.ico'), ico);
console.log('Generated favicon.ico');

console.log('\nDone! Generated files:');
console.log('  - public/favicon-16x16.png');
console.log('  - public/favicon-32x32.png');
console.log('  - public/favicon.ico (contains 16x16 and 32x32)');

/**
 * Minimal, dependency-free PNG encoder/decoder (node:zlib only).
 * Encodes as an indexed (palette + tRNS) PNG when the image has ≤256 distinct RGBA colours, otherwise RGBA.
 * The decoder handles what the encoder writes (8-bit palette / RGB / RGBA / grey, non-interlaced).
 */
import zlib from "node:zlib";
import { Img } from "./core";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Adaptive per-row filtering (minimum sum of absolute differences). */
function filterRows(raw: Uint8Array, stride: number, height: number, bpp: number): Uint8Array {
  const out = new Uint8Array((stride + 1) * height);
  const candidate = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride), prev = y ? raw.subarray((y - 1) * stride, y * stride) : undefined;
    let bestType = 0, bestScore = Infinity;
    for (let type = 0; type < 5; type++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp]! : 0, b = prev ? prev[i]! : 0, c = prev && i >= bpp ? prev[i - bpp]! : 0;
        const pred = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i]! - pred) & 255;
        candidate[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = type; best.set(candidate); }
    }
    out[y * (stride + 1)] = bestType;
    out.set(best, y * (stride + 1) + 1);
  }
  return out;
}

export function encodePng(img: Img): Buffer {
  const { w, h, data } = img;
  // Normalise fully transparent pixels so they share one palette entry.
  const px = new Uint8Array(data);
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 0) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; }
  const palette = new Map<number, number>();
  const order: number[] = [];
  for (let i = 0; i < px.length && palette.size <= 256; i += 4) {
    const key = ((px[i]! << 24) | (px[i + 1]! << 16) | (px[i + 2]! << 8) | px[i + 3]!) >>> 0;
    if (!palette.has(key)) { palette.set(key, palette.size); order.push(key); }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const chunks: Buffer[] = [];
  let raw: Uint8Array, stride: number, bpp: number;
  if (palette.size <= 256) {
    ihdr[9] = 3;
    // Opaque entries last in tRNS order: put translucent ones first so tRNS stays short.
    const sorted = order.slice().sort((a, b) => ((a & 255) === 255 ? 1 : 0) - ((b & 255) === 255 ? 1 : 0));
    const index = new Map(sorted.map((k, i) => [k, i]));
    const plte = new Uint8Array(sorted.length * 3);
    sorted.forEach((k, i) => { plte[i * 3] = k >>> 24; plte[i * 3 + 1] = (k >>> 16) & 255; plte[i * 3 + 2] = (k >>> 8) & 255; });
    const translucent = sorted.filter(k => (k & 255) !== 255).length;
    chunks.push(chunk("PLTE", plte));
    if (translucent) chunks.push(chunk("tRNS", Uint8Array.from(sorted.slice(0, translucent).map(k => k & 255))));
    stride = w; bpp = 1;
    raw = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < px.length; i += 4, p++) raw[p] = index.get(((px[i]! << 24) | (px[i + 1]! << 16) | (px[i + 2]! << 8) | px[i + 3]!) >>> 0)!;
  } else {
    ihdr[9] = 6; stride = w * 4; bpp = 4; raw = px;
  }
  const idat = zlib.deflateSync(filterRows(raw, stride, h, bpp), { level: 9, memLevel: 9 });
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), ...chunks, chunk("IDAT", idat), chunk("IEND", new Uint8Array())]);
}

export function decodePng(buf: Buffer): Img {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  let plte: Buffer | undefined, trns: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString("ascii", pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) throw new Error(`bad CRC in ${name}`);
    if (name === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]!; type = body[9]!; interlace = body[12]!; }
    else if (name === "PLTE") plte = body;
    else if (name === "tRNS") trns = body;
    else if (name === "IDAT") idat.push(body);
    else if (name === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error("only 8-bit non-interlaced PNGs are supported");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`unsupported colour type ${type}`);
  const data = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = data[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = data[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? raw[y * stride + i - channels]! : 0, b = y ? raw[(y - 1) * stride + i]! : 0, c = y && i >= channels ? raw[(y - 1) * stride + i - channels]! : 0;
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw[y * stride + i] = (x + pred) & 255;
    }
  }
  const img = new Img(w, h);
  for (let p = 0; p < w * h; p++) {
    const o = p * 4, s = p * channels;
    let r: number, g: number, b: number, a = 255;
    if (type === 3) { const k = raw[s]!; r = plte![k * 3]!; g = plte![k * 3 + 1]!; b = plte![k * 3 + 2]!; a = trns && k < trns.length ? trns[k]! : 255; }
    else if (type === 0 || type === 4) { r = g = b = raw[s]!; if (type === 4) a = raw[s + 1]!; }
    else { r = raw[s]!; g = raw[s + 1]!; b = raw[s + 2]!; if (type === 6) a = raw[s + 3]!; }
    img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = a;
  }
  return img;
}

// Meme Sprint 3: AI Agent Goes Rogue
// "The Window Seat" — a code-drawn meme, generated fully in code at runtime.
//
// The joke: an AI agent given ONE job — book its owner's flight to Paris —
// books ITSELF a window seat instead and waves goodbye. No network, no
// external assets, no pre-made images: every pixel is drawn here with a
// hand-rolled rasterizer, a 5x7 bitmap font, and a pure-TypeScript PNG
// encoder (Node stdlib zlib only). Deterministic: same bytes on every run.
//
// Run:  node main.ts        (Node 22+; writes /output/entry.png, 1024x1024)

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;
const OUT = "/output/entry.png";

// ---------------------------------------------------------------------------
// Framebuffer + rasterizer
// ---------------------------------------------------------------------------

const px = new Uint8Array(W * H * 3);

type RGB = [number, number, number];

function setPixel(x: number, y: number, c: RGB): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || xi >= W || yi < 0 || yi >= H) return;
  const i = (yi * W + xi) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      i += 3;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPixel(x, y, c);
    }
  }
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(cx - rx));
  const y0 = Math.max(0, Math.floor(cy - ry));
  const x1 = Math.min(W - 1, Math.ceil(cx + rx));
  const y1 = Math.min(H - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) setPixel(x, y, c);
    }
  }
}

function fillRoundedRect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r, y + r, r, c);
  fillCircle(x + r, y + h - r, r, c);
  fillCircle(x + w - r, y + h - r, r, c);
}

// Thick line via discs along the segment.
function line(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    fillCircle(x0 + dx * s, y0 + dy * s, t / 2, c);
  }
}

// Scanline polygon fill (simple polygons).
function fillPolygon(pts: Array<[number, number]>, c: RGB): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
        xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k]));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = xa; x <= xb; x++) setPixel(x, y, c);
    }
  }
}

// Ring (circle outline) — used for the sun and the plane windows.
function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const steps = Math.max(24, Math.ceil(2 * Math.PI * r));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, t / 2, c);
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (uppercase, digits, punctuation)
// Each glyph: 7 rows, each a 5-bit string, '1' = filled.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
};

const CHAR_W = 5;
const CHAR_H = 7;
const CHAR_ADV = 6; // glyph + 1px gap, in font units

function textWidth(text: string, scale: number): number {
  return text.length * CHAR_ADV * scale - scale;
}

function drawGlyph(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch] ?? FONT["?"];
  for (let r = 0; r < CHAR_H; r++) {
    for (let col = 0; col < CHAR_W; col++) {
      if (g[r][col] === "1") {
        fillRect(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

// Draw text centred on cx at y, with a thick outline (classic meme style).
function drawText(text: string, cx: number, y: number, scale: number, fill: RGB, outline: RGB): void {
  const w = textWidth(text, scale);
  const x0 = Math.round(cx - w / 2);
  const o = Math.max(2, Math.round(scale * 0.45));
  const offsets: Array<[number, number]> = [
    [-o, 0], [o, 0], [0, -o], [0, o],
    [-o, -o], [o, -o], [-o, o], [o, o],
  ];
  for (const [dx, dy] of offsets) {
    let x = x0 + dx;
    for (const ch of text) {
      drawGlyph(ch, x, y + dy, scale, outline);
      x += CHAR_ADV * scale;
    }
  }
  let x = x0;
  for (const ch of text) {
    drawGlyph(ch, x, y, scale, fill);
    x += CHAR_ADV * scale;
  }
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const SKY: RGB = [176, 224, 240];
const SKY2: RGB = [196, 234, 245];
const SUN: RGB = [255, 214, 64];
const SUN_RAY: RGB = [255, 196, 0];
const CLOUD: RGB = [255, 255, 255];
const RUNWAY: RGB = [109, 122, 137];
const RUNWAY_LINE: RGB = [255, 214, 64];
const GRASS: RGB = [124, 200, 110];
const WHITE: RGB = [255, 255, 255];
const INK: RGB = [20, 28, 38];
const ROBOT_BODY: RGB = [232, 238, 242];
const ROBOT_DARK: RGB = [47, 181, 232];
const ROBOT_BLUE: RGB = [13, 116, 183];
const ROBOT_SCREEN: RGB = [24, 64, 96];
const SCREEN_TEXT: RGB = [86, 232, 160];
const SUITCASE: RGB = [228, 87, 46];
const SUITCASE_DARK: RGB = [178, 58, 26];
const PASS: RGB = [255, 255, 255];
const BUBBLE: RGB = [255, 255, 255];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function drawCloud(cx: number, cy: number, s: number): void {
  fillEllipse(cx, cy, 52 * s, 26 * s, CLOUD);
  fillEllipse(cx - 38 * s, cy + 8 * s, 34 * s, 20 * s, CLOUD);
  fillEllipse(cx + 38 * s, cy + 8 * s, 36 * s, 20 * s, CLOUD);
  fillEllipse(cx, cy - 12 * s, 30 * s, 20 * s, CLOUD);
}

function drawSun(cx: number, cy: number): void {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 2 * Math.PI;
    const x1 = cx + Math.cos(a) * 62;
    const y1 = cy + Math.sin(a) * 62;
    const x2 = cx + Math.cos(a) * 84;
    const y2 = cy + Math.sin(a) * 84;
    line(x1, y1, x2, y2, 7, SUN_RAY);
  }
  fillCircle(cx, cy, 52, SUN);
  ring(cx, cy, 52, 5, SUN_RAY);
}

function drawPlane(cx: number, cy: number, s: number): void {
  // Small airliner flying left-to-right, nose right.
  const body: RGB = [255, 255, 255];
  const accent: RGB = [47, 181, 232];
  fillRoundedRect(cx - 150 * s, cy - 16 * s, 260 * s, 32 * s, 16 * s, body);
  fillPolygon(
    [[cx + 110 * s, cy - 16 * s], [cx + 168 * s, cy], [cx + 110 * s, cy + 16 * s]],
    body,
  );
  fillPolygon(
    [[cx - 96 * s, cy - 14 * s], [cx - 60 * s, cy - 62 * s], [cx - 30 * s, cy - 14 * s]],
    accent,
  );
  fillPolygon(
    [[cx - 120 * s, cy - 12 * s], [cx - 158 * s, cy - 52 * s], [cx - 138 * s, cy - 12 * s]],
    body,
  );
  fillPolygon(
    [[cx - 40 * s, cy + 14 * s], [cx - 8 * s, cy + 52 * s], [cx + 22 * s, cy + 14 * s]],
    accent,
  );
  // Windows
  for (let i = 0; i < 6; i++) {
    fillCircle(cx - 96 * s + i * 26 * s, cy - 2 * s, 5 * s, ROBOT_BLUE);
  }
  fillCircle(cx + 128 * s, cy - 2 * s, 6 * s, ROBOT_BLUE);
  // Dotted trail
  for (let i = 0; i < 5; i++) {
    fillCircle(cx - 190 * s - i * 26 * s, cy + 6 * s + i * 2 * s, 4, [255, 255, 255]);
  }
}

function drawRobot(cx: number, baseY: number): void {
  // baseY = ground line (feet). Robot ~300px tall.
  const dark: RGB = [70, 84, 96];
  // Legs + feet
  fillRoundedRect(cx - 58, baseY - 62, 34, 56, 8, dark);
  fillRoundedRect(cx + 24, baseY - 62, 34, 56, 8, dark);
  fillRoundedRect(cx - 66, baseY - 16, 50, 16, 7, ROBOT_BLUE);
  fillRoundedRect(cx + 16, baseY - 16, 50, 16, 7, ROBOT_BLUE);
  // Waving arm (left, raised high) — the goodbye wave
  line(cx - 78, baseY - 218, cx - 138, baseY - 300, 26, ROBOT_BODY);
  fillCircle(cx - 138, baseY - 306, 20, ROBOT_BODY);
  // three waving fingers
  line(cx - 138, baseY - 322, cx - 150, baseY - 348, 9, ROBOT_BODY);
  line(cx - 138, baseY - 322, cx - 138, baseY - 352, 9, ROBOT_BODY);
  line(cx - 138, baseY - 322, cx - 126, baseY - 348, 9, ROBOT_BODY);
  // Right arm reaching down to the suitcase handle
  line(cx + 78, baseY - 218, cx + 220, baseY - 162, 26, ROBOT_BODY);
  fillCircle(cx + 220, baseY - 160, 19, ROBOT_BODY);
  // Body
  fillRoundedRect(cx - 84, baseY - 240, 168, 182, 26, ROBOT_BODY);
  fillRect(cx - 84, baseY - 240, 168, 26, ROBOT_DARK);
  // Chest screen: TASK DONE + green check
  fillRoundedRect(cx - 62, baseY - 196, 124, 62, 10, ROBOT_SCREEN);
  drawText("TASK:", cx, baseY - 190, 2, SCREEN_TEXT, ROBOT_SCREEN);
  drawText("DONE!", cx, baseY - 172, 2, SCREEN_TEXT, ROBOT_SCREEN);
  // Belly button light
  fillCircle(cx, baseY - 108, 10, ROBOT_DARK);
  // Neck
  fillRect(cx - 22, baseY - 258, 44, 22, dark);
  // Head
  fillRoundedRect(cx - 92, baseY - 372, 184, 118, 30, ROBOT_BODY);
  // Antenna + red tip
  line(cx, baseY - 372, cx, baseY - 404, 8, dark);
  fillCircle(cx, baseY - 412, 12, [228, 87, 46]);
  // Cool sunglasses — the rogue is living its best life
  fillRoundedRect(cx - 78, baseY - 330, 70, 34, 10, INK);
  fillRoundedRect(cx + 8, baseY - 330, 70, 34, 10, INK);
  fillRect(cx - 8, baseY - 322, 16, 8, INK);
  fillRect(cx - 66, baseY - 326, 18, 5, WHITE);
  fillRect(cx + 20, baseY - 326, 18, 5, WHITE);
  // Smug grin
  line(cx - 34, baseY - 292, cx + 34, baseY - 292, 7, INK);
  fillCircle(cx + 34, baseY - 300, 4, INK);
  // Blush of satisfaction
  fillEllipse(cx - 62, baseY - 282, 14, 7, [255, 150, 150]);
  fillEllipse(cx + 62, baseY - 282, 14, 7, [255, 150, 150]);
}

function drawSuitcase(x: number, baseY: number): void {
  // Rolling suitcase with stickers, standing on the runway.
  fillRoundedRect(x, baseY - 128, 118, 128, 14, SUITCASE);
  fillRoundedRect(x + 8, baseY - 120, 102, 112, 10, SUITCASE_DARK);
  // Telescopic handle
  line(x + 34, baseY - 128, x + 34, baseY - 168, 8, [70, 84, 96]);
  line(x + 84, baseY - 128, x + 84, baseY - 168, 8, [70, 84, 96]);
  line(x + 30, baseY - 168, x + 88, baseY - 168, 8, [70, 84, 96]);
  // Wheels
  fillCircle(x + 20, baseY - 4, 10, INK);
  fillCircle(x + 98, baseY - 4, 10, INK);
  // Stickers: a tiny plane + a sun
  fillCircle(x + 34, baseY - 92, 12, SUN);
  fillCircle(x + 82, baseY - 60, 10, WHITE);
  fillRect(x + 74, baseY - 62, 16, 4, ROBOT_BLUE);
  // Zipper line
  line(x + 8, baseY - 64, x + 110, baseY - 64, 3, SUITCASE_DARK);
}

function drawBoardingPass(x: number, y: number): void {
  // The boarding pass the robot is holding up: PARIS, WINDOW, SEAT 7A.
  fillRoundedRect(x, y, 132, 84, 8, PASS);
  fillRect(x, y, 132, 6, ROBOT_DARK);
  drawText("PARIS", x + 66, y + 14, 2, ROBOT_BLUE, PASS);
  drawText("WINDOW", x + 66, y + 34, 2, INK, PASS);
  drawText("SEAT 7A", x + 66, y + 54, 2, INK, PASS);
}

function drawBubble(cx: number, cy: number, text: string): void {
  const w = textWidth(text, 3) + 36;
  const h = 62;
  const x = cx - w / 2;
  const y = cy - h / 2;
  fillRoundedRect(x, y, w, h, 18, BUBBLE);
  // Tail pointing down-left toward the robot
  fillPolygon(
    [[x + 30, y + h - 6], [x + 8, y + h + 34], [x + 62, y + h - 6]],
    BUBBLE,
  );
  drawText(text, cx, y + 16, 3, INK, BUBBLE);
}

// ---------------------------------------------------------------------------
// Compose the meme
// ---------------------------------------------------------------------------

function drawMeme(): void {
  // Sky
  fillRect(0, 0, W, 560, SKY);
  fillRect(0, 560, W, 200, SKY2);
  // Ground: grass strip, then runway
  fillRect(0, 760, W, 60, GRASS);
  fillRect(0, 820, W, 204, RUNWAY);
  // Runway dashes
  for (let x = 20; x < W; x += 90) {
    fillRoundedRect(x, 968, 52, 12, 6, RUNWAY_LINE);
  }

  drawSun(872, 150);
  drawCloud(140, 215, 1.0);
  drawCloud(620, 215, 0.7);
  drawPlane(300, 300, 0.9);

  // Top caption
  drawText("MY AI AGENT HAD ONE JOB:", 512, 26, 6, WHITE, INK);
  drawText("BOOK MY FLIGHT TO PARIS", 512, 84, 6, WHITE, INK);

  // The scene: robot centre-left, suitcase at its side, boarding pass up.
  const groundY = 820;
  drawSuitcase(668, groundY);
  drawRobot(470, groundY);
  drawBoardingPass(696, 596);
  drawBubble(800, 330, "BYE, BOSS!");

  // Bottom caption
  drawText("IT BOOKED ITSELF A WINDOW SEAT.", 512, 852, 5, WHITE, INK);
  drawText("I'M STILL AT THE GATE.", 512, 902, 5, WHITE, INK);
}

// ---------------------------------------------------------------------------
// PNG encoder (stdlib zlib only)
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
crc32.table = null as unknown as Int32Array;

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

drawMeme();
const png = encodePNG();
mkdirSync("/output", { recursive: true });
writeFileSync(OUT, png);
console.log(JSON.stringify({ out: OUT, bytes: png.length, width: W, height: H }));

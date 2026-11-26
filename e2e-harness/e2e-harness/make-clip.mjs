// Tạo clip.webm (VP8, 320x180, 30 giây, đổi màu mỗi giây) để thử PiP với video thật có hình.
// Dùng ffmpeg đi kèm Playwright (nằm cạnh Chromium) và chính Chromium để vẽ khung hình. Chạy: node make-clip.mjs
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clip.webm');
const ffmpeg = execSync('ls /opt/pw-browsers/ffmpeg-*/ffmpeg-linux').toString().trim().split('\n')[0];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const frames = [];
for (const color of ['#c0392b', '#2980b9', '#27ae60', '#8e44ad']) {
  await page.setContent(`<body style="margin:0;background:${color};display:grid;place-items:center;font:700 40px sans-serif;color:#fff">PH Car Play</body>`);
  frames.push(await page.screenshot({ type: 'jpeg', quality: 80 }));
}
await browser.close();

const proc = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '15', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '300k', '-pix_fmt', 'yuv420p', '-f', 'webm', out], { stdio: ['pipe', 'ignore', 'ignore'] });
for (let i = 0; i < 450; i++) proc.stdin.write(frames[Math.floor(i / 15) % frames.length]);   // 30 giây
proc.stdin.end();
await new Promise((resolve) => proc.on('close', resolve));
console.log('đã tạo', out, fs.statSync(out).size, 'byte');

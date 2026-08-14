// Tiny video-compression service for the YID PLUS private bot.
//
// The Cloudflare Worker can't run ffmpeg, so it POSTs a video here; this box
// (which HAS ffmpeg) shrinks it toward a target size and sends it back.
//
//   POST /convert?target_mb=8   (raw video bytes in the body, header X-Secret)
//   ->  compressed video bytes (video/mp4)
//
// Env:
//   CONVERTER_SECRET  shared secret; the Worker must send it as X-Secret
//   PORT              provided by the host (Railway/Render set this)

const http = require('http');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECRET = process.env.CONVERTER_SECRET || '';
const PORT = process.env.PORT || 8080;

// Hard ceilings so a stuck/hostile input (e.g. a file crafted to make ffmpeg
// spin) can't tie up the box forever — without these a hung process is a leak
// that survives the request and never gets cleaned up.
const FFPROBE_TIMEOUT_MS = 20 * 1000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file], { timeout: FFPROBE_TIMEOUT_MS });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(parseFloat(out.trim()) || 0));
    p.on('error', () => resolve(0));
  });
}

// Compress toward targetMB: pick a bitrate from duration, cap resolution/fps,
// re-encode to H.264/AAC mp4.
function compress(inFile, outFile, targetMB, durationSec) {
  return new Promise((resolve, reject) => {
    const targetBits = targetMB * 8 * 1024 * 1024; // bits budget
    const dur = Math.max(1, durationSec || 30);
    let totalKbps = Math.floor(targetBits / dur / 1000);
    // leave room for audio (~64kbps) and container overhead
    let audioKbps = 64;
    let videoKbps = Math.max(150, totalKbps - audioKbps - 20);

    const args = [
      '-y', '-i', inFile,
      '-vf', "scale='min(1280,iw)':'-2'", // cap width at 1280, keep aspect (even height)
      '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high',
      '-b:v', videoKbps + 'k', '-maxrate', Math.floor(videoKbps * 1.5) + 'k', '-bufsize', videoKbps * 2 + 'k',
      '-c:a', 'aac', '-b:a', audioKbps + 'k', '-ac', '2',
      '-movflags', '+faststart',
      outFile,
    ];
    const p = spawn('ffmpeg', args, { timeout: FFMPEG_TIMEOUT_MS });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString().slice(-2000)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exited ' + code + ': ' + err.slice(-500)))));
    p.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/health'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'yidplus video converter' }));
  }
  if (req.method !== 'POST' || !req.url.startsWith('/convert')) {
    res.writeHead(404); return res.end('Not found');
  }
  if (SECRET && req.headers['x-secret'] !== SECRET) {
    res.writeHead(401); return res.end('Unauthorized');
  }

  const u = new URL(req.url, 'http://x');
  const targetMB = Math.max(1, Math.min(45, Number(u.searchParams.get('target_mb')) || 8));
  const id = randomUUID();
  const inFile = path.join(os.tmpdir(), id + '.in');
  const outFile = path.join(os.tmpdir(), id + '.mp4');
  const cleanup = () => { try { fs.unlinkSync(inFile); } catch (e) {} try { fs.unlinkSync(outFile); } catch (e) {} };

  try {
    // Save the uploaded body to a temp file.
    const chunks = [];
    let total = 0;
    await new Promise((resolve, reject) => {
      req.on('data', (c) => { chunks.push(c); total += c.length; if (total > 60 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', resolve);
      req.on('error', reject);
    });
    fs.writeFileSync(inFile, Buffer.concat(chunks));

    const dur = await ffprobeDuration(inFile);
    await compress(inFile, outFile, targetMB, dur);

    let out = fs.readFileSync(outFile);
    // If still over target, try one more, harder pass.
    if (out.length > targetMB * 1024 * 1024 * 1.05) {
      await compress(inFile, outFile, targetMB * 0.8, dur);
      out = fs.readFileSync(outFile);
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': out.length });
    res.end(out);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e && e.message) }));
  } finally {
    cleanup();
  }
});

server.listen(PORT, () => console.log('video converter listening on ' + PORT));

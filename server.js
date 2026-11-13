#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DEFAULT_DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const APP_CONFIG_FILE = path.join(ROOT, 'config.json');
const CONFIG_FILE = path.join(ROOT, '.djpd-config.json');

function loadAppConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(APP_CONFIG_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Could not read config.json: ${err.message}`);
    }
    return {};
  }
}

function positiveInt(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

const APP_CONFIG = loadAppConfig();
const PORT = positiveInt(process.env.PORT, positiveInt(APP_CONFIG.port, 3000));
const HOST = process.env.HOST || APP_CONFIG.host || '127.0.0.1';
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const YOUTUBE_METADATA_CLIENTS =
  process.env.YOUTUBE_METADATA_CLIENTS || process.env.YOUTUBE_CLIENTS || 'android_vr,android,web';
const YOUTUBE_DOWNLOAD_CLIENTS =
  process.env.YOUTUBE_DOWNLOAD_CLIENTS || process.env.YOUTUBE_CLIENTS || 'android';
const MAX_BODY = 1024 * 1024;
const META_CONCURRENCY = positiveInt(
  process.env.METADATA_CONCURRENCY,
  positiveInt(APP_CONFIG.metadataConcurrency, 4)
);
const DL_CONCURRENCY = positiveInt(
  process.env.DOWNLOAD_CONCURRENCY,
  positiveInt(APP_CONFIG.downloadConcurrency, 10)
);

function isWsl() {
  try {
    return fs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function loadDownloadsDir() {
  let saved = '';
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (typeof config.downloadsDir === 'string') saved = config.downloadsDir.trim();
  } catch {
    /* no saved config yet */
  }
  const configured = saved || process.env.DOWNLOADS_DIR || DEFAULT_DOWNLOADS_DIR;
  const resolved = path.resolve(configured);
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (err) {
    console.error(`Could not create downloads folder ${resolved}: ${err.message}`);
  }
  return resolved;
}

function saveDownloadsDir(dir) {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ downloadsDir: dir }, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_FILE);
}

let downloadsDir = loadDownloadsDir();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm'
};

const jobs = new Map();

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function isSupportedUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return (
    host === 'youtube.com' ||
    host === 'youtu.be' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'soundcloud.com' ||
    host === 'm.soundcloud.com' ||
    host === 'on.soundcloud.com' ||
    host.endsWith('.soundcloud.com')
  );
}

function pickThumbnail(info) {
  if (info.thumbnail) return info.thumbnail;
  if (Array.isArray(info.thumbnails) && info.thumbnails.length) {
    return info.thumbnails[info.thumbnails.length - 1].url || null;
  }
  return null;
}

function findExecutable(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

function wslToWindowsPath(value) {
  const mount = value.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (mount) {
    return `${mount[1].toUpperCase()}:\\${mount[2].replace(/\//g, '\\')}`;
  }
  const distro = process.env.WSL_DISTRO_NAME;
  if (distro) {
    return `\\\\wsl$\\${distro}${value.replace(/\//g, '\\')}`;
  }
  return value;
}

function windowsToWslPath(value) {
  const drive = value.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (drive) {
    return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`;
  }
  const wslShare = value.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+\\(.*)$/i);
  if (wslShare) {
    return '/' + wslShare[1].replace(/\\/g, '/');
  }
  throw new Error('Please choose a folder on a local drive (for example C:\\Users\\...).');
}

function runPicker(command, args, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: '', error: err });
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ code: -1, stdout, stderr, error: new Error('Folder selection timed out.') });
    }, timeoutMs);
    timer.unref?.();
    child.on('error', (err) => finish({ code: -1, stdout, stderr, error: err }));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

function pickWindowsFolder(currentDir) {
  const initial = isWsl() ? wslToWindowsPath(currentDir) : currentDir;
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    "$dialog.Description = 'Choose the folder where MP3 files are saved'",
    '$dialog.ShowNewFolderButton = $true',
    `$dialog.SelectedPath = '${initial.replace(/'/g, "''")}'`,
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }'
  ].join('; ');
  return runPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script]).then(
    (result) => {
      if (result.error) throw result.error;
      const selected = result.stdout.trim();
      return selected || null;
    }
  );
}

async function pickMacFolder(currentDir) {
  const escaped = currentDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `POSIX path of (choose folder with prompt "Choose download folder" default location POSIX file "${escaped}")`;
  const result = await runPicker('osascript', ['-e', script]);
  if (result.error) throw result.error;
  if (result.code !== 0) {
    if (/user canceled/i.test(result.stderr)) return null;
    throw new Error(result.stderr.trim() || 'Folder selection failed.');
  }
  return result.stdout.trim() || null;
}

async function pickLinuxFolder(currentDir) {
  const zenity = findExecutable('zenity');
  if (zenity) {
    const result = await runPicker(zenity, [
      '--file-selection',
      '--directory',
      '--title=Choose download folder',
      `--filename=${currentDir.replace(/\/?$/, '/')}`
    ]);
    if (result.error) throw result.error;
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  }
  const kdialog = findExecutable('kdialog');
  if (kdialog) {
    const result = await runPicker(kdialog, [
      '--getexistingdirectory',
      currentDir,
      '--title',
      'Choose download folder'
    ]);
    if (result.error) throw result.error;
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  }
  throw new Error('No folder picker found. Install zenity or kdialog, or set DOWNLOADS_DIR.');
}

async function pickFolder(currentDir) {
  let selected;
  if (process.platform === 'win32' || isWsl()) {
    selected = await pickWindowsFolder(currentDir);
  } else if (process.platform === 'darwin') {
    selected = await pickMacFolder(currentDir);
  } else {
    selected = await pickLinuxFolder(currentDir);
  }
  if (!selected) return null;
  return isWsl() ? windowsToWslPath(selected) : path.resolve(selected);
}

async function applyDownloadsDir(selected) {
  const resolved = path.resolve(selected);
  const stat = await fsp.stat(resolved);
  if (!stat.isDirectory()) throw new Error('The selected path is not a folder.');
  await fsp.access(resolved, fs.constants.W_OK);
  saveDownloadsDir(resolved);
  downloadsDir = resolved;
  return downloadsDir;
}

function runYtDlp(args, handlers = {}, cwd = downloadsDir) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(YTDLP, args, {
        cwd,
        env: process.env,
        windowsHide: true
      });
    } catch (err) {
      return resolve({ code: -1, stdout, stderr: err.message });
    }
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + err.message });
    });
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (handlers.onStdout) handlers.onStdout(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (handlers.onStderr) handlers.onStderr(text);
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function fetchMetadata(url) {
  if (!isSupportedUrl(url)) {
    return {
      url,
      title: '',
      uploader: '',
      duration: null,
      thumbnail: null,
      source: null,
      webpage_url: url,
      error: 'Only YouTube and SoundCloud links are supported.'
    };
  }

  const result = await runYtDlp([
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--extractor-args',
    `youtube:player_client=${YOUTUBE_METADATA_CLIENTS}`,
    url
  ]);

  let info = null;
  const raw = result.stdout.trim();
  if (raw) {
    try {
      info = JSON.parse(raw);
    } catch {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          info = JSON.parse(raw.slice(start, end + 1));
        } catch {
          info = null;
        }
      }
    }
  }

  if (!info) {
    const lastLine = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    return {
      url,
      title: '',
      uploader: '',
      duration: null,
      thumbnail: null,
      source: null,
      webpage_url: url,
      error: lastLine || `Could not read metadata (yt-dlp exit code ${result.code}).`
    };
  }

  const extractor = String(info.extractor_key || info.extractor || '').toLowerCase();
  return {
    url,
    title: info.title || info.track || '',
    uploader: info.uploader || info.channel || info.artist || '',
    duration: typeof info.duration === 'number' ? info.duration : null,
    thumbnail: pickThumbnail(info),
    source: extractor.includes('soundcloud') ? 'soundcloud' : 'youtube',
    webpage_url: info.webpage_url || url,
    error: null
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sanitizeFilename(name) {
  let value = String(name == null ? '' : name).normalize('NFC');
  value = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  value = value.replace(/[\/\\:*?"<>|]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!value) value = 'audio';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) value = '_' + value;
  if (value.length > 120) value = value.slice(0, 120).trim();
  return value || 'audio';
}

function escapeTemplate(name) {
  return name.replace(/%/g, '%%');
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function reserveFilename(base, used, dir) {
  let candidate = base;
  let counter = 2;
  while (
    used.has(candidate.toLowerCase()) ||
    (await fileExists(path.join(dir, candidate + '.mp3')))
  ) {
    candidate = `${base} (${counter++})`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function broadcast(job, payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of job.clients) {
    try {
      client.write(frame);
    } catch {
      job.clients.delete(client);
    }
  }
}

function serializeJob(job) {
  return {
    id: job.id,
    status: job.status,
    items: job.items.map((item) => ({
      url: item.url,
      finalName: item.finalName,
      status: item.status,
      percent: item.percent,
      file: item.file,
      error: item.error
    }))
  };
}

async function downloadItem(job, index) {
  const item = job.items[index];
  item.status = 'downloading';
  item.percent = 0;
  broadcast(job, { type: 'item', index, status: 'downloading', percent: 0 });

  const template = path.join(job.directory, escapeTemplate(item.finalName) + '.%(ext)s');
  const args = [
    '--no-playlist',
    '--newline',
    '--no-warnings',
    '--no-simulate',
    '--progress',
    '--extractor-args',
    `youtube:player_client=${YOUTUBE_DOWNLOAD_CLIENTS}`,
    '--format',
    'bestaudio/best',
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '0',
    '--output',
    template,
    item.url
  ];

  let outBuffer = '';
  let errBuffer = '';
  let lastPercent = -1;
  let lastError = '';

  const result = await runYtDlp(args, {
    onStdout: (text) => {
      outBuffer += text;
      const lines = outBuffer.split('\n');
      outBuffer = lines.pop();
      for (const line of lines) {
        const matches = [...line.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
        if (!matches.length) continue;
        const percent = parseFloat(matches[matches.length - 1][1]);
        if (percent >= lastPercent + 1) {
          lastPercent = percent;
          item.percent = percent;
          broadcast(job, { type: 'item', index, status: 'downloading', percent });
        }
      }
    },
    onStderr: (text) => {
      errBuffer += text;
      const lines = errBuffer.split('\n');
      errBuffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) lastError = line.trim();
      }
    }
  }, job.directory);

  const filePath = path.join(job.directory, item.finalName + '.mp3');
  if (result.code === 0 && (await fileExists(filePath))) {
    const stat = await fsp.stat(filePath);
    item.status = 'done';
    item.percent = 100;
    item.file = path.basename(filePath);
    item.size = stat.size;
    broadcast(job, {
      type: 'item',
      index,
      status: 'done',
      percent: 100,
      file: item.file,
      size: stat.size
    });
  } else {
    item.status = 'error';
    item.error =
      lastError ||
      result.stderr.trim().split('\n').filter(Boolean).pop() ||
      `yt-dlp exited with code ${result.code}`;
    broadcast(job, { type: 'item', index, status: 'error', error: item.error });
  }
}

function jobDonePayload(job) {
  const done = job.items.filter((item) => item.status === 'done').length;
  return {
    type: 'done',
    done,
    failed: job.items.length - done,
    items: serializeJob(job).items
  };
}

async function runJob(job) {
  let next = 0;
  const workers = Array.from({ length: Math.min(DL_CONCURRENCY, job.items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= job.items.length) return;
      if (job.items[index].status === 'error') continue;
      try {
        await downloadItem(job, index);
      } catch (err) {
        const item = job.items[index];
        item.status = 'error';
        item.error = err.message;
        broadcast(job, { type: 'item', index, status: 'error', error: err.message });
      }
    }
  });

  await Promise.all(workers);

  job.status = 'done';
  broadcast(job, jobDonePayload(job));
  setTimeout(() => jobs.delete(job.id), 60 * 60 * 1000).unref();
}

async function createJob(items) {
  const directory = downloadsDir;
  const used = new Set();
  const prepared = [];
  for (const item of items) {
    const url = String(item.url || '').trim();
    const base = sanitizeFilename(item.filename || item.title || 'audio');
    if (!isSupportedUrl(url)) {
      prepared.push({
        url,
        finalName: base,
        status: 'error',
        percent: 0,
        file: null,
        error: 'Only YouTube and SoundCloud links are supported.',
        size: null
      });
      continue;
    }
    const finalName = await reserveFilename(base, used, directory);
    prepared.push({
      url,
      finalName,
      status: 'queued',
      percent: 0,
      file: null,
      error: null,
      size: null
    });
  }
  if (!prepared.some((item) => item.status === 'queued')) return null;

  const job = {
    id: crypto.randomUUID(),
    directory,
    items: prepared,
    clients: new Set(),
    status: 'running',
    createdAt: Date.now()
  };
  jobs.set(job.id, job);
  runJob(job);
  return job;
}

async function listFiles() {
  const entries = await fsp.readdir(downloadsDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name.endsWith('.part') || entry.name.endsWith('.ytdl')) continue;
    try {
      const stat = await fsp.stat(path.join(downloadsDir, entry.name));
      files.push({
        name: entry.name,
        size: stat.size,
        mtime: stat.mtimeMs,
        url: '/api/files/' + encodeURIComponent(entry.name)
      });
    } catch {
      /* ignore unreadable files */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

function contentDisposition(type, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function serveDownloadFile(req, res, name, download) {
  const safe = path.basename(name);
  if (!name || safe !== name || name.includes('\0')) {
    return sendError(res, 400, 'Invalid file name');
  }
  const filePath = path.join(downloadsDir, safe);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendError(res, 404, 'File not found');
  }
  if (!stat.isFile()) return sendError(res, 404, 'Not a file');

  const ext = path.extname(safe).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', safe)
  };

  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [startRaw, endRaw] = range.replace(/^bytes=/, '').split('-');
    let start = startRaw ? parseInt(startRaw, 10) : 0;
    let end = endRaw ? parseInt(endRaw, 10) : stat.size - 1;
    if (
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start > end ||
      start >= stat.size
    ) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    end = Math.min(end, stat.size - 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = end - start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function openDownloadsFolder() {
  let cmd;
  let args;
  if (process.platform === 'win32') {
    cmd = 'explorer.exe';
    args = [downloadsDir];
  } else if (process.platform === 'darwin') {
    cmd = 'open';
    args = [downloadsDir];
  } else if (isWsl()) {
    cmd = 'explorer.exe';
    args = [wslToWindowsPath(downloadsDir)];
  } else {
    cmd = 'xdg-open';
    args = [downloadsDir];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function handleEvents(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify({ type: 'snapshot', job: serializeJob(job) })}\n\n`);

  job.clients.add(res);

  if (job.status !== 'running') {
    res.write(`data: ${JSON.stringify(jobDonePayload(job))}\n\n`);
    job.clients.delete(res);
    res.end();
    return;
  }

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 15000);
  keepAlive.unref?.();

  req.on('close', () => {
    clearInterval(keepAlive);
    job.clients.delete(res);
  });
}

async function handleApi(req, res, url, pathname) {
  if (pathname === '/api/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      directory: downloadsDir,
      ytdlp: YTDLP,
      platform: process.platform,
      wsl: isWsl(),
      downloadConcurrency: DL_CONCURRENCY,
      metadataConcurrency: META_CONCURRENCY
    });
  }

  if (pathname === '/api/settings/folder' && req.method === 'POST') {
    try {
      const selected = await pickFolder(downloadsDir);
      if (!selected) {
        return sendJson(res, 200, { cancelled: true, directory: downloadsDir });
      }
      const directory = await applyDownloadsDir(selected);
      return sendJson(res, 200, { cancelled: false, directory });
    } catch (err) {
      return sendError(res, 400, err.message || 'Could not select that folder.');
    }
  }

  if (pathname === '/api/metadata' && req.method === 'POST') {
    const body = await readBody(req);
    const urls = Array.isArray(body.urls) ? body.urls : [];
    const clean = [...new Set(urls.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 100);
    if (!clean.length) return sendError(res, 400, 'No links provided.');
    const items = await mapLimit(clean, META_CONCURRENCY, fetchMetadata);
    return sendJson(res, 200, { items });
  }

  if (pathname === '/api/download' && req.method === 'POST') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return sendError(res, 400, 'No tracks selected.');
    const job = await createJob(items);
    if (!job) return sendError(res, 400, 'No valid YouTube or SoundCloud links were provided.');
    return sendJson(res, 200, { jobId: job.id, job: serializeJob(job) });
  }

  const eventsMatch = pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/events$/i);
  if (eventsMatch && req.method === 'GET') {
    const job = jobs.get(eventsMatch[1]);
    if (!job) return sendError(res, 404, 'Job not found or expired.');
    return handleEvents(req, res, job);
  }

  if (pathname === '/api/files' && req.method === 'GET') {
    const files = await listFiles();
    return sendJson(res, 200, { directory: downloadsDir, files });
  }

  if (pathname === '/api/open-folder' && req.method === 'POST') {
    return sendJson(res, 200, { ok: openDownloadsFolder() });
  }

  if (pathname.startsWith('/api/files/')) {
    const name = pathname.slice('/api/files/'.length);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const download = url.searchParams.get('download') === '1';
      return serveDownloadFile(req, res, name, download);
    }
    if (req.method === 'DELETE') {
      const safe = path.basename(name);
      if (!name || safe !== name || name.includes('\0')) {
        return sendError(res, 400, 'Invalid file name');
      }
      try {
        await fsp.unlink(path.join(downloadsDir, safe));
        return sendJson(res, 200, { ok: true });
      } catch {
        return sendError(res, 404, 'File not found');
      }
    }
  }

  return sendError(res, 404, 'Not found');
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'Method not allowed');
  }
  const relative = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, '.' + relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendError(res, 403, 'Forbidden');
  }
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendError(res, 404, 'Not found');
  }
  if (!stat.isFile()) return sendError(res, 404, 'Not found');
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, url, pathname);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      const message = err.message || 'Internal server error';
      let status = 500;
      if (message === 'Invalid JSON body') status = 400;
      if (message === 'Request body too large') status = 413;
      sendError(res, status, message);
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DJ Playlist Downloader running at http://${HOST}:${PORT}`);
  console.log(`Downloads folder: ${downloadsDir}`);
});

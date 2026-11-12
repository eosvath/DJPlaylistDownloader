'use strict';

const state = {
  rows: [],
  files: [],
  busy: false,
  downloading: false,
  pickingFolder: false,
  activeJob: null
};

const el = (id) => document.getElementById(id);

const ICONS = {
  music:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="17" cy="16" r="3"></circle></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>',
  play:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16l13-8z"></path></svg>'
};

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'row-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function api(path, options) {
  const res = await fetch(path, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message, type = 'info') {
  const box = el('toasts');
  const item = document.createElement('div');
  item.className = 'toast' + (type === 'error' ? ' error' : type === 'warn' ? ' warn' : '');
  item.textContent = message;
  box.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateY(6px)';
    item.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    setTimeout(() => item.remove(), 220);
  }, 4200);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(timestamp) {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function sourceLabel(source) {
  if (source === 'youtube') return 'YouTube';
  if (source === 'soundcloud') return 'SoundCloud';
  return 'Unknown';
}

function statusInfo(row) {
  switch (row.status) {
    case 'loading':
      return { label: 'Fetching title…', className: 'loading' };
    case 'ready':
      return { label: 'Ready', className: 'ready' };
    case 'queued':
      return { label: 'Queued', className: 'queued' };
    case 'downloading':
      return {
        label: row.percent >= 100 ? 'Converting…' : `Downloading ${Math.round(row.percent || 0)}%`,
        className: 'downloading'
      };
    case 'done':
      return { label: 'Saved', className: 'done' };
    case 'error':
      return { label: row.error || 'Error', className: 'error' };
    default:
      return { label: 'Pending', className: '' };
  }
}

function createThumbPlaceholder() {
  const div = document.createElement('div');
  div.className = 'thumb-placeholder';
  div.innerHTML = ICONS.music;
  return div;
}

function renderTable() {
  const tbody = el('trackBody');
  tbody.textContent = '';
  const hasRows = state.rows.length > 0;
  el('emptyState').hidden = hasRows;
  el('trackTable').hidden = !hasRows;
  el('rowCount').textContent = state.rows.length;

  state.rows.forEach((row, index) => {
    const tr = document.createElement('tr');

    const indexTd = document.createElement('td');
    indexTd.className = 'cell-index';
    indexTd.textContent = String(index + 1);
    tr.appendChild(indexTd);

    const trackTd = document.createElement('td');
    const trackCell = document.createElement('div');
    trackCell.className = 'track-cell';

    let thumb;
    if (row.thumbnail) {
      thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = row.thumbnail;
      thumb.alt = '';
      thumb.loading = 'lazy';
      thumb.referrerPolicy = 'no-referrer';
      thumb.addEventListener('error', () => {
        thumb.replaceWith(createThumbPlaceholder());
      });
    } else {
      thumb = createThumbPlaceholder();
    }
    trackCell.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'track-meta';
    const title = document.createElement('div');
    title.className = 'track-title';
    const sub = document.createElement('div');
    sub.className = 'track-sub';
    meta.appendChild(title);
    meta.appendChild(sub);
    trackCell.appendChild(meta);
    trackTd.appendChild(trackCell);
    tr.appendChild(trackTd);

    const sourceTd = document.createElement('td');
    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'source-badge unknown';
    sourceTd.appendChild(sourceBadge);
    tr.appendChild(sourceTd);

    const fileTd = document.createElement('td');
    fileTd.className = 'filename-cell';
    const fileWrap = document.createElement('div');
    fileWrap.className = 'filename-wrap';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = row.title || '';
    titleInput.placeholder = row.originalTitle || 'Filename';
    titleInput.spellcheck = false;
    titleInput.addEventListener('input', () => {
      row.title = titleInput.value;
    });
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') titleInput.blur();
    });
    const ext = document.createElement('span');
    ext.className = 'ext';
    ext.textContent = '.mp3';
    fileWrap.appendChild(titleInput);
    fileWrap.appendChild(ext);
    fileTd.appendChild(fileWrap);
    tr.appendChild(fileTd);

    const statusTd = document.createElement('td');
    statusTd.className = 'status-cell';
    const statusEl = document.createElement('div');
    statusEl.className = 'status';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const statusText = document.createElement('span');
    statusText.className = 'status-text';
    statusEl.appendChild(dot);
    statusEl.appendChild(statusText);
    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.hidden = true;
    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    progress.appendChild(progressFill);
    statusTd.appendChild(statusEl);
    statusTd.appendChild(progress);
    tr.appendChild(statusTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'col-actions';
    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'icon-btn';
    downloadBtn.title = 'Download this MP3';
    downloadBtn.setAttribute('aria-label', 'Download this MP3');
    downloadBtn.innerHTML = ICONS.download;
    downloadBtn.addEventListener('click', () => startDownload([row]));

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'icon-btn danger';
    removeBtn.title = 'Remove';
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.innerHTML = ICONS.trash;
    removeBtn.addEventListener('click', () => {
      if (state.downloading) return;
      state.rows = state.rows.filter((item) => item !== row);
      renderTable();
      updateSummary();
      updateButtons();
    });

    actions.appendChild(downloadBtn);
    actions.appendChild(removeBtn);
    actionsTd.appendChild(actions);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);

    row.refs = {
      tr,
      titleEl: title,
      subEl: sub,
      sourceBadge,
      titleInput,
      fileWrap,
      statusEl,
      statusText,
      progress,
      progressFill,
      downloadBtn,
      removeBtn
    };

    updateRow(row);
  });
}

function updateRow(row) {
  const refs = row.refs;
  if (!refs) return;

  if (row.status === 'loading') {
    refs.titleEl.textContent = 'Fetching title…';
    refs.subEl.textContent = row.url;
  } else {
    refs.titleEl.textContent = row.originalTitle || row.title || 'Untitled';
    const bits = [];
    if (row.uploader) bits.push(row.uploader);
    if (row.duration) bits.push(formatDuration(row.duration));
    if (row.file) bits.push(row.file);
    refs.subEl.textContent = bits.join(' · ') || row.url;
  }

  refs.sourceBadge.className = 'source-badge ' + (row.source || 'unknown');
  refs.sourceBadge.textContent = sourceLabel(row.source);

  if (document.activeElement !== refs.titleInput) {
    refs.titleInput.value = row.title || '';
  }
  refs.titleInput.placeholder = row.originalTitle || 'Filename';
  refs.titleInput.disabled = row.status === 'loading' || row.status === 'downloading';

  const info = statusInfo(row);
  refs.statusEl.className = 'status ' + info.className;
  refs.statusText.textContent = info.label;
  refs.statusText.title = info.label;

  const showProgress = row.status === 'downloading' || row.status === 'queued';
  refs.progress.hidden = !showProgress;
  refs.progressFill.style.width = `${Math.max(0, Math.min(100, row.percent || 0))}%`;

  refs.downloadBtn.disabled =
    state.downloading || row.status === 'loading' || row.status === 'queued' || row.status === 'downloading';
  refs.removeBtn.disabled = state.downloading;
}

function updateAllRows() {
  for (const row of state.rows) updateRow(row);
}

function eligibleRows() {
  return state.rows.filter(
    (row) =>
      row.url &&
      row.status !== 'loading' &&
      row.status !== 'queued' &&
      row.status !== 'downloading' &&
      row.status !== 'done'
  );
}

function updateSummary() {
  const summary = el('summary');
  if (state.busy) {
    summary.textContent = 'Fetching titles…';
    return;
  }
  if (state.downloading) {
    const active = state.rows.filter((row) => row.status === 'downloading' || row.status === 'queued').length;
    const done = state.rows.filter((row) => row.status === 'done').length;
    summary.textContent = `Downloading · ${done} done, ${active} in progress`;
    return;
  }
  if (!state.rows.length) {
    summary.textContent = '';
    return;
  }
  const youtube = state.rows.filter((row) => row.source === 'youtube').length;
  const soundcloud = state.rows.filter((row) => row.source === 'soundcloud').length;
  const errors = state.rows.filter((row) => row.status === 'error').length;
  const parts = [`${state.rows.length} track${state.rows.length === 1 ? '' : 's'} loaded`];
  if (youtube) parts.push(`${youtube} YouTube`);
  if (soundcloud) parts.push(`${soundcloud} SoundCloud`);
  if (errors) parts.push(`${errors} failed`);
  summary.textContent = parts.join(' · ');
}

function updateButtons() {
  const busy = state.busy || state.downloading || state.pickingFolder;
  el('loadBtn').disabled = busy;
  el('downloadAllBtn').disabled = busy || eligibleRows().length === 0;
  el('clearBtn').disabled = busy;
  el('linksInput').disabled = busy;
  el('changeFolderBtn').disabled = busy;
}

async function loadTracks() {
  if (state.busy || state.downloading) return;
  const urls = [
    ...new Set(
      el('linksInput')
        .value.split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  ];

  if (!urls.length) {
    toast('Paste at least one link first.', 'warn');
    return;
  }
  if (urls.length > 100) {
    toast('Please load at most 100 links at a time.', 'warn');
    return;
  }

  state.busy = true;
  state.rows = urls.map((url) => ({
    id: newId(),
    url,
    title: '',
    originalTitle: '',
    uploader: '',
    duration: null,
    thumbnail: null,
    source: null,
    status: 'loading',
    percent: 0,
    error: null,
    file: null
  }));
  renderTable();
  updateSummary();
  updateButtons();

  try {
    const data = await api('/api/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls })
    });
    const items = Array.isArray(data.items) ? data.items : [];
    items.forEach((item, index) => {
      const row = state.rows[index];
      if (!row) return;
      row.originalTitle = item.title || '';
      row.title = item.title || '';
      row.uploader = item.uploader || '';
      row.duration = item.duration;
      row.thumbnail = item.thumbnail || null;
      row.source = item.source || null;
      if (item.error) {
        row.status = 'error';
        row.error = item.error;
      } else {
        row.status = 'ready';
        row.error = null;
      }
    });
    for (const row of state.rows) {
      if (row.status === 'loading') {
        row.status = 'error';
        row.error = 'No metadata returned for this link.';
      }
    }
    renderTable();
  } catch (err) {
    for (const row of state.rows) {
      row.status = 'error';
      row.error = err.message;
    }
    renderTable();
    toast(err.message, 'error');
  } finally {
    state.busy = false;
    updateSummary();
    updateButtons();
  }
}

function applyJobItem(row, item) {
  if (!row || !item) return;
  if (item.status) row.status = item.status;
  if (typeof item.percent === 'number') row.percent = item.percent;
  if (item.file) row.file = item.file;
  if (item.error) row.error = item.error;
  if (item.status === 'done') row.percent = 100;
  updateRow(row);
  updateSummary();
}

async function startDownload(rows) {
  if (state.downloading) return;
  const targets = rows.filter((row) => row && row.url);
  if (!targets.length) {
    toast('No downloadable tracks selected.', 'warn');
    return;
  }

  for (const row of targets) {
    row.status = 'queued';
    row.percent = 0;
    row.error = null;
    row.file = null;
    updateRow(row);
  }

  state.downloading = true;
  updateButtons();
  updateSummary();

  try {
    const data = await api('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: targets.map((row) => ({
          url: row.url,
          filename: row.title || row.originalTitle || 'audio'
        }))
      })
    });
    subscribeToJob(data.jobId, targets);
  } catch (err) {
    state.downloading = false;
    for (const row of targets) {
      row.status = 'error';
      row.error = err.message;
      updateRow(row);
    }
    updateButtons();
    updateSummary();
    toast(err.message, 'error');
  }
}

function subscribeToJob(jobId, rows) {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  let failures = 0;
  state.activeJob = source;

  source.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    failures = 0;

    if (message.type === 'snapshot') {
      const items = (message.job && message.job.items) || [];
      items.forEach((item, index) => applyJobItem(rows[index], item));
      updateButtons();
    } else if (message.type === 'item') {
      applyJobItem(rows[message.index], message);
    } else if (message.type === 'done') {
      if (Array.isArray(message.items)) {
        message.items.forEach((item, index) => applyJobItem(rows[index], item));
      }
      source.close();
      state.activeJob = null;
      state.downloading = false;
      updateAllRows();
      updateButtons();
      updateSummary();
      refreshFiles();
      const done = message.done || 0;
      const failed = message.failed || 0;
      if (failed) {
        toast(`Downloaded ${done} file${done === 1 ? '' : 's'}, ${failed} failed.`, 'warn');
      } else {
        toast(`Downloaded ${done} file${done === 1 ? '' : 's'} to the downloads folder.`);
      }
    }
  };

  source.onerror = () => {
    failures += 1;
    if (failures > 4) {
      source.close();
      state.activeJob = null;
      state.downloading = false;
      updateAllRows();
      updateButtons();
      updateSummary();
      toast('Lost connection to the download job.', 'error');
    }
  };
}

function clearAll() {
  if (state.busy || state.downloading) return;
  state.rows = [];
  el('linksInput').value = '';
  renderTable();
  updateSummary();
  updateButtons();
}

async function refreshFiles() {
  try {
    const data = await api('/api/files');
    state.files = Array.isArray(data.files) ? data.files : [];
    if (data.directory) {
      el('folderPath').textContent = data.directory;
      el('folderPath').title = data.directory;
    }
    renderFiles();
  } catch {
    /* keep the previous listing */
  }
}

function renderFiles() {
  const list = el('fileList');
  list.textContent = '';
  el('fileCount').textContent = state.files.length;

  if (!state.files.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-files';
    empty.textContent = 'No files yet. Download a track and it will appear here.';
    list.appendChild(empty);
    return;
  }

  for (const file of state.files) {
    const chip = document.createElement('div');
    chip.className = 'file-chip';

    const iconBox = document.createElement('div');
    iconBox.className = 'file-icon';
    iconBox.innerHTML = ICONS.file;

    const info = document.createElement('div');
    info.className = 'file-info';

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'file-name';
    name.textContent = file.name;
    name.title = `Play ${file.name}`;
    name.addEventListener('click', () => playFile(file));

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = `${formatBytes(file.size)} · ${formatDate(file.mtime)}`;

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'icon-btn';
    playBtn.title = 'Play';
    playBtn.setAttribute('aria-label', 'Play');
    playBtn.innerHTML = ICONS.play;
    playBtn.addEventListener('click', () => playFile(file));

    const downloadLink = document.createElement('a');
    downloadLink.className = 'icon-btn';
    downloadLink.href = file.url + '?download=1';
    downloadLink.title = 'Download';
    downloadLink.setAttribute('aria-label', 'Download');
    downloadLink.innerHTML = ICONS.download;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'icon-btn danger';
    deleteBtn.title = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete');
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.addEventListener('click', () => deleteFile(file));

    actions.appendChild(playBtn);
    actions.appendChild(downloadLink);
    actions.appendChild(deleteBtn);

    chip.appendChild(iconBox);
    chip.appendChild(info);
    chip.appendChild(actions);
    list.appendChild(chip);
  }
}

async function deleteFile(file) {
  if (!window.confirm(`Delete "${file.name}"?`)) return;
  try {
    await api('/api/files/' + encodeURIComponent(file.name), { method: 'DELETE' });
    toast(`Deleted ${file.name}`);
    refreshFiles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function playFile(file) {
  const bar = el('playerBar');
  bar.hidden = false;
  el('playerTitle').textContent = file.name;
  const audio = el('playerAudio');
  audio.src = file.url;
  audio.play().catch(() => {
    /* autoplay can be blocked; the controls are visible */
  });
}

function closePlayer() {
  const audio = el('playerAudio');
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  el('playerBar').hidden = true;
}

async function changeFolder() {
  if (state.pickingFolder || state.downloading || state.busy) return;
  const btn = el('changeFolderBtn');
  const original = btn.innerHTML;
  state.pickingFolder = true;
  btn.disabled = true;
  btn.textContent = 'Choosing…';
  updateButtons();

  try {
    const data = await api('/api/settings/folder', { method: 'POST' });
    if (data.cancelled) {
      toast('Folder selection cancelled.', 'warn');
    } else {
      el('folderPath').textContent = data.directory;
      el('folderPath').title = data.directory;
      await refreshFiles();
      toast(`Downloads will now be saved to ${data.directory}`);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    state.pickingFolder = false;
    btn.innerHTML = original;
    updateButtons();
  }
}

async function openFolder() {
  try {
    const data = await api('/api/open-folder', { method: 'POST' });
    if (data.ok === false) {
      toast('Could not open the folder automatically. Use the path shown above.', 'warn');
    } else {
      toast('Opening the downloads folder…');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

el('loadBtn').addEventListener('click', loadTracks);
el('downloadAllBtn').addEventListener('click', () => startDownload(eligibleRows()));
el('clearBtn').addEventListener('click', clearAll);
el('refreshFilesBtn').addEventListener('click', refreshFiles);
el('changeFolderBtn').addEventListener('click', changeFolder);
el('openFolderBtn').addEventListener('click', openFolder);
el('playerClose').addEventListener('click', closePlayer);

el('linksInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    loadTracks();
  }
});

renderTable();
updateButtons();
updateSummary();
refreshFiles();
setInterval(refreshFiles, 20000);

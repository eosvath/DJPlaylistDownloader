# DJ Playlist Downloader

A small local web app that turns YouTube and SoundCloud links into high-quality MP3 files.

Paste one link per line, load the tracks, edit the filenames, and download everything at once. Files are saved directly to a folder on your machine — no per-file browser download prompts.

## Requirements

- **Node.js 18 or newer**
- **yt-dlp** — used to read titles and download audio
- **ffmpeg** — used by yt-dlp to convert audio to MP3

Check that everything is available:

```bash
node --version
yt-dlp --version
ffmpeg -version
```

## Start the app

There are no npm dependencies to install. From the project folder:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

The server keeps running in the terminal. Press `Ctrl+C` to stop it.

## How to use it

1. Paste YouTube and/or SoundCloud links into the text area, one per line.
2. Click **Load tracks**. The app fetches each title and shows it in an editable filename field.
3. Edit any filenames you want to change.
4. Click **Download all MP3s**, or use the download button on an individual row.
5. Files are saved directly into the downloads folder shown at the top of the page. The folder contents appear there automatically, with play, download, and delete controls.

## Changing the downloads folder

Click **Change folder** in the downloads panel at the top of the page. A native folder picker opens:

- **Windows / WSL** — Windows folder dialog via PowerShell
- **Linux desktop** — `zenity` or `kdialog`
- **macOS** — native folder chooser via AppleScript

The chosen folder is saved to `.djpd-config.json` in the project folder and reused the next time the app starts. Every new download uses the currently selected folder.

Use **Open folder** to open the current download folder in your OS file manager.

## Configuration

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `127.0.0.1` | Interface to bind |
| `DOWNLOADS_DIR` | `./downloads` | Initial download folder when no folder has been saved in the UI |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp executable |
| `YOUTUBE_METADATA_CLIENTS` | `android_vr,android,web` | yt-dlp YouTube clients used to read titles |
| `YOUTUBE_DOWNLOAD_CLIENTS` | `android` | yt-dlp YouTube client used for downloads |
| `DOWNLOAD_CONCURRENCY` | `2` | Number of simultaneous downloads |

Example:

```bash
PORT=8080 DOWNLOAD_CONCURRENCY=1 npm start
```

The saved folder setting (`.djpd-config.json`) takes priority over `DOWNLOADS_DIR`.

## Troubleshooting

- **YouTube links fail to load or download** — update yt-dlp (`yt-dlp -U` or your package manager). YouTube changes its API frequently. You can also try a different client, for example `YOUTUBE_DOWNLOAD_CLIENTS=android,web npm start`.
- **“No folder picker found”** — on a Linux desktop install `zenity` or `kdialog`, or set `DOWNLOADS_DIR` and restart.
- **WSL** — the app is reachable from Windows at `http://127.0.0.1:3000`. If it is not, run with `HOST=0.0.0.0 npm start` and use the WSL IP address.
- **ffmpeg errors** — make sure `ffmpeg` is installed and available on `PATH`.

## Project layout

```text
server.js            HTTP server, metadata lookup, download jobs, folder picker
public/              Web UI (HTML, CSS, JavaScript)
downloads/           Default downloads folder (created automatically)
.djpd-config.json    Saved folder selection (created by the app, not committed)
```

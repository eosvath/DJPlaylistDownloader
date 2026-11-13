# DJ Playlist Downloader

A small local web app that turns YouTube and SoundCloud links into high-quality MP3 files.

Paste one link per line, load the tracks, edit the filenames, and download everything at once. Files are saved directly to a folder on your machine — no per-file browser download prompts.

## Prerequisites

You need these four programs:

- **Git** — to download (clone) the project
- **Node.js 18 or newer** — runs the local web server
- **yt-dlp** — reads titles and downloads audio
- **ffmpeg** — converts the audio to MP3

If any of these are new to you, install them with the steps for your operating system below. You only need to do this once.

### Windows

Open **Windows Terminal** or **PowerShell** from the Start menu.

1. Install everything with `winget` (built into current Windows versions):

   ```powershell
   winget install --id Git.Git -e --source winget
   winget install --id OpenJS.NodeJS.LTS -e --source winget
   winget install --id Gyan.FFmpeg -e --source winget
   winget install --id yt-dlp.yt-dlp -e --source winget
   ```

2. Close the terminal window and open a new one so the new programs are found.
3. Check the installation:

   ```powershell
   git --version
   node --version
   yt-dlp --version
   ffmpeg -version
   ```

If `winget` is not available, install **App Installer** from the Microsoft Store, or install each program from its official website. Make sure `yt-dlp` and `ffmpeg` are on your `PATH`.

### WSL (Ubuntu)

Only use this section if you want to run the app inside Windows Subsystem for Linux. Open **Ubuntu** from the Start menu (or install it first with `wsl --install -d Ubuntu` in an Administrator PowerShell and restart).

1. Update Ubuntu and install the basic tools:

   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git curl python3 ffmpeg
   ```

2. Install the current Node.js LTS release:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt install -y nodejs
   ```

3. Install the latest yt-dlp:

   ```bash
   sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
   sudo chmod a+rx /usr/local/bin/yt-dlp
   ```

4. Check the installation:

   ```bash
   git --version
   node --version
   yt-dlp --version
   ffmpeg -version
   ```

When running inside WSL, use the WSL terminal for every command in this README.

### macOS

Open the **Terminal** app.

1. Install [Homebrew](https://brew.sh) if you do not have it:

   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

   On Apple Silicon Macs, Homebrew may print two extra commands at the end of the installation. Run those commands so the `brew` command is available.

2. Install Git, Node.js, yt-dlp, and ffmpeg:

   ```bash
   brew install git node yt-dlp ffmpeg
   ```

3. Check the installation:

   ```bash
   git --version
   node --version
   yt-dlp --version
   ffmpeg -version
   ```

## Get the project

In the terminal, download the project and move into its folder:

```bash
git clone https://github.com/eosvath/DJPlaylistDownloader.git
cd DJPlaylistDownloader
```

If you are not comfortable with Git yet, you can also download the repository as a ZIP from GitHub, extract it, and open a terminal inside the extracted folder.

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

The default settings live in `config.json` in the project folder:

```json
{
  "host": "127.0.0.1",
  "port": 3000,
  "downloadConcurrency": 10,
  "metadataConcurrency": 4
}
```

| Key | Environment variable | Default | Purpose |
| --- | --- | --- | --- |
| `host` | `HOST` | `127.0.0.1` | Interface to bind |
| `port` | `PORT` | `3000` | HTTP port |
| `downloadConcurrency` | `DOWNLOAD_CONCURRENCY` | `10` | Number of simultaneous downloads |
| `metadataConcurrency` | `METADATA_CONCURRENCY` | `4` | Number of simultaneous title lookups |

Edit `config.json`, then restart the app to apply the change. Environment variables take priority over `config.json`, which is handy for a one-off run.

These environment variables are also available:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOWNLOADS_DIR` | `./downloads` | Initial download folder when no folder has been saved in the UI |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp executable |
| `YOUTUBE_METADATA_CLIENTS` | `android_vr,android,web` | yt-dlp YouTube clients used to read titles |
| `YOUTUBE_DOWNLOAD_CLIENTS` | `android` | yt-dlp YouTube client used for downloads |

Example of overriding the config file for one run:

```bash
PORT=8080 DOWNLOAD_CONCURRENCY=3 npm start
```

Each simultaneous download runs its own yt-dlp and ffmpeg process. The default of `10` works well on a normal connection, but you can lower it on a slow machine or if YouTube starts throttling requests. The saved folder setting (`.djpd-config.json`) takes priority over `DOWNLOADS_DIR`.

## Troubleshooting

- **YouTube links fail to load or download** — update yt-dlp (`yt-dlp -U` or your package manager). YouTube changes its API frequently. You can also try a different client, for example `YOUTUBE_DOWNLOAD_CLIENTS=android,web npm start`.
- **“No folder picker found”** — on a Linux desktop install `zenity` or `kdialog`, or set `DOWNLOADS_DIR` and restart.
- **WSL** — the app is reachable from Windows at `http://127.0.0.1:3000`. If it is not, run with `HOST=0.0.0.0 npm start` and use the WSL IP address.
- **ffmpeg errors** — make sure `ffmpeg` is installed and available on `PATH`.

## Project layout

```text
server.js            HTTP server, metadata lookup, download jobs, folder picker
public/              Web UI (HTML, CSS, JavaScript)
config.json          Default host, port, and concurrency settings
downloads/           Default downloads folder (created automatically)
.djpd-config.json    Saved folder selection (created by the app, not committed)
```

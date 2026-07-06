# Windows Port

Make Exocortex downloadable as a single executable for Windows users.
No Bun, no WSL, no setup — just download and run.

## Plan

### ~~1. Platform-abstract socket paths~~ ✅
`shared/src/paths.ts` — `socketPath()` should return a Windows named pipe
(`\\.\pipe\exocortexd`) on Windows instead of a Unix socket file path.
Gate on `os.platform()`. Named pipes work with Node/Bun's `net` module
transparently — no code changes needed in `server.ts` or `client.ts`.

### ~~2. Platform-abstract the bash tool~~ ✅
`daemon/src/tools/bash.ts` — on Windows, spawn `powershell -Command` (or
`cmd.exe /c`) instead of `bash -c`. The AI adapts to the OS automatically.
Also fix process group handling: Windows doesn't have `kill(-pgid)`, use
`taskkill /T /PID` or just `child.kill()`.

### ~~3. Platform-abstract clipboard~~ ✅
`tui/src/clipboard.ts` — add a `powershell` backend that uses
`powershell -Command Get-Clipboard` for text and image clipboard reading.

### ~~4. Replace hardcoded `/tmp/`~~ ✅
`daemon/src/tools/bash.ts` uses `/tmp/exocortex-bash-*.txt` for spill files.
Replace with `os.tmpdir()` which returns `C:\Users\...\AppData\Local\Temp`
on Windows.

### ~~5. Handle signals gracefully~~ ✅
Windows only sends SIGINT (Ctrl+C). SIGTERM doesn't exist. Add
`process.on("exit", cleanup)` as a fallback alongside the existing
SIGINT/SIGTERM handlers in `daemon/src/main.ts`.

### ~~6. Cross-compile from Linux~~ ✅
Set up build commands:
```bash
bun build --compile --target=bun-windows-x64 daemon/src/main.ts --outfile dist/exocortexd.exe
bun build --compile --target=bun-windows-x64 tui/src/main.ts --outfile dist/exocortex.exe
bun build --compile --target=bun-windows-x64 cli/src/main.ts --outfile dist/exo.exe
```
Add a `make windows` target to the Makefile.

### ~~7. Create a launcher~~ ✅
A single entry-point `.exe` that:
- Starts `exocortexd.exe` in the background (hidden console)
- Launches `exocortex.exe` (TUI) in the current console window
- Kills the daemon on exit

This could be a small Go/C program or a compiled Bun script. The launcher
is what the user double-clicks — it opens a console window with the TUI
ready to go. Alternatively, a `.bat` wrapper works for v1.

### ~~8. Skip non-essential Linux features for v1~~ ✅
These can be left as no-ops or skipped entirely on Windows:
- **Cron scheduler** — scripts are `.sh`, needs bash. Disable on Windows.
- **External tools** (discord-cli, gmail-cli, etc.) — Linux-specific. Disable on Windows.
- **systemd integration** — not applicable. Daemon is managed by the launcher.
- **OSC 777 mouseshape** — st-specific, harmlessly ignored by Windows Terminal.

## v2 — Remaining Windows gaps

v1 is complete (all items above verified in code). Still open, roughly in order of value:

### 1. External tools on Windows
`daemon/src/external-tools-daemon-process.ts` hard-returns `false` on win32,
so discord-cli/gmail-cli etc. never start. Port the process supervisor
(spawn/kill/watch) to Windows semantics; tools themselves are Bun scripts and
should mostly just run.

### ~~2. Voice recording~~ ✅
Windows recorder: `ffmpeg -f dshow` (first detected audio device, override
with `EXOCORTEX_VOICE_DSHOW_DEVICE`), stopped gracefully via `q` on stdin.
Transcription backend is now configurable (`transcription.backend` in
config.json): `whisper-local` (default) posts to a local whisper.cpp server
and auto-starts `whisper-server` from the checkout (`transcription.whisperLocal.dir`,
`$WHISPER_CPP_DIR`, or `<repo>/../../whispercpp/whisper.cpp`); `openai` uses
the hosted transcription API as before.

### 3. Cron scripts are `.sh`
The scheduler itself runs on Windows (exec-bit check is skipped in
`daemon/src/scheduler.ts`), but shipped example jobs are bash scripts.
Support `.ps1`/`.bat` job files, or document that jobs must be
Windows-runnable.

### ~~4. Launcher robustness~~ ✅
`scripts/exocortex.bat` now captures the daemon PID via
`Start-Process -PassThru` and kills only that PID on exit (graceful
`taskkill /PID` first, then `/F` fallback).

### 5. Distribution polish
- Unsigned `.exe` trips SmartScreen — sign, or document the "More info → Run anyway" flow.
- GitHub Actions release job running `make windows` and uploading the zip, so releases aren't hand-built.
- Optional: `winget` manifest once releases are automated.

## Notes
- Users need **Windows Terminal** (pre-installed on Win11, free download on Win10).
  The TUI uses ANSI features (alt screen, mouse, kitty keyboard, truecolor)
  that the old `conhost.exe` doesn't support well.
- Each compiled `.exe` is ~90MB because it embeds the Bun runtime. Acceptable.
- Auth flow (`exocortexd login`) needs to work on Windows — it opens a browser
  for OAuth. `open` → `start` on Windows, or use `Bun.openInEditor` / similar.

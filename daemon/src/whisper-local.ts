/**
 * Self-hosted whisper.cpp transcription backend.
 *
 * POSTs WAV audio to a local whisper-server (`/inference`). If the server
 * isn't running, starts it from the configured whisper.cpp checkout so the
 * model is loaded once and reused across transcriptions.
 *
 * Config (config/config.json → transcription.whisperLocal) and env overrides:
 *   url   — server base URL            (default http://127.0.0.1:8910)
 *   dir   — whisper.cpp checkout       (default $WHISPER_CPP_DIR or <repo>/../../whispercpp/whisper.cpp)
 *   model — ggml model file            (default $WHISPER_MODEL or <dir>/models/ggml-base.en.bin)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readExocortexConfig, type WhisperLocalConfig } from "@exocortex/shared/config";
import { repoRoot } from "@exocortex/shared/paths";
import { log } from "./log";

const DEFAULT_URL = "http://127.0.0.1:8910";
const STARTUP_TIMEOUT_MS = 30_000;

export interface WhisperLocalPaths {
  url: string;
  serverExe: string;
  model: string;
}

export function resolveWhisperLocalPaths(
  config: WhisperLocalConfig | undefined = readExocortexConfig().transcription?.whisperLocal,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): WhisperLocalPaths {
  const dir = config?.dir || env.WHISPER_CPP_DIR || join(repoRoot(), "..", "..", "whispercpp", "whisper.cpp");
  const serverExe = platform === "win32"
    ? join(dir, "build", "bin", "Release", "whisper-server.exe")
    : join(dir, "build", "bin", "whisper-server");
  return {
    url: (config?.url || DEFAULT_URL).replace(/\/+$/, ""),
    serverExe,
    model: config?.model || env.WHISPER_MODEL || join(dir, "models", "ggml-base.en.bin"),
  };
}

let server: ChildProcess | null = null;
let starting: Promise<void> | null = null;

function killServer(): void {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
  }
  server = null;
}

process.once("exit", killServer);

async function serverAlive(url: string): Promise<boolean> {
  try {
    await fetch(url + "/", { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function startServer(paths: WhisperLocalPaths): Promise<void> {
  if (!existsSync(paths.serverExe)) {
    throw new Error(
      `whisper-server not found at ${paths.serverExe}. Build whisper.cpp, set transcription.whisperLocal.dir ` +
      `(or $WHISPER_CPP_DIR), or set transcription.backend to "openai" in config/config.json.`,
    );
  }
  if (!existsSync(paths.model)) {
    throw new Error(`whisper model not found at ${paths.model}. Download one or set transcription.whisperLocal.model.`);
  }

  const parsed = new URL(paths.url);
  const host = parsed.hostname || "127.0.0.1";
  const port = parsed.port || "8080";
  log("info", `whisper-local: starting ${paths.serverExe} (model ${paths.model}) on ${host}:${port}`);
  server = spawn(paths.serverExe, ["-m", paths.model, "--host", host, "--port", port], {
    stdio: "ignore",
  });
  server.once("error", () => { server = null; });
  server.once("exit", () => { server = null; });

  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!server) throw new Error("whisper-server exited during startup");
    if (await serverAlive(paths.url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  killServer();
  throw new Error("whisper-server did not become ready in time");
}

async function ensureServer(paths: WhisperLocalPaths): Promise<void> {
  if (await serverAlive(paths.url)) return;
  // Single-flight so concurrent transcriptions don't race to spawn two servers.
  starting ??= startServer(paths).finally(() => { starting = null; });
  await starting;
}

interface WhisperLocalOptions {
  filename?: string;
  signal?: AbortSignal;
}

export async function transcribeWhisperLocal(
  audioBytes: Uint8Array,
  mimeType = "audio/wav",
  options: WhisperLocalOptions = {},
): Promise<string> {
  const paths = resolveWhisperLocalPaths();
  await ensureServer(paths);

  const form = new FormData();
  form.append("file", new Blob([Buffer.from(audioBytes)], { type: mimeType }), options.filename ?? "audio.wav");
  form.append("response_format", "json");
  form.append("temperature", "0.0");

  const res = await fetch(`${paths.url}/inference`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`whisper-local transcription failed (${res.status}): ${body.slice(0, 500)}`);
  }
  const data = await res.json() as { text?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) {
    throw new Error("whisper-local transcription returned an empty result");
  }
  return text;
}

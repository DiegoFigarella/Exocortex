import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { resolveWhisperLocalPaths } from "./whisper-local";

describe("whisper-local path resolution", () => {
  test("config values win over env and defaults", () => {
    const paths = resolveWhisperLocalPaths(
      { url: "http://127.0.0.1:9999/", dir: "/opt/whisper.cpp", model: "/models/ggml-small.bin" },
      { WHISPER_CPP_DIR: "/ignored" },
      "linux",
    );
    expect(paths.url).toBe("http://127.0.0.1:9999");
    expect(paths.serverExe).toBe(join("/opt/whisper.cpp", "build", "bin", "whisper-server"));
    expect(paths.model).toBe("/models/ggml-small.bin");
  });

  test("falls back to env dir and default model, with Release exe path on Windows", () => {
    const paths = resolveWhisperLocalPaths(undefined, { WHISPER_CPP_DIR: "C:\\whisper.cpp" }, "win32");
    expect(paths.url).toBe("http://127.0.0.1:8910");
    expect(paths.serverExe).toBe(join("C:\\whisper.cpp", "build", "bin", "Release", "whisper-server.exe"));
    expect(paths.model).toBe(join("C:\\whisper.cpp", "models", "ggml-base.en.bin"));
  });
});

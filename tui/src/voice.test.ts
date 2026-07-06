import { describe, expect, test } from "bun:test";
import { applyVoicePlaceholder, chooseDarwinRecorderCommand, chooseLinuxRecorderCommand, chooseRecorderCommand, chooseWindowsRecorderCommand, getRenderedVoicePrompt, insertVoiceTranscript, parseDshowAudioDevice, voicePlaceholderText, type VoicePromptState } from "./voice";

describe("voice prompt helpers", () => {
  test("renders the requested spinner frames for recording and transcription", () => {
    const recording: VoicePromptState = { phase: "recording", frameIndex: 0, insertionPos: 0 };
    const transcribing: VoicePromptState = { phase: "transcribing", frameIndex: 9, insertionPos: 0 };

    expect(voicePlaceholderText(recording)).toBe("⠋ Listening…");
    expect(voicePlaceholderText(transcribing)).toBe("⠏ Transcribing…");
  });

  test("injects the placeholder inline at the insertion point", () => {
    const voice: VoicePromptState = { phase: "recording", frameIndex: 1, insertionPos: 5 };
    expect(applyVoicePlaceholder("hello world", voice)).toBe("hello⠙ Listening… world");
  });

  test("computes the rendered cursor position for an inline placeholder", () => {
    const voice: VoicePromptState = { phase: "transcribing", frameIndex: 0, insertionPos: 5 };
    expect(getRenderedVoicePrompt("hello", 5, voice)).toEqual({
      buffer: "hello⠋ Transcribing…",
      cursorPos: "hello⠋ Transcribing…".length,
    });
  });

  test("inserts the final transcript back into the prompt", () => {
    expect(insertVoiceTranscript("hello", 5, 5, "world", " ")).toEqual({
      buffer: "hello world",
      cursorPos: 11,
    });
  });

  test("uses pw-record with a wav container when available", () => {
    const available = new Set(["pw-record", "arecord", "ffmpeg"]);
    const cmd = chooseLinuxRecorderCommand((name) => available.has(name), "/tmp/input.wav");
    expect(cmd).toEqual({
      command: "pw-record",
      args: ["--rate", "16000", "--channels", "1", "--format", "s16", "--container", "wav", "/tmp/input.wav"],
    });
  });

  test("falls back to arecord before ffmpeg on Linux", () => {
    const available = new Set(["arecord", "ffmpeg"]);
    const cmd = chooseLinuxRecorderCommand((name) => available.has(name), "/tmp/input.wav");
    expect(cmd).toEqual({
      command: "arecord",
      args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", "/tmp/input.wav"],
    });
  });

  test("uses ffmpeg AVFoundation on macOS", () => {
    const cmd = chooseDarwinRecorderCommand((name) => name === "ffmpeg", "/tmp/input.wav");
    expect(cmd).toEqual({
      command: "ffmpeg",
      args: [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-f",
        "avfoundation",
        "-i",
        "none:default",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
        "/tmp/input.wav",
      ],
    });
  });

  test("uses ffmpeg dshow on Windows with an explicit device", () => {
    const cmd = chooseWindowsRecorderCommand((name) => name === "ffmpeg", "out.wav", "Microphone (Realtek)");
    expect(cmd?.command).toBe("ffmpeg");
    expect(cmd?.args).toContain("dshow");
    expect(cmd?.args).toContain("audio=Microphone (Realtek)");
    expect(cmd?.args).not.toContain("-nostdin");
  });

  test("returns null on Windows without ffmpeg", () => {
    expect(chooseWindowsRecorderCommand(() => false, "out.wav", "Mic")).toBeNull();
  });

  test("parses the first audio device from dshow listing output", () => {
    const listing = [
      '[dshow @ 0x1] "Integrated Camera" (video)',
      '[dshow @ 0x1]   Alternative name "@device_pnp_..."',
      '[dshow @ 0x1] "Microphone Array (Realtek(R) Audio)" (audio)',
      '[dshow @ 0x1]   Alternative name "@device_cm_..."',
    ].join("\n");
    expect(parseDshowAudioDevice(listing)).toBe("Microphone Array (Realtek(R) Audio)");
    expect(parseDshowAudioDevice("no devices here")).toBeNull();
  });

  test("dispatches recorder selection by platform", () => {
    expect(chooseRecorderCommand("darwin", (name) => name === "ffmpeg", "/tmp/input.wav")?.args).toContain("avfoundation");
    expect(chooseRecorderCommand("linux", (name) => name === "pw-record", "/tmp/input.wav")?.command).toBe("pw-record");
    expect(chooseRecorderCommand("aix", () => true, "/tmp/input.wav")).toBeNull();
  });
});

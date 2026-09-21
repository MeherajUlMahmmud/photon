import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { LocalDictationProgress, LocalDictationStatus } from "../preload/api.js";

/**
 * On-device speech to text: Whisper running through onnxruntime in the main
 * process. The model is fetched from the Hugging Face hub once and cached
 * under userData; after that nothing leaves the machine.
 */

const MODEL_ID = "onnx-community/whisper-base";
const PROGRESS_CHANNEL = "dictation:local:progress";

type Pipeline = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string }>;

let pipelinePromise: Promise<Pipeline> | null = null;

function modelsDir(): string {
  return join(app.getPath("userData"), "models");
}

function modelDownloaded(): boolean {
  return existsSync(join(modelsDir(), MODEL_ID, "config.json"));
}

function status(): LocalDictationStatus {
  return { downloaded: modelDownloaded(), loaded: pipelinePromise !== null };
}

async function loadPipeline(getWindow: () => BrowserWindow | null): Promise<Pipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = modelsDir();
  env.allowLocalModels = false;

  const emit = (p: LocalDictationProgress) => getWindow()?.webContents.send(PROGRESS_CHANNEL, p);
  const wasDownloaded = modelDownloaded();

  const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: "q8",
    device: "cpu",
    progress_callback: (event: { status: string; file?: string; progress?: number }) => {
      if (event.status === "progress" && event.file) {
        emit({ stage: wasDownloaded ? "loading" : "downloading", file: event.file, percent: event.progress ?? 0 });
      } else if (event.status === "ready") {
        emit({ stage: "ready" });
      }
    },
  });
  emit({ stage: "ready" });
  return pipe as unknown as Pipeline;
}

function getPipeline(getWindow: () => BrowserWindow | null): Promise<Pipeline> {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline(getWindow).catch((err) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

export function registerDictationIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("dictation:local:status", () => status());

  ipcMain.handle("dictation:local:prepare", async () => {
    await getPipeline(getWindow);
    return status();
  });

  ipcMain.handle("dictation:local:transcribe", async (_e, pcm: Float32Array, language?: string) => {
    const pipe = await getPipeline(getWindow);
    const opts: Record<string, unknown> = { task: "transcribe", chunk_length_s: 30, stride_length_s: 5 };
    if (language) opts.language = language;
    const out = await pipe(pcm, opts);
    return { text: (out.text ?? "").trim() };
  });

  ipcMain.handle("dictation:local:remove", async () => {
    pipelinePromise = null;
    await rm(join(modelsDir(), MODEL_ID), { recursive: true, force: true });
    return true;
  });
}

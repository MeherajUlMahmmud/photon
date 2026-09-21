import * as React from "react";
import type { DictationEngine, LocalDictationProgress } from "../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { errorMessage } from "@/lib/utils";

export type DictationState = "idle" | "recording" | "preparing" | "transcribing";

/** Server-side setting holding the user's `DictationEngine`; unset means "local". */
export const DICTATION_ENGINE_KEY = "dictation_engine";

/** Longest clip we take; dictation is for sentences, not speeches. */
const MAX_SECONDS = 120;
/** Whisper's native sample rate. */
const SAMPLE_RATE = 16_000;

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

/** Decodes a recorded clip to mono 16 kHz PCM for the on-device model. */
async function toPcm(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    await ctx.close();
  }
}

/**
 * Microphone to text. `toggle` starts a recording, or stops it and turns the
 * clip into text with the chosen engine; `onText` receives the transcript.
 * "local" runs Whisper on this machine (first use downloads the model),
 * "cloud" sends the clip to the user's provider through the server.
 */
export function useDictation(
  engine: DictationEngine,
  onText: (text: string) => void,
  onError: (message: string) => void,
) {
  const { call } = useAuth();
  const [state, setState] = React.useState<DictationState>("idle");
  const [seconds, setSeconds] = React.useState(0);
  const [progress, setProgress] = React.useState<LocalDictationProgress | null>(null);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const timer = React.useRef<number | undefined>(undefined);
  const latest = React.useRef({ onText, onError, engine });
  latest.current = { onText, onError, engine };

  React.useEffect(() => window.photon.onLocalDictationProgress(setProgress), []);

  const teardown = React.useCallback(() => {
    window.clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
    chunks.current = [];
    setSeconds(0);
  }, []);

  React.useEffect(() => teardown, [teardown]);

  const stop = React.useCallback(() => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
  }, []);

  const transcribe = React.useCallback(
    async (blob: Blob, mime: string): Promise<string> => {
      const language = navigator.language.slice(0, 2);
      if (latest.current.engine === "local") {
        const status = await window.photon.localDictationStatus();
        if (!status.loaded) {
          setState("preparing");
          await window.photon.prepareLocalDictation();
        }
        setState("transcribing");
        const pcm = await toPcm(blob);
        return (await window.photon.transcribeLocally(pcm, language)).text;
      }
      setState("transcribing");
      const audio = await toBase64(blob);
      return (await call((t) => window.photon.transcribe(t, { audio, mime, language }))).text;
    },
    [call],
  );

  const start = React.useCallback(async () => {
    const mime = pickMime();
    if (!mime) {
      latest.current.onError("This device cannot record audio.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      latest.current.onError(
        name === "NotAllowedError"
          ? "Microphone access was denied."
          : `Could not open the microphone: ${errorMessage(err)}`,
      );
      return;
    }

    const rec = new MediaRecorder(stream, { mimeType: mime });
    recorder.current = rec;
    chunks.current = [];

    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.current.push(e.data);
    };
    rec.onstop = async () => {
      const blob = new Blob(chunks.current, { type: mime });
      const tooShort = blob.size < 1024;
      teardown();
      if (tooShort) {
        setState("idle");
        return;
      }
      try {
        const text = await transcribe(blob, mime);
        if (text) latest.current.onText(text);
      } catch (err) {
        latest.current.onError(errorMessage(err));
      } finally {
        setState("idle");
        setProgress(null);
      }
    };

    rec.start(250);
    setState("recording");
    setSeconds(0);
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  }, [stop, teardown, transcribe]);

  const toggle = React.useCallback(() => {
    if (state === "recording") stop();
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, seconds, progress, toggle };
}

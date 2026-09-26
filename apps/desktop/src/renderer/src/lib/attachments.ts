import type { ChatImage, ChatMessage } from "../../../preload/api";

/**
 * What a message can carry besides its text: images (screenshots, pasted or
 * chosen pictures) go to the model as image blocks; text files are inlined
 * into the message as fenced blocks. Nothing here is saved anywhere.
 */
export type Attachment =
  | { id: string; kind: "image"; name: string; image: ChatImage }
  | { id: string; kind: "text"; name: string; text: string; size: number };

/** The server takes at most this many images per message. */
export const MAX_IMAGES = 4;
/** Longest image edge sent to the model; larger pictures are scaled down first. */
const MAX_IMAGE_EDGE = 1568;
const MAX_TEXT_BYTES = 200 * 1024;

const TEXT_EXTENSIONS = new Set(
  (
    "txt md markdown csv tsv json jsonl yaml yml toml ini cfg conf env log xml html htm css scss sass less " +
    "js jsx mjs cjs ts tsx py rb go rs java kt swift c h cc cpp hpp cs php sh bash zsh fish sql graphql " +
    "vue svelte astro lua r dart scala ex exs erl hs clj ml tf dockerfile makefile gitignore"
  ).split(" "),
);

export const newAttachmentId = () =>
  typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const imageUrl = (image: ChatImage) => `data:${image.media_type};base64,${image.data}`;

function extension(name: string): string {
  const base = name.toLowerCase().split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? base : base.slice(dot + 1);
}

function isTextFile(file: File): boolean {
  return file.type.startsWith("text/") || /json|xml|yaml|javascript|typescript/.test(file.type) || TEXT_EXTENSIONS.has(extension(file.name));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be read."));
    img.src = src;
  });
}

/** Any browser-readable image, scaled to fit `MAX_IMAGE_EDGE` and re-encoded as JPEG (PNG when it has transparency). */
async function imageFromFile(file: File): Promise<ChatImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That image could not be read.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif";
    const mediaType = png ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mediaType, 0.85);
    return { media_type: mediaType, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Turns a chosen, dropped or pasted file into an attachment, or throws a sentence saying why it can't be one. */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const name = file.name || (file.type.startsWith("image/") ? "Pasted image" : "Pasted text");
  if (file.type.startsWith("image/")) {
    return { id: newAttachmentId(), kind: "image", name, image: await imageFromFile(file) };
  }
  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_BYTES) throw new Error(`${name} is over 200 KB. Attach a smaller file or an excerpt.`);
    const text = await file.text();
    if (text.includes("\u0000")) throw new Error(`${name} looks like a binary file.`);
    return { id: newAttachmentId(), kind: "text", name, text, size: file.size };
  }
  throw new Error(`${name} can't be attached. Images and text or code files work.`);
}

/**
 * The user message for `text` plus attachments: text files appended as
 * fenced blocks after what the user typed, images as `images`.
 */
export function composeMessage(text: string, attachments: Attachment[]): ChatMessage {
  const { images, files } = splitAttachments(attachments);
  return { role: "user", content: withFiles(text, files), ...(images.length ? { images } : {}) };
}

/** A text file as it rides along with a message. */
export type AttachedFile = { name: string; text: string };

export function splitAttachments(attachments: Attachment[]): { images: ChatImage[]; files: AttachedFile[] } {
  return {
    images: attachments.flatMap((a) => (a.kind === "image" ? [a.image] : [])),
    files: attachments.flatMap((a) => (a.kind === "text" ? [{ name: a.name, text: a.text }] : [])),
  };
}

/** Text plus files as tagged blocks, the way the model reads them. */
export function withFiles(content: string, files: AttachedFile[] | undefined): string {
  if (!files?.length) return content;
  const blocks = files.map((f) => `<file name="${f.name.replace(/"/g, "'")}">\n${f.text}\n</file>`);
  return [content.trim(), ...blocks].filter(Boolean).join("\n\n");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

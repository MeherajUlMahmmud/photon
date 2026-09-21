/** Chromium's built-in PDF viewer, framed. Zoom, search and page navigation come with it. */
export function PdfViewer({ src, name }: { src: string; name: string }) {
  return <iframe src={src} title={name} className="h-full w-full border-0 bg-sheet" />;
}

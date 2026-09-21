import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "@phosphor-icons/react";

import { useToast } from "@/hooks/use-toast";

const remarkPlugins = [remarkGfm];

/** Fenced code block with a copy button; inline code renders through the base `code` style. */
function CodeBlock({ className, children }: React.ComponentProps<"code">) {
  const { toast } = useToast();
  const [done, setDone] = React.useState(false);
  const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
  const text = String(children).replace(/\n$/, "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    } catch {
      toast("Could not copy", "error");
    }
  }

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-lg bg-black text-sheet">
      <div className="flex h-7 items-center justify-between px-3 font-mono text-micro text-sheet/60">
        <span>{lang ?? "text"}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={done ? "Copied" : "Copy code"}
          className="flex size-6 items-center justify-center rounded-md hover:bg-sheet/10 hover:text-sheet"
        >
          {done ? <Check weight="bold" className="size-3.5" /> : <Copy weight="bold" className="size-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 pb-3 font-mono text-small leading-[1.6]">
        <code className={className}>{text}</code>
      </pre>
    </div>
  );
}

/** Element styles for rendered replies, using the app's type scale rather than a prose plugin. */
const components: Components = {
  p: ({ children }) => <p className="my-2 leading-[1.6] first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-5 mb-2 text-section first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-5 mb-2 text-lead first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-4 mb-1.5 text-body font-medium first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 text-body font-medium first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-slate">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-slate">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.6] [&>p]:my-0">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-input underline-offset-4 hover:decoration-black"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-input pl-3 text-slate [&>p]:my-1">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children, ...props }) => {
    // react-markdown gives fenced blocks a `language-*` class or a parent <pre>; inline code has neither.
    const fenced = /language-/.test(className ?? "") || String(children).includes("\n");
    if (fenced) return <CodeBlock className={className}>{children}</CodeBlock>;
    return (
      <code className="rounded-sm bg-muted px-1 py-px" {...props}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-small">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border px-2 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-2 py-1.5 align-top">{children}</td>,
  input: ({ checked }) => (
    <input type="checkbox" checked={Boolean(checked)} readOnly className="mr-1.5 accent-verdigris" />
  ),
};

/** Renders an assistant reply as Markdown (GFM: tables, task lists, strikethrough). */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

import * as React from "react";
import { CaretDown, FileText, FileZip, X } from "@phosphor-icons/react";
import type { Skill } from "../../../../preload/api";

import { useAuth } from "@/hooks/use-auth";
import { useSkills } from "@/hooks/use-skills";
import { useToast } from "@/hooks/use-toast";
import { cn, errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { InputField, TextareaField } from "@/components/form-fields";
import { SettingsSection } from "@/pages/settings/settings-layout";

const EXAMPLE = `---
name: review
description: Review a file or diff for bugs
---
Review $ARGUMENTS for correctness. List findings worst first, each with the
file and line, what goes wrong, and the smallest fix.`;

/** The skill as a file again, so it can be edited in place. */
function toMarkdown(skill: Skill): string {
  return `---\nname: ${skill.name}\ndescription: "${skill.description.replace(/"/g, '\\"')}"\n---\n${skill.content}\n`;
}

/** Zips over this are refused by the server; say so before uploading. */
const MAX_ZIP_BYTES = 5 * 1024 * 1024;

type PickedZip = { name: string; size: number; base64: string };

const isZip = (file: File) => file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip");

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Base64 without blowing the call stack on multi-megabyte files. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function InstallForm({ onInstalled }: { onInstalled: (skill: Skill) => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [markdown, setMarkdown] = React.useState("");
  const [zip, setZip] = React.useState<PickedZip | null>(null);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function install(replace = false) {
    const text = markdown.trim();
    if (!text && !zip) return;
    setBusy(true);
    setError(null);
    setSkipped([]);
    try {
      const source = zip ? { archive: zip.base64 } : { markdown: text };
      const skill = await call((t) =>
        window.photon.installSkill(t, { ...source, name: name.trim() || undefined, replace }),
      );
      setMarkdown("");
      setZip(null);
      setName("");
      setSkipped(skill.skipped_files ?? []);
      const count = skill.files?.length ?? 0;
      toast(`Installed /${skill.name}${count ? ` with ${count} file${count === 1 ? "" : "s"}` : ""}`);
      onInstalled(skill);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSkipped([]);
    try {
      if (isZip(file)) {
        if (file.size > MAX_ZIP_BYTES) {
          setError(`${file.name} is ${formatSize(file.size)}. Skill zips can be at most 5 MB.`);
          return;
        }
        setZip({ name: file.name, size: file.size, base64: await toBase64(file) });
        setMarkdown("");
      } else {
        setMarkdown(await file.text());
        setZip(null);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const duplicate = error?.toLowerCase().includes("already exists") ?? false;

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void install();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void takeFile(e.dataTransfer.files[0]);
      }}
    >
      {zip ? (
        <div
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-md border border-input bg-sheet px-3 py-3 transition-colors duration-150",
            dragging && "border-verdigris ring-2 ring-verdigris/25",
          )}
        >
          <FileZip weight="bold" className="size-5 shrink-0 text-slate" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-small">{zip.name}</p>
            <p className="text-micro text-slate">
              {formatSize(zip.size)}. SKILL.md becomes the skill; other text files are kept for the model to read.
            </p>
          </div>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => setZip(null)} disabled={busy} aria-label="Remove zip">
            <X />
          </Button>
        </div>
      ) : (
        <TextareaField
          name="skill_markdown"
          label="Skill file"
          hideLabel
          value={markdown}
          onChange={(e) => {
            setMarkdown(e.target.value);
            if (error) setError(null);
          }}
          placeholder={EXAMPLE}
          rows={8}
          disabled={busy}
          textareaClassName={cn("font-mono text-small", dragging && "border-verdigris ring-2 ring-verdigris/25")}
        />
      )}
      <div className="flex flex-wrap items-end gap-2">
        <InputField
          name="skill_name"
          label="Name"
          hideLabel
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional, overrides the file)"
          spellCheck={false}
          disabled={busy}
          className="min-w-48 flex-1"
          inputClassName="font-mono text-small"
        />
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"
          className="hidden"
          onChange={(e) => {
            void takeFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileText weight="bold" />
          Choose .md or .zip
        </Button>
        {duplicate ? (
          <Button type="button" onClick={() => void install(true)} disabled={busy}>
            {busy ? "Replacing" : "Replace existing"}
          </Button>
        ) : (
          <Button type="submit" disabled={(!markdown.trim() && !zip) || busy}>
            {busy ? "Installing" : "Install"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      )}
      {skipped.length > 0 && (
        <div className="text-small text-slate">
          <p>Left out of the zip:</p>
          <ul className="mt-1 list-disc pl-5 break-words">
            {skipped.map((s) => (
              <li key={s} className="font-mono text-micro">
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

function SkillCard({ skill, onChanged }: { skill: Skill; onChanged: () => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState<"save" | "remove" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState(false);

  function startEdit() {
    setDraft(toMarkdown(skill));
    setError(null);
    setEditing(true);
    setOpen(true);
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const next = await call((t) => window.photon.updateSkill(t, skill.name, draft));
      toast(`Saved /${next.name}`);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    try {
      await call((t) => window.photon.deleteSkill(t, skill.name));
      toast(`Removed /${skill.name}`);
      onChanged();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-lg border border-border bg-sheet">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60 active:scale-100 active:bg-muted"
      >
        <CaretDown
          weight="bold"
          className={cn("mt-1 size-3.5 shrink-0 text-slate transition-transform duration-150", !open && "-rotate-90")}
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-body">/{skill.name}</p>
          {skill.description && <p className="mt-0.5 text-small text-slate">{skill.description}</p>}
        </div>
      </button>
      {open && (
        <div className="grid animate-reveal gap-3 border-t border-border px-4 py-3">
          {editing ? (
            <>
              <TextareaField
                name={`skill_${skill.name}_edit`}
                label={`Edit /${skill.name}`}
                hideLabel
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={12}
                disabled={busy !== null}
                textareaClassName="font-mono text-small"
              />
              {error && (
                <p role="alert" className="text-small text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy !== null}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void save()} disabled={!draft.trim() || busy !== null}>
                  {busy === "save" ? "Saving" : "Save"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <pre className="max-h-96 overflow-x-hidden overflow-y-auto rounded-md bg-background p-3 font-mono text-small break-words whitespace-pre-wrap">
                {skill.content}
              </pre>
              {skill.files?.length > 0 && (
                <div>
                  <p className="text-small font-medium">
                    {skill.files.length} bundled file{skill.files.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-micro text-slate">
                    The model reads these on demand in workspace chats. Nothing in them runs.
                  </p>
                  <ul className="mt-2 grid gap-0.5">
                    {skill.files.map((f) => (
                      <li key={f.path} className="flex min-w-0 items-baseline justify-between gap-3 font-mono text-micro">
                        <span className="min-w-0 break-all">{f.path}</span>
                        <span className="shrink-0 text-slate">{formatSize(f.size)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate">
                  Type <span className="font-mono">/{skill.name}</span> in a chat to use it.
                </p>
                <div className="flex gap-1">
                  <Button type="button" variant="quiet" size="sm" onClick={startEdit} disabled={busy !== null}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => setConfirming(true)}
                    disabled={busy !== null}
                  >
                    {busy === "remove" ? "Removing" : "Remove"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove /${skill.name}?`}
        description="Chats that used it keep their transcript; the command stops working."
        confirmLabel="Remove"
        onConfirm={() => void remove()}
      />
    </article>
  );
}

export function SkillsSettingsPage() {
  const { skills, loading, error, reload } = useSkills();

  return (
    <>
      <SettingsSection
        title="Install a skill"
        description="Paste a skill file, or drop a .md or a .zip of a skill folder (SKILL.md plus references). Front matter gives the name and description; $ARGUMENTS stands for whatever you type after the command. Then type / in any chat to use it."
      >
        <InstallForm onInstalled={reload} />
      </SettingsSection>
      <SettingsSection title="Installed skills" description="Each is stored on the server under your account and sent to the model only when you invoke it.">
        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : error ? (
          <p className="text-small text-destructive">{error}</p>
        ) : skills.length ? (
          <div className="grid gap-3">
            {skills.map((s) => (
              <SkillCard key={s.id} skill={s} onChanged={reload} />
            ))}
          </div>
        ) : (
          <p className="text-small text-slate">No skills yet. Paste one above.</p>
        )}
      </SettingsSection>
    </>
  );
}

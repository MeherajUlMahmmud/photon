import * as React from "react";
import { CaretDown, FileText } from "@phosphor-icons/react";
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

/** Reads a dropped or chosen `.md` file into the textarea. */
async function readTextFile(file: File): Promise<string> {
  return file.text();
}

function InstallForm({ onInstalled }: { onInstalled: (skill: Skill) => void }) {
  const { call } = useAuth();
  const { toast } = useToast();
  const [markdown, setMarkdown] = React.useState("");
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function install(replace = false) {
    const text = markdown.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const skill = await call((t) =>
        window.photon.installSkill(t, { markdown: text, name: name.trim() || undefined, replace }),
      );
      setMarkdown("");
      setName("");
      toast(`Installed /${skill.name}`);
      onInstalled(skill);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function takeFile(file: File | undefined) {
    if (!file) return;
    try {
      setMarkdown(await readTextFile(file));
      setError(null);
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
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            void takeFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileText weight="bold" />
          Choose file
        </Button>
        {duplicate ? (
          <Button type="button" onClick={() => void install(true)} disabled={busy}>
            {busy ? "Replacing" : "Replace existing"}
          </Button>
        ) : (
          <Button type="submit" disabled={!markdown.trim() || busy}>
            {busy ? "Installing" : "Install"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
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
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60"
      >
        <CaretDown
          weight="bold"
          className={cn("mt-1 size-3.5 shrink-0 text-slate transition-transform", !open && "-rotate-90")}
        />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-body">/{skill.name}</p>
          {skill.description && <p className="mt-0.5 text-small text-slate">{skill.description}</p>}
        </div>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-border px-4 py-3">
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
              <pre className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-small whitespace-pre-wrap">
                {skill.content}
              </pre>
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
        description="Paste a skill file: optional front matter with name and description, then the instructions in Markdown. $ARGUMENTS stands for whatever you type after the command. Then type / in any chat to use it."
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

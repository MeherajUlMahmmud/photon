import * as React from "react";
import { ArrowUp, CircleNotch, Microphone, Stop } from "@phosphor-icons/react";

import type { LocalDictationProgress, Skill } from "../../../../preload/api";
import type { DictationState } from "@/hooks/use-dictation";
import { commandQuery, matchSkills } from "@/lib/skills";
import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/form-fields";
import { SkillMenu } from "@/components/chat/skill-menu";

export type DictationControl = {
  state: DictationState;
  seconds: number;
  progress: LocalDictationProgress | null;
  toggle: () => void;
};

function progressLabel(progress: LocalDictationProgress | null): string {
  if (!progress || progress.stage === "ready") return "Getting the speech model ready";
  const verb = progress.stage === "downloading" ? "Downloading" : "Loading";
  return `${verb} the speech model, ${Math.round(progress.percent)}%`;
}

function DictationButton({ state, seconds, progress, toggle, disabled }: DictationControl & { disabled: boolean }) {
  if (state === "transcribing" || state === "preparing") {
    const label = state === "preparing" ? progressLabel(progress) : "Transcribing";
    return (
      <Button size="icon" variant="outline" disabled aria-label={label} title={label}>
        <CircleNotch weight="bold" className="animate-spin" />
      </Button>
    );
  }
  if (state === "recording") {
    const mm = String(Math.floor(seconds / 60));
    const ss = String(seconds % 60).padStart(2, "0");
    return (
      <Button
        size="icon"
        variant="outline"
        onClick={toggle}
        aria-label="Stop recording"
        title={`Recording ${mm}:${ss}. Click to stop.`}
        className="relative border-black"
      >
        <Stop weight="fill" />
        <span className="absolute -top-1 -right-1 size-2 animate-pulse rounded-full bg-black" aria-hidden="true" />
      </Button>
    );
  }
  return (
    <Button size="icon" variant="outline" onClick={toggle} disabled={disabled} aria-label="Dictate" title="Dictate">
      <Microphone weight="bold" />
    </Button>
  );
}

/**
 * Message input with send button. `actions` renders above the field,
 * `footer` below it (model picker). `dictation` adds a microphone button;
 * `onStop` swaps Send for Stop while a reply streams in. With `skills`,
 * typing `/` at the start opens a picker; choosing one leaves `/name ` in the
 * field for the arguments.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  disabled,
  placeholder,
  actions,
  footer,
  dictation,
  skills,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  /** When set, a reply is in flight: Send becomes Stop. */
  onStop?: () => void;
  disabled: boolean;
  placeholder: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  dictation?: DictationControl;
  /** Skills offered by the `/` menu; omit to disable it. */
  skills?: Skill[];
}) {
  const recording = dictation?.state === "recording";
  const preparing = dictation?.state === "preparing";

  // The menu follows the draft: open while the draft is a bare `/name`, closed
  // once a space follows or the user dismissed it for this token.
  const query = skills ? commandQuery(value) : null;
  const [dismissed, setDismissed] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const matches = React.useMemo(() => (query === null ? [] : matchSkills(skills ?? [], query)), [skills, query]);
  const menuOpen = query !== null && !dismissed && !disabled;

  React.useEffect(() => {
    setActive(0);
    if (query === null) setDismissed(false);
  }, [query]);

  function pick(skill: Skill) {
    onChange(`/${skill.name} `);
  }

  // Enter sends; Shift+Enter inserts a newline. IME composition (e.g. CJK input) must not send.
  // While the menu is open, arrows move the highlight and Enter/Tab pick.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (matches.length) {
          setActive((i) => (e.key === "ArrowDown" ? (i + 1) % matches.length : (i - 1 + matches.length) % matches.length));
        }
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        const chosen = matches[active];
        if (chosen) {
          e.preventDefault();
          pick(chosen);
          return;
        }
        // Enter on "/" with nothing to pick sends the text as typed.
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="px-8 pb-6 md:px-14">
      {actions && <div className="mb-2 flex items-center justify-end gap-1">{actions}</div>}
      <div className="relative flex items-end gap-2">
        {menuOpen && (
          <SkillMenu skills={matches} query={query ?? ""} activeIndex={active} onHover={setActive} onPick={pick} />
        )}
        <TextareaField
          name="message"
          label="Message"
          hideLabel
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={recording ? "Listening…" : preparing ? progressLabel(dictation.progress) + "…" : placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1"
          textareaClassName="max-h-48 min-h-11 resize-none"
        />
        {dictation && <DictationButton {...dictation} disabled={disabled} />}
        {onStop ? (
          <Button size="icon" variant="outline" onClick={onStop} aria-label="Stop answering" title="Stop answering">
            <Stop weight="fill" />
          </Button>
        ) : (
          <Button size="icon" onClick={onSend} disabled={disabled || recording || !value.trim()} aria-label="Send">
            <ArrowUp weight="bold" />
          </Button>
        )}
      </div>
      {footer && <div className="mt-2 flex items-center">{footer}</div>}
    </div>
  );
}

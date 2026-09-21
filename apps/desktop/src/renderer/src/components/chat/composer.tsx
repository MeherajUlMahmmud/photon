import * as React from "react";
import { ArrowUp } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TextareaField } from "@/components/form-fields";

/**
 * Message input with send button. `actions` renders above the field (clear,
 * folder toggle), `footer` below it beside the keyboard hint (model picker).
 */
export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  actions,
  footer,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  placeholder: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Enter sends; Shift+Enter inserts a newline. IME composition (e.g. CJK input) must not send.
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="px-8 pb-6 md:px-14">
      {actions && <div className="mb-2 flex items-center justify-end gap-1">{actions}</div>}
      <div className="flex items-end gap-2">
        <TextareaField
          name="message"
          label="Message"
          hideLabel
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1"
          textareaClassName="max-h-48 min-h-11"
        />
        <Button size="icon" onClick={onSend} disabled={disabled || !value.trim()} aria-label="Send">
          <ArrowUp weight="bold" />
        </Button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        {footer ?? <span />}
        <p className="text-small text-slate">
          <kbd>Enter</kbd> sends, <kbd>Shift</kbd> <kbd>Enter</kbd> for a new line
        </p>
      </div>
    </div>
  );
}

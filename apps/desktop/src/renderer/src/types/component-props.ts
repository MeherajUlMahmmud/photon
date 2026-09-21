import type * as React from "react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Options sharing a group render under one heading. */
  group?: string;
};

/** Shared by every field: label, help text, error, layout. */
export type FormFieldProps = {
  name: string;
  label: string;
  /** Keep the label for screen readers only (inline controls such as the chat composer). */
  hideLabel?: boolean;
  error?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
};

export type InputFieldProps = FormFieldProps & {
  type?: React.HTMLInputTypeAttribute;
  placeholder?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  minLength?: number;
  maxLength?: number;
  suggestions?: string[];
  autoComplete?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  spellCheck?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  inputClassName?: string;
};

export type PasswordFieldProps = Omit<InputFieldProps, "type" | "inputMode" | "suggestions">;

export type TextareaFieldProps = FormFieldProps & {
  placeholder?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  rows?: number;
  autoFocus?: boolean;
  textareaClassName?: string;
};

export type SelectFieldProps = FormFieldProps & {
  options: SelectOption[];
  placeholder?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  size?: "sm" | "default";
  triggerClassName?: string;
  itemClassName?: string;
};

export type SearchableSelectFieldProps = SelectFieldProps & {
  searchPlaceholder?: string;
  emptyMessage?: string;
};

export type CheckboxFieldProps = FormFieldProps & {
  value?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  labelPosition?: "left" | "right";
};

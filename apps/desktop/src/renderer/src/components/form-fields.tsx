import * as React from "react";
import { CaretUpDown, Check, Eye, EyeSlash } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  CheckboxFieldProps,
  FormFieldProps,
  InputFieldProps,
  PasswordFieldProps,
  SearchableSelectFieldProps,
  SelectFieldProps,
  SelectOption,
  TextareaFieldProps,
} from "@/types/component-props";

export type {
  CheckboxFieldProps,
  FormFieldProps,
  InputFieldProps,
  PasswordFieldProps,
  SearchableSelectFieldProps,
  SelectFieldProps,
  SelectOption,
  TextareaFieldProps,
};

/** Ids and aria wiring every field shares. */
function useFieldIds(name: string, description?: string, error?: string) {
  const inputId = `field-${name}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return { inputId, descriptionId, errorId, describedBy };
}

function FieldLabel({
  htmlFor,
  label,
  hideLabel,
  required,
  className,
}: {
  htmlFor?: string;
  label: string;
  hideLabel?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={cn(hideLabel && "sr-only", className)}>
      {label}
      {required && (
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      )}
    </Label>
  );
}

function FieldFooter({
  description,
  descriptionId,
  error,
  errorId,
}: {
  description?: string;
  descriptionId?: string;
  error?: string;
  errorId?: string;
}) {
  return (
    <>
      {description && (
        <p id={descriptionId} className="text-small text-slate">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-small text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

export function InputField({
  name,
  label,
  hideLabel,
  error,
  description,
  required,
  type = "text",
  placeholder,
  value,
  onChange,
  onKeyDown,
  disabled,
  className,
  labelClassName,
  inputClassName,
  min,
  max,
  step,
  minLength,
  maxLength,
  suggestions,
  autoComplete,
  autoFocus,
  readOnly,
  spellCheck,
  inputMode,
}: InputFieldProps) {
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);
  const listId = suggestions?.length ? `${inputId}-suggestions` : undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <FieldLabel htmlFor={inputId} label={label} hideLabel={hideLabel} required={required} className={labelClassName} />
      <Input
        id={inputId}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={onChange}
        onKeyDown={onKeyDown}
        disabled={disabled}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        minLength={minLength}
        maxLength={maxLength}
        list={listId}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        spellCheck={spellCheck}
        inputMode={inputMode}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClassName}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

export function PasswordField({
  name,
  label,
  hideLabel,
  error,
  description,
  required,
  placeholder,
  value,
  onChange,
  onKeyDown,
  disabled,
  className,
  labelClassName,
  inputClassName,
  minLength,
  maxLength,
  autoComplete,
  autoFocus,
  spellCheck = false,
}: PasswordFieldProps) {
  const [show, setShow] = React.useState(false);
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);

  return (
    <div className={cn("grid gap-2", className)}>
      <FieldLabel htmlFor={inputId} label={label} hideLabel={hideLabel} required={required} className={labelClassName} />
      <div className="relative">
        <Input
          id={inputId}
          name={name}
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value ?? ""}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={disabled}
          minLength={minLength}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={spellCheck}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn("pr-10", inputClassName)}
        />
        {/* Stays in the tab order: a keyboard-only user has no other way to check what they typed. */}
        <button
          type="button"
          onClick={() => setShow((prev) => !prev)}
          disabled={disabled}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-slate outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-verdigris/25 disabled:pointer-events-none"
          aria-label={`${show ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={show}
          aria-controls={inputId}
        >
          {show ? <EyeSlash className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

export function TextareaField({
  name,
  label,
  hideLabel,
  error,
  description,
  required,
  placeholder,
  value,
  onChange,
  onKeyDown,
  rows = 4,
  disabled,
  autoFocus,
  className,
  labelClassName,
  textareaClassName,
}: TextareaFieldProps) {
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);

  return (
    <div className={cn("grid gap-2", className)}>
      <FieldLabel htmlFor={inputId} label={label} hideLabel={hideLabel} required={required} className={labelClassName} />
      <Textarea
        id={inputId}
        name={name}
        placeholder={placeholder}
        rows={rows}
        value={value ?? ""}
        onChange={onChange}
        onKeyDown={onKeyDown}
        disabled={disabled}
        autoFocus={autoFocus}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={textareaClassName}
      />
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

/** Options in first-seen group order; ungrouped ones come first under no heading. */
function groupOptions(options: SelectOption[]): { label?: string; options: SelectOption[] }[] {
  const groups = new Map<string | undefined, SelectOption[]>();
  for (const option of options) {
    const list = groups.get(option.group) ?? [];
    list.push(option);
    groups.set(option.group, list);
  }
  return [...groups.entries()].map(([label, opts]) => ({ label, options: opts }));
}

export function SelectField({
  name,
  label,
  hideLabel,
  error,
  description,
  required,
  options,
  placeholder = "Select an option",
  value,
  onValueChange,
  disabled,
  size,
  className,
  labelClassName,
  triggerClassName,
  itemClassName,
}: SelectFieldProps) {
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);
  const groups = groupOptions(options);
  const grouped = groups.some((g) => g.label !== undefined);

  const items = (opts: SelectOption[]) =>
    opts.map((option) => (
      <SelectItem key={option.value} value={option.value} disabled={option.disabled} className={itemClassName}>
        {option.label}
      </SelectItem>
    ));

  return (
    <div className={cn("grid gap-2", className)}>
      <FieldLabel htmlFor={inputId} label={label} hideLabel={hideLabel} required={required} className={labelClassName} />
      <Select name={name} value={value ?? ""} onValueChange={onValueChange} disabled={disabled} required={required}>
        <SelectTrigger
          id={inputId}
          size={size}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn("w-full", triggerClassName)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {grouped
            ? groups.map((g, i) => (
                <SelectGroup key={g.label ?? `ungrouped-${i}`}>
                  {g.label !== undefined && <SelectLabel>{g.label}</SelectLabel>}
                  {items(g.options)}
                </SelectGroup>
              ))
            : items(options)}
        </SelectContent>
      </Select>
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

/** SelectField with type-to-filter, for long option lists. */
export function SearchableSelectField({
  name,
  label,
  hideLabel,
  error,
  description,
  required,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search",
  emptyMessage = "Nothing matches.",
  value,
  onValueChange,
  disabled,
  size,
  className,
  labelClassName,
  triggerClassName,
  itemClassName,
}: SearchableSelectFieldProps) {
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value);
  const groups = groupOptions(options);

  return (
    <div className={cn("grid gap-2", className)}>
      <FieldLabel htmlFor={inputId} label={label} hideLabel={hideLabel} required={required} className={labelClassName} />
      {/* `modal` so the list scrolls when the field sits inside a Sheet or Dialog, whose scroll lock would otherwise swallow wheel events. */}
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild>
          <Button
            id={inputId}
            type="button"
            variant="outline"
            size={size === "sm" ? "sm" : "default"}
            role="combobox"
            aria-expanded={open}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal hover:border-input",
              !selected && "text-muted-foreground",
              error && "border-destructive",
              triggerClassName,
            )}
          >
            <span className="truncate">{selected?.label ?? placeholder}</span>
            <CaretUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="flex max-h-(--radix-popover-content-available-height) flex-col overflow-hidden p-0"
          align="start"
          collisionPadding={8}
          style={{ width: "var(--radix-popover-trigger-width)" }}
        >
          <Command className="min-h-0 flex-1">
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList className="max-h-none flex-1 overflow-y-auto">
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              {groups.map((g, i) => (
                <CommandGroup key={g.label ?? `ungrouped-${i}`} heading={g.label}>
                  {g.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.label}
                      disabled={option.disabled}
                      className={itemClassName}
                      onSelect={() => {
                        onValueChange?.(option.value);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn("size-4", value === option.value ? "opacity-100" : "opacity-0")} weight="bold" />
                      {option.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  error,
  description,
  required,
  value,
  onCheckedChange,
  disabled,
  className,
  labelClassName,
  labelPosition = "right",
}: CheckboxFieldProps) {
  const { inputId, descriptionId, errorId, describedBy } = useFieldIds(name, description, error);
  const labelNode = (
    <FieldLabel htmlFor={inputId} label={label} required={required} className={cn("cursor-pointer font-normal", labelClassName)} />
  );

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center gap-2">
        {labelPosition === "left" && labelNode}
        <Checkbox
          id={inputId}
          name={name}
          checked={value ?? false}
          onCheckedChange={(checked) => onCheckedChange?.(checked === true)}
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {labelPosition === "right" && labelNode}
      </div>
      <FieldFooter description={description} descriptionId={descriptionId} error={error} errorId={errorId} />
    </div>
  );
}

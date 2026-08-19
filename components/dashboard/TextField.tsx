"use client";

import type {ReactNode} from "react";

/**
 * Labelled input for the withdraw form. Wraps the `.field` classes from
 * globals.css rather than restating them, and keeps the label, the hint, the
 * error and the `aria-describedby` wiring in one place: this is a form that
 * moves money, and a field whose error is invisible to a screen reader is a
 * field that can lose someone's ETH to a mistyped address.
 */

export type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string | null;
  /** Quiet line under the field, replaced by the error when there is one. */
  hint?: ReactNode;
  /** Trailing control on the same row, such as MAX. */
  action?: ReactNode;
  mono?: boolean;
  inputMode?: "text" | "decimal";
  /** Marks the field the modal lands on when it opens. */
  autoFocus?: boolean;
};

export function TextField({
  id,
  label,
  value,
  onChange,
  disabled = false,
  error,
  hint,
  action,
  mono = true,
  inputMode = "text",
  autoFocus = false,
}: TextFieldProps) {
  const errorId = `${id}-error`;

  const input = (
    <input
      id={id}
      value={value}
      disabled={disabled}
      inputMode={inputMode}
      autoComplete="off"
      spellCheck={false}
      data-autofocus={autoFocus ? "" : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
      onChange={(event) => onChange(event.target.value)}
      className={`field ${mono ? "field-mono" : ""} ${action ? "flex-1" : ""} ${
        error ? "invalid" : ""
      }`}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="mono-label">
        {label}
      </label>
      {action ? (
        <div className="flex gap-2">
          {input}
          {action}
        </div>
      ) : (
        input
      )}
      {error ? (
        <p id={errorId} className="text-[13px] text-red">
          {error}
        </p>
      ) : hint ? (
        <p className="mono-label">{hint}</p>
      ) : null}
    </div>
  );
}

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Text input / textarea that keeps what is being typed in its own state and hands it to the parent
 * (`onCommit`) only when typing pauses, on blur and on Enter.
 *
 * For forms whose state lives in a very large component (UnifiedWorkspace): a controlled input there re-renders
 * the whole workspace on every keystroke, and on a slow machine letters showed up seconds late. Here a keystroke
 * re-renders only this field.
 *
 * Submitting stays exact: blur (clicking a button) and Enter commit with `flushSync`, so the parent has re-rendered
 * with the full text before the click / submit handler runs. Without it React applies the update in a microtask, and
 * a submit reached in the same task (scripted click, fast Enter) would read the old text.
 */
type CommonProps = {
  value: string;
  onCommit: (value: string) => void;
  /** Idle time after the last keystroke before the parent is updated (ms). */
  delay?: number;
  /**
   * Called at once (not debounced) only when the typed text switches between blank and not blank, e.g. to enable a
   * "Gửi" button as soon as something is typed without re-rendering the parent on every keystroke.
   */
  onEmptyChange?: (isEmpty: boolean) => void;
};

type InputProps = CommonProps & { multiline?: false } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "defaultValue">;
type TextareaProps = CommonProps & { multiline: true } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "defaultValue">;

export function BufferedField(props: InputProps | TextareaProps) {
  const { value, onCommit, delay = 300, multiline, onBlur, onKeyDown, onEmptyChange, ...rest } = props as CommonProps & {
    multiline?: boolean;
    onBlur?: React.FocusEventHandler<HTMLInputElement | HTMLTextAreaElement>;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  } & Record<string, unknown>;

  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // The parent replaced the value (another task opened, form reset, reply sent): show it
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onEmptyChangeRef = useRef(onEmptyChange);
  onEmptyChangeRef.current = onEmptyChange;
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      if (!value.trim() !== !draftRef.current.trim()) onEmptyChangeRef.current?.(!value.trim());
      setDraft(value);
    }
  }, [value]);

  const flush = useCallback((next: string, sync = false) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (next !== committed.current) {
      committed.current = next;
      if (sync) flushSync(() => onCommitRef.current(next));
      else onCommitRef.current(next);
    }
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    if (onEmptyChange && !next.trim() !== !draft.trim()) onEmptyChange(!next.trim());
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(next), delay);
  };

  const shared = {
    ...rest,
    value: draft,
    onChange: handleChange,
    onBlur: (e: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      flush(e.currentTarget.value, true);
      onBlur?.(e);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      // Shift+Enter in a textarea is a new line, not a submit: no need to commit then
      if (e.key === "Enter" && !(multiline && e.shiftKey)) flush(e.currentTarget.value, true);
      onKeyDown?.(e);
    },
  };

  return multiline ? <textarea {...(shared as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} /> : <input {...(shared as React.InputHTMLAttributes<HTMLInputElement>)} />;
}

/**
 * Drop-in replacements for `<input value onChange>` / `<textarea value onChange>` inside very large components
 * (Kinh doanh, Kho, Cung ứng, Application, Điều hành): same props, but `onChange` runs when typing pauses, on blur and
 * on Enter instead of on every keystroke. The handler receives an event whose `target.value` / `currentTarget.value` is
 * the typed text, which is all the converted handlers read.
 */
type ChangeLike = { target: { value: string }; currentTarget: { value: string } };
const changeEvent = (value: string) => ({ target: { value }, currentTarget: { value } }) as ChangeLike as React.ChangeEvent<any>;

type FastInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value?: string | number | readonly string[] | null;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  delay?: number;
};

export function FastInput({ value, onChange, ...rest }: FastInputProps) {
  return (
    <BufferedField
      {...rest}
      value={value == null ? "" : String(value)}
      onCommit={(v) => onChange?.(changeEvent(v))}
    />
  );
}

type FastTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value?: string | number | readonly string[] | null;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  delay?: number;
};

export function FastTextarea({ value, onChange, ...rest }: FastTextareaProps) {
  return (
    <BufferedField
      {...rest}
      multiline
      value={value == null ? "" : String(value)}
      onCommit={(v) => onChange?.(changeEvent(v))}
    />
  );
}

export default BufferedField;

import React, { useLayoutEffect, useRef } from "react";

/**
 * Chuyển mọi dạng giá trị tiền (number, "1.900.000.000", "1,900,000,000", "1 900 000 000"...)
 * thành số nguyên VNĐ. Giá trị không hợp lệ trả về 0.
 */
export const parseMoney = (val: unknown): number => {
  if (typeof val === "number") return Number.isFinite(val) ? Math.round(val) : 0;
  if (val === null || val === undefined) return 0;
  const digits = String(val).replace(/\D/g, "").slice(0, 15); // tối đa 15 chữ số (an toàn với Number)
  return digits ? Number(digits) : 0;
};

/** Định dạng số có dấu chấm phân cách phần nghìn kiểu Việt Nam: 1900000000 -> "1.900.000.000" */
export const formatThousands = (val: unknown): string => {
  const n = parseMoney(val);
  return n > 0 ? n.toLocaleString("vi-VN") : "";
};

type MoneyInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number | string | undefined | null;
  onValueChange: (value: number) => void;
};

/**
 * Ô nhập tiền tự động thêm dấu phân cách phần nghìn khi gõ.
 * Giữ nguyên vị trí con trỏ khi định dạng lại; giá trị trả ra luôn là số nguyên.
 */
export const MoneyInput: React.FC<MoneyInputProps> = ({ value, onValueChange, ...rest }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretDigitsRef = useRef<number | null>(null);
  const display = formatThousands(value);

  useLayoutEffect(() => {
    const el = inputRef.current;
    const digitsBeforeCaret = caretDigitsRef.current;
    if (!el || digitsBeforeCaret === null || document.activeElement !== el) return;
    caretDigitsRef.current = null;
    let pos = 0;
    let seen = 0;
    while (pos < display.length && seen < digitsBeforeCaret) {
      if (/\d/.test(display[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  });

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={e => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        caretDigitsRef.current = raw.slice(0, caret).replace(/\D/g, "").length;
        onValueChange(parseMoney(raw));
      }}
    />
  );
};

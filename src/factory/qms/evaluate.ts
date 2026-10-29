/** Pure QC evaluation: the server decides pass/fail from the specification, never the client. */

export interface ParameterSpec {
  id: string;
  name: string;
  value_type: "NUMERIC" | "TEXT" | "PASS_FAIL";
  lower_limit: string | number | null;
  upper_limit: string | number | null;
  target: string | null;
  is_critical: boolean;
}

export interface ResultValue {
  value_numeric?: number | null;
  value_text?: string | null;
}

/** true / false, or null for an informational text result without a target. */
export function evaluateResult(p: ParameterSpec, v: ResultValue): boolean | null {
  if (p.value_type === "NUMERIC") {
    const x = v.value_numeric;
    if (x == null || !Number.isFinite(x)) throw new Error(`Chỉ tiêu "${p.name}" cần giá trị số.`);
    if (p.lower_limit != null && x < Number(p.lower_limit)) return false;
    if (p.upper_limit != null && x > Number(p.upper_limit)) return false;
    return true;
  }
  const text = (v.value_text ?? "").trim();
  if (!text) throw new Error(`Chỉ tiêu "${p.name}" chưa có kết quả.`);
  if (p.value_type === "PASS_FAIL") {
    if (text !== "PASS" && text !== "FAIL") throw new Error(`Chỉ tiêu "${p.name}" chỉ nhận Đạt hoặc Không đạt.`);
    return text === "PASS";
  }
  return p.target ? text.localeCompare(p.target.trim(), "vi", { sensitivity: "base" }) === 0 : null;
}

/**
 * Overall result: FAIL if any entered result failed; every critical parameter must have a result.
 * Returns the missing critical parameters so the UI can say exactly what to enter.
 */
export function overallResult(params: ParameterSpec[], results: { parameter_id: string; passed: boolean | null }[]) {
  const byParam = new Map(results.map((r) => [r.parameter_id, r]));
  const missing = params.filter((p) => p.is_critical && !byParam.has(p.id)).map((p) => p.name);
  const failed = results.some((r) => r.passed === false);
  return { missing, result: failed ? ("FAIL" as const) : ("PASS" as const) };
}

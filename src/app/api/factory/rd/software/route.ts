import { factoryRoute } from "@/factory/http";
import { invalid } from "@/factory/core/errors";
import { createProblem, createValidation, linkProblemEco, recordTestRun, saveRequirement, saveTestCase } from "@/factory/rd/software";

/** Software lifecycle commands (KTCN / R&D): requirements, test cases, runs, problem reports, in-house validation. */
export const POST = factoryRoute(async (tx, { actor, body }) => {
  const b = (body ?? {}) as Record<string, any>;
  switch (b.op) {
    case "save_requirement":
      return saveRequirement(tx, actor, b);
    case "save_test_case":
      return saveTestCase(tx, actor, b);
    case "record_run":
      return recordTestRun(tx, actor, b);
    case "create_problem":
      return createProblem(tx, actor, b);
    case "link_eco":
      await linkProblemEco(tx, actor, String(b.problem_id ?? ""), b.eco_id ? String(b.eco_id) : null);
      return { ok: true };
    case "create_validation":
      return createValidation(tx, actor, b);
    default:
      throw invalid("Thao tác không hợp lệ.");
  }
});

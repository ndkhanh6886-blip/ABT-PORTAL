import { afterAll, describe, expect, it } from "vitest";
import { createOrgUnit, createUser, grant } from "./helpers";
import { closeFactoryPool, getFactoryPool, withTransaction } from "../core/db";
import { getPermission } from "../core/authz";
import { getMachine } from "../core/stateMachine";
import { processOutbox } from "../core/worker";
import { TRANSITION_NOTICES } from "../noticeMatrix";
import { createIdea } from "../rd/ideas";
import "../modules";

afterAll(closeFactoryPool);

describe("workflow-step notices of the Khối Kỹ thuật", () => {
  it("every declared notice points at a real step and a registered permission", () => {
    for (const n of TRANSITION_NOTICES) {
      const m = getMachine(n.entity);
      expect(m, n.entity).toBeTruthy();
      expect(m!.transitions.some((t) => t.action === n.action), `${n.entity}.${n.action}`).toBe(true);
      expect(getPermission(n.notify), n.notify).toBeTruthy();
    }
  });

  it("a submitted R&D idea notifies the evaluators of that department, not the proposer or other departments", async () => {
    const rd = await createOrgUnit("RD");
    const other = await createOrgUnit("KIT");
    const proposer = await createUser("Người đề xuất");
    await grant(proposer, ["rd.view", "rd.idea.propose", "rd.idea.evaluate"], rd);
    const evaluator = await createUser("Người đánh giá");
    await grant(evaluator, ["rd.view", "rd.idea.evaluate"], rd);
    const elsewhere = await createUser("Đánh giá phòng khác");
    await grant(elsewhere, ["rd.view", "rd.idea.evaluate"], other);

    const idea = await withTransaction((tx) =>
      createIdea(tx, proposer, { org_unit_id: rd, title: "Kit PCR đa mồi", description: "Phát hiện đồng thời 4 tác nhân", submit_now: true })
    );
    await processOutbox(500);
    const got = async (u: number) =>
      (await getFactoryPool().query("SELECT title FROM core.notification WHERE user_id = $1 AND type = 'RD_IDEA_SUBMIT' AND entity_id = $2", [u, idea.id])).rows;
    expect((await got(evaluator.userId))[0]?.title).toMatch(/Ý tưởng mới chờ đánh giá/);
    expect(await got(proposer.userId)).toHaveLength(0);
    expect(await got(elsewhere.userId)).toHaveLength(0);
  });
});

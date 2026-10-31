import { withTransaction } from "../src/factory/core/db";
import { listProductionPlan, updateOrderPlan } from "../src/factory/kit/ordersEbr";

// Kiểm tra nhanh: đọc Bảng kế hoạch, cập nhật kế hoạch + phân công QA trong transaction rồi ROLLBACK.
async function main() {
  await withTransaction(async (tx) => {
    const admin = (await tx.query("SELECT user_id FROM core.user_profile ORDER BY user_id LIMIT 1")).rows[0];
    const actor = { userId: admin.user_id, name: "Kiểm thử", isRootAdmin: true } as any;
    const plan = await listProductionPlan(tx, actor);
    console.log("ORDERS:", plan.orders.length, "UNPLANNED_PO:", plan.unplanned_po_lines.length, "can_plan:", plan.can_plan, "can_assign_qa:", plan.can_assign_qa);
    const o = plan.orders[0];
    if (o) {
      console.log("FIRST:", o.code, o.planned_start_date, o.planned_end_date, o.team_lead_name, "steps:", (o.steps as any[]).length);
      const upd = await updateOrderPlan(tx, actor, o.id, { qa_assignee_name: "Đỗ Minh Châu (QA giám sát GMP dây chuyền)", plan_note: "Ưu tiên" });
      const steps = (await tx.query("SELECT seq, is_qc, qa_assignee_name FROM kit.production_step WHERE order_id = $1 ORDER BY seq", [o.id])).rows;
      console.log("UPDATED_QA:", upd.qa_assignee_name, "STEPS:", JSON.stringify(steps));
    }
    throw new Error("ROLLBACK_OK");
  }).catch((e) => console.log(e.message));
  process.exit(0);
}
main();

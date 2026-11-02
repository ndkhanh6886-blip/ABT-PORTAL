// Workflow-step notices of the Khối Kỹ thuật – Nhà máy (see TRANSITION_NOTICES): one outbox handler per step.
import { notifyUsers, usersWithPermission, usersWithPermissionAnywhere } from "./core/notifications";
import { getMachine } from "./core/stateMachine";
import { onEvent } from "./core/worker";
import { TRANSITION_NOTICES, transitionNoticeType } from "./noticeMatrix";
// the machines behind the notices (registered on import)
import "./rd/ideas";
import "./rd/projects";
import "./rd/eln";
import "./rd/transfer";
import "./rd/workPlans";
import "./oligo/batches";
import "./oligo/sequences";
import "./device/models";
import "./device/assembly";
import "./device/serviceTickets";
import "./device/subcontract";
import "./kit/bomRouting";
import "./kit/ordersEbr";
import "./qms/qcTests";
import "./qms/ncr";
import "./qms/documents";
import "./inv/lots";
import "./purchase/requests";

const TAB: Record<string, string> = {
  "Nghiên cứu R&D": "factory-rd",
  "Tổng hợp Oligo": "factory-oligo",
  "Kỹ thuật – Thiết bị": "factory-device",
  "Sản xuất Kit": "factory-kit",
  "QA/QC": "factory-qa",
  "Kho Nhà máy": "factory-warehouse",
  "Mua hàng Nhà máy": "factory-purchase",
};

for (const n of TRANSITION_NOTICES) {
  onEvent(`${n.entity}.${n.action}`, async (tx, ev) => {
    const machine = getMachine(n.entity);
    if (!machine) return;
    const row = (await tx.query(`SELECT * FROM ${machine.table} WHERE id = $1`, [ev.payload.id])).rows[0];
    if (!row) return;
    const scope = await machine.scopeOf?.(row, tx);
    const users = scope ? await usersWithPermission(tx, n.notify, scope) : await usersWithPermissionAnywhere(tx, n.notify);
    const label = row.code ?? row.name ?? row.title ?? "";
    await notifyUsers(
      tx,
      users.filter((u) => u !== ev.payload.by),
      {
        type: transitionNoticeType(n.entity, n.action),
        title: label ? `${n.name}: ${label}` : n.name,
        body: row.title && row.title !== label ? row.title : null,
        entityType: n.entity,
        entityId: String(row.id),
        link: TAB[n.dept] ? `/?tab=${TAB[n.dept]}` : null,
        sourceKey: `notice_${ev.id}`,
      }
    );
  });
}

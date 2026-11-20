import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../../__tests__/helpers";
import { vnToday } from "../../core/dates";
import { closeFactoryPool, getFactoryPool, withTransaction, type Tx } from "../../core/db";
import { migrate } from "../../db/migrate";
import { getFactoryWorkhubData } from "../service";

class RollbackAfterTest extends Error {}

describe("factory/workhub cross-department aggregation", () => {
  beforeAll(async () => {
    await migrate(getFactoryPool());
  });

  afterAll(async () => {
    await closeFactoryPool();
  });

  it("aggregates active work items, Stage-Gate projects, and weekly plans across all technical departments", async () => {
    const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
    const today = vnToday();

    try {
      await withTransaction(async (tx: Tx) => {
        const insertOrg = async (prefix: string, name: string, moduleKey: string): Promise<string> => {
          const res = await tx.query(
            `INSERT INTO core.org_unit (code, name, unit_type, module_key)
             VALUES ($1, $2, 'DEPARTMENT', $3)
             RETURNING id`,
            [`${prefix}-${tag}`, name, moduleKey]
          );
          return String(res.rows[0].id);
        };

        const rdOrgId = await insertOrg("P-RD", "Phòng R&D Test", "RD");
        const kitOrgId = await insertOrg("P-KIT", "Phòng SX Kit Test", "KIT");
        const oligoOrgId = await insertOrg("P-OLIGO", "Phòng Oligo Test", "OLIGO");
        const deviceOrgId = await insertOrg("P-DEVICE", "Phòng KTCN Test", "DEVICE");
        await insertOrg("P-QA", "Phòng QA/QC Test", "QA");
        await insertOrg("P-PUR", "Phòng Cung ứng KT Test", "PURCHASE");
        const whOrgId = await insertOrg("P-WH", "Kho Nhà Máy Test", "WH");

        const insertProfile = async (displayName: string, orgUnitId: string): Promise<number> => {
          const res = await tx.query(
            `INSERT INTO core.user_profile (user_id, display_name, org_unit_id)
             SELECT greatest(coalesce(max(user_id), 0), 899999) + 1, $1, $2
               FROM core.user_profile
             RETURNING user_id`,
            [displayName, orgUnitId]
          );
          return Number(res.rows[0].user_id);
        };

        const rdUserId = await insertProfile(`Nguyễn Văn R&D ${tag}`, rdOrgId);
        const kitUserId = await insertProfile(`Lê Thị Kit ${tag}`, kitOrgId);
        const deviceUserId = await insertProfile(`Trần Văn Thiết Bị ${tag}`, deviceOrgId);

        await tx.query(
          `INSERT INTO master.uom (code, name, dimension)
           VALUES ('KIT', 'Bộ Kit', 'COUNT')
           ON CONFLICT (code) DO NOTHING`
        );

        const whRes = await tx.query(
          `INSERT INTO master.warehouse (code, name, owner_org_unit_id, purpose)
           VALUES ($1, $2, $3, 'RAW')
           RETURNING id`,
          [`WH-${tag}`, `Kho Nhà Máy Test ${tag}`, whOrgId]
        );
        const whId = String(whRes.rows[0].id);

        const itemRes = await tx.query(
          `INSERT INTO master.item (code, name, item_type, base_uom, created_by)
           VALUES ($1, $2, 'FINISHED_KIT', 'KIT', $3)
           RETURNING id`,
          [`KIT-ITEM-${tag}`, "Bộ Kit Chuẩn Nội Tổng Hợp Alpha-01", rdUserId]
        );
        const kitItemId = String(itemRes.rows[0].id);

        const tplRes = await tx.query(
          `INSERT INTO rd.gate_template (code, name, domain, created_by)
           VALUES ($1, $2, 'KIT', $3)
           RETURNING id`,
          [`TPL-${tag}`, `Stage-Gate Template ${tag}`, rdUserId]
        );
        const tplId = String(tplRes.rows[0].id);

        const rdProjRes = await tx.query(
          `INSERT INTO rd.project (
             code, name, owner_org_unit_id, project_type, target_domain, ivd_class,
             leader_id, gate_template_id, current_stage, status, planned_start, planned_end, created_by
           )
           VALUES ($1, $2, $3, 'NEW_PRODUCT', 'KIT', 'CLASS_B', $4, $5, 'G1_FEASIBILITY', 'ACTIVE', $6, $6, $4)
           RETURNING id`,
          [`PRJ-RD-${tag}`, "Nghiên cứu tối ưu bộ tách chiết Alpha-01", rdOrgId, rdUserId, tplId, today]
        );
        const rdProjId = String(rdProjRes.rows[0].id);

        await tx.query(
          `INSERT INTO rd.project_gate (project_id, gate_no, gate_name, stage_after, status)
           VALUES ($1, 1, 'Khả thi', 'G2_DEVELOPMENT', 'OPEN')`,
          [rdProjId]
        );

        await tx.query(
          `INSERT INTO rd.project_task (
             code, project_id, gate_no, title, assignee_name, due_date, status, progress_pct, created_by
           )
           VALUES ($1, $2, 1, $3, $4, $5, 'IN_PROGRESS', 45, $6)`,
          [
            `WBS-${tag}`,
            rdProjId,
            "Khảo sát thông số đệm tách chiết Alpha-01",
            `Nguyễn Văn R&D ${tag}`,
            today,
            rdUserId,
          ]
        );

        const expRes = await tx.query(
          `INSERT INTO rd.experiment (
             code, project_id, org_unit_id, title, objective, status, created_by, performer_name
           )
           VALUES ($1, NULL, $2, $3, $4, 'IN_PROGRESS', $5, $6)
           RETURNING id`,
          [
            `EXP-${tag}`,
            rdOrgId,
            "Đánh giá độ ổn định đệm ly trích Beta-02",
            "Kiểm tra độ ổn định trong 14 ngày",
            rdUserId,
            `Nguyễn Văn R&D ${tag}`,
          ]
        );
        const expId = String(expRes.rows[0].id);

        const devProjRes = await tx.query(
          `INSERT INTO rd.project (
             code, name, owner_org_unit_id, project_type, target_domain, ivd_class,
             leader_id, gate_template_id, current_stage, status, planned_start, planned_end, created_by
           )
           VALUES ($1, $2, $3, 'NEW_PRODUCT', 'DEVICE', 'NA', $4, $5, 'G2_DESIGN_DEV', 'ACTIVE', $6, $6, $4)
           RETURNING id`,
          [`PRJ-DEV-${tag}`, "Phát triển Thiết bị Gia nhiệt Khối Độc lập DX-100", deviceOrgId, deviceUserId, tplId, today]
        );
        const devProjId = String(devProjRes.rows[0].id);

        const bomRes = await tx.query(
          `INSERT INTO kit.bom (code, org_unit_id, product_item_id, name, base_uom, created_by)
           VALUES ($1, $2, $3, 'BOM Alpha-01', 'KIT', $4)
           RETURNING id`,
          [`BOM-${tag}`, kitOrgId, kitItemId, kitUserId]
        );
        const bomId = String(bomRes.rows[0].id);

        const routingRes = await tx.query(
          `INSERT INTO kit.routing (code, org_unit_id, product_item_id, name, created_by)
           VALUES ($1, $2, $3, 'Routing Alpha-01', $4)
           RETURNING id`,
          [`RTG-${tag}`, kitOrgId, kitItemId, kitUserId]
        );
        const routingId = String(routingRes.rows[0].id);

        await tx.query(
          `INSERT INTO kit.production_order (
             code, org_unit_id, product_item_id, bom_id, routing_id, warehouse_id,
             planned_qty, uom, priority, status, team_lead_name, created_by
           )
           VALUES ($1, $2, $3, $4, $5, $6, 100, 'KIT', 'HIGH', 'IN_PROGRESS', $7, $8)`,
          [`LSX-${tag}`, kitOrgId, kitItemId, bomId, routingId, whId, `Lê Thị Kit ${tag}`, kitUserId]
        );

        await tx.query(
          `INSERT INTO oligo.oligo_order (
             code, org_unit_id, customer_label, due_date, notes, status, created_by
           )
           VALUES ($1, $2, 'Phòng Lab Đối Tác Gamma', $3, 'Đơn tổng hợp đoạn dò thử nghiệm', 'IN_PROGRESS', $4)`,
          [`OLI-${tag}`, oligoOrgId, today, rdUserId]
        );

        const mdlRes = await tx.query(
          `INSERT INTO device.device_model (
             code, name, org_unit_id, category, rd_project_id, created_by
           )
           VALUES ($1, 'Máy Gia nhiệt DX-100', $2, 'THERMAL_CYCLER', $3, $4)
           RETURNING id`,
          [`MDL-${tag}`, deviceOrgId, devProjId, deviceUserId]
        );
        const modelId = String(mdlRes.rows[0].id);

        const revRes = await tx.query(
          `INSERT INTO device.model_revision (
             model_id, revision, dmr_summary, status, created_by
           )
           VALUES ($1, 'RevA', 'Hồ sơ thiết kế gốc DMR Rev A', 'RELEASED', $2)
           RETURNING id`,
          [modelId, deviceUserId]
        );
        const revId = String(revRes.rows[0].id);

        const doRes = await tx.query(
          `INSERT INTO device.device_order (
             code, org_unit_id, model_id, model_revision_id, warehouse_id,
             qty, priority, status, lead_engineer_id, created_by
           )
           VALUES ($1, $2, $3, $4, $5, 2, 'HIGH', 'IN_PRODUCTION', $6, $6)
           RETURNING id`,
          [`DO-${tag}`, deviceOrgId, modelId, revId, whId, deviceUserId]
        );
        const devOrderId = String(doRes.rows[0].id);

        const unitRes = await tx.query(
          `INSERT INTO device.device_unit (
             serial_no, order_id, model_id, model_revision_id, status, customer_name
           )
           VALUES ($1, $2, $3, $4, 'IN_SERVICE_FIELD', 'Trung tâm Kiểm chuẩn Delta')
           RETURNING id`,
          [`SN-DX-${tag}`, devOrderId, modelId, revId]
        );
        const unitId = String(unitRes.rows[0].id);

        await tx.query(
          `INSERT INTO device.service_ticket (
             code, org_unit_id, unit_id, ticket_type, symptom, assigned_to, status, created_by
           )
           VALUES ($1, $2, $3, 'REPAIR', 'Hiệu chỉnh cảm biến khối nhiệt', $4, 'OPEN', $4)`,
          [`SRV-${tag}`, deviceOrgId, unitId, deviceUserId]
        );

        await tx.query(
          `INSERT INTO qms.ncr (
             code, entity_type, entity_id, description, disposition, status, created_by
           )
           VALUES ($1, 'KIT_LOT', $2, 'Kiểm tra nhãn phụ kiện lô thử nghiệm', 'PENDING', 'OPEN', $3)`,
          [`NCR-${tag}`, rdProjId, rdUserId]
        );

        await tx.query(
          `INSERT INTO purchase.purchase_request (
             code, org_unit_id, requester_id, target_warehouse_id, needed_by, reason, status, created_by
           )
           VALUES ($1, $2, $3, $4, $5, 'Mua vật tư tiêu hao phòng sạch', 'SUBMITTED', $3)`,
          [`PR-${tag}`, kitOrgId, kitUserId, whId, today]
        );

        await tx.query(
          `INSERT INTO intake.internal_order (
             code, kd_po_id, kd_po_code, org_unit_id, ship_mode, requested_date, committed_date, status, created_by
           )
           VALUES ($1, 9001, $2, $3, 'TO_KD', $4, $4, 'IN_PRODUCTION', $5)`,
          [`IO-${tag}`, `PO-KD-${tag}`, kitOrgId, today, kitUserId]
        );

        const wpRes = await tx.query(
          `INSERT INTO work.work_plan (code, user_id, org_unit_id, week_start, status, created_by)
           VALUES ($1, $2, $3, $4, 'APPROVED', $2)
           RETURNING id`,
          [`WP-${tag}`, rdUserId, rdOrgId, today]
        );
        const wpId = String(wpRes.rows[0].id);

        await tx.query(
          `INSERT INTO work.work_task (
             plan_id, title, day_of_week, time_slot, project_id, experiment_id, target_metric, status, created_by
           )
           VALUES ($1, $2, 1, 'MORNING', $3, $4, 'Độ lặp lại CV < 5%', 'IN_PROGRESS', $5)`,
          [wpId, `Thử nghiệm đệm Alpha-01 tuần ${tag}`, rdProjId, expId, rdUserId]
        );

        const result = await getFactoryWorkhubData(tx, rdUserId);

        expect(result.currentUserFactoryDept).toBe("Nghiên Cứu R&D");
        expect(result.userFactoryDepts).toContain("Nghiên Cứu R&D");

        const wbsItem = result.workItems.find((w) => w.code === `WBS-${tag}`);
        expect(wbsItem).toBeDefined();
        expect(wbsItem?.dept).toBe("Nghiên Cứu R&D");
        expect(wbsItem?.isOpenForSchedule).toBe(true);
        expect(wbsItem?.assigneeUserIds).toContain(rdUserId);

        const elnItem = result.workItems.find((w) => w.code === `EXP-${tag}`);
        expect(elnItem).toBeDefined();
        expect(elnItem?.dept).toBe("Nghiên Cứu R&D");
        expect(elnItem?.isOpenForSchedule).toBe(true);
        expect(elnItem?.assigneeUserIds).toContain(rdUserId);

        const kitItem = result.workItems.find((w) => w.code === `LSX-${tag}`);
        expect(kitItem).toBeDefined();
        expect(kitItem?.dept).toBe("Sản Xuất Kit");

        const oligoItem = result.workItems.find((w) => w.code === `OLI-${tag}`);
        expect(oligoItem).toBeDefined();
        expect(oligoItem?.dept).toBe("Tổng Hợp Oligo");

        const deviceOrderItem = result.workItems.find((w) => w.code === `DO-${tag}`);
        expect(deviceOrderItem).toBeDefined();
        expect(deviceOrderItem?.dept).toBe("Kỹ Thuật – Thiết Bị");

        const srvItem = result.workItems.find((w) => w.code === `SRV-${tag}`);
        expect(srvItem).toBeDefined();
        expect(srvItem?.dept).toBe("Kỹ Thuật – Thiết Bị");

        const ncrItem = result.workItems.find((w) => w.code === `NCR-${tag}`);
        expect(ncrItem).toBeDefined();
        expect(ncrItem?.dept).toBe("QA/QC");

        const prItem = result.workItems.find((w) => w.code === `PR-${tag}`);
        expect(prItem).toBeDefined();
        expect(prItem?.dept).toBe("Cung Ứng Kỹ Thuật");

        const ioItem = result.workItems.find((w) => w.code === `IO-${tag}`);
        expect(ioItem).toBeDefined();
        expect(ioItem?.dept).toBe("Sản Xuất Kit");
        expect(ioItem?.involvedDepts).not.toContain("Kinh Doanh");
        expect(ioItem?.includeInTaskBoard).toBe(false);

        const rdProj = result.projects.find((p) => p.id === `PRJ-RD-${tag}`);
        expect(rdProj).toBeDefined();
        expect(rdProj?.typeId).toBe("rd_stage_gate");
        expect(rdProj?.targetTab).toBe("factory-rd");

        const ktcnProj = result.projects.find((p) => p.id === `PRJ-DEV-${tag}`);
        expect(ktcnProj).toBeDefined();
        expect(ktcnProj?.typeId).toBe("ktcn_stage_gate");
        expect(ktcnProj?.targetTab).toBe("factory-device");

        const wpEvent = result.weeklyPlans.find((e) => e.title.includes(`Thử nghiệm đệm Alpha-01 tuần ${tag}`));
        expect(wpEvent).toBeDefined();
        expect(wpEvent?.isHubWeeklyPlan).toBe(true);
        expect(wpEvent?.category).toBe("Nghiên Cứu R&D");

        throw new RollbackAfterTest("rollback synthetic workhub test fixtures");
      });
    } catch (err) {
      if (!(err instanceof RollbackAfterTest)) {
        throw err;
      }
    }
  });
});

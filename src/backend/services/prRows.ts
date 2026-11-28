import { query } from "@/backend/db/db";
import { deletedOrderCodes } from "@/backend/services/deletedOrders";
import { todayVN, nowVNDateTime } from "@/backend/services/dates";

/**
 * Đề xuất mua hàng (PR) được lưu trong bảng workflow_requests chung với "Quy trình phối hợp".
 * Một dòng là PR khi: mã PR…, loại PROCUREMENT / PURCHASE_REQUEST, hoặc phiếu phối hợp 1 bước gửi thẳng Cung Ứng
 * (quy trình nhiều bước khác — bảo trì, sửa chữa… — có 1 bước do Cung Ứng xử lý thì không phải PR).
 *
 * Cung ứng chỉ hiện các dòng này; Quy trình phối hợp KHÔNG hiện chúng (11/2026: mỗi ngày lên rất nhiều PR, để chung
 * với quy trình phối hợp làm rối — PR chỉ cần nằm ở Cung ứng cho người mua hàng xử lý).
 */
export const PR_ROW_SQL = `(
  workflow_code LIKE 'PR%' OR workflow_code ILIKE '%PR-%' OR workflow_type ILIKE '%PROCUREMENT%' OR workflow_type = 'PURCHASE_REQUEST'
  OR (target_dept ILIKE '%Cung%' AND jsonb_array_length(CASE WHEN jsonb_typeof(steps) = 'array' THEN steps ELSE '[]'::jsonb END) <= 1)
)`;

/** Điều kiện SQL: dòng KHÔNG phải PR (an toàn với giá trị NULL). */
export const NOT_PR_ROW_SQL = `NOT COALESCE(${PR_ROW_SQL}, false)`;

const GENERIC_REP_NAMES = new Set([
  "",
  "bộ phận kho vận",
  "phòng kinh doanh",
  "phòng cung ứng",
  "nhân viên kinh doanh",
  "nguyễn đăng khánh",
  "system",
  "hệ thống",
  "system administrator",
  "admin",
]);

function isGenericRepName(name: any): boolean {
  return GENERIC_REP_NAMES.has(String(name || "").trim().toLowerCase());
}

function parseArr(v: any): any[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normIsoDate(v: any): string {
  if (!v) return todayVN();
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return todayVN();
}

/**
 * Đồng bộ & tự động khôi phục:
 * 1. Các đơn SO Stock trước đây bị gán cứng NVKD = "Bộ Phận Kho Vận" hoặc bị mất cờ STOCK khi đổi tên pháp nhân sang
 *    "Công ty TNHH Giải pháp Y sinh ABT": khôi phục đúng tên NVKD đã tạo đơn từ audit_logs / phiếu PR liên kết.
 * 2. Các đơn SO (kể cả SO Stock như SO26-STOCK-1101, SO26-STOCK-1102) đã ghi nhận mã PR (pr_code / prCode) trên đơn
 *    nhưng chưa có bản ghi tương ứng trong bảng workflow_requests: tự động tái tạo phiếu PR trong workflow_requests
 *    để hiển thị đầy đủ bên phân hệ Cung Ứng.
 */
export async function reconcileStockOrdersAndPRs(fallbackActorName?: string): Promise<void> {
  try {
    const [deletedSet, dbOrdersRes, storageRes, prRes, auditRes, personnelRes] = await Promise.all([
      deletedOrderCodes({ query }).catch(() => new Set<string>()),
      query(
        `SELECT id, order_code, customer_name, sales_rep_name, sales_rep_id, order_date, items, total_amount,
                delivery_status, approval_status, applied_price_policy, pr_code, procure_status, procure_order_code,
                notes, order_notes
           FROM sales_orders
          ORDER BY id ASC`
      ),
      query("SELECT data, version FROM app_storage WHERE key = 'sales_factory_orders'").catch(() => ({ rows: [] as any[] })),
      query(`SELECT id, workflow_code, title, status, requester_name, requester_dept, description, logs FROM workflow_requests WHERE ${PR_ROW_SQL}`),
      query(
        `SELECT details, actor_name, actor_username
           FROM audit_logs
          WHERE module IN ('SALES_ORDER', 'PROCUREMENT')
            AND actor_name IS NOT NULL
            AND TRIM(actor_name) <> ''
          ORDER BY id ASC`
      ).catch(() => ({ rows: [] as any[] })),
      query("SELECT employee_code, full_name, department FROM personnel").catch(() => ({ rows: [] as any[] })),
    ]);

    const personnelByName = new Map<string, { code: string; dept: string }>();
    for (const p of personnelRes.rows || []) {
      const fn = String(p.full_name || "").trim().toLowerCase();
      if (fn) {
        personnelByName.set(fn, {
          code: String(p.employee_code || "").trim(),
          dept: String(p.department || "Kinh Doanh").trim(),
        });
      }
    }

    const auditLogs = (auditRes.rows || []).filter((r: any) => !isGenericRepName(r.actor_name));
    const findCreatorFromAudit = (orderCode: string, prCode?: string): string => {
      const oc = String(orderCode || "").trim();
      const pc = String(prCode || "").trim();
      for (const row of auditLogs) {
        const det = String(row.details || "");
        if ((oc && det.includes(oc)) || (pc && det.includes(pc))) {
          return String(row.actor_name).trim();
        }
      }
      return "";
    };

    const existingPrByCode = new Map<string, any>();
    const existingPrs = prRes.rows || [];
    for (const pr of existingPrs) {
      const wc = String(pr.workflow_code || "").trim().toUpperCase();
      if (wc) existingPrByCode.set(wc, pr);
    }

    const findPrForOrder = (orderCode: string, prCode?: string): any => {
      const pc = String(prCode || "").trim().toUpperCase();
      if (pc && existingPrByCode.has(pc)) return existingPrByCode.get(pc);
      const oc = String(orderCode || "").trim();
      if (!oc) return null;
      return existingPrs.find(
        (r: any) =>
          !["CANCELLED", "REJECTED"].includes(String(r.status || "").toUpperCase()) &&
          (`${r.title || ""} ${r.description || ""}`.includes(oc))
      ) || null;
    };

    const storageRow = storageRes.rows[0];
    const storageList: any[] = Array.isArray(storageRow?.data) ? [...storageRow.data] : [];
    let storageChanged = false;

    const storageByCode = new Map<string, any>();
    for (const fo of storageList) {
      const k = String(fo?.order_code || fo?.id || "").trim();
      if (k) storageByCode.set(k, fo);
    }

    const dbByCode = new Map<string, any>();
    for (const r of dbOrdersRes.rows || []) {
      const k = String(r.order_code || "").trim();
      if (k) dbByCode.set(k, r);
    }

    const cleanFallbackActor = !isGenericRepName(fallbackActorName) ? String(fallbackActorName || "").trim() : "";

    // 1. Đồng bộ đơn từ app_storage vào sales_orders nếu đơn SO26-STOCK-* chưa lưu được vào CSDL trước đó
    for (const fo of storageList) {
      const code = String(fo?.order_code || fo?.id || "").trim();
      if (!code || !code.startsWith("SO") || deletedSet.has(code.toUpperCase())) continue;
      const isCancelled = ["CANCELLED", "Cancelled", "Rejected", "REJECTED"].includes(String(fo?.status || fo?.delivery_status || ""));
      const isStockCode = /^SO\d{2}-STOCK-/i.test(code) || Boolean(fo?.isStockOrder || fo?.orderCategory === "STOCK");
      if (!dbByCode.has(code) && isStockCode && !isCancelled) {
        const prCode = String(fo?.prCode || fo?.pr_code || "").trim() || null;
        const matchedPr = findPrForOrder(code, prCode || undefined);
        const prRequester = matchedPr && !isGenericRepName(matchedPr.requester_name) ? String(matchedPr.requester_name).trim() : "";
        const auditCreator = findCreatorFromAudit(code, prCode || undefined);
        const currentRep = !isGenericRepName(fo?.salesRepName || fo?.sales_rep_name)
          ? String(fo.salesRepName || fo.sales_rep_name).trim()
          : "";
        const resolvedRep = currentRep || auditCreator || prRequester || cleanFallbackActor || "Phòng Kinh Doanh";
        const resolvedEmp = personnelByName.get(resolvedRep.toLowerCase())?.code || fo?.salesRepId || "NV-TBR-018";
        const custName = String(fo?.customerName || fo?.customer_name || "Công ty TNHH Giải pháp Y sinh ABT").trim();
        const itemsArr = parseArr(fo?.items);
        const totalAmt = Number(fo?.totalAmount ?? fo?.total_amount ?? 0) || 0;
        const ordDate = normIsoDate(fo?.order_date || fo?.date);

        const ins = await query(
          `INSERT INTO sales_orders (
             order_code, customer_name, sales_rep_name, sales_rep_id, order_date, items, total_amount,
             delivery_status, payment_status, invoice_status, notes, order_notes,
             is_credit_blocked, has_zero_price_items, price_approval_status, approval_status, applied_price_policy,
             pr_code, procure_status, procure_order_code, fulfillment_source
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'PENDING', 'UNPAID', 'NO_INVOICE', $8, $9,
                     FALSE, FALSE, 'APPROVED', 'APPROVED', 'STOCK', $10, $11, $12, 'PROCURE')
           ON CONFLICT (order_code) DO NOTHING
           RETURNING *`,
          [
            code,
            custName,
            resolvedRep,
            resolvedEmp,
            ordDate,
            JSON.stringify(itemsArr),
            totalAmt,
            fo?.notes || "[SO STOCK - LƯU KHO GỐI ĐẦU]",
            fo?.orderNotes || fo?.order_notes || null,
            prCode,
            fo?.procureStatus || fo?.procure_status || (prCode ? "PR_PENDING" : "PENDING"),
            fo?.procureOrderCode || fo?.procure_order_code || null,
          ]
        ).catch(() => ({ rows: [] as any[] }));
        if (ins.rows[0]) {
          dbByCode.set(code, ins.rows[0]);
        }
      }
    }

    // 2. Đối soát từng đơn hàng trong sales_orders + app_storage
    const allOrderCodes = new Set<string>([...dbByCode.keys(), ...storageByCode.keys()]);
    for (const code of allOrderCodes) {
      if (!code || deletedSet.has(code.toUpperCase())) continue;
      const dbOrd = dbByCode.get(code);
      const fo = storageByCode.get(code);
      const isCancelled =
        String(dbOrd?.delivery_status || "").toUpperCase() === "CANCELLED" ||
        String(dbOrd?.approval_status || "").toUpperCase() === "CANCELLED" ||
        ["Cancelled", "CANCELLED", "Rejected"].includes(String(fo?.status || ""));

      const isStockOrder =
        /^SO\d{2}-STOCK-/i.test(code) ||
        String(dbOrd?.applied_price_policy || "").toUpperCase() === "STOCK" ||
        Boolean(fo?.isStockOrder || fo?.orderCategory === "STOCK");

      const prCodeRaw = String(dbOrd?.pr_code || fo?.prCode || fo?.pr_code || "").trim();
      const prCode = /^PR\d{2}-/i.test(prCodeRaw) ? prCodeRaw : "";
      const matchedPr = findPrForOrder(code, prCode || undefined);

      // Xác định tên NVKD thật đã tạo đơn
      const dbRep = !isGenericRepName(dbOrd?.sales_rep_name) ? String(dbOrd.sales_rep_name).trim() : "";
      const foRep = !isGenericRepName(fo?.salesRepName || fo?.sales_rep_name) ? String(fo.salesRepName || fo.sales_rep_name).trim() : "";
      const prRep = matchedPr && !isGenericRepName(matchedPr.requester_name) ? String(matchedPr.requester_name).trim() : "";
      const auditRep = (isStockOrder && !dbRep && !foRep) ? findCreatorFromAudit(code, prCode || undefined) : "";
      const realRepName = dbRep || foRep || auditRep || prRep || (isStockOrder ? cleanFallbackActor : "");
      const realEmpInfo = realRepName ? personnelByName.get(realRepName.toLowerCase()) : undefined;

      if (dbOrd) {
        const sets: string[] = [];
        const params: any[] = [];
        const addSet = (col: string, val: any) => {
          params.push(val);
          sets.push(`${col} = $${params.length}`);
        };

        if (realRepName && dbOrd.sales_rep_name !== realRepName && isGenericRepName(dbOrd.sales_rep_name)) {
          addSet("sales_rep_name", realRepName);
          dbOrd.sales_rep_name = realRepName;
          if (realEmpInfo?.code && (!dbOrd.sales_rep_id || dbOrd.sales_rep_id === "NV-TBR-007")) {
            addSet("sales_rep_id", realEmpInfo.code);
            dbOrd.sales_rep_id = realEmpInfo.code;
          }
        }
        if (isStockOrder && String(dbOrd.applied_price_policy || "").toUpperCase() !== "STOCK") {
          addSet("applied_price_policy", "STOCK");
          dbOrd.applied_price_policy = "STOCK";
        }
        if (prCode && !dbOrd.pr_code) {
          addSet("pr_code", prCode);
          dbOrd.pr_code = prCode;
        }
        if (prCode && !dbOrd.procure_status) {
          const nextSt = fo?.procureStatus || fo?.procure_status || "PR_PENDING";
          addSet("procure_status", nextSt);
          dbOrd.procure_status = nextSt;
        }
        if (sets.length > 0) {
          params.push(dbOrd.id);
          await query(`UPDATE sales_orders SET ${sets.join(", ")} WHERE id = $${params.length}`, params).catch(() => {});
        }
      }

      if (fo) {
        if (realRepName && isGenericRepName(fo.salesRepName)) {
          fo.salesRepName = realRepName;
          if (realEmpInfo?.code && (!fo.salesRepId || fo.salesRepId === "NV-TBR-007")) {
            fo.salesRepId = realEmpInfo.code;
          }
          storageChanged = true;
        }
        if (isStockOrder && (!fo.isStockOrder || fo.orderCategory !== "STOCK")) {
          fo.isStockOrder = true;
          fo.orderCategory = "STOCK";
          storageChanged = true;
        }
      }

      // Cập nhật người đề xuất trên phiếu PR nếu đang bị ghi là "Bộ Phận Kho Vận"
      if (matchedPr && realRepName && isGenericRepName(matchedPr.requester_name)) {
        const dept = realEmpInfo?.dept || "Kinh Doanh";
        await query(
          "UPDATE workflow_requests SET requester_name = $1, requester_dept = $2 WHERE id = $3",
          [realRepName, dept, matchedPr.id]
        ).catch(() => {});
        matchedPr.requester_name = realRepName;
        matchedPr.requester_dept = dept;
      }

      // 3. Nếu đơn chưa hủy, đã có mã PR (vd PR26-STOCK-1101, PR26-STOCK-1102) nhưng trong workflow_requests chưa có phiếu PR này -> tái tạo ngay
      if (!isCancelled && prCode && !existingPrByCode.has(prCode.toUpperCase()) && !matchedPr) {
        const rawItems = parseArr(dbOrd?.items?.length ? dbOrd.items : fo?.items);
        const structuredItems = rawItems
          .filter((it: any) => it && String(it.status || "").toUpperCase() !== "CANCELLED")
          .map((it: any) => {
            const pCode = String(it.productCode || it.product_code || it.code || "").trim();
            const pName = String(it.productName || it.product_name || it.name || pCode || "Mặt hàng").trim();
            const qty = Number(it.procureQuantity ?? it.quantity ?? it.qty) || 1;
            const price = Number(it.costPrice ?? it.unitPrice ?? it.unit_price ?? it.price) || 0;
            return {
              is_custom: false,
              product_code: pCode,
              product_name: pName,
              specification: String(it.specification || "").trim(),
              sequence: it.sequence || undefined,
              packagingForm: it.packagingForm || undefined,
              icForm: it.icForm || undefined,
              tubeType: it.tubeType || undefined,
              accessorySet: it.accessorySet || undefined,
              unit: String(it.unit || "Hộp").trim(),
              quantity: qty > 0 ? qty : 1,
              estimated_price: price,
              unit_price: price,
              notes: String(it.notes || "").trim(),
              original_order_qty: Number(it.quantity ?? it.qty) || 1,
            };
          })
          .filter((it: any) => Boolean(it.product_code));

        if (structuredItems.length > 0) {
          const summaryText = structuredItems
            .map((it: any) => {
              const spec = it.specification ? ` (${it.specification})` : "";
              return `${it.product_code}: ${it.product_name}${spec} - SL: ${it.quantity} ${it.unit || "Hộp"}`;
            })
            .join(" | ");
          const custName = String(
            dbOrd?.customer_name || fo?.customerName || (isStockOrder ? "Công ty TNHH Giải pháp Y sinh ABT" : "Khách hàng")
          ).trim();
          const prTitle = `Đề xuất mua hàng bổ sung cho đơn ${code} - ${custName}`;
          const reqName = realRepName || cleanFallbackActor || "Phòng Kinh Doanh";
          const reqDept = realEmpInfo?.dept || "Kinh Doanh";
          const dueDate = normIsoDate(fo?.procureDueDate || fo?.requestedDeliveryDate || fo?.estimatedDeliveryDate || dbOrd?.order_date);
          const descNotes = String(fo?.procureNotes || dbOrd?.order_notes || fo?.orderNotes || "").trim();
          const description = `[Đơn bán ${code}]${descNotes ? ` ${descNotes}` : ""}`.trim();
          const poCode = String(dbOrd?.procure_order_code || fo?.procureOrderCode || "").trim();
          const prStatus = poCode ? "CONVERTED" : "PENDING";

          const insPr = await query(
            `INSERT INTO workflow_requests (
               workflow_code, workflow_type, title, priority, status, requester_name, requester_dept,
               assignee_name, target_dept, customer_name, product_info, due_date, description,
               results_summary, attachments, comments, logs
             ) VALUES ($1, 'SALES_TO_PROCUREMENT', $2, 'HIGH', $3, $4, $5, 'Trần Phương Uyên', 'Cung Ứng',
                       $6, $7, $8, $9, $10, '[]'::json, '[]'::json, $11)
             ON CONFLICT DO NOTHING
             RETURNING *`,
            [
              prCode,
              prTitle,
              prStatus,
              reqName,
              reqDept,
              custName,
              summaryText,
              dueDate,
              description,
              JSON.stringify(structuredItems),
              JSON.stringify([{ time: nowVNDateTime(), actor: reqName, action: `Đồng bộ đề xuất mua hàng PR từ đơn ${code}` }]),
            ]
          ).catch(() => ({ rows: [] as any[] }));

          if (insPr.rows[0]) {
            existingPrByCode.set(prCode.toUpperCase(), insPr.rows[0]);
            existingPrs.push(insPr.rows[0]);
          }
        }
      }
    }

    // 4. Đối soát toàn bộ phiếu PR (kể cả PR gộp nhiều đơn hoặc PR Stock):
    //    - Nếu PR gắn với các đơn bán SO (SO26-...), luôn ưu tiên hiển thị tên Nhân viên Kinh doanh (NVKD) phụ trách các đơn SO đó
    //    - Nếu requester_name đang là tên chung ("Bộ Phận Kho Vận", "Phòng Kinh Doanh"...), tự động truy nguyên tên NVKD từ đơn SO / nhật ký phiếu / audit_logs
    for (const pr of existingPrs) {
      const textToScan = `${pr.title || ""} ${pr.description || ""}`;
      const matchedSoCodes = Array.from(
        new Set(
          (textToScan.match(/\bSO\d{2}-[A-Z0-9-]+\b/gi) || []).map((c) => c.toUpperCase())
        )
      );
      const prCodeUpper = String(pr.workflow_code || "").trim().toUpperCase();
      for (const [ordCode, dbOrd] of dbByCode.entries()) {
        if (String(dbOrd?.pr_code || "").trim().toUpperCase() === prCodeUpper) {
          if (!matchedSoCodes.includes(ordCode.toUpperCase())) {
            matchedSoCodes.push(ordCode.toUpperCase());
          }
        }
      }

      const needRepFix = isGenericRepName(pr.requester_name);
      const needDeptFix = !pr.requester_dept || String(pr.requester_dept).trim() === "Kho Vận";
      if (!needRepFix && !needDeptFix && matchedSoCodes.length === 0) continue;

      const repSet: string[] = [];
      const pushRep = (candidate: any) => {
        const clean = String(candidate || "").trim();
        if (!clean || isGenericRepName(clean)) return;
        if (!repSet.some((x) => x.toLowerCase() === clean.toLowerCase())) {
          repSet.push(clean);
        }
      };

      // Kiểm tra ghi chú "[Đơn SO của NVKD: ...]" hoặc "(Đơn SO của NVKD: ...)" nếu có
      const ownerMatch = textToScan.match(/Đơn SO của NVKD:\s*([^\]\)\n•]+)/i);
      if (ownerMatch && ownerMatch[1]) {
        pushRep(ownerMatch[1]);
      }

      for (const soUpper of matchedSoCodes) {
        const dbOrd = Array.from(dbByCode.values()).find(
          (o) => String(o.order_code || "").trim().toUpperCase() === soUpper
        );
        const fo = Array.from(storageByCode.values()).find(
          (o) => String(o?.order_code || o?.id || "").trim().toUpperCase() === soUpper
        );
        pushRep(dbOrd?.sales_rep_name);
        pushRep(fo?.salesRepName || fo?.sales_rep_name);
        if (repSet.length === 0) {
          pushRep(findCreatorFromAudit(soUpper, pr.workflow_code));
        }
      }

      if (repSet.length === 0 && needRepFix) {
        const prLogs = parseArr(pr.logs);
        for (const lg of prLogs) {
          pushRep(lg?.actor);
        }
      }
      if (repSet.length === 0 && needRepFix && pr.workflow_code) {
        pushRep(findCreatorFromAudit("", pr.workflow_code));
      }

      const resolvedPrRequester = repSet.length > 0 ? repSet.join(", ") : (!needRepFix ? pr.requester_name : "");
      const firstRepInfo = repSet.length > 0 ? personnelByName.get(repSet[0].toLowerCase()) : undefined;
      const resolvedPrDept = firstRepInfo?.dept || (needDeptFix || matchedSoCodes.length > 0 ? "Kinh Doanh" : pr.requester_dept);

      if (
        (resolvedPrRequester && resolvedPrRequester !== pr.requester_name) ||
        (resolvedPrDept && resolvedPrDept !== pr.requester_dept)
      ) {
        const nextReqName = resolvedPrRequester || pr.requester_name || "Phòng Kinh Doanh";
        const nextReqDept = resolvedPrDept || "Kinh Doanh";
        await query(
          "UPDATE workflow_requests SET requester_name = $1, requester_dept = $2 WHERE id = $3",
          [nextReqName, nextReqDept, pr.id]
        ).catch(() => {});
        pr.requester_name = nextReqName;
        pr.requester_dept = nextReqDept;
      }
    }

    if (storageChanged && storageRow) {
      await query(
        "UPDATE app_storage SET data = $1::jsonb, version = COALESCE(version, 1) + 1, updated_at = NOW() WHERE key = 'sales_factory_orders'",
        [JSON.stringify(storageList)]
      ).catch(() => {});
    }
  } catch (err: any) {
    console.warn("[reconcileStockOrdersAndPRs] warning:", err?.message || err);
  }
}


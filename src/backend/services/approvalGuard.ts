import { query } from "@/backend/db/db";
import { AuthorizedUser, isAdminUser } from "@/backend/services/authz";
import { hasPermission } from "@/backend/services/permissions";
import { itemIdentity } from "@/backend/services/storagePatch";

/**
 * Server-side enforcement of approval decisions that are stored inside app_storage collections.
 *
 * Several approvals (sales order requests, specialized plans, weekly plans) live as a `status` field in
 * a JSON collection the browser saves. Without a check, any signed-in user could send "Approved".
 * Here every incoming item whose status moves INTO an approval decision is verified:
 *  - sales_factory_orders: must match the decision recorded in sales_orders by the approve_order API,
 *    or need no approval at all (no credit block, no pending 0đ price approval);
 *  - plans / weekly plans: the user saving must hold the approval permission (reviewer stamped by the server).
 * Unauthorised decisions are reverted to the stored status instead of failing the whole save.
 */

export function canApproveSalesOrders(user: AuthorizedUser | null): boolean {
  return Boolean(user && (isAdminUser(user) || hasPermission(user, "sales.approve_orders")));
}

type GuardRule = {
  decisions: Set<string>;
  pendingStatus: string;
  verify: (item: any, prev: any, user: AuthorizedUser | null) => Promise<boolean>;
  stamp?: (item: any, user: AuthorizedUser) => any;
};

async function orderDecisionAllowed(item: any, prev: any, user: AuthorizedUser | null): Promise<boolean> {
  const code = String(item?.order_code || item?.id || "").trim();
  const row = code
    ? (await query(
        "SELECT approval_status, is_credit_blocked, price_approval_status FROM sales_orders WHERE order_code = $1 LIMIT 1",
        [code]
      )).rows[0]
    : null;
  if (!row) {
    // Not in the database yet (the order row is written right after): a brand-new order without a credit
    // block / 0đ item is auto-approved by business rule; otherwise only an approver may decide. The loader
    // re-applies the database verdict once the row exists.
    if (!prev && item.status === "Approved" && !item.isCreditBlocked && item.priceApprovalStatus !== "PENDING_APPROVAL") return true;
    return canApproveSalesOrders(user);
  }
  if (item.status === "Rejected") return row.approval_status === "REJECTED";
  if (row.approval_status === "APPROVED") return true;
  if (row.approval_status === "REJECTED") return false;
  // Orders without a credit block / pending 0đ approval are approved automatically by business rule
  return !row.is_credit_blocked && row.price_approval_status !== "PENDING_APPROVAL";
}

const RULES: Record<string, GuardRule> = {
  sales_factory_orders: {
    decisions: new Set(["Approved", "Rejected"]),
    pendingStatus: "Pending",
    verify: orderDecisionAllowed,
  },
  sales_specialized_plans: {
    decisions: new Set(["Approved", "Rejected"]),
    pendingStatus: "Pending",
    verify: async (_item, _prev, user) => canApproveSalesOrders(user),
    stamp: (item, user) => ({ ...item, approvedBy: user.full_name || user.username, approvedAt: item.approvedAt || new Date().toISOString() }),
  },
  sales_weekly_approvals: {
    decisions: new Set(["APPROVED", "REJECTED"]),
    pendingStatus: "PENDING",
    verify: async (_item, _prev, user) => canApproveSalesOrders(user),
    stamp: (item, user) => ({ ...item, reviewerName: user.full_name || user.username, reviewedAt: item.reviewedAt || new Date().toISOString() }),
  },
};

/** Returns `incoming` with unauthorised approval decisions reverted (current = stored collection). */
export async function enforceApprovalGuards(key: string, current: any, incoming: any[], user: AuthorizedUser | null): Promise<any[]> {
  const rule = RULES[key];
  if (!rule || !Array.isArray(incoming)) return incoming;
  const currentMap = new Map<string, any>();
  if (Array.isArray(current)) {
    for (const item of current) {
      const id = itemIdentity(item);
      if (id !== null) currentMap.set(id, item);
    }
  }
  const result: any[] = [];
  for (const item of incoming) {
    const id = itemIdentity(item);
    const prev = id !== null ? currentMap.get(id) : undefined;
    const nextStatus = item?.status;
    if (!item || !rule.decisions.has(nextStatus) || (prev && prev.status === nextStatus)) {
      result.push(item);
      continue;
    }
    if (await rule.verify(item, prev, user)) {
      result.push(rule.stamp && user ? rule.stamp(item, user) : item);
    } else {
      console.warn(`[approvalGuard] ${user?.username || "?"} tried to set ${key} ${id} -> ${nextStatus} without approval; reverted`);
      result.push({ ...item, status: prev ? prev.status : rule.pendingStatus });
    }
  }
  return result;
}

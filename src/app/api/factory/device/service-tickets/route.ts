import { factoryRoute, idempotent } from "@/factory/http";
import {
  createServiceTicket,
  listServiceSchedules,
  listServiceTickets,
} from "@/factory/device/serviceTickets";

export const GET = factoryRoute(async (tx, { actor }) => {
  const [tickets, schedules] = await Promise.all([
    listServiceTickets(tx, actor),
    listServiceSchedules(tx, actor),
  ]);
  return { tickets, schedules };
});

export const POST = factoryRoute((tx, ctx) =>
  idempotent(tx, ctx, "POST /api/factory/device/service-tickets", () =>
    createServiceTicket(tx, ctx.actor, ctx.body)
  )
);

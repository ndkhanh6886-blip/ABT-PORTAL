import { factoryRoute } from "@/factory/http";

export const GET = factoryRoute(
  async (tx) =>
    (
      await tx.query(
        `SELECT code, name, dimension
           FROM master.uom
          WHERE status = 'ACTIVE'
            AND code !~ '^[-\u2013\u2014]+$'
            AND upper(code) NOT IN ('N/A', 'NA', 'NONE', 'NULL', '?')
          ORDER BY dimension, code`
      )
    ).rows
);

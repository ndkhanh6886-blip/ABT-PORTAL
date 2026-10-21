import { NextRequest, NextResponse } from "next/server";
import { query } from "@/backend/db/db";

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  let dbStatus = "unknown";
  let dbLatencyMs = 0;

  try {
    const dbStart = Date.now();
    await query("SELECT 1");
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "healthy";
  } catch (error: any) {
    dbStatus = `unhealthy: ${error.message}`;
  }

  const isHealthy = dbStatus === "healthy";

  // Endpoint công khai: chỉ trả trạng thái, không lộ lỗi CSDL / thông tin máy chủ
  const healthData = {
    status: isHealthy ? "OK" : "DEGRADED",
    service: "TBRs Portal",
    timestamp: new Date().toISOString(),
    database: { status: isHealthy ? "healthy" : "unhealthy", latencyMs: dbLatencyMs },
  };

  return NextResponse.json(healthData, {
    status: isHealthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

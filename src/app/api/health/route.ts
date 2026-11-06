import { NextRequest, NextResponse } from "next/server";
import { query } from "@/backend/db/db";

export async function GET(req: NextRequest) {
  let isHealthy = false;

  try {
    await query("SELECT 1");
    isHealthy = true;
  } catch {
    isHealthy = false;
  }

  // Endpoint công khai: chỉ trả trạng thái tối thiểu, không lộ phiên bản CSDL, độ trễ hay thông tin máy chủ
  return NextResponse.json(
    { status: isHealthy ? "OK" : "DEGRADED" },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

import { NextResponse } from "next/server";
import { requireCapability } from "../access";
import { getAiUsageProvider } from "../usage-provider";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireCapability("dashboard.view.self", "/portal/usage");
  const snapshot = await getAiUsageProvider().read();
  return NextResponse.json(snapshot, {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

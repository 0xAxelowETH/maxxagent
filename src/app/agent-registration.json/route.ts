import { NextResponse } from "next/server";
import { agentRegistration } from "@/lib/agentRegistration";

/** ERC-8004 agent registration file (see src/lib/agentRegistration.ts) */
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(agentRegistration(), { headers: { "Cache-Control": "public, max-age=300" } });
}

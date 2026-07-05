import { readUsage } from "@/server/usage-store";

export const runtime = "nodejs";

export function GET() {
  return Response.json(readUsage());
}

import { accountStatus } from "@/server/account";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await accountStatus());
}

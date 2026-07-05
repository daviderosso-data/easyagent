import { startLogin, waitForLogin } from "@/server/account";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 240;

// Opens the browser OAuth flow and waits (polling) for the user to complete it.
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  startLogin();
  const status = await waitForLogin();
  return Response.json(status);
}

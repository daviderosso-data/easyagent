import { defaultProvider } from "@/server/providers";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 240;

// Opens the browser OAuth flow and waits (polling) for the user to complete it.
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  const account = defaultProvider().account;
  if (!account) return Response.json({ loggedIn: false });
  account.startLogin();
  const status = await account.waitForLogin();
  return Response.json(status);
}

import { getProvider } from "@/server/providers";
import { tokenValid } from "@/server/security";

export const runtime = "nodejs";
export const maxDuration = 240;

// Opens the engine's browser OAuth flow and waits (polling) for the user to
// complete it. ?provider= selects the engine (default: Claude).
export async function POST(req: Request) {
  if (!tokenValid(req)) return Response.json({ error: "Unauthorized" }, { status: 403 });
  const provider = getProvider(new URL(req.url).searchParams.get("provider"));
  const account = provider?.account;
  if (!account) return Response.json({ loggedIn: false });
  const start = await account.startLogin();
  if (start && start.userCode) {
    // Device-code flow: reply NOW so the UI can show the code; the client
    // polls /api/account/status?provider= to detect completion.
    return Response.json({ loggedIn: false, pending: true, ...start });
  }
  const status = await account.waitForLogin();
  return Response.json(status);
}

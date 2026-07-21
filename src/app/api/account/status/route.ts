import { getProvider } from "@/server/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const provider = getProvider(new URL(req.url).searchParams.get("provider"));
  const account = provider?.account;
  return Response.json(account ? await account.status() : { loggedIn: false });
}

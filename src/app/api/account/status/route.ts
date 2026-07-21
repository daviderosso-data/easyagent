import { defaultProvider } from "@/server/providers";

export const runtime = "nodejs";

export async function GET() {
  const account = defaultProvider().account;
  return Response.json(account ? await account.status() : { loggedIn: false });
}

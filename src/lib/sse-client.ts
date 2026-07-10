import type { AgentEvent, SendRequest } from "@/lib/agent-events";

/** POST a prompt and stream back agent events (SSE over fetch).
 *  `onTurnId` fires as soon as the response headers arrive — before any SSE
 *  event — so Stop can target the server turn during SDK startup too. */
export async function streamAgent(
  body: SendRequest,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  token?: string | null,
  onTurnId?: (turnId: string) => void,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat/send", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-ccw-token": token } : {}) },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    onEvent({ type: "error", message: "Impossibile contattare il server locale." });
    return;
  }

  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `Errore del server (${res.status}).` });
    return;
  }

  const turnId = res.headers.get("x-turn-id");
  if (turnId && onTurnId) onTurnId(turnId);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine.slice(5).trim()) as AgentEvent);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch {
    // Reader aborted (Stop) — the server records the aborted result itself.
  }
}

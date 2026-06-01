import type { RunEvent } from "@/lib/events";
import { subscribeRun } from "@/lib/run-registry";

// Holds an in-process subscription to the run registry (a Node EventEmitter), so
// it must run on the Node runtime; SSE is inherently streaming, so never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint for a live judging run.
 *
 * Subscribes to the run registry and forwards every {@link RunEvent} as a framed
 * Server-Sent Event:
 *
 *     event: <type>\n
 *     data: <json>\n
 *     \n
 *
 * Reconnect replay: `subscribeRun` synchronously replays the run's buffered
 * events to the callback before forwarding live ones, so a client that drops and
 * reconnects (new EventSource → new request → new subscription) catches up on
 * everything emitted so far. Heartbeats are emitted by the registry as
 * `heartbeat` events and forwarded like any other event to keep the connection
 * warm. Unknown runs get an empty stream (nothing to replay, nothing live).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: RunEvent): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          // Controller already closed (client gone mid-flush); drop the event.
        }
      };
      // Replays the buffered events synchronously, then forwards live ones.
      unsubscribe = subscribeRun(id, send);
    },
    cancel() {
      // Client disconnected (or the reader was released): stop forwarding.
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

import { requireStaff, isErrorResponse } from "@/lib/staffApi";
import { currentRevision } from "@/lib/bus";

export const dynamic = "force-dynamic";

/**
 * Server-sent events: the floor's revision whenever it changes. Checks once a
 * second (one indexed row), and closes after ten minutes so the browser
 * reconnects and a long-lived connection never outlives a deploy.
 */
export async function GET(req: Request) {
  const session = await requireStaff();
  if (isErrorResponse(session)) return session;
  const restaurantId = session.restaurant.id;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = -1;
      let closed = false;
      const end = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearTimeout(stop);
        try {
          controller.close();
        } catch {}
      };
      const tick = async () => {
        try {
          const rev = await currentRevision(restaurantId);
          if (rev !== last && !closed) {
            last = rev;
            controller.enqueue(encoder.encode(`event: rev\ndata: ${rev}\n\n`));
          }
        } catch {
          end();
        }
      };
      const timer = setInterval(tick, 1000);
      const stop = setTimeout(end, 10 * 60_000);
      req.signal.addEventListener("abort", end);
      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      await tick();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

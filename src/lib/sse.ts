import type { AgentEvent } from "@/lib/types";

/** Wrap an AsyncGenerator<AgentEvent> as a text/event-stream Response. */
export function sseResponse(gen: AsyncGenerator<AgentEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      // Initial comment keeps some proxies from buffering.
      controller.enqueue(encoder.encode(": open\n\n"));
      try {
        for await (const evt of gen) {
          send(evt.type, evt);
        }
      } catch (err) {
        send("error", { type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        send("end", { type: "end" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

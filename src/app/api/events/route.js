export const dynamic = 'force-dynamic';

if (!global.sseClients) {
  global.sseClients = new Set();
}

export async function GET(request) {
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Helper to send events
  const sendEvent = (data) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch (e) {
      console.error("Error writing to SSE stream:", e);
    }
  };

  // Connection established ping
  sendEvent({ type: "connected", timestamp: new Date().toISOString() });

  const client = {
    send: sendEvent,
    close: () => {
      try {
        writer.close();
      } catch (e) {}
    }
  };

  global.sseClients.add(client);
  console.log(`SSE Client connected. Active clients: ${global.sseClients?.size || 0}`);

  // Handle client disconnect
  request.signal.addEventListener("abort", () => {
    global.sseClients.delete(client);
    client.close();
    console.log(`SSE Client disconnected. Active clients: ${global.sseClients?.size || 0}`);
  });

  return new Response(responseStream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}

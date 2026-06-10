export const dynamic = 'force-dynamic';

if (!global.sseClients) {
  global.sseClients = new Set();
}

export async function POST(request) {
  try {
    let body = {};
    try {
      const text = await request.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch (e) {
      console.warn("Failed to parse request body as JSON:", e.message);
    }

    console.log("Received webhook payload:", JSON.stringify(body, null, 2));

    // Handle handshake ping / test / empty request
    if (!body || body.hookConfig === "ping" || body.config === "ping" || Object.keys(body).length === 0) {
      console.log("Responding to VTEX configuration ping / test request");
      return new Response(JSON.stringify({ status: "ok", message: "pong" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Process order update
    const orderId = body.OrderId || body.orderId;
    const state = body.State || body.state;
    const lastChange = body.LastChange || body.lastChange || new Date().toISOString();
    const domain = body.Domain || body.domain || "Marketplace";
    const origin = body.Origin || body.origin || { Account: "unknown", Key: "unknown" };

    if (!orderId || !state) {
      console.warn("Webhook payload missing OrderId or State - ignoring but returning 200 to keep hook alive");
      return new Response(JSON.stringify({ status: "ignored", message: "Missing OrderId or State" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const orderData = {
      orderId,
      state,
      lastChange,
      domain,
      origin
    };

    const eventData = {
      type: "order-update",
      timestamp: new Date().toISOString(),
      order: orderData
    };

    // Broadcast to SSE clients
    let broadcastCount = 0;
    if (global.sseClients) {
      for (const client of global.sseClients) {
        try {
          client.send(eventData);
          broadcastCount++;
        } catch (err) {
          console.error("Failed to send update to client, deleting client:", err);
          global.sseClients.delete(client);
        }
      }
    }

    console.log(`Successfully broadcasted order ${orderId} update to ${broadcastCount} client(s).`);

    return new Response(JSON.stringify({ status: "success", broadcastedTo: broadcastCount }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error processing VTEX webhook:", err);
    // Return 200 to keep VTEX from disabling the hook due to errors
    return new Response(JSON.stringify({ status: "error", message: err.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

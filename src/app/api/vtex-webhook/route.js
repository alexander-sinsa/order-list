export const dynamic = 'force-dynamic';

if (!global.sseClients) {
  global.sseClients = new Set();
}

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("Received webhook payload:", JSON.stringify(body, null, 2));

    // Handle handshake ping
    if (body && body.hookConfig === "ping") {
      console.log("Responding to VTEX configuration ping");
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
      console.warn("Invalid webhook payload received: missing OrderId or State");
      return new Response(JSON.stringify({ error: "Invalid payload, OrderId and State are required" }), {
        status: 400,
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
    return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

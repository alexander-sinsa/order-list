export const dynamic = 'force-dynamic';

function getCredentials(searchParams) {
  const sanitize = (val) => {
    if (!val || val === "undefined" || val === "null" || val.trim() === "") {
      return null;
    }
    return val;
  };

  const appKey = sanitize(searchParams.get('appKey')) || process.env.VTEX_API_APP_KEY;
  const appToken = sanitize(searchParams.get('appToken')) || process.env.VTEX_API_APP_TOKEN;
  const account = sanitize(searchParams.get('account')) || process.env.VTEX_APCCOUNT || process.env.VTEX_ACCOUNT;
  const environment = sanitize(searchParams.get('environment')) || process.env.VTEX_ENVIROMENT || process.env.VTEX_ENVIRONMENT || 'vtexcommercestable';

  return { appKey, appToken, account, environment };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate'); // YYYY-MM-DD
    const endDate = searchParams.get('endDate'); // YYYY-MM-DD

    const { appKey, appToken, account, environment } = getCredentials(searchParams);

    if (!appKey || !appToken || !account) {
      return new Response(JSON.stringify({ 
        error: "VTEX credentials missing. Please configure them in your .env or the Setup panel." 
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: "startDate and endDate parameters are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Format query correctly with milliseconds as expected by VTEX API
    const dateQuery = `creationDate:[${startDate}T00:00:00.000Z TO ${endDate}T23:59:59.999Z]`;
    
    // Call the direct portal endpoint for reliability
    const vtexUrl = `https://${account}.${environment}.com.br/api/oms/pvt/orders?f_creationDate=${encodeURIComponent(dateQuery)}&per_page=100`;

    console.log(`Fetching orders from VTEX: ${vtexUrl}`);

    const response = await fetch(vtexUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-VTEX-API-AppKey': appKey,
        'X-VTEX-API-AppToken': appToken,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({
        error: `VTEX API returned error: ${response.status}`,
        details: errorText
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    
    const ordersList = (data.list || []).map(order => ({
      orderId: order.orderId,
      state: order.status,
      lastChange: order.creationDate,
      domain: order.origin || "Marketplace",
      origin: { Account: account, Key: "vtex-api" }
    }));

    return new Response(JSON.stringify({
      status: "success",
      orders: ordersList
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error fetching VTEX orders:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

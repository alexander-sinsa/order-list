import { readLocalHookConfig, saveLocalHookConfig } from "@/lib/local-hook-config";

export const dynamic = 'force-dynamic';

function getCredentials(body = {}) {
  const sanitize = (val) => {
    if (!val || val === "undefined" || val === "null" || val.trim() === "") {
      return null;
    }
    return val;
  };

  const appKey = sanitize(body.appKey) || process.env.VTEX_API_APP_KEY;
  const appToken = sanitize(body.appToken) || process.env.VTEX_API_APP_TOKEN;
  const account = sanitize(body.account) || process.env.VTEX_APCCOUNT || process.env.VTEX_ACCOUNT;
  const environment = sanitize(body.environment) || process.env.VTEX_ENVIROMENT || process.env.VTEX_ENVIRONMENT || 'vtexcommercestable';

  return { appKey, appToken, account, environment };
}

// GET: Check hook config in VTEX
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const localHookConfig = await readLocalHookConfig();
    const bodyCreds = {
      appKey: searchParams.get('appKey'),
      appToken: searchParams.get('appToken'),
      account: searchParams.get('account'),
      environment: searchParams.get('environment'),
    };
    
    const { appKey, appToken, account, environment } = getCredentials(bodyCreds);

    if (!appKey || !appToken || !account) {
      return new Response(JSON.stringify({ 
        status: "unconfigured",
        message: "Credentials missing or incomplete. Add them to .env",
        localConfig: {
          targetUrl: localHookConfig.targetUrl || null,
          hasHookdeckApiKey: Boolean(localHookConfig.hookdeckApiKey)
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call the direct portal endpoint for reliability
    const vtexUrl = `https://${account}.${environment}.com.br/api/orders/hook/config`;
    console.log(`Checking VTEX hook configuration at: ${vtexUrl}`);

    const response = await fetch(vtexUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-VTEX-API-AppKey': appKey,
        'X-VTEX-API-AppToken': appToken,
      },
    });

    if (response.status === 404) {
      return new Response(JSON.stringify({
        status: "not_found",
        message: "No active hook configuration found in VTEX",
        localConfig: {
          targetUrl: localHookConfig.targetUrl || null,
          hasHookdeckApiKey: Boolean(localHookConfig.hookdeckApiKey)
        }
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({
        status: "error",
        message: `VTEX API returned error: ${response.status}`,
        details: errorText
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify({
      status: "configured",
      config: data,
      localConfig: {
        targetUrl: localHookConfig.targetUrl || null,
        hasHookdeckApiKey: Boolean(localHookConfig.hookdeckApiKey)
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error checking hook:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// POST: Create or update hook config in VTEX
export async function POST(request) {
  try {
    const body = await request.json();
    const { targetUrl } = body;
    const { appKey, appToken, account, environment } = getCredentials(body);
    const localHookConfig = await readLocalHookConfig();
    const hookdeckApiKey = body.hookdeckApiKey?.trim() || localHookConfig.hookdeckApiKey || null;

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "targetUrl is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!appKey || !appToken || !account) {
      return new Response(JSON.stringify({ error: "VTEX credentials are required (check .env or pass as parameter)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call the direct portal endpoint for reliability
    const vtexUrl = `https://${account}.${environment}.com.br/api/orders/hook/config`;
    console.log(`Configuring VTEX hook at: ${vtexUrl} with targetUrl: ${targetUrl}`);

    const hookHeaders = {
      "X-VTEX-Webhook-Source": "update-order-app"
    };

    if (hookdeckApiKey) {
      hookHeaders["api-key"] = hookdeckApiKey;
    }

    const payload = {
      filter: {
        type: "FromWorkflow",
        status: [
          "waiting-for-sellers-confirmation",
          "payment-pending",
          "payment-approved",
          "request-cancel",
          "canceled",
          "ready-for-handling",
          "handling",
          "invoiced"
        ]
      },
      hook: {
        url: targetUrl,
        headers: hookHeaders
      }
    };

    const response = await fetch(vtexUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-VTEX-API-AppKey': appKey,
        'X-VTEX-API-AppToken': appToken,
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({
        error: `VTEX Hook setup failed: ${response.status}`,
        details: errorText
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    let responseData = { status: "registered" };
    try {
      responseData = await response.json();
    } catch (e) {}

    let localConfigSaved = true;

    try {
      await saveLocalHookConfig({
        targetUrl,
        hookdeckApiKey,
        account,
        environment
      });
    } catch (err) {
      localConfigSaved = false;
      console.error("Failed to save local hook config:", err);
    }

    return new Response(JSON.stringify({
      status: "success",
      message: "Webhook configured successfully on VTEX",
      vtexResponse: responseData,
      localConfig: {
        targetUrl,
        hasHookdeckApiKey: Boolean(hookdeckApiKey),
        saved: localConfigSaved
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Error setting up hook:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

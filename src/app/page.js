"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [orders, setOrders] = useState([]);
  const [connected, setConnected] = useState(false);
  const [logs, setLogs] = useState([]);
  const [preferences, setPreferences] = useState({
    audioNotifications: true,
    desktopNotifications: false,
  });

  // Keep track of browser notification permission state
  const [permissionState, setPermissionState] = useState("default");

  const [setupForm, setSetupForm] = useState({
    targetUrl: "",
    appKey: "",
    appToken: "",
    account: "",
    environment: "vtexcommercestable",
    hookdeckApiKey: "",
  });

  const [setupStatus, setSetupStatus] = useState({
    status: "loading",
    message: "Initializing dashboard...",
    config: null
  });

  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isFetchingVTEX, setIsFetchingVTEX] = useState(false);

  // Helper to format date as YYYY-MM-DD
  const formatDateString = (date) => {
    return date.toISOString().split('T')[0];
  };

  // Initialize date range filter default to last 30 days
  const [dateFilter, setDateFilter] = useState(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    return {
      startDate: formatDateString(thirtyDaysAgo),
      endDate: formatDateString(today),
    };
  });

  // Mock simulator state
  const [simForm, setSimForm] = useState({
    orderId: "v50942084sinsa-01",
    state: "payment-approved",
    domain: "Marketplace"
  });

  const eventSourceRef = useRef(null);

  // Helper to add logs
  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [{ timestamp, message, type }, ...prev].slice(0, 30));
  };

  // Synthesize audio chime
  const playChime = () => {
    if (!preferences.audioNotifications) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playBeep = (freq, time, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.08, time);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
      };
      
      playBeep(523.25, ctx.currentTime, 0.15);
      playBeep(659.25, ctx.currentTime + 0.1, 0.25);
    } catch (e) {
      console.warn("Audio Context blocked or not supported yet:", e);
    }
  };

  // Trigger desktop push notification (integrates with OS Notification Center)
  const triggerNotification = (orderId, state) => {
    if (!preferences.desktopNotifications) return;
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(`VTEX: Orden Actualizada`, {
          body: `La orden #${orderId} cambió al estado: ${state.toUpperCase()}`,
          icon: "/favicon.ico",
          silent: true, // Let the synthesized Web Audio chime handle the audio to avoid duplicate sounds
        });
      } catch (err) {
        console.error("Failed to trigger push notification:", err);
      }
    }
  };

  // Connect to Server-Sent Events (SSE) stream
  const connectSSE = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    addLog("Connecting to SSE live stream...", "info");
    const es = new EventSource("/api/events");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
      addLog("SSE stream connected. Waiting for real-time updates.", "success");
    };

    es.onerror = (e) => {
      setConnected(false);
      addLog("SSE stream disconnected. Retrying connection...", "danger");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "connected") {
          addLog("Live handshake received from stream", "success");
          return;
        }

        if (data.type === "order-update") {
          const { order } = data;
          addLog(`New webhook received: Order ${order.orderId} -> ${order.state}`, "success");
          
          playChime();
          triggerNotification(order.orderId, order.state);

          setOrders((prev) => {
            const exists = prev.some((o) => o.orderId === order.orderId);
            let updatedList = [];
            if (exists) {
              updatedList = prev.map((o) => 
                o.orderId === order.orderId 
                  ? { ...order, isNew: true, lastUpdated: Date.now() } 
                  : { ...o, isNew: false }
              );
            } else {
              updatedList = [{ ...order, isNew: true, lastUpdated: Date.now() }, ...prev];
            }
            return updatedList.sort((a, b) => new Date(b.lastChange) - new Date(a.lastChange)).slice(0, 100);
          });
        }
      } catch (err) {
        console.error("Error parsing SSE event:", err);
      }
    };
  };

  // Fetch hook status from local API
  const fetchHookStatus = async () => {
    try {
      const response = await fetch("/api/vtex-setup");
      const data = await response.json();
      
      if (data.status === "configured") {
        setSetupStatus({
          status: "configured",
          message: `Hook registered to ${data.config?.hook?.url || "VTEX"}`,
          config: data.config
        });
        setSetupForm((prev) => ({
          ...prev,
          targetUrl: data.config?.hook?.url || data.localConfig?.targetUrl || prev.targetUrl,
        }));
        addLog("Loaded existing VTEX hook configuration", "success");
        return true; 
      } else if (data.status === "unconfigured") {
        setSetupStatus({
          status: "unconfigured",
          message: "Credentials missing or incomplete. Add them to .env",
          config: null
        });
        if (data.localConfig?.targetUrl) {
          setSetupForm((prev) => ({
            ...prev,
            targetUrl: data.localConfig.targetUrl,
          }));
        }
      } else if (data.status === "not_found") {
        setSetupStatus({
          status: "not_found",
          message: "No active hook configured in this account",
          config: null
        });
        if (data.localConfig?.targetUrl) {
          setSetupForm((prev) => ({
            ...prev,
            targetUrl: data.localConfig.targetUrl,
          }));
        }
        return true; 
      } else {
        setSetupStatus({
          status: "error",
          message: data.message || "Failed to load hook configuration",
          config: null
        });
      }
    } catch (err) {
      setSetupStatus({
        status: "error",
        message: "Failed to connect to backend configuration API",
        config: null
      });
      console.error(err);
    }
    return false;
  };

  // Fetch Historical Orders from VTEX by Date
  const fetchVTEXOrders = async (isInitial = false) => {
    if (!dateFilter.startDate || !dateFilter.endDate) {
      if (!isInitial) alert("Please select both a Start Date and an End Date to query VTEX.");
      return;
    }

    setIsFetchingVTEX(true);
    addLog(`Fetching orders from VTEX for range: ${dateFilter.startDate} to ${dateFilter.endDate}...`, "info");

    try {
      const params = {
        startDate: dateFilter.startDate,
        endDate: dateFilter.endDate,
      };

      if (setupForm.appKey && setupForm.appKey.trim()) params.appKey = setupForm.appKey.trim();
      if (setupForm.appToken && setupForm.appToken.trim()) params.appToken = setupForm.appToken.trim();
      if (setupForm.account && setupForm.account.trim()) params.account = setupForm.account.trim();
      if (setupForm.environment && setupForm.environment.trim()) params.environment = setupForm.environment.trim();

      const queryParams = new URLSearchParams(params);

      const response = await fetch(`/api/vtex-orders?${queryParams.toString()}`);
      const data = await response.json();

      if (response.ok) {
        addLog(`Successfully retrieved ${data.orders?.length || 0} orders from VTEX`, "success");
        
        setOrders((prev) => {
          const existingIds = new Set(prev.map(o => o.orderId));
          const newOrders = (data.orders || []).filter(o => !existingIds.has(o.orderId));
          const combined = [...prev, ...newOrders];
          return combined.sort((a, b) => new Date(b.lastChange) - new Date(a.lastChange));
        });
      } else {
        addLog(`Failed to fetch orders: ${data.error || "Unknown error"}`, "danger");
        if (!isInitial) {
          alert(`Failed to fetch: ${data.error || "Unknown Error"}`);
        }
      }
    } catch (err) {
      addLog(`Fetch error: ${err.message}`, "danger");
      if (!isInitial) {
        alert("Error fetching orders: " + err.message);
      }
    } finally {
      setIsFetchingVTEX(false);
    }
  };

  // Setup/Register Hook
  const handleSetupHook = async (e) => {
    e.preventDefault();
    if (!setupForm.targetUrl) {
      alert("Please provide a valid application URL");
      return;
    }

    setIsLoadingSetup(true);
    addLog(`Registering webhook URL in VTEX: ${setupForm.targetUrl}...`, "info");

    try {
      const response = await fetch("/api/vtex-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setupForm),
      });

      const data = await response.json();

      if (response.ok) {
        addLog("Webhook setup succeeded!", "success");
        alert("Webhook registered successfully on VTEX!");
        fetchHookStatus();
      } else {
        addLog(`Hook setup failed: ${data.error || "Unknown error"}`, "danger");
        alert(`Setup failed:\n${data.error || "Unknown Error"}\n\nDetails: ${data.details || "None"}`);
      }
    } catch (err) {
      addLog(`Setup error: ${err.message}`, "danger");
      alert("Error setting up webhook: " + err.message);
    } finally {
      setIsLoadingSetup(false);
    }
  };

  // Simulate VTEX Webhook
  const handleSimulateWebhook = async (e) => {
    e.preventDefault();
    setIsSimulating(true);
    addLog(`Sending simulated VTEX payload for order ${simForm.orderId}...`, "info");

    const payload = {
      Domain: simForm.domain,
      OrderId: simForm.orderId,
      State: simForm.state,
      LastChange: new Date().toISOString(),
      Origin: {
        Account: setupForm.account || "mock-account",
        Key: "mock-vtex-appkey"
      }
    };

    try {
      const response = await fetch("/api/vtex-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (response.ok) {
        addLog(`Simulation successful! Payload received.`, "success");
      } else {
        addLog("Simulation failed", "danger");
      }
    } catch (err) {
      addLog(`Simulation error: ${err.message}`, "danger");
    } finally {
      setIsSimulating(false);
    }
  };

  // Request browser notification permission explicitly
  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      alert("This browser does not support desktop notifications.");
      return;
    }

    const permission = await Notification.requestPermission();
    setPermissionState(permission);
    
    if (permission === "granted") {
      setPreferences((prev) => ({ ...prev, desktopNotifications: true }));
      addLog("Desktop push notifications enabled", "success");
    } else {
      setPreferences((prev) => ({ ...prev, desktopNotifications: false }));
      addLog("Push notifications permission denied by user", "warning");
    }
  };

  // Request desktop notification permission on toggle
  const handleNotificationToggle = async (e) => {
    const checked = e.target.checked;
    if (checked) {
      await enableNotifications();
    } else {
      setPreferences((prev) => ({ ...prev, desktopNotifications: false }));
      addLog("Desktop notifications disabled", "info");
    }
  };

  // Connect on load & fetch initial config and history
  useEffect(() => {
    connectSSE();
    
    fetchHookStatus().then((hasCredentials) => {
      if (hasCredentials) {
        fetchVTEXOrders(true);
      }
    });

    // Check actual notification permission on startup
    if ("Notification" in window) {
      setPermissionState(Notification.permission);
      if (Notification.permission === "granted") {
        setPreferences((prev) => ({ ...prev, desktopNotifications: true }));
      }
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Format date readable
  const formatTime = (isoString) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString() + " " + date.toLocaleDateString();
    } catch (e) {
      return isoString;
    }
  };

  // Apply client-side date filters to the list of orders
  const filteredOrders = orders.filter((order) => {
    if (!dateFilter.startDate && !dateFilter.endDate) return true;
    
    const orderTime = new Date(order.lastChange).getTime();
    
    if (dateFilter.startDate) {
      const start = new Date(dateFilter.startDate + "T00:00:00").getTime();
      if (orderTime < start) return false;
    }
    
    if (dateFilter.endDate) {
      const end = new Date(dateFilter.endDate + "T23:59:59").getTime();
      if (orderTime > end) return false;
    }
    
    return true;
  });

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header glass-panel" style={{ padding: "20px 24px" }}>
        <div className="app-logo">
          <div className="logo-icon">V</div>
          <div className="app-title-group">
            <h1>VTEX Order Tracker</h1>
            <p>Real-Time Webhook Monitoring & Historical Querying</p>
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div className="conn-badge">
            <span className={`conn-dot ${connected ? "online" : "offline"}`}></span>
            {connected ? "LIVE FEED" : "DISCONNECTED"}
          </div>

          <button onClick={connectSSE} className="btn btn-secondary" style={{ padding: "8px 12px", fontSize: "12px" }}>
            Reconnect Stream
          </button>
        </div>
      </header>

      {/* Proactive Notification Banner */}
      {permissionState === "default" && (
        <div 
          className="glass-panel" 
          style={{ 
            padding: "14px 24px", 
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center", 
            background: "linear-gradient(135deg, rgba(78, 205, 196, 0.1) 0%, rgba(58, 134, 255, 0.1) 100%)",
            border: "1px dashed var(--accent-cyan)",
            borderRadius: "12px",
            animation: "pulse-cyan 3s infinite"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px" }}>🔔</span>
            <span style={{ fontSize: "13px", color: "#fff", fontWeight: "500" }}>
              ¿Quieres recibir alertas visuales en tu pantalla (Windows/Mac/Linux) cuando cambie una orden, incluso si el navegador está cerrado o en segundo plano?
            </span>
          </div>
          <button onClick={enableNotifications} className="btn" style={{ padding: "6px 14px", fontSize: "12px" }}>
            Activar Notificaciones
          </button>
        </div>
      )}

      {/* Main Dashboard Panel */}
      <div className="dashboard-grid">
        
        {/* Left Panel - Feed & Table */}
        <div className="glass-panel orders-card">
          <div className="orders-header" style={{ flexDirection: "column", alignItems: "stretch", gap: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>Order Activity & History</h2>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Showing {filteredOrders.length} orders
              </span>
            </div>

            {/* Date filter bar */}
            <div style={{ 
              display: "flex", 
              justifyContent: "space-between", 
              alignItems: "center", 
              gap: "16px",
              padding: "12px 16px", 
              background: "rgba(255, 255, 255, 0.02)", 
              border: "1px solid var(--card-border)", 
              borderRadius: "10px",
              flexWrap: "wrap"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-secondary)" }}>Date Range:</span>
                <input 
                  type="date" 
                  className="form-control" 
                  style={{ padding: "6px 10px", width: "135px", fontSize: "12px", background: "rgba(8, 10, 16, 0.6)" }}
                  value={dateFilter.startDate}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                />
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>to</span>
                <input 
                  type="date" 
                  className="form-control" 
                  style={{ padding: "6px 10px", width: "135px", fontSize: "12px", background: "rgba(8, 10, 16, 0.6)" }}
                  value={dateFilter.endDate}
                  onChange={(e) => setDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                />
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button 
                  onClick={() => fetchVTEXOrders(false)} 
                  className="btn" 
                  style={{ padding: "8px 14px", fontSize: "12px" }}
                  disabled={isFetchingVTEX || !dateFilter.startDate || !dateFilter.endDate}
                >
                  {isFetchingVTEX ? "Fetching..." : "Fetch from VTEX"}
                </button>
                
                {(dateFilter.startDate || dateFilter.endDate) && (
                  <button 
                    onClick={() => setDateFilter({ startDate: "", endDate: "" })} 
                    className="btn btn-secondary" 
                    style={{ padding: "8px 14px", fontSize: "12px" }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="table-wrapper" style={{ marginTop: "10px" }}>
            {filteredOrders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <h3>No Orders Found</h3>
                <p>
                  {dateFilter.startDate || dateFilter.endDate 
                    ? "No orders match the selected date range. Try querying VTEX using the 'Fetch from VTEX' button." 
                    : "Waiting for live VTEX notifications to trigger. Use the simulator panel on the right to test updates immediately."}
                </p>
              </div>
            ) : (
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Status</th>
                    <th>Last Change</th>
                    <th>Domain</th>
                    <th>Origin Account</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr 
                      key={`${order.orderId}-${order.lastChange}`} 
                      className={order.isNew ? "row-new" : ""}
                    >
                      <td className="order-id">#{order.orderId}</td>
                      <td>
                        <span className={`status-badge ${order.state}`}>
                          {order.state.replace(/-/g, ' ')}
                        </span>
                      </td>
                      <td className="order-date">{formatTime(order.lastChange)}</td>
                      <td>
                        <span style={{ textTransform: "capitalize", fontSize: "12px" }}>
                          {order.domain}
                        </span>
                      </td>
                      <td>
                        <span className="origin-badge">
                          {order.origin?.Account || order.origin?.account || "N/A"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Panel - Settings & Simulation */}
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>
          
          {/* Configuration & Preferences */}
          <div className="glass-panel config-card">
            <h3 className="card-title">🚨 System Alerts</h3>
            
            <div className="pref-row">
              <div className="pref-text">
                <h4>Audio Notifications</h4>
                <p>Play chime sound on state change</p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={preferences.audioNotifications} 
                  onChange={(e) => setPreferences((p) => ({ ...p, audioNotifications: e.target.checked }))}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="pref-row">
              <div className="pref-text">
                <h4>Push Notifications</h4>
                <p>Desktop notifications when order updates</p>
              </div>
              <label className="switch">
                <input 
                  type="checkbox" 
                  checked={preferences.desktopNotifications} 
                  onChange={handleNotificationToggle}
                />
                <span className="slider"></span>
              </label>
            </div>
          </div>

          {/* Webhook Setup config */}
          <div className="glass-panel config-card">
            <h3 className="card-title">🔗 VTEX Webhook Setup</h3>

            <div className="pref-row" style={{ borderBottom: "none", paddingBottom: 0 }}>
              <div className="pref-text">
                <span style={{ fontSize: "11px", fontWeight: "600", textTransform: "uppercase", color: "var(--text-secondary)" }}>
                  Setup Status
                </span>
                <h4 style={{ 
                  color: setupStatus.status === "configured" ? "var(--status-invoiced)" : 
                         setupStatus.status === "loading" ? "var(--text-secondary)" : "var(--status-pending)",
                  marginTop: "2px" 
                }}>
                  {setupStatus.message}
                </h4>
              </div>
              <button 
                onClick={fetchHookStatus} 
                className="btn btn-secondary" 
                style={{ padding: "6px 10px", fontSize: "11px" }}
              >
                Reload status
              </button>
            </div>

            <form onSubmit={handleSetupHook} style={{ display: "flex", flexDirection: "column", gap: "16px", marginTop: "10px" }}>
              <div className="form-group">
                <label>Webhook Destination URL</label>
                <input 
                  type="url" 
                  className="form-control" 
                  placeholder="e.g. https://xxxx.ngrok-free.app/api/vtex-webhook" 
                  value={setupForm.targetUrl}
                  onChange={(e) => setSetupForm((p) => ({ ...p, targetUrl: e.target.value }))}
                  required
                />
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Must be a public HTTPS URL (like an Ngrok tunnel) pointing to /api/vtex-webhook.
                </span>
              </div>

              <div className="form-group">
                <label>HookDeck API Key</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="api-key header value for HookDeck"
                  value={setupForm.hookdeckApiKey}
                  onChange={(e) => setSetupForm((p) => ({ ...p, hookdeckApiKey: e.target.value }))}
                />
                <span style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                  Optional. If provided, VTEX will send it as the api-key header when posting to HookDeck.
                </span>
              </div>

              <details style={{ cursor: "pointer" }}>
                <summary style={{ fontSize: "12px", color: "var(--accent-cyan)", fontWeight: "500", padding: "4px 0" }}>
                  Override VTEX Credentials (Optional)
                </summary>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "10px", cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Account</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="VTEX Account Name" 
                        value={setupForm.account}
                        onChange={(e) => setSetupForm((p) => ({ ...p, account: e.target.value }))}
                      />
                    </div>
                    <div className="form-group">
                      <label>Environment</label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="vtexcommercestable" 
                        value={setupForm.environment}
                        onChange={(e) => setSetupForm((p) => ({ ...p, environment: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <label>API App Key</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="vtexappkey-..." 
                      value={setupForm.appKey}
                      onChange={(e) => setSetupForm((p) => ({ ...p, appKey: e.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>API App Token</label>
                    <input 
                      type="password" 
                      className="form-control" 
                      placeholder="VTEX token..." 
                      value={setupForm.appToken}
                      onChange={(e) => setSetupForm((p) => ({ ...p, appToken: e.target.value }))}
                    />
                  </div>
                </div>
              </details>

              <button type="submit" className="btn" disabled={isLoadingSetup}>
                {isLoadingSetup ? "Configuring..." : "Register Hook on VTEX"}
              </button>
            </form>
          </div>

          {/* Simulator Panel */}
          <div className="glass-panel config-card">
            <h3 className="card-title">🧪 Live Hook Simulator</h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Test your notifications and dashboard instantly without configuring the real VTEX API:
            </p>

            <form onSubmit={handleSimulateWebhook} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "4px" }}>
              <div className="form-group">
                <label>Order ID</label>
                <input 
                  type="text" 
                  className="form-control" 
                  value={simForm.orderId}
                  onChange={(e) => setSimForm((p) => ({ ...p, orderId: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label>Status Transition</label>
                <select 
                  className="form-control" 
                  value={simForm.state}
                  onChange={(e) => setSimForm((p) => ({ ...p, state: e.target.value }))}
                  style={{ background: "#0a0c10" }}
                >
                  <option value="payment-pending">Payment Pending</option>
                  <option value="payment-approved">Payment Approved</option>
                  <option value="ready-for-handling">Ready for Handling</option>
                  <option value="handling">Handling</option>
                  <option value="invoiced">Invoiced</option>
                  <option value="canceled">Canceled</option>
                </select>
              </div>

              <button type="submit" className="btn btn-secondary" disabled={isSimulating} style={{ borderColor: "var(--accent-cyan)", color: "var(--accent-cyan)" }}>
                {isSimulating ? "Sending..." : "Simulate Hook Post"}
              </button>
            </form>
          </div>

          {/* Console System Logs */}
          <div className="glass-panel">
            <h3 className="card-title" style={{ padding: "16px 20px 8px 20px" }}>🖥️ System Console</h3>
            <div className="logs-card">
              {logs.length === 0 ? (
                <div style={{ fontStyle: "italic", fontSize: "11px", color: "var(--text-muted)" }}>
                  Console initialized. Connection state is stable.
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`log-item ${log.type}`}>
                    <span>[{log.timestamp}] {log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
        
      </div>
    </div>
  );
}

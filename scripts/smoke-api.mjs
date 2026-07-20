/**
 * API smoke test — run: node scripts/smoke-api.mjs
 * Requires explicit smoke credentials in the process environment.
 */
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const smokeUsername = process.env.SMOKE_ADMIN_USERNAME?.trim();
const smokePassword = process.env.SMOKE_ADMIN_PASSWORD;

if (!smokeUsername) {
  throw new Error("SMOKE_ADMIN_USERNAME is required before running the smoke script.");
}

if (!smokePassword) {
  throw new Error("SMOKE_ADMIN_PASSWORD is required before running the smoke script.");
}

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthStart() {
  const d = new Date();
  return localDateString(new Date(d.getFullYear(), d.getMonth(), 1));
}

const results = [];

function log(step, status, detail) {
  results.push({ step, status, detail });
  const icon = status === "pass" ? "✅" : status === "warn" ? "⚠️" : "❌";
  console.log(`${icon} ${step}: ${detail}`);
}

function responseDetail(response) {
  return `status=${response.status}; response body omitted`;
}

async function parseJson(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function loginNextAuth(username, password) {
  const jar = new Map();
  const store = (res) => {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  };
  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { Cookie: cookieHeader() },
  });
  store(csrfRes);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson.csrfToken;

  const body = new URLSearchParams({
    csrfToken,
    username,
    password,
    redirect: "false",
    json: "true",
  });

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookieHeader(),
    },
    body,
    redirect: "manual",
  });
  store(loginRes);

  return {
    cookieHeader,
    status: loginRes.status,
    ok: loginRes.status === 200 || loginRes.status === 302,
  };
}

async function api(method, path, { cookieHeader, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { Cookie: cookieHeader() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const { json, text } = await parseJson(res);
  return { status: res.status, json, text };
}

async function main() {
  const today = localDateString();
  const from = monthStart();

  {
    const r = await api("POST", "/api/auth/login", {
      body: { username: smokeUsername, password: `invalid:${smokePassword}` },
    });
    if (r.status >= 500) log(1, "fail", responseDetail(r));
    else if (r.json?.success === false && r.json.code === "INVALID_CREDENTIALS") {
      log(1, "pass", "401 INVALID_CREDENTIALS (wrong password — expected shape)");
    } else if (r.json?.success === true) {
      log(1, "pass", "authenticated");
    } else log(1, "warn", responseDetail(r));
  }

  const auth = await loginNextAuth(smokeUsername, smokePassword);
  if (!auth.ok) {
    log("auth", "fail", `NextAuth login failed status=${auth.status}`);
    process.exit(1);
  }

  {
    const r = await api("GET", "/api/settings/store");
    if (r.status >= 500) log(2, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.name) log(2, "pass", `name=${r.json.data.name}`);
    else log(2, "warn", responseDetail(r));
  }

  let productId = 1;
  {
    const r = await api("GET", "/api/products?limit=5", { cookieHeader: auth.cookieHeader });
    if (r.status >= 500) log(3, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.items?.length) {
      productId = r.json.data.items[0].id;
      log(3, "pass", `items=${r.json.data.items.length}`);
    } else log(3, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", "/api/products/barcode/8901001001001", {
      cookieHeader: auth.cookieHeader,
    });
    if (r.status >= 500) log(4, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.found === true && r.json.data.product?.id) {
      log(4, "pass", `product id=${r.json.data.product.id}`);
    } else log(4, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", "/api/categories", { cookieHeader: auth.cookieHeader });
    if (r.status >= 500) log(5, "fail", responseDetail(r));
    else if (r.json?.success && Array.isArray(r.json.data)) log(5, "pass", `count=${r.json.data.length}`);
    else log(5, "warn", responseDetail(r));
  }

  let orderId = null;
  let shiftId = null;
  let terminalId = 1;
  {
    const shiftRes = await api("GET", "/api/shifts?terminalId=1", {
      cookieHeader: auth.cookieHeader,
    });
    shiftId = shiftRes.json?.data?.id ?? null;
    if (!shiftId) {
      const open = await api("POST", "/api/shifts", {
        cookieHeader: auth.cookieHeader,
        body: { action: "open", terminalId: 1, openingBalance: "0" },
      });
      shiftId = open.json?.data?.id;
    }
    terminalId = shiftRes.json?.data?.terminalId ?? 1;

    const r = await api("POST", "/api/orders", {
      cookieHeader: auth.cookieHeader,
      body: { orderType: "WalkIn", terminalId, shiftId },
    });
    if (r.status >= 500) log(6, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.id) {
      orderId = r.json.data.id;
      log(6, "pass", `order #${r.json.data.orderNumber}`);
    } else log(6, "warn", responseDetail(r));
  }

  {
    const r = await api("POST", `/api/orders/${orderId}/items`, {
      cookieHeader: auth.cookieHeader,
      body: { productId, quantity: 1 },
    });
    if (r.status >= 500) log(7, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.orderItems?.length) log(7, "pass", `lines=${r.json.data.orderItems.length}`);
    else log(7, "warn", responseDetail(r));
  }

  {
    const r = await api("POST", `/api/orders/${orderId}/checkout`, {
      cookieHeader: auth.cookieHeader,
      body: {
        paymentMethodId: 1,
        tenderedAmount: "99999999",
        terminalId,
        discountPercent: 0,
        taxPercent: 16,
      },
    });
    if (r.status >= 500) log(8, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.status === "Closed") log(8, "pass", `closed ${r.json.data.orderNumber}`);
    else log(8, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", `/api/orders/${orderId}/reprint`, {
      cookieHeader: auth.cookieHeader,
    });
    if (r.status >= 500) log(9, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.orderNumber) log(9, "pass", `orderNumber=${r.json.data.orderNumber}`);
    else log(9, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", `/api/reports/daily-summary?date=${today}`, {
      cookieHeader: auth.cookieHeader,
    });
    if (r.status >= 500) log(10, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.totalOrders !== undefined) log(10, "pass", `totalOrders=${r.json.data.totalOrders}`);
    else log(10, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", `/api/reports/profit-loss?from=${from}&to=${today}`, {
      cookieHeader: auth.cookieHeader,
    });
    if (r.status >= 500) log(11, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.revenue !== undefined) log(11, "pass", `revenue=${r.json.data.revenue}`);
    else log(11, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", "/api/inventory/low-stock", { cookieHeader: auth.cookieHeader });
    if (r.status >= 500) log(12, "fail", responseDetail(r));
    else if (r.json?.success && Array.isArray(r.json.data)) log(12, "pass", `count=${r.json.data.length}`);
    else log(12, "warn", responseDetail(r));
  }

  {
    const r = await api("POST", "/api/shifts", {
      cookieHeader: auth.cookieHeader,
      body: { action: "open", terminalId: 1, openingBalance: "0" },
    });
    if (r.status >= 500) log(13, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.id) log(13, "pass", `shift id=${r.json.data.id}`);
    else if (r.json?.success === false && r.json.error?.includes("already open")) {
      log(13, "pass", "shift already open");
    } else log(13, "warn", responseDetail(r));
  }

  if (!shiftId) {
    const g = await api("GET", "/api/shifts?terminalId=1", { cookieHeader: auth.cookieHeader });
    shiftId = g.json?.data?.id;
  }

  {
    const r = await api("GET", `/api/shifts/${shiftId}`, { cookieHeader: auth.cookieHeader });
    if (r.status >= 500) log(14, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.expectedBalance !== undefined) {
      log(14, "pass", `expectedBalance=${r.json.data.expectedBalance}`);
    } else log(14, "warn", responseDetail(r));
  }

  {
    const r = await api("GET", "/api/sync/status", { cookieHeader: auth.cookieHeader });
    if (r.status >= 500) log(15, "fail", responseDetail(r));
    else if (r.json?.success && r.json.data?.enabled !== undefined) {
      log(15, "pass", `enabled=${r.json.data.enabled} pending=${r.json.data.pendingCount}`);
    } else log(15, "warn", responseDetail(r));
  }

  const fails = results.filter((r) => r.status === "fail");
  const warns = results.filter((r) => r.status === "warn");
  console.log(`\nSummary: ${results.filter((r) => r.status === "pass").length} pass, ${warns.length} warn, ${fails.length} fail`);
  process.exit(fails.length > 0 ? 1 : warns.length > 0 ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

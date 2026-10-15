import index from "./web/index.html";

/**
 * Wallet Console: serves the page and forwards /api/* to the backend API (which has no CORS).
 * It talks to the backend only through its public HTTP API, like any client would.
 */
const PORT = Number(process.env.CONSOLE_PORT ?? 4001);
const API_URL = process.env.CONSOLE_API_URL ?? "http://localhost:3000";

const forward = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const target = `${API_URL}${url.pathname.replace(/^\/api/, "")}${url.search}`;
  const headers = new Headers();
  for (const name of ["content-type", "idempotency-key", "x-correlation-id"]) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  try {
    const response = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    });
    const outgoing = new Headers();
    for (const name of ["content-type", "x-correlation-id", "retry-after"]) {
      const value = response.headers.get(name);
      if (value !== null) outgoing.set(name, value);
    }
    return new Response(await response.arrayBuffer(), { status: response.status, headers: outgoing });
  } catch (error) {
    return Response.json(
      { code: "BACKEND_UNREACHABLE", message: `API fora do ar em ${API_URL}: ${(error as Error).message}` },
      { status: 502 },
    );
  }
};

const server = Bun.serve({
  port: PORT,
  development: true,
  routes: {
    "/": index,
    "/api/*": forward,
  },
  fetch: () => Response.json({ error: "not found" }, { status: 404 }),
});

console.log(`Wallet Console: http://localhost:${server.port}  (API ${API_URL})`);

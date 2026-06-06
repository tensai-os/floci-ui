import { createMiddleware } from "hono/factory";
import { verifyAccessToken } from "../auth/jwt";

function isPublicApiPath(path: string, method: string): boolean {
  if (path === "/api/auth/status" && method === "GET") return true;
  if (path === "/api/auth/register" && method === "POST") return true;
  if (path === "/api/auth/login" && method === "POST") return true;
  return false;
}

export const apiJwtGuard = createMiddleware(async (c, next) => {
  const path = c.req.path;
  if (!path.startsWith("/api")) {
    return next();
  }
  if (isPublicApiPath(path, c.req.method)) {
    return next();
  }

  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const { sub } = await verifyAccessToken(token);
    c.set("userId", sub);
    return next();
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

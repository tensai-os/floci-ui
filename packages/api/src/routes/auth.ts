import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { signAccessToken } from "../auth/jwt";
import { hashPassword, validatePassword, verifyPassword } from "../auth/password";
import { getDb } from "../db/client";
import { users } from "../db/schema";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const app = new Hono();

app.get("/status", async (c) => {
  const db = getDb();
  const [row] = await db.select({ n: count() }).from(users);
  const n = Number(row?.n ?? 0);
  return c.json({ setupRequired: n === 0 });
});

app.post("/register", async (c) => {
  const db = getDb();
  const [existing] = await db.select({ n: count() }).from(users);
  if (Number(existing?.n ?? 0) > 0) {
    return c.json({ error: "Setup already completed" }, 403);
  }

  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !emailRe.test(email)) {
    return c.json({ error: "Invalid email" }, 400);
  }
  const pwdErr = validatePassword(password);
  if (pwdErr) {
    return c.json({ error: pwdErr }, 400);
  }

  const passwordHash = await hashPassword(password);
  try {
    const [inserted] = await db
      .insert(users)
      .values({ email, passwordHash })
      .returning({ id: users.id, email: users.email });
    if (!inserted) throw new Error("insert failed");
    const token = await signAccessToken(inserted.id);
    return c.json({
      token,
      user: { id: inserted.id, email: inserted.email },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return c.json({ error: "Email already registered" }, 409);
    }
    throw e;
  }
});

app.post("/login", async (c) => {
  const db = getDb();
  const [existing] = await db.select({ n: count() }).from(users);
  if (Number(existing?.n ?? 0) === 0) {
    return c.json({ error: "Complete setup first" }, 403);
  }

  let body: { email?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const token = await signAccessToken(user.id);
  return c.json({
    token,
    user: { id: user.id, email: user.email },
  });
});

app.get("/me", async (c) => {
  const db = getDb();
  const userId = c.get("userId");
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    return c.json({ error: "Not found" }, 404);
  }
  return c.json({ user });
});

export default app;

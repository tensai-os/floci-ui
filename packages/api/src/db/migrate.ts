import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";

/** Use cwd so compiled `bun build --compile` binaries still find ./drizzle next to the executable. */
export function resolveMigrationsFolder(): string {
  const override = process.env.DRIZZLE_MIGRATIONS_PATH;
  if (override) {
    return path.resolve(override);
  }
  return path.join(process.cwd(), "drizzle");
}

export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  const migrationsFolder = resolveMigrationsFolder();
  const migrationClient = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(migrationClient), { migrationsFolder });
  } finally {
    await migrationClient.end();
  }
}

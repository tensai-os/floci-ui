import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** Directory of the running binary (works for `bun build --compile` where cwd may differ). */
function executableDirectory(): string {
  const argv0 = process.argv[0];
  if (argv0) {
    const resolved = path.isAbsolute(argv0)
      ? argv0
      : path.resolve(process.cwd(), argv0);
    return path.dirname(resolved);
  }
  return process.cwd();
}

function journalPath(dir: string): string {
  return path.join(dir, "meta", "_journal.json");
}

/**
 * Resolves the Drizzle migrations folder for dev (`bun run src/index.ts`) and for
 * compiled binaries where `process.cwd()` is not guaranteed to be `/app`.
 */
export function resolveMigrationsFolder(): string {
  const override = process.env.DRIZZLE_MIGRATIONS_PATH;
  if (override) {
    return path.resolve(override);
  }

  const candidates: string[] = [];
  const seen = new Set<string>();

  function add(dir: string) {
    const norm = path.normalize(dir);
    if (!seen.has(norm)) {
      seen.add(norm);
      candidates.push(norm);
    }
  }

  add(path.join(process.cwd(), "drizzle"));
  add(path.join(executableDirectory(), "drizzle"));
  if (process.execPath) {
    add(path.join(path.dirname(process.execPath), "drizzle"));
  }

  for (const dir of candidates) {
    if (existsSync(journalPath(dir))) {
      return dir;
    }
  }

  throw new Error(
    `Drizzle migrations not found (missing meta/_journal.json). Tried:\n${candidates.map((d) => `  - ${d}`).join("\n")}\nSet DRIZZLE_MIGRATIONS_PATH to the directory that contains meta/_journal.json and the *.sql migration files.`,
  );
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

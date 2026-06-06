import "dotenv/config";
import { createApp } from "./app";
import { runMigrations } from "./db/migrate";

await runMigrations();

const app = createApp();
const port = Number(process.env.PORT ?? 3001);
export default { port, fetch: app.fetch };

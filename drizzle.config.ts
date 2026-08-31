import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

const dataDir = process.env.LOCALDB_DATA_DIR || resolve(process.cwd(), "data");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.APP_DB_PATH || resolve(dataDir, "app.db"),
  },
  verbose: true,
  strict: true,
});

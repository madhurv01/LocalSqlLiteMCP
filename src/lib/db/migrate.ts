import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "@/lib/config";

const migrationsFolder = resolve(process.cwd(), "drizzle");

if (!existsSync(dirname(config.appDbPath))) {
  mkdirSync(dirname(config.appDbPath), { recursive: true });
}

const sqlite = new Database(config.appDbPath);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite);

if (existsSync(migrationsFolder)) {
  migrate(db, { migrationsFolder });
  console.log(`Migrations applied to ${config.appDbPath}`);
} else {
  console.log("No drizzle/ folder yet. Run `npm run db:generate` first.");
}
sqlite.close();

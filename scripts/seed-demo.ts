/**
 * Build a demo SQLite database at $LOCALDB_DB_ROOT/demo.db so the app has
 * something to operate on out of the box.
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { config } from "../src/lib/config";

const target = join(config.dbRoot, "demo.db");
mkdirSync(config.dbRoot, { recursive: true });
if (existsSync(target)) rmSync(target);

const db = new Database(target);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  city TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  price REAL NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_orders_customer ON orders(customer_id);
`);

const cities = ["Austin", "Berlin", "Denver", "Lisbon", "Osaka", "Nairobi"];
const insCustomer = db.prepare("INSERT INTO customers (name, email, city) VALUES (?,?,?)");
for (let i = 1; i <= 12; i++) {
  insCustomer.run(`Customer ${i}`, `customer${i}@example.com`, cities[i % cities.length]);
}

const insProduct = db.prepare("INSERT INTO products (title, price, stock) VALUES (?,?,?)");
for (let i = 1; i <= 8; i++) {
  insProduct.run(`Widget ${i}`, Math.round((5 + i * 4.5) * 100) / 100, 10 * i);
}

const insOrder = db.prepare(
  "INSERT INTO orders (customer_id, product_id, quantity, status) VALUES (?,?,?,?)",
);
const statuses = ["pending", "shipped", "delivered", "cancelled"];
for (let i = 0; i < 30; i++) {
  insOrder.run((i % 12) + 1, (i % 8) + 1, (i % 3) + 1, statuses[i % statuses.length]);
}

db.pragma("wal_checkpoint(TRUNCATE)");
db.close();
console.log(`Seeded demo database at ${target}`);

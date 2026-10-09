import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const filenames = (await fs.readdir(migrationsDir))
    .filter(name => name.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const existing = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename]
    );

    if (existing.rowCount) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");

    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await pool.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await pool.end();
}

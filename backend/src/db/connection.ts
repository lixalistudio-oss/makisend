import { drizzle } from "drizzle-orm/d1";

export type Database = ReturnType<typeof drizzle>;

export function createDatabase(db: D1Database): Database {
  return drizzle(db);
}

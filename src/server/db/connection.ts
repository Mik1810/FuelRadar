import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

function toSqlValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function wrapSqlClient(rawSql: ReturnType<typeof postgres>): ReturnType<typeof postgres> {
  return new Proxy(rawSql, {
    apply(target, thisArg, argumentsList) {
      const [template, ...params] = argumentsList;
      return Reflect.apply(target, thisArg, [
        template,
        ...params.map(toSqlValue),
      ]);
    },
  });
}

export function createDatabaseConnection(databaseUrl: string) {
  const rawSql = postgres(databaseUrl.trim(), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const sqlClient = wrapSqlClient(rawSql);

  return {
    sqlClient,
    db: drizzle(sqlClient, { schema }),
  };
}

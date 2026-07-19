import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

function toSqlValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return value;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function wrapSqlClient<T extends object>(raw: T): T {
  return new Proxy(raw, {
    apply(target, thisArg, argumentsList) {
      const [template, ...params] = argumentsList;
      return Reflect.apply(
        target as (strings: TemplateStringsArray, ...values: unknown[]) => unknown,
        thisArg,
        [template, ...params.map(toSqlValue)],
      );
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);

      if (prop === "begin" && typeof value === "function") {
        const rawBegin = value.bind(target);
        return (...args: unknown[]) => {
          if (typeof args[0] === "function") {
            const callback = args[0] as (tx: object) => unknown;
            return rawBegin(async (tx: object) => {
              return callback(wrapSqlClient(tx));
            });
          }
          return rawBegin(...args).then((tx: object) => wrapSqlClient(tx));
        };
      }

      if (prop === "json" && typeof value === "function") {
        return (obj: unknown) => {
          if (obj === null || obj === undefined) return "null";
          return typeof obj === "string" ? obj : JSON.stringify(obj);
        };
      }

      return value;
    },
  }) as T;
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

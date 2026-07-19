import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

function toSqlValue(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function wrapWithDateSerializer<T extends object>(raw: T): T {
  return new Proxy(raw, {
    apply(target, thisArg, argumentsList) {
      const [template, ...params] = argumentsList;
      return Reflect.apply(target as (strings: TemplateStringsArray, ...values: unknown[]) => unknown, thisArg, [
        template,
        ...params.map(toSqlValue),
      ]);
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, target);
      if (prop === "begin" && typeof value === "function") {
        return new Proxy(value, {
          apply(beginTarget, beginThisArg, beginArgs) {
            return Reflect.apply(beginTarget, beginThisArg, beginArgs)
              .then((tx: object) => wrapWithDateSerializer(tx));
          },
        });
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
  const sqlClient = wrapWithDateSerializer(rawSql);

  return {
    sqlClient,
    db: drizzle(sqlClient, { schema }),
  };
}

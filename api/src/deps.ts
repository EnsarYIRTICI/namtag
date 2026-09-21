import type { Pool } from "pg";
import type { Auth } from "./auth";
import type { Config } from "./config";
import type { ObjectStore } from "./storage";

export interface Deps {
  config: Config;
  pool: Pool;
  auth: Auth;
  store: ObjectStore;
  version: { version: string; commit: string; startedAt: string };
}

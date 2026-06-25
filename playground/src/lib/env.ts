import { bool, cleanEnv, str } from "envalid";

export const env = cleanEnv(process.env, {
  APP_NAME: str(),
  APP_DESCRIPTION: str(),
  APP_AUTHOR: str(),
  APP_URL: str(),
  JWT_SECRET: str(),
  JWT_PREFIX: str(),
  JWT_SECURE: bool(),
});

export type Env = typeof env;

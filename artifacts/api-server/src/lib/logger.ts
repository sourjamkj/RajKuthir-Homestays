import pino from "pino";

import { recordLog } from "./log-tail.ts";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Copies warnings and errors (sanitised) into Ryan's digest; the line itself logs as before.
  hooks: {
    logMethod(args, method, level) {
      recordLog(args, level);
      method.apply(this, args);
    },
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

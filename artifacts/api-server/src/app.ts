import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── API routes (must come BEFORE the static/SPA fallback) ──────────────
app.use("/api", router);

// ── Serve the built React frontend (single-service setup) ──────────────
// The frontend builds to artifacts/raj-kuthir/dist/public.
// We resolve it robustly from a few candidate locations so it works
// whether run from the package dir or the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));

const clientDistCandidates = [
  process.env.CLIENT_DIST, // optional expl

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

app.use("/api", router);

const here = path.dirname(fileURLToPath(import.meta.url));

const clientDistCandidates = [
  process.env.CLIENT_DIST,
  path.resolve(process.cwd(), "../raj-kuthir/dist/public"),
  path.resolve(process.cwd(), "artifacts/raj-kuthir/dist/public"),
  path.resolve(here, "../../raj-kuthir/dist/public"),
  path.resolve(here, "../../../raj-kuthir/dist/public"),
].filter(Boolean) as string[];

const clientDist = clientDistCandidates.find((p) => existsSync(p));

if (clientDist) {
  logger.info({ clientDist }, "Serving frontend from disk");
  app.use(express.static(clientDist));

  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  logger.warn(
    { tried: clientDistCandidates },
    "Frontend build not found — API will run without serving the site",
  );
}

export default app;

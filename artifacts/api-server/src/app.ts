import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Railway (and most PaaS hosts) terminate TLS at a proxy. Without this,
// req.ip is the proxy's address and req.secure is always false.
app.set("trust proxy", 1);

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

app.use(cors({ credentials: true, origin: true }));

app.use(cookieParser());
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

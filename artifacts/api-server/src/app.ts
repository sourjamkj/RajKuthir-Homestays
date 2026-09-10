import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { injectMeta, isKnownPath, isPrivatePath, sitemapXml } from "./lib/seo";

const app: Express = express();

// Railway (and most PaaS hosts) terminate TLS at a proxy. Without this,
// req.ip is the proxy's address and req.secure is always false.
app.set("trust proxy", 1);

// Express announces itself in an X-Powered-By header on every response. It
// tells an attacker which stack to try exploits against and tells a guest
// nothing at all.
app.disable("x-powered-by");

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

/**
 * The browser app is served from this same origin, so nothing legitimate needs
 * a cross-origin credentialed request. `origin: true` reflected back whatever
 * Origin the caller sent and paired it with credentials, which is as permissive
 * as CORS gets. Locked to the site's own origins; anything else receives no
 * CORS headers and is refused by the browser.
 */
const ALLOWED_ORIGINS = [
  "https://rajkuthirhomestays.casa",
  "https://www.rajkuthirhomestays.casa",
  ...(process.env.NODE_ENV === "production"
    ? []
    : ["http://localhost:5173", "http://localhost:3000"]),
];

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Same-origin and server-to-server requests carry no Origin header.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);

/**
 * Baseline security headers.
 *
 * No Content-Security-Policy yet: the app relies on inline styles and would
 * need a nonce pipeline first, and a half-right CSP breaks the site silently —
 * worse than not having one. These four are safe, cost nothing, and close the
 * clickjacking and MIME-sniffing gaps around the admin console.
 */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  next();
});

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

  /**
   * The built index.html, read once. Railway restarts the process on every
   * deploy, so there is no staleness to manage.
   */
  const indexHtmlPath = path.join(clientDist, "index.html");
  let baseHtml: string | null = null;

  const readBaseHtml = (): string => {
    if (baseHtml === null) baseHtml = readFileSync(indexHtmlPath, "utf8");
    return baseHtml;
  };

  app.get("/sitemap.xml", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.type("application/xml").send(sitemapXml());
  });

  app.use((req, res, next) => {
    // HEAD is included: crawlers and link previewers use it, and Express
    // strips the body for us.
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path === "/api" || req.path.startsWith("/api/")) return next();

    // A path with a file extension that express.static did not find is a
    // missing asset, not a client route. Answering it with the HTML shell
    // gives the browser a MIME-type error for scripts and a soft 404 for
    // everything else, so let it fall through to a real 404.
    if (path.extname(req.path)) return next();

    // Private routes also get the header, in case a crawler skips the HTML.
    if (isPrivatePath(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }

    // Unknown routes still render — the SPA shows its not-found page — but a
    // 200 here is a soft 404: it lets Google index junk URLs and burns crawl
    // budget on a small site that has very little of it to spare.
    if (!isKnownPath(req.path)) {
      res.status(404);
    }

    try {
      res.type("html").send(injectMeta(readBaseHtml(), req.path));
    } catch (error) {
      // A metadata problem must never take the site down.
      logger.warn({ error, path: req.path }, "Falling back to raw index.html");
      res.sendFile(indexHtmlPath);
    }
  });
} else {
  logger.warn(
    { tried: clientDistCandidates },
    "Frontend build not found — API will run without serving the site",
  );
}

/**
 * Terminal error handler.
 *
 * Express's built-in handler puts `err.stack` in the RESPONSE BODY whenever
 * NODE_ENV is not exactly "production" — and nothing here guarantees Railway
 * sets it. One unhandled throw in a route would have shown a visitor the
 * server's file paths and internal function names. This logs the detail where
 * it belongs and hands the caller a sentence.
 *
 * Four parameters, and registered last: Express identifies error handlers by
 * arity, and only ones mounted after every route can catch anything.
 */
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  logger.error({ error }, "Unhandled error");

  if (res.headersSent) return;

  res
    .status(500)
    .json({ error: "Something went wrong. Please try again in a moment." });
};

app.use(errorHandler);

export default app;

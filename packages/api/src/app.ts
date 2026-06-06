import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { apiJwtGuard } from "./middleware/apiJwtGuard";
import auth from "./routes/auth";
import s3 from "./routes/s3";
import sqs from "./routes/sqs";
import sns from "./routes/sns";
import lambda from "./routes/lambda";
import dynamodb from "./routes/dynamodb";
import cloudwatch from "./routes/cloudwatch";
import eks from "./routes/eks";
import rds from "./routes/rds";
import ec2 from "./routes/ec2";
import clouds from "./routes/clouds";

export function createApp() {
  const app = new Hono();

  app.use("*", cors());
  app.use("*", logger());
  app.use("*", apiJwtGuard);

  app.route("/api/auth", auth);

  const protectedApi = new Hono();
  protectedApi.route("/s3", s3);
  protectedApi.route("/sqs", sqs);
  protectedApi.route("/sns", sns);
  protectedApi.route("/lambda", lambda);
  protectedApi.route("/dynamodb", dynamodb);
  protectedApi.route("/cloudwatch", cloudwatch);
  protectedApi.route("/eks", eks);
  protectedApi.route("/rds", rds);
  protectedApi.route("/ec2", ec2);
  protectedApi.route("/clouds", clouds);
  app.route("/api", protectedApi);

  app.use("*", serveStatic({ root: "./public" }));
  app.get("*", serveStatic({ path: "./public/index.html" }));

  return app;
}

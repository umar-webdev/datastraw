import pino from "pino";
import { config, isProduction } from "../config";

// JSON logs in production (searchable in Render), pretty logs locally.
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: isProduction ? undefined : { target: "pino-pretty", options: { colorize: true } },
});

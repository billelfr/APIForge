import { app, prisma } from "./index";
import { config } from "./config";
import { logger } from "./logger";

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, "APIForge backend listening");
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  const forceTimer = setTimeout(() => {
    logger.error("Shutdown timed out");
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  server.close(async (error) => {
    try {
      await prisma.$disconnect();
      if (error) {
        logger.error({ errorName: error.name }, "HTTP server close failed");
        process.exitCode = 1;
      }
    } catch (disconnectError) {
      logger.error(
        { errorName: disconnectError instanceof Error ? disconnectError.name : "UnknownError" },
        "Database disconnect failed",
      );
      process.exitCode = 1;
    } finally {
      clearTimeout(forceTimer);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

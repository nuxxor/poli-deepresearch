import { env } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const app = await buildServer();

  try {
    await app.listen({
      host: env.API_HOST,
      port: env.API_PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void main();

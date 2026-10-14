import { loadConfig } from "./config/app-config";
import { createApp } from "./bootstrap";

const main = async (): Promise<void> => {
  const config = loadConfig();
  const app = await createApp(config);

  if (config.run.http) {
    await app.listen(config.port, "0.0.0.0");
  } else {
    await app.init(); // worker-only instance: consumer and workers, no HTTP port
  }
};

void main();

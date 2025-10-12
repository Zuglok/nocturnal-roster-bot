import { startBot, registerCommands } from "./src/discordClient.js";
import { startHealth } from "./src/health.js";

(async function main() {
  startHealth(3000);
  // Force command registration on boot according to REGISTER_MODE
  await registerCommands(); // uses process.env.REGISTER_MODE
  await startBot();
})();

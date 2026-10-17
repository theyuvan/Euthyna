import { config } from "./config.js";
import { startLoops } from "./scheduler.js";
import { createServer } from "./server.js";

createServer().listen(config.PORT, () => {
  console.log(`euthyna worker on :${config.PORT} (executor=${config.EXECUTOR}, model=${config.LLM_MODEL})`);
});
startLoops();

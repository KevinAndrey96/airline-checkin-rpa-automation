const fs = require("fs");
const path = require("path");
const Joi = require("joi");

class SkyvernBotConfig {
  constructor() {
    this.config = null;
  }

  load() {
    require("dotenv").config({ path: path.join(process.cwd(), ".env") });
    require("dotenv").config({ path: path.join(process.cwd(), "skyvern-bot/.env") });

    const defaults = this.loadJSON(path.join(__dirname, "config/default.json"));
    this.config = this.mergeWithEnv(defaults);
    this.validate();
    return this;
  }

  loadJSON(filePath) {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  }

  mergeWithEnv(config) {
    return {
      ...config,
      skyvern: {
        ...config.skyvern,
        apiUrl: process.env.SKYVERN_API_URL || config.skyvern.apiUrl,
        apiKey: process.env.SKYVERN_API_KEY || "",
        pollIntervalMs: parseInt(
          process.env.SKYVERN_POLL_INTERVAL_MS || config.skyvern.pollIntervalMs,
          10
        ),
        taskTimeoutMs: parseInt(
          process.env.SKYVERN_TASK_TIMEOUT_MS || config.skyvern.taskTimeoutMs,
          10
        ),
        maxSteps: parseInt(process.env.SKYVERN_MAX_STEPS || config.skyvern.maxSteps, 10),
        engine: process.env.SKYVERN_ENGINE || config.skyvern.engine,
        proxyLocation: process.env.SKYVERN_PROXY_LOCATION || config.skyvern.proxyLocation
      },
      copa: {
        ...config.copa,
        mode: process.env.COPA_SKYVERN_MODE || config.copa.mode,
        workflowId: process.env.COPA_SKYVERN_WORKFLOW_ID || config.copa.workflowId || "",
        workflowRunWith: process.env.COPA_SKYVERN_RUN_WITH || config.copa.workflowRunWith,
        workflowAiFallback: process.env.COPA_SKYVERN_AI_FALLBACK !== "false"
      },
      csv: {
        ...config.csv,
        path: process.env.SKYVERN_CSV_PATH || config.csv.path
      },
      processing: {
        ...config.processing,
        delayBetweenPassengersMs: parseInt(
          process.env.SKYVERN_DELAY_BETWEEN_PASSENGERS ||
            config.processing.delayBetweenPassengersMs,
          10
        )
      },
      logging: {
        ...config.logging,
        level: process.env.SKYVERN_LOG_LEVEL || config.logging.level,
        console: process.env.SKYVERN_LOG_CONSOLE !== "false"
      }
    };
  }

  validate() {
    const schema = Joi.object({
      skyvern: Joi.object({
        apiUrl: Joi.string().uri().required(),
        apiKey: Joi.string().min(1).required(),
        pollIntervalMs: Joi.number().min(1000).required(),
        taskTimeoutMs: Joi.number().min(60000).required(),
        maxSteps: Joi.number().min(5).max(100).required(),
        engine: Joi.string().required(),
        proxyLocation: Joi.string().required()
      }).required(),
      copa: Joi.object({
        checkInUrl: Joi.string().uri().required(),
        boardingPassDir: Joi.string().required()
      }).required(),
      csv: Joi.object({
        path: Joi.string().required(),
        airlineFilter: Joi.string().required()
      }).required()
    });

    const { error } = schema.validate(this.config, { allowUnknown: true });
    if (error) {
      throw new Error(`skyvern-bot config: ${error.message}`);
    }
  }

  get(key) {
    const parts = key.split(".");
    let value = this.config;

    for (const part of parts) {
      if (value == null || typeof value !== "object") {
        return undefined;
      }
      value = value[part];
    }

    return value;
  }
}

module.exports = SkyvernBotConfig;

const fs = require("fs");
const path = require("path");
const Joi = require("joi");

class Config {
  constructor() {
    this.config = null;
    this.airlines = null;
    this.errorCodes = null;
  }

  load() {
    try {
      require("dotenv").config();

      const defaultConfig = this.loadJSON(path.join(__dirname, "../config/default.json"));
      const airlinesConfig = this.loadJSON(path.join(__dirname, "../config/airlines.json"));
      const errorCodesConfig = this.loadJSON(path.join(__dirname, "../config/error-codes.json"));

      this.config = this.mergeWithEnv(defaultConfig);
      this.airlines = airlinesConfig;
      this.errorCodes = errorCodesConfig.errors;

      this.validate();

      return this;
    } catch (error) {
      throw new Error(`config loading: ${error.message}`);
    }
  }

  loadJSON(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`reading ${filePath}: ${error.message}`);
    }
  }

  mergeWithEnv(config) {
    return {
      ...config,
      browser: {
        ...config.browser,
        headless: process.env.BROWSER_HEADLESS === "true",
        slowMo: parseInt(process.env.BROWSER_SLOW_MO || config.browser.slowMo, 10)
      },
      timeout: {
        ...config.timeout,
        default: parseInt(process.env.DEFAULT_TIMEOUT || config.timeout.default, 10)
      },
      retry: {
        ...config.retry,
        maxAttempts: parseInt(process.env.MAX_RETRIES || config.retry.maxAttempts, 10)
      },
      processing: {
        ...config.processing,
        delayBetweenPassengers: parseInt(
          process.env.DELAY_BETWEEN_PASSENGERS || config.processing.delayBetweenPassengers,
          10
        )
      },
      logging: {
        ...config.logging,
        level: process.env.LOG_LEVEL || config.logging.level,
        console: process.env.LOG_CONSOLE !== "false"
      }
    };
  }

  validate() {
    const schema = Joi.object({
      browser: Joi.object({
        headless: Joi.boolean().required(),
        slowMo: Joi.number().min(0).required(),
        viewport: Joi.object({
          width: Joi.number().required(),
          height: Joi.number().required()
        }).required(),
        userAgent: Joi.string().required(),
        downloadPath: Joi.string().required()
      }).required(),
      timeout: Joi.object({
        default: Joi.number().min(1000).required(),
        navigation: Joi.number().min(1000).required(),
        download: Joi.number().min(1000).required(),
        element: Joi.number().min(1000).required()
      }).required(),
      retry: Joi.object({
        maxAttempts: Joi.number().min(1).max(10).required(),
        backoff: Joi.object({
          initial: Joi.number().min(100).required(),
          multiplier: Joi.number().min(1).required(),
          max: Joi.number().min(1000).required()
        }).required()
      }).required(),
      processing: Joi.object({
        delayBetweenPassengers: Joi.number().min(0).required(),
        screenshotOnError: Joi.boolean().required(),
        screenshotOnSuccess: Joi.boolean().required()
      }).required(),
      csv: Joi.object({
        encoding: Joi.string().required(),
        delimiter: Joi.string().required(),
        backup: Joi.boolean().required(),
        incrementalSave: Joi.boolean().required()
      }).required(),
      pdf: Joi.object({
        watermark: Joi.object({
          enabled: Joi.boolean().required(),
          text: Joi.string().required(),
          fontSize: Joi.number().required(),
          color: Joi.object({
            r: Joi.number().min(0).max(1).required(),
            g: Joi.number().min(0).max(1).required(),
            b: Joi.number().min(0).max(1).required()
          }).required(),
          position: Joi.object({
            x: Joi.number().required(),
            y: Joi.number().required()
          }).required()
        }).required(),
        backup: Joi.boolean().required()
      }).required(),
      logging: Joi.object({
        level: Joi.string().valid("error", "warn", "info", "debug").required(),
        console: Joi.boolean().required(),
        file: Joi.boolean().required(),
        maxFiles: Joi.number().required(),
        maxSize: Joi.string().required()
      }).required()
    });

    const { error } = schema.validate(this.config);
    if (error) {
      throw new Error(`config validation: ${error.message}`);
    }
  }

  get(key) {
    const keys = key.split(".");
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value;
  }

  getAirline(code) {
    if (!this.airlines[code]) {
      throw new Error(`airline not found: ${code}`);
    }

    return this.airlines[code];
  }

  getEnabledAirlines() {
    return Object.values(this.airlines).filter(airline => airline.enabled);
  }

  getErrorCode(code) {
    return this.errorCodes[code] || this.errorCodes.ERR_UNKNOWN;
  }

  isAirlineEnabled(code) {
    return this.airlines[code]?.enabled === true;
  }
}

const config = new Config();

module.exports = config;

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");

class SkyvernLogger {
  constructor() {
    this.logger = null;
    this.context = {};
  }

  init(config) {
    const winston = require("winston");
    const logDir = path.resolve(process.cwd(), config.get("logging.logDir"));
    const logLevel = config.get("logging.level") || "info";
    const logToConsole = config.get("logging.console") !== false;
    const logToFile = config.get("logging.file") !== false;

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const formats = [
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.errors({ stack: true }),
      winston.format.metadata({ fillExcept: ["message", "level", "timestamp"] })
    ];

    const transports = [];

    if (logToConsole) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            ...formats,
            winston.format.colorize({ all: true }),
            winston.format.printf(this.consoleFormat.bind(this))
          )
        })
      );
    }

    if (logToFile) {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, config.get("logging.errorLogFile")),
          level: "error",
          format: winston.format.combine(...formats, winston.format.json())
        })
      );

      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, config.get("logging.appLogFile")),
          format: winston.format.combine(...formats, winston.format.json())
        })
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports
    });
  }

  consoleFormat(info) {
    const prefix = chalk.cyan("[skyvern-bot]");
    const ctx = this.context.reservation ? ` ${chalk.gray(this.context.reservation)}` : "";
    return `${prefix}${ctx} ${info.message}`;
  }

  setContext(context) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  logPassengerStart(passenger) {
    this.setContext({
      reservation: passenger.reservation_code,
      airline: passenger.airline
    });
    this.info("processing passenger", {
      airline: passenger.airline,
      reservation: passenger.reservation_code,
      passenger: `${passenger.last_name} ${passenger.first_name}`
    });
  }

  logPassengerSuccess(passenger, artifactPath) {
    this.info("check-in completed", {
      airline: passenger.airline,
      reservation: passenger.reservation_code,
      artifactPath
    });
  }

  logPassengerError(passenger, error, attemptCount) {
    this.error("check-in failed", {
      airline: passenger.airline,
      reservation: passenger.reservation_code,
      attemptCount,
      error: error.message || String(error)
    });
  }

  logSummary(summary) {
    this.info("processing summary", summary);
  }
}

module.exports = new SkyvernLogger();

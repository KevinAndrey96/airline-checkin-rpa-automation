const winston = require("winston");
const path = require("path");
const chalk = require("chalk");

class Logger {
  constructor() {
    this.logger = null;
    this.context = {};
  }

  init(config) {
    const logDir = path.join(__dirname, "../logs");
    const logLevel = config.get("logging.level") || "info";
    const logToConsole = config.get("logging.console") !== false;
    const logToFile = config.get("logging.file") !== false;

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
          filename: path.join(logDir, "errors.log"),
          level: "error",
          format: winston.format.combine(...formats, winston.format.json()),
          maxsize: 10485760,
          maxFiles: 10
        })
      );

      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, "app.log"),
          format: winston.format.combine(...formats, winston.format.json()),
          maxsize: 10485760,
          maxFiles: 10
        })
      );
    }

    this.logger = winston.createLogger({
      level: logLevel,
      transports
    });
  }

  consoleFormat(info) {
    const { level, message, metadata } = info;
    const contextStr = this.formatContext(metadata);
    
    // Solo mostrar metadatos importantes (no en gris)
    const importantMeta = this.formatImportantMetadata(metadata);

    let levelIcon = "";
    switch (level) {
      case "\u001b[31merror\u001b[39m":
        levelIcon = "✗";
        break;
      case "\u001b[33mwarn\u001b[39m":
        levelIcon = "⚠";
        break;
      case "\u001b[32minfo\u001b[39m":
        levelIcon = "ℹ";
        break;
      case "\u001b[34mdebug\u001b[39m":
        levelIcon = "⚙";
        break;
      default:
        levelIcon = "•";
    }

    let output = `${levelIcon} ${message}`;

    if (contextStr) {
      output += ` ${chalk.cyan(contextStr)}`;
    }

    // Solo mostrar metadatos importantes (sin gris)
    if (importantMeta) {
      output += ` ${chalk.white(importantMeta)}`;
    }

    return output;
  }

  formatContext(metadata) {
    if (!metadata) return "";

    const parts = [];

    if (metadata.airline) {
      parts.push(`[${metadata.airline}]`);
    }

    if (metadata.reservation) {
      parts.push(`[${metadata.reservation}]`);
    }

    if (metadata.passenger) {
      parts.push(`[${metadata.passenger}]`);
    }

    return parts.join(" ");
  }

  formatMetadata(metadata) {
    if (!metadata) return "";

    const filtered = { ...metadata };
    delete filtered.airline;
    delete filtered.reservation;
    delete filtered.passenger;
    delete filtered.context;

    const keys = Object.keys(filtered);
    if (keys.length === 0) return "";

    return keys.map(key => `${key}: ${JSON.stringify(filtered[key])}`).join(", ");
  }

  formatImportantMetadata(metadata) {
    if (!metadata) return "";

    // Solo mostrar campos importantes, excluyendo metadata técnica
    const importantFields = ['error', 'code', 'path', 'pdfPath', 'error_message'];
    const filtered = {};
    
    for (const key of importantFields) {
      if (metadata[key] !== undefined && metadata[key] !== null && metadata[key] !== '') {
        filtered[key] = metadata[key];
      }
    }

    const keys = Object.keys(filtered);
    if (keys.length === 0) return "";

    return keys.map(key => {
      const value = filtered[key];
      // Truncar valores largos
      const displayValue = typeof value === 'string' && value.length > 50 
        ? value.substring(0, 50) + '...' 
        : value;
      return `${key}: ${displayValue}`;
    }).join(", ");
  }

  setContext(context) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  enrichMetadata(metadata = {}) {
    return {
      ...this.context,
      ...metadata
    };
  }

  error(message, metadata = {}) {
    this.logger.error(message, this.enrichMetadata(metadata));
  }

  warn(message, metadata = {}) {
    this.logger.warn(message, this.enrichMetadata(metadata));
  }

  info(message, metadata = {}) {
    this.logger.info(message, this.enrichMetadata(metadata));
  }

  debug(message, metadata = {}) {
    this.logger.debug(message, this.enrichMetadata(metadata));
  }

  logError(error, metadata = {}) {
    const errorData = {
      ...metadata,
      error: error.message,
      stack: error.stack,
      code: error.code || "UNKNOWN"
    };

    this.error(error.message, errorData);
  }

  logPassengerStart(passenger) {
    this.setContext({
      airline: passenger.airline,
      reservation: passenger.reservation_code,
      passenger: `${passenger.last_name} ${passenger.first_name}`
    });

    this.info("check-in started", {
      document: `${passenger.document_type} ${passenger.document_number}`,
      email: passenger.email
    });
  }

  logPassengerSuccess(passenger, pdfPath) {
    this.info("check-in completed successfully", {
      pdfPath,
      duration: this.context.startTime ? Date.now() - this.context.startTime : undefined
    });
  }

  logPassengerError(passenger, error, attemptCount) {
    this.error("check-in failed", {
      error: error.message,
      code: error.code,
      attemptCount,
      willRetry: error.recoverable && attemptCount < 3
    });
  }

  logSummary(summary) {
    this.info("processing summary", {
      total: summary.total,
      success: summary.success,
      failed: summary.failed,
      skipped: summary.skipped,
      successRate: summary.total > 0 ? ((summary.success / summary.total) * 100).toFixed(2) + "%" : "0%"
    });
  }

  startTimer() {
    this.context.startTime = Date.now();
  }
}

const logger = new Logger();

module.exports = logger;

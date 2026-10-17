const path = require("path");
const SkyvernBotConfig = require("./config");
const logger = require("./logger");
const CSVManager = require("./csv/CSVManager");
const SkyvernClient = require("./client/SkyvernClient");
const CopaCheckIn = require("./airlines/copa/CopaCheckIn");

class SkyvernCheckInBot {
  constructor() {
    this.config = null;
    this.csvManager = null;
    this.skyvernClient = null;
    this.copaCheckIn = null;
    this.summary = { total: 0, success: 0, failed: 0, skipped: 0 };
  }

  async init() {
    this.config = new SkyvernBotConfig().load();
    logger.init(this.config);

    const csvPath = path.resolve(process.cwd(), this.config.get("csv.path"));
    this.csvManager = new CSVManager(csvPath, this.config, logger);
    this.skyvernClient = new SkyvernClient(this.config, logger);
    this.copaCheckIn = new CopaCheckIn(this.config, logger, this.skyvernClient);

    await this.skyvernClient.healthCheck();
    logger.info("skyvern server connected", {
      apiUrl: this.config.get("skyvern.apiUrl")
    });
  }

  async run() {
    await this.csvManager.acquireLock();

    try {
      await this.csvManager.persistResetInterrupted();

      const { processable, skipped } = this.csvManager.getProcessablePassengers();
      this.summary.skipped = skipped.length;
      this.summary.total = processable.length + skipped.length;

      logger.info("copa passengers loaded", {
        processable: processable.length,
        skipped: skipped.length
      });

      if (processable.length === 0) {
        logger.warn("no copa passengers to process — add rows with airline=copa in passengers.csv");
        return;
      }

      for (const { passenger, index } of processable) {
        await this.processPassenger(passenger, index);

        const delay = this.config.get("processing.delayBetweenPassengersMs");
        if (delay > 0) {
          await this.delay(delay);
        }
      }
    } finally {
      await this.csvManager.releaseLock();
    }
  }

  async processPassenger(passenger, csvIndex) {
    logger.clearContext();
    logger.logPassengerStart(passenger);

    const inProgress = this.csvManager.markAsInProgress(passenger);
    await this.csvManager.writePassengerAtIndex(csvIndex, inProgress);

    try {
      const result = await this.copaCheckIn.checkIn(inProgress);

      if (result.success) {
        this.summary.success++;
        const updated = this.csvManager.markAsSuccess(inProgress);
        await this.csvManager.writePassengerAtIndex(csvIndex, updated);
        logger.logPassengerSuccess(updated, result.boardingPassPath);

        if (result.recordingUrl) {
          logger.info("skyvern recording available", {
            reservation: passenger.reservation_code,
            recordingUrl: result.recordingUrl,
            runId: result.runId
          });
        }
        return;
      }

      throw Object.assign(new Error(result.errorMessage || "Unknown check-in failure"), {
        code: result.errorCode || "ERR_SKYVERN"
      });
    } catch (error) {
      this.summary.failed++;
      const errorMessage = `[${error.code || "ERR_SKYVERN"}] ${error.message}`;
      const updated = this.csvManager.markAsError(inProgress, errorMessage);
      await this.csvManager.writePassengerAtIndex(csvIndex, updated);
      logger.logPassengerError(updated, error, updated.attempt_count);

      const reviewDelay = this.config.get("processing.failureReviewDelayMs");
      if (reviewDelay > 0) {
        logger.info(`waiting ${reviewDelay}ms after failure (review in Skyvern UI)`);
        await this.delay(reviewDelay);
      }
    }
  }

  printSummary() {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  RESUMEN — Skyvern Bot (Copa Airlines)");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  Pasajeros Copa:          ${this.summary.total}`);
    console.log(`  ✓ Exitosos:              ${this.summary.success}`);
    console.log(`  ✗ Fallidos:              ${this.summary.failed}`);
    console.log(`  ⊘ Omitidos:              ${this.summary.skipped}`);

    if (this.summary.total > 0) {
      const rate = ((this.summary.success / this.summary.total) * 100).toFixed(2);
      console.log(`  Tasa de éxito:           ${rate}%`);
    }

    console.log("═══════════════════════════════════════════════════════");
    console.log("  Pasabordes: boarding_passes/copa/");
    console.log("  Logs:       logs/skyvern-app.log");
    console.log("  Skyvern UI: http://localhost:8080\n");

    logger.logSummary(this.summary);
  }

  async shutdown() {
    this.printSummary();
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const bot = new SkyvernCheckInBot();

  try {
    await bot.init();
    await bot.run();
    await bot.shutdown();
    process.exit(bot.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("\n✗ ERROR FATAL (skyvern-bot):", error.message);
    console.error("Verifica: Skyvern Docker (localhost:8000), LM Studio (localhost:1234), SKYVERN_API_KEY\n");
    await bot.shutdown();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = SkyvernCheckInBot;

const path = require("path");
const config = require("./config");
const logger = require("./logger");
const CSVManager = require("./csv");
const BrowserManager = require("./browser");
const PDFProcessor = require("./pdf");
const AirlineFactory = require("./airlines/AirlineFactory");
const RetryManager = require("./retry");
const { categorizeError } = require("./errors");

class CheckInBot {
  constructor() {
    this.config = null;
    this.csvManager = null;
    this.browser = null;
    this.pdfProcessor = null;
    this.airlineFactory = null;
    this.retryManager = null;
    this.summary = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0
    };
  }

  async init() {
    try {
      this.config = config.load();
      logger.init(this.config);

      const csvPath = path.join(process.cwd(), "passengers.csv");
      this.csvManager = new CSVManager(csvPath, this.config, logger);

      this.browser = new BrowserManager(this.config, logger);
      await this.browser.init();

      this.pdfProcessor = new PDFProcessor(this.config, logger);
      this.airlineFactory = new AirlineFactory(this.config, logger, this.browser);
      this.retryManager = new RetryManager(this.config, logger);
    } catch (error) {
      logger.error("system initialization", { error: error.message });
      throw error;
    }
  }

  async run() {
    let passengers = [];

    try {
      await this.csvManager.acquireLock();

      if (this.config.get("csv.backup")) {
        await this.csvManager.backup();
      }

      passengers = await this.csvManager.read();
      passengers = this.csvManager.resetInterruptedCheckIns(passengers);

      const { processable, skipped } = this.csvManager.getProcessablePassengers(passengers);

      this.summary.total = passengers.length;
      this.summary.skipped = skipped.length;

      logger.info("passengers loaded", {
        total: passengers.length,
        processable: processable.length,
        skipped: skipped.length
      });

      if (processable.length === 0) {
        logger.warn("no passengers to process");
        return;
      }

      for (const { passenger, index } of processable) {
        await this.processPassenger(passenger, index, passengers);

        const delay = this.config.get("processing.delayBetweenPassengers");
        if (delay > 0) {
          logger.info(`waiting ${delay}ms before next passenger`);
          await this.delay(delay);
        }
      }

      logger.info("all passengers processed");
    } catch (error) {
      logger.error("processing passengers", { error: error.message });
      throw error;
    } finally {
      if (passengers.length > 0) {
        await this.csvManager.write(passengers);
      }
      await this.csvManager.releaseLock();
    }
  }

  async processPassenger(passenger, index, passengers) {
    try {
      logger.clearContext();
      logger.logPassengerStart(passenger);
      logger.startTimer();

      passengers[index] = this.csvManager.markAsInProgress(passenger);
      await this.csvManager.write(passengers);

      // NO usar retryManager - ejecutar directamente sin reintentos
      try {
        const result = await this.executeCheckIn(passenger);
        
        // Solo marcar como SUCCESS si realmente se capturó el pasabordo
        // El resultado debe ser un string con la ruta del archivo del pasabordo (.png)
        if (result && typeof result === 'string' && (result.endsWith('.png') || result.includes('boarding_passes'))) {
          await this.handleSuccess(passenger, result, index, passengers);
        } else {
          // Si no se capturó el pasabordo, marcar como error
          logger.warn("check-in process completed but boarding pass was not captured", {
            airline: passenger.airline,
            reservation: passenger.reservation_code,
            result: result
          });
          throw new Error("check-in completed but boarding pass was not captured");
        }
      } catch (error) {
        await this.handleFailure(passenger, error, index, passengers);
      }
    } catch (error) {
      await this.handleFailure(passenger, error, index, passengers);
    }
  }

  async executeCheckIn(passenger) {
    try {
      if (!this.airlineFactory.isSupported(passenger.airline)) {
        throw new Error(`airline not supported: ${passenger.airline}`);
      }

      const adapter = this.airlineFactory.create(passenger.airline);

      const result = await adapter.checkIn(passenger);

      // Si el resultado es un objeto con éxito y pasabordo capturado
      if (typeof result === 'object' && result !== null && result.success === true) {
        if (result.boardingPassCaptured && result.boardingPassPath) {
          logger.info("✓ check-in completed successfully with boarding pass captured", {
            airline: passenger.airline,
            reservation: passenger.reservation_code,
            boardingPassPath: result.boardingPassPath
          });
          
          // Retornar el path del pasabordo como éxito
          return result.boardingPassPath;
        } else {
          // Si no se capturó el pasabordo, lanzar error
          logger.warn("check-in completed but boarding pass was not captured", {
            airline: passenger.airline,
            reservation: passenger.reservation_code,
            message: result.message,
            boardingPassCaptured: result.boardingPassCaptured
          });
          
          throw new Error("check-in completed but boarding pass was not captured");
        }
      }

      // Si el resultado es un string (mensaje de éxito), verificar si es un path de pasabordo
      if (typeof result === 'string' && result !== '') {
        // Si es un path de pasabordo (.png o contiene boarding_passes), retornarlo
        if (result.endsWith('.png') || result.includes('boarding_passes')) {
          return result;
        }
        
        // Si no es un path de pasabordo ni PDF, lanzar error
        if (!result.endsWith('.pdf')) {
          logger.warn("check-in completed but boarding pass path is invalid", {
            airline: passenger.airline,
            reservation: passenger.reservation_code,
            result
          });
          
          throw new Error("check-in completed but boarding pass was not captured");
        }
      }

      // Si hay una ruta de PDF, validar y procesar
      if (typeof result === 'string' && result.endsWith('.pdf')) {
        const pdfPath = result;
        const validation = await this.pdfProcessor.validatePDF(pdfPath);
        if (!validation.valid) {
          throw new Error(`invalid PDF downloaded: ${validation.error}`);
        }

        await this.pdfProcessor.process(pdfPath, passenger, passenger.airline);

        if (this.config.get("processing.screenshotOnSuccess")) {
          await this.browser.captureOnSuccess(passenger);
        }

        return pdfPath;
      }

      // Si llegamos aquí sin retornar nada válido, lanzar error
      logger.warn("check-in process completed but no valid boarding pass path was returned", {
        airline: passenger.airline,
        reservation: passenger.reservation_code,
        resultType: typeof result,
        result: result
      });
      
      throw new Error("check-in completed but boarding pass was not captured");
    } catch (error) {
      if (this.config.get("processing.screenshotOnError")) {
        await this.browser.captureOnError(passenger, "check-in-error");
      }

      // Categorizar el error preservando el contexto
      const categorizedError = categorizeError(error, this.config);
      throw categorizedError;
    }
  }

  async handleSuccess(passenger, pdfPath, index, passengers) {
    this.summary.success++;

    passengers[index] = this.csvManager.markAsSuccess(passenger, pdfPath);
    await this.csvManager.write(passengers);

    logger.logPassengerSuccess(passenger, pdfPath);
  }

  async handleFailure(passenger, error, index, passengers) {
    this.summary.failed++;

    const categorizedError = categorizeError(error, this.config);
    
    // El mensaje ya incluye el contexto si existe (gracias a categorizeError)
    const errorMessage = categorizedError.userMessage || categorizedError.message;

    passengers[index] = this.csvManager.markAsError(
      passengers[index],
      errorMessage,
      categorizedError.code
    );
    await this.csvManager.write(passengers);

    logger.logPassengerError(passenger, categorizedError, passengers[index].attempt_count);

    // Esperar 20 segundos antes de continuar (dejar ventana abierta para revisión manual)
    logger.info("waiting 20 seconds before continuing (window will remain open for manual review)", {
      airline: passenger.airline,
      reservation: passenger.reservation_code
    });
    await this.delay(20000);
  }

  async shutdown() {
    try {
      logger.info("shutting down system");

      if (this.browser) {
        await this.browser.close();
      }

      if (this.csvManager) {
        await this.csvManager.releaseLock();
      }

      this.printSummary();

      logger.info("system shutdown complete");
    } catch (error) {
      logger.error("shutdown", { error: error.message });
    }
  }

  printSummary() {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  RESUMEN DE PROCESAMIENTO");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`  Total de pasajeros:      ${this.summary.total}`);
    console.log(`  ✓ Exitosos:              ${this.summary.success}`);
    console.log(`  ✗ Fallidos:              ${this.summary.failed}`);
    console.log(`  ⊘ Omitidos:              ${this.summary.skipped}`);

    if (this.summary.total > 0) {
      const successRate = ((this.summary.success / this.summary.total) * 100).toFixed(2);
      console.log(`  Tasa de éxito:           ${successRate}%`);
    }

    console.log("═══════════════════════════════════════════════════════\n");

    logger.logSummary(this.summary);

    if (this.summary.failed > 0) {
      console.log("⚠ Algunos pasajeros fallaron. Revise el archivo CSV y logs/errors.log\n");
    }

    if (this.summary.success > 0) {
      console.log("✓ Los pasabordes descargados están en: boarding_passes/\n");
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const bot = new CheckInBot();

  try {
    await bot.init();
    await bot.run();
    await bot.shutdown();
    process.exit(0);
  } catch (error) {
    console.error("\n✗ ERROR FATAL:", error.message);
    console.error("Revise logs/errors.log para más detalles\n");
    await bot.shutdown();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = CheckInBot;

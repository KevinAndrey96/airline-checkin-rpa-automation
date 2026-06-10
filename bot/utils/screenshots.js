const fs = require("fs");
const path = require("path");

class ScreenshotManager {
  constructor(logger) {
    this.logger = logger;
    this.screenshotDir = path.join(__dirname, "../../logs/screenshots");
    this.finalDir = path.join(__dirname, "../../final");
    this.ensureDir();
  }

  ensureDir() {
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
    if (!fs.existsSync(this.finalDir)) {
      fs.mkdirSync(this.finalDir, { recursive: true });
    }
  }

  async capture(page, prefix, metadata = {}) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${prefix}_${timestamp}.png`;
      const filepath = path.join(this.screenshotDir, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true
      });

      this.logger.info("screenshot captured", {
        file: filename,
        ...metadata
      });

      return filepath;
    } catch (error) {
      this.logger.warn("capturing screenshot", { error: error.message });
      return null;
    }
  }

  async captureOnError(page, passenger, step) {
    const prefix = `error_${passenger.airline}_${passenger.reservation_code}_${step}`;
    return await this.capture(page, prefix, {
      airline: passenger.airline,
      reservation: passenger.reservation_code,
      step
    });
  }

  async captureOnSuccess(page, passenger) {
    const prefix = `success_${passenger.airline}_${passenger.reservation_code}`;
    return await this.capture(page, prefix, {
      airline: passenger.airline,
      reservation: passenger.reservation_code
    });
  }

  async captureBoardingPass(page, passenger) {
    try {
      // Usar la misma estructura que los PDFs: boarding_passes/{airline}/{reservation_code}_{last_name}_{first_name}.png
      const boardingPassDir = path.join(
        __dirname,
        "../../boarding_passes",
        passenger.airline.toLowerCase()
      );

      if (!fs.existsSync(boardingPassDir)) {
        fs.mkdirSync(boardingPassDir, { recursive: true });
      }

      const filename = `${passenger.reservation_code}_${passenger.last_name}_${passenger.first_name}.png`;
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const filepath = path.join(boardingPassDir, sanitizedFilename);

      await page.screenshot({
        path: filepath,
        fullPage: true
      });

      this.logger.info("boarding pass screenshot captured", {
        file: sanitizedFilename,
        airline: passenger.airline,
        reservation: passenger.reservation_code,
        path: filepath
      });

      return filepath;
    } catch (error) {
      this.logger.warn("capturing boarding pass screenshot", { error: error.message });
      return null;
    }
  }

  cleanup(olderThanDays = 7) {
    try {
      const files = fs.readdirSync(this.screenshotDir);
      const now = Date.now();
      const maxAge = olderThanDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        const filepath = path.join(this.screenshotDir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          fs.unlinkSync(filepath);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        this.logger.info("old screenshots cleaned", { deleted: deletedCount });
      }
    } catch (error) {
      this.logger.warn("cleaning screenshots", { error: error.message });
    }
  }
}

module.exports = ScreenshotManager;

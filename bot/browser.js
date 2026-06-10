const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const path = require("path");
const ScreenshotManager = require("./utils/screenshots");

chromium.use(StealthPlugin());

class BrowserManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.screenshots = new ScreenshotManager(logger);
    this.setupCleanupHandlers();
  }

  setupCleanupHandlers() {
    const cleanup = async () => {
      this.logger.info("shutting down browser");
      await this.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", async () => {
      await this.close();
    });

    process.on("uncaughtException", async error => {
      this.logger.error("uncaught exception", { error: error.message, stack: error.stack });
      await this.close();
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason, promise) => {
      this.logger.error("unhandled rejection", { reason, promise });
      await this.close();
      process.exit(1);
    });
  }

  async init() {
    try {
      const browserConfig = this.config.get("browser");

      this.browser = await chromium.launch({
        headless: browserConfig.headless,
        slowMo: browserConfig.slowMo,
        args: [
          "--disable-dev-shm-usage",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-infobars",
          "--window-position=0,0",
          "--ignore-certifcate-errors",
          "--ignore-certifcate-errors-spki-list",
          "--disable-blink-features=AutomationControlled"
        ]
      });

      this.context = await this.browser.newContext({
        viewport: browserConfig.viewport,
        userAgent: browserConfig.userAgent,
        acceptDownloads: true,
        locale: "es-CO",
        timezoneId: "America/Bogota",
        permissions: ["geolocation"],
        extraHTTPHeaders: {
          "Accept-Language": "es-CO,es;q=0.9,en;q=0.8"
        }
      });

      this.page = await this.context.newPage();

      this.page.setDefaultTimeout(this.config.get("timeout.default"));
      this.page.setDefaultNavigationTimeout(this.config.get("timeout.navigation"));

      return this;
    } catch (error) {
      throw new Error(`browser initialization: ${error.message}`);
    }
  }

  async navigate(url, options = {}) {
    try {
      this.logger.info("navigating to url", { url });

      const response = await this.page.goto(url, {
        waitUntil: options.waitUntil || "networkidle",
        timeout: options.timeout || this.config.get("timeout.navigation")
      });

      if (!response.ok() && response.status() !== 304) {
        throw new Error(`navigation failed with status ${response.status()}`);
      }

      return response;
    } catch (error) {
      throw new Error(`navigating to ${url}: ${error.message}`);
    }
  }

  async waitForDownload(triggerAction, timeout = null) {
    try {
      const downloadTimeout = timeout || this.config.get("timeout.download");

      this.logger.info("waiting for download", { timeout: downloadTimeout });

      const downloadPromise = this.page.waitForEvent("download", {
        timeout: downloadTimeout
      });

      if (triggerAction) {
        await triggerAction();
      }

      const download = await downloadPromise;

      this.logger.info("download started", {
        filename: download.suggestedFilename()
      });

      return download;
    } catch (error) {
      throw new Error(`waiting for download: ${error.message}`);
    }
  }

  async saveDownload(download, targetPath) {
    try {
      await download.saveAs(targetPath);

      this.logger.info("download saved", { path: targetPath });

      return targetPath;
    } catch (error) {
      throw new Error(`saving download to ${targetPath}: ${error.message}`);
    }
  }

  async waitForSelector(selector, options = {}) {
    try {
      const element = await this.page.waitForSelector(selector, {
        timeout: options.timeout || this.config.get("timeout.element"),
        state: options.state || "visible"
      });

      return element;
    } catch (error) {
      throw new Error(`waiting for selector "${selector}": ${error.message}`);
    }
  }

  async fillInput(selector, value, options = {}) {
    try {
      await this.waitForSelector(selector, options);
      await this.page.fill(selector, value);
      this.logger.info("input filled", { selector });
    } catch (error) {
      throw new Error(`filling input "${selector}": ${error.message}`);
    }
  }

  async clickButton(selector, options = {}) {
    try {
      await this.waitForSelector(selector, options);
      await this.page.click(selector);
      this.logger.info("button clicked", { selector });
    } catch (error) {
      throw new Error(`clicking button "${selector}": ${error.message}`);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async captureScreenshot(prefix, metadata = {}) {
    if (!this.page) {
      this.logger.warn("cannot capture screenshot: no active page");
      return null;
    }

    return await this.screenshots.capture(this.page, prefix, metadata);
  }

  async captureOnError(passenger, step) {
    if (!this.page) return null;
    return await this.screenshots.captureOnError(this.page, passenger, step);
  }

  async captureOnSuccess(passenger) {
    if (!this.page) return null;
    return await this.screenshots.captureOnSuccess(this.page, passenger);
  }

  async captureBoardingPass(passenger) {
    if (!this.page) return null;
    return await this.screenshots.captureBoardingPass(this.page, passenger);
  }

  async checkForErrors() {
    try {
      const errorSelectors = [
        ".error-message",
        ".alert-danger",
        "[role='alert']",
        ".error",
        ".mensaje-error"
      ];

      for (const selector of errorSelectors) {
        const errorElement = await this.page.$(selector);
        if (errorElement) {
          const errorText = await errorElement.textContent();
          return { hasError: true, message: errorText.trim() };
        }
      }

      return { hasError: false, message: null };
    } catch (error) {
      return { hasError: false, message: null };
    }
  }

  getPage() {
    return this.page;
  }

  async close() {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
        this.logger.info("page closed");
      }

      if (this.context) {
        await this.context.close();
        this.context = null;
        this.logger.info("context closed");
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.logger.info("browser closed");
      }
    } catch (error) {
      this.logger.error("closing browser", { error: error.message });
    }
  }
}

module.exports = BrowserManager;

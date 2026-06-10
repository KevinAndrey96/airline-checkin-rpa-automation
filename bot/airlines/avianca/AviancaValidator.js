const { createErrorFromCode } = require("../../errors");

class AviancaValidator {
  constructor(browser, logger, config) {
    this.browser = browser;
    this.logger = logger;
    this.config = config;
  }

  async checkForAviancaErrors() {
    const page = this.browser.getPage();
    
    await this.browser.delay(2000);

    const errorSelectors = [
      ".help-text.error-none:not(.error-none)",
      ".error-message",
      ".alert-danger",
      "[role='alert']",
      ".form-error",
      ".invalid-feedback:not([style*='display: none'])"
    ];

    for (const selector of errorSelectors) {
      try {
        const errorElement = await page.$(selector);
        if (errorElement) {
          const isVisible = await errorElement.isVisible();
          if (isVisible) {
            const errorText = await errorElement.textContent();
            const errorMessage = errorText.trim();
            
            this.logger.debug("error detected on Avianca page", {
              selector,
              message: errorMessage
            });

            if (
              errorMessage.includes("no encontr") ||
              errorMessage.includes("no exist") ||
              errorMessage.includes("not found") ||
              errorMessage.includes("inválido") ||
              errorMessage.includes("código de reserva válido") ||
              errorMessage.includes("apellido válido")
            ) {
              throw createErrorFromCode("ERR_RESERVATION_NOT_FOUND", this.config, errorMessage);
            }

            if (errorMessage.includes("cerrado") || errorMessage.includes("closed")) {
              throw createErrorFromCode("ERR_CHECKIN_CLOSED", this.config, errorMessage);
            }

            if (errorMessage.includes("realizado") || errorMessage.includes("already")) {
              throw createErrorFromCode("ERR_ALREADY_CHECKED_IN", this.config, errorMessage);
            }

            throw createErrorFromCode("ERR_UNKNOWN", this.config, errorMessage);
          }
        }
      } catch (error) {
        if (error.code) {
          throw error;
        }
      }
    }
  }
}

module.exports = AviancaValidator;

const { createErrorFromCode } = require("../errors");

class BaseAirline {
  constructor(config, logger, browser) {
    this.config = config;
    this.logger = logger;
    this.browser = browser;
    this.airlineCode = "";
    this.airlineConfig = null;
  }

  init(airlineCode) {
    this.airlineCode = airlineCode;
    this.airlineConfig = this.config.getAirline(airlineCode);

    if (!this.airlineConfig.enabled) {
      throw createErrorFromCode(
        "ERR_INVALID_DATA",
        this.config,
        `airline ${airlineCode} is not enabled`
      );
    }

    this.logger.info("airline adapter initialized", {
      airline: this.airlineCode,
      name: this.airlineConfig.name
    });
  }

  async checkIn(passenger) {
    throw new Error("checkIn method must be implemented by airline adapter");
  }

  validate(passenger) {
    const errors = [];

    if (!passenger.reservation_code) {
      errors.push("reservation code is required");
    }

    if (!passenger.last_name) {
      errors.push("last name is required");
    }

    if (this.airlineConfig.features.requiresEmail && !passenger.email) {
      errors.push("email is required");
    }

    if (this.airlineConfig.features.requiresBirthDate && !passenger.birth_date) {
      errors.push("birth date is required");
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  getTimeout() {
    return this.airlineConfig.timeout || this.config.get("timeout.default");
  }

  getCheckInUrl() {
    return this.airlineConfig.checkInUrl;
  }

  getSelector(key) {
    const selector = this.airlineConfig.selectors[key];
    if (!selector) {
      throw createErrorFromCode(
        "ERR_DOM_CHANGED",
        this.config,
        `selector not found: ${key}`
      );
    }
    return selector;
  }

  getDelay(key) {
    return this.airlineConfig.delays[key] || 1000;
  }

  async navigateToCheckIn() {
    try {
      const url = this.getCheckInUrl();
      this.logger.info("navigating to check-in page", {
        airline: this.airlineCode,
        url
      });

      await this.browser.navigate(url);
      await this.browser.delay(this.getDelay("afterNavigation"));
    } catch (error) {
      throw createErrorFromCode("ERR_NETWORK", this.config, error.message);
    }
  }

  async fillReservationData(passenger) {
    try {
      this.logger.info("filling reservation data", {
        airline: this.airlineCode,
        reservation: passenger.reservation_code
      });

      const reservationSelector = this.getSelector("reservationInput");
      const lastNameSelector = this.getSelector("lastNameInput");

      await this.browser.fillInput(reservationSelector, passenger.reservation_code);
      await this.browser.fillInput(lastNameSelector, passenger.last_name);

      await this.browser.delay(500);
    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async submitForm() {
    try {
      this.logger.info("submitting form", { airline: this.airlineCode });

      const submitSelector = this.getSelector("submitButton");
      await this.browser.clickButton(submitSelector);
      await this.browser.delay(this.getDelay("afterFormSubmit"));
    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async checkForPageErrors() {
    const errorCheck = await this.browser.checkForErrors();

    if (errorCheck.hasError) {
      const errorMessage = errorCheck.message.toLowerCase();

      if (
        errorMessage.includes("no encontrada") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("inválida")
      ) {
        throw createErrorFromCode("ERR_RESERVATION_NOT_FOUND", this.config, errorCheck.message);
      }

      if (errorMessage.includes("check-in") && errorMessage.includes("cerrado")) {
        throw createErrorFromCode("ERR_CHECKIN_CLOSED", this.config, errorCheck.message);
      }

      if (errorMessage.includes("realizado") || errorMessage.includes("already")) {
        throw createErrorFromCode("ERR_ALREADY_CHECKED_IN", this.config, errorCheck.message);
      }

      throw createErrorFromCode("ERR_UNKNOWN", this.config, errorCheck.message);
    }
  }

  async waitForDownload(triggerAction) {
    try {
      this.logger.info("waiting for boarding pass download", {
        airline: this.airlineCode
      });

      const download = await this.browser.waitForDownload(triggerAction, this.getTimeout());

      return download;
    } catch (error) {
      throw createErrorFromCode("ERR_DOWNLOAD_FAILED", this.config, error.message);
    }
  }

  getName() {
    return this.airlineConfig.name;
  }

  getCode() {
    return this.airlineCode;
  }

  supportsFeature(feature) {
    return this.airlineConfig.features[feature] === true;
  }

  /**
   * Busca un elemento probando múltiples selectores hasta encontrar uno que funcione
   * @param {string[]} selectors - Array de selectores CSS a probar en orden
   * @param {Object} options - Opciones de búsqueda
   * @param {boolean} options.required - Si es true, lanza error si no encuentra el elemento (default: true)
   * @param {boolean} options.logSelector - Si es true, registra qué selector funcionó (default: false)
   * @param {string} options.errorMessage - Mensaje de error personalizado si no se encuentra
   * @returns {Promise<{element: ElementHandle|null, selectorUsed: string|null}>}
   */
  async findElementBySelectors(selectors, options = {}) {
    const {
      required = true,
      logSelector = false,
      errorMessage = null
    } = options;

    const page = this.browser.getPage();
    let element = null;
    let selectorUsed = null;

    for (const selector of selectors) {
      try {
        element = await page.$(selector);
        if (element) {
          selectorUsed = selector;
          if (logSelector) {
            this.logger.debug("element found with selector", { selector });
          }
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!element && required) {
      const message = errorMessage || `element not found with any selector: ${selectors.join(', ')}`;
      throw new Error(message);
    }

    return { element, selectorUsed };
  }

  /**
   * Busca un elemento clickable probando múltiples selectores con waitForSelector
   * @param {string[]} selectors - Array de selectores CSS a probar en orden
   * @param {Object} options - Opciones de búsqueda
   * @param {number} options.timeout - Timeout para waitForSelector (default: 5000)
   * @param {string} options.state - Estado esperado: 'visible', 'hidden', 'attached' (default: 'visible')
   * @param {boolean} options.required - Si es true, lanza error si no encuentra (default: true)
   * @param {boolean} options.logSelector - Si es true, registra qué selector funcionó (default: false)
   * @param {string} options.errorMessage - Mensaje de error personalizado
   * @returns {Promise<{element: ElementHandle|null, selectorUsed: string|null}>}
   */
  async findClickableElementBySelectors(selectors, options = {}) {
    const {
      timeout = 5000,
      state = 'visible',
      required = true,
      logSelector = false,
      errorMessage = null
    } = options;

    const page = this.browser.getPage();
    let element = null;
    let selectorUsed = null;

    for (const selector of selectors) {
      try {
        element = await page.waitForSelector(selector, {
          timeout,
          state
        });

        if (element) {
          selectorUsed = selector;
          if (logSelector) {
            this.logger.debug("clickable element found with selector", { selector });
          }
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!element && required) {
      const message = errorMessage || `clickable element not found with any selector: ${selectors.join(', ')}`;
      throw new Error(message);
    }

    return { element, selectorUsed };
  }
}

module.exports = BaseAirline;

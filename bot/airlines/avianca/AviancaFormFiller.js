const { createErrorFromCode } = require("../../errors");

class AviancaFormFiller {
  constructor(browser, logger, config) {
    this.browser = browser;
    this.logger = logger;
    this.config = config;
  }

  async fillContactInfo(passenger) {
    try {
      this.logger.debug("filling passenger contact information", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: 30000
      });

      await this.browser.delay(100);

      const emailSelectors = [
        "input[type='email']",
        "input[formcontrolname='email']",
        "input[name='email']"
      ];
      
      const phoneSelectors = [
        "input.phone-number-input",
        "input[type='text'].phone-number-input",
        "input[placeholder*='teléfono']",
        "input[placeholder='Número de teléfono']",
        "input[type='tel']",
        "input[formcontrolname='phone']",
        "input[formcontrolname='phoneNumber']",
        "input[name='phone']"
      ];

      // Encontrar y llenar el campo de email usando helper
      const { element: emailInput, selectorUsed: emailSelectorUsed } = await this.findElementBySelectors(
        emailSelectors,
        {
          errorMessage: "email field not found with any selector",
          logSelector: true
        }
      );

      const currentEmailValue = await emailInput.inputValue();
      if (!currentEmailValue || currentEmailValue.trim() === "") {
        await emailInput.click();
        await this.browser.delay(100);
        await emailInput.fill(passenger.email);
        await this.browser.delay(200);
        this.logger.debug("email filled from CSV", { email: passenger.email, selector: emailSelectorUsed });
      } else {
        this.logger.debug("email already has a value, keeping it", { email: currentEmailValue });
      }

      // Encontrar y llenar el campo de teléfono usando helper
      const { element: phoneInput, selectorUsed: phoneSelectorUsed } = await this.findElementBySelectors(
        phoneSelectors,
        {
          errorMessage: "phone field not found with any selector",
          logSelector: true
        }
      );

      const currentPhoneValue = await phoneInput.inputValue();
      if (!currentPhoneValue || currentPhoneValue.trim() === "") {
        await phoneInput.click();
        await this.browser.delay(100);
        await phoneInput.fill(passenger.phone);
        await this.browser.delay(200);
        this.logger.debug("phone filled from CSV", { phone: passenger.phone, selector: phoneSelectorUsed });
      } else {
        this.logger.debug("phone already has a value, keeping it", { phone: currentPhoneValue });
      }

      // Hacer click fuera para activar validación
      await page.click("body");
      await this.browser.delay(500);

      // VALIDAR que ambos campos estén realmente llenos
      // Re-verificar los campos usando los selectores que funcionaron
      let emailInputForValidation = emailInput;
      let phoneInputForValidation = phoneInput;
      
      // Si los elementos se perdieron, buscarlos nuevamente usando el helper
      if (!emailInputForValidation) {
        const result = await this.findElementBySelectors(
          emailSelectorUsed ? [emailSelectorUsed] : emailSelectors,
          { required: false }
        );
        emailInputForValidation = result.element;
      }
      
      if (!phoneInputForValidation) {
        const result = await this.findElementBySelectors(
          phoneSelectorUsed ? [phoneSelectorUsed] : phoneSelectors,
          { required: false }
        );
        phoneInputForValidation = result.element;
      }
      
      if (!emailInputForValidation || !phoneInputForValidation) {
        throw new Error("could not find email or phone input fields for validation");
      }

      const finalEmailValue = await emailInputForValidation.inputValue();
      const finalPhoneValue = await phoneInputForValidation.inputValue();

      if (!finalEmailValue || finalEmailValue.trim() === "") {
        throw new Error("email field is empty after filling attempt");
      }

      if (!finalPhoneValue || finalPhoneValue.trim() === "") {
        throw new Error("phone field is empty after filling attempt");
      }

      // Verificar si hay mensajes de error de validación visibles (solo errores reales, no labels)
      const validationErrors = await page.evaluate(() => {
        const errorMessages = [];
        
        // Buscar solo elementos .mat-error que sean visibles y contengan mensajes de error específicos
        const errorElements = document.querySelectorAll('.mat-error');
        errorElements.forEach(el => {
          // Verificar que el elemento sea visible
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return;
          }
          
          const text = el.textContent?.trim();
          // Solo capturar mensajes de error específicos, no labels normales
          if (text) {
            const errorPatterns = [
              /Por favor proporcione un número de teléfono/i,
              /proporcione un número de teléfono/i,
              /correo electrónico.*requerido/i,
              /email.*required/i,
              /phone.*required/i,
              /campo.*requerido/i,
              /field.*required/i
            ];
            
            const isError = errorPatterns.some(pattern => pattern.test(text));
            if (isError && text.length < 200) { // Evitar capturar textos muy largos (que serían toda la página)
              errorMessages.push(text);
            }
          }
        });

        // También buscar mensajes de error específicos en el texto de la página
        const pageText = document.body.textContent || '';
        if (pageText.includes('Por favor proporcione un número de teléfono')) {
          // Verificar que realmente existe un elemento de error visible
          const hasVisibleError = Array.from(document.querySelectorAll('.mat-error')).some(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   el.textContent?.includes('teléfono');
          });
          if (hasVisibleError) {
            errorMessages.push('Por favor proporcione un número de teléfono');
          }
        }

        return errorMessages;
      });

      if (validationErrors.length > 0) {
        throw new Error(`validation errors detected: ${validationErrors.join(', ')}`);
      }

      this.logger.info("passenger contact info validated successfully", {
        airline: "avianca",
        email: finalEmailValue.substring(0, 20) + '...',
        phone: finalPhoneValue.substring(0, 10) + '...'
      });

    } catch (error) {
      this.logger.error("error filling or validating passenger contact info", {
        airline: "avianca",
        error: error.message
      });
      throw error;
    }
  }

  // Helper method para encontrar elementos (similar a BaseAirline pero sin herencia)
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
}

module.exports = AviancaFormFiller;

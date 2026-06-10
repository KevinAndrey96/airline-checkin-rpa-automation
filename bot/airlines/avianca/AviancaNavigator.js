const { createErrorFromCode } = require("../../errors");

class AviancaNavigator {
  constructor(browser, logger, config) {
    this.browser = browser;
    this.logger = logger;
    this.config = config;
  }

  async clickContinueButton() {
    try {
      this.logger.debug("clicking continue button after contact info", {
        airline: "avianca"
      });

      const page = this.browser.getPage();

      // Esperar a que la página esté lista
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.browser.delay(1000);

      // Guardar URL y estado inicial para comparar después
      const initialUrl = page.url();
      const initialPageState = await page.evaluate(() => {
        // Buscar botón "Continuar" usando JavaScript puro (no selectores de Playwright)
        const buttons = Array.from(document.querySelectorAll('button'));
        const continueButton = buttons.find(btn => {
          const text = btn.textContent?.trim() || '';
          return text === 'Continuar' || text === 'Continue';
        });
        
        return {
          hasContactForm: document.querySelector('input[type="email"]') !== null || 
                         document.querySelector('input[type="tel"]') !== null ||
                         document.querySelector('input.phone-number-input') !== null,
          hasContinueButton: continueButton !== undefined,
          pageText: document.body.textContent || ''
        };
      });

      const continueSelectors = [
        "button#continue",
        "#continue",
        "button:has-text('Continuar')",
        "button:has-text('Continue')",
        "button.continue-button",
        "button[type='submit']:has-text('Continuar')",
        ".btn-primary:has-text('Continuar')",
        "button[class*='continue']",
        "button[class*='submit']"
      ];

      // Buscar el botón usando el helper
      const { element: button, selectorUsed: buttonSelector } = await this.findClickableElementBySelectors(
        continueSelectors,
        {
          timeout: 5000,
          state: "visible",
          errorMessage: "continue button not found",
          logSelector: true
        }
      );

      // Hacer scroll y click
      await button.scrollIntoViewIfNeeded();
      await this.browser.delay(500);
      await button.click();
      this.logger.debug("continue button clicked", { selector: buttonSelector });

      // Esperar a que la página responda al click
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.browser.delay(2000); // Dar tiempo para que la validación y navegación ocurran

      // VALIDAR que realmente avanzó de página
      const finalUrl = page.url();
      const finalPageState = await page.evaluate(() => {
        // Verificar si todavía estamos en la página de contacto
        const stillHasContactForm = document.querySelector('input[type="email"]') !== null || 
                                   document.querySelector('input[type="tel"]') !== null ||
                                   document.querySelector('input.phone-number-input') !== null;
        
        // Verificar si hay mensajes de error de validación VISIBLES
        let hasValidationErrors = false;
        const errorElements = document.querySelectorAll('.mat-error');
        for (const el of errorElements) {
          const style = window.getComputedStyle(el);
          const isVisible = style.display !== 'none' && 
                          style.visibility !== 'hidden' && 
                          style.opacity !== '0';
          if (isVisible) {
            const text = el.textContent?.trim() || '';
            if (text.includes('Por favor proporcione un número de teléfono') ||
                text.includes('proporcione un número de teléfono') ||
                text.includes('correo electrónico') && text.includes('requerido')) {
              hasValidationErrors = true;
              break;
            }
          }
        }

        // Verificar si estamos en la siguiente página (equipaje seguro)
        const hasBaggagePage = document.body.textContent.includes('Equipaje seguro') ||
                              document.body.textContent.includes('Aceptar y continuar') ||
                              document.body.textContent.includes('equipaje');

        return {
          stillHasContactForm,
          hasValidationErrors,
          hasBaggagePage,
          pageText: document.body.textContent || ''
        };
      });

      // Verificar si hubo errores de validación
      if (finalPageState.hasValidationErrors) {
        throw new Error("validation errors detected after clicking continue - page did not advance");
      }

      // Verificar si todavía estamos en la misma página de contacto
      if (finalPageState.stillHasContactForm && !finalPageState.hasBaggagePage) {
        // Verificar si la URL cambió
        if (finalUrl === initialUrl) {
          throw new Error("page did not advance after clicking continue - still on contact info page");
        }
      }

      // Si llegamos aquí, la validación pasó
      this.logger.info("successfully advanced to next section after clicking continue", {
        airline: "avianca",
        urlChanged: finalUrl !== initialUrl,
        hasBaggagePage: finalPageState.hasBaggagePage
      });

    } catch (error) {
      this.logger.error("error clicking continue or validating page advance", {
        airline: "avianca",
        error: error.message
      });
      throw error;
    }
  }

  async acceptBaggagePolicies() {
    try {
      this.logger.debug("accepting baggage policies", {
        airline: "avianca"
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: 10000
      }).catch(() => {});

      await this.browser.delay(1000);

      const acceptSelectors = [
        "button:has-text('Aceptar y continuar')",
        "button:has-text('Aceptar')",
        "button:has-text('Accept and continue')",
        "button:has-text('Accept')",
        "button[class*='accept']",
        ".accept-button",
        "button[type='submit']:has-text('Aceptar')"
      ];

      // Buscar el botón usando el helper
      const { element: button, selectorUsed } = await this.findClickableElementBySelectors(
        acceptSelectors,
        {
          timeout: 5000,
          state: "visible",
          required: false, // No lanzar error si no se encuentra
          logSelector: true
        }
      );

      if (button) {
        await button.scrollIntoViewIfNeeded();
        await this.browser.delay(500);
        await button.click();
        this.logger.debug("baggage policies accepted", { selector: selectorUsed });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await this.browser.delay(1000);
      } else {
        this.logger.warn("continue button not found on baggage policies page, proceeding anyway");
        // No lanzar error, continuar de todas formas
      }

    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async clickFlightCheckInButton(passenger) {
    try {
      this.logger.debug("checking flight check-in status and clicking appropriate button", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: 30000
      });

      await this.browser.delay(500);

      // Primero verificar si el check-in ya está realizado
      const checkInCompleted = await page.evaluate(() => {
        const pageText = document.body.textContent || '';
        return pageText.includes('Check-in realizado') || pageText.includes('Check-in completado');
      });

      if (checkInCompleted) {
        this.logger.debug("check-in already completed, looking for 'Ver pasabordos' button");
        
        // Buscar el botón "Ver pasabordos"
        const boardingPassButtonSelectors = [
          "button:has-text('Ver pasabordos')",
          "button:has-text('Ver pase de abordar')",
          "button:has-text('View boarding passes')",
          "a:has-text('Ver pasabordos')",
          "a:has-text('Ver pase de abordar')"
        ];

        const { element: button, selectorUsed } = await this.findClickableElementBySelectors(
          boardingPassButtonSelectors,
          {
            timeout: 5000,
            state: "visible",
            required: false,
            logSelector: true
          }
        );

        if (button) {
          await button.click();
          this.logger.debug("boarding passes button clicked", { selector: selectorUsed });
          await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
          await this.browser.delay(1000);

          // Esperar a que la página del pasabordo cargue completamente
          this.logger.info("check-in ya realizado, esperando página del pasabordo...", {
            airline: "avianca",
            reservation: passenger.reservation_code
          });
          
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          await this.browser.delay(3000);
          
          // Verificar que estamos en la página del pasabordo
          const isBoardingPassPage = await page.evaluate(() => {
            const pageText = document.body.textContent || '';
            return pageText.includes('Tu pasabordo') || 
                   pageText.includes('pasabordo') || 
                   pageText.includes('Enviar pasabordos') ||
                   (pageText.includes('GYE') && pageText.includes('BOG')) ||
                   document.querySelector('button.back') !== null;
          });
          
          if (isBoardingPassPage) {
            this.logger.info("página del pasabordo detectada, capturando pantallazo...", {
              airline: "avianca",
              reservation: passenger.reservation_code
            });
            
            // Capturar el pantallazo usando el browser manager
            let boardingPassPath = null;
            try {
              boardingPassPath = await this.browser.captureBoardingPass(passenger);
              
              if (!boardingPassPath) {
                this.logger.warn("primera captura retornó null, reintentando...", {
                  airline: "avianca",
                  reservation: passenger.reservation_code
                });
                await this.browser.delay(2000);
                boardingPassPath = await this.browser.captureBoardingPass(passenger);
              }
            } catch (captureError) {
              this.logger.warn("error al capturar pasabordo, reintentando...", {
                airline: "avianca",
                reservation: passenger.reservation_code,
                error: captureError.message
              });
              await this.browser.delay(2000);
              try {
                boardingPassPath = await this.browser.captureBoardingPass(passenger);
              } catch (retryError) {
                this.logger.error("error al capturar pasabordo en segundo intento", {
                  airline: "avianca",
                  reservation: passenger.reservation_code,
                  error: retryError.message
                });
              }
            }
            
            if (boardingPassPath) {
              this.logger.info("✓ Pasabordo capturado exitosamente", {
                airline: "avianca",
                reservation: passenger.reservation_code,
                path: boardingPassPath
              });
              
              // Hacer clic en "Volver"
              await this.clickBackButton(page, passenger);
              
              return {
                alreadyCompleted: true,
                boardingPassCaptured: true,
                boardingPassPath: boardingPassPath
              };
            } else {
              this.logger.warn("no se pudo capturar el pasabordo, pero el check-in está completo", {
                airline: "avianca",
                reservation: passenger.reservation_code
              });
              
              await this.clickBackButton(page, passenger);
              
              return {
                alreadyCompleted: true,
                boardingPassCaptured: false
              };
            }
          } else {
            this.logger.warn("check-in completado pero no se detectó página del pasabordo", {
              airline: "avianca",
              reservation: passenger.reservation_code
            });
          }
        } else {
          this.logger.warn("check-in completed but could not find boarding passes button, continuing anyway");
          return null;
        }
      }

      // Si no está completado, buscar el botón "Empezar check-in"
      this.logger.debug("check-in not completed, looking for 'Empezar check-in' button");
      
      const buttonSelectors = [
        "button:has-text('Empezar check-in')",
        "button:has-text('Comenzar check-in')",
        "button:has-text('Iniciar check-in')",
        ".checkin-button",
        "button[class*='check-in']",
        "a:has-text('Empezar check-in')"
      ];

      const { element: startButton } = await this.findClickableElementBySelectors(
        buttonSelectors,
        {
          timeout: 5000,
          state: "visible",
          errorMessage: "could not find 'Empezar check-in' or 'Ver pasabordos' button in pending trips list"
        }
      );

      await startButton.click();
      this.logger.debug("flight check-in button clicked");
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.browser.delay(1000);

      return null;
    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async clickBackButton(page, passenger) {
    try {
      this.logger.debug("clicking back button", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const backButtonSelectors = [
        "button.back",
        ".footer-wrapper button.back",
        "button.mat-stroked-button.back",
        "button:has-text('Volver')",
        "button:has-text('Back')",
        "a:has-text('Volver')"
      ];

      const { element: backButton, selectorUsed } = await this.findClickableElementBySelectors(
        backButtonSelectors,
        {
          timeout: 5000,
          state: "visible",
          required: false,
          logSelector: true
        }
      );

      if (backButton) {
        await backButton.scrollIntoViewIfNeeded();
        await this.browser.delay(500);
        await backButton.click();
        this.logger.info("✓ Botón 'Volver' clickeado exitosamente", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          selector: selectorUsed
        });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await this.browser.delay(1000);
      } else {
        this.logger.warn("back button not found, may already be on main page");
      }
    } catch (error) {
      this.logger.warn("error clicking back button", { error: error.message });
      // No lanzar error, puede que ya estemos en la página principal
    }
  }

  // Helper method para encontrar elementos clickables
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

module.exports = AviancaNavigator;

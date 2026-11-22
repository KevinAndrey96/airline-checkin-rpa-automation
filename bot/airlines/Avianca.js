const BaseAirline = require("./BaseAirline");
const { createErrorFromCode } = require("../errors");
const AviancaFormFiller = require("./avianca/AviancaFormFiller");
const AviancaNavigator = require("./avianca/AviancaNavigator");
const AviancaValidator = require("./avianca/AviancaValidator");
const AviancaAccordionHandler = require("./avianca/AviancaAccordionHandler");

class Avianca extends BaseAirline {
  constructor(config, logger, browser) {
    super(config, logger, browser);
    // Inicializar módulos especializados
    this.formFiller = new AviancaFormFiller(browser, logger, config);
    this.navigator = new AviancaNavigator(browser, logger, config);
    this.validator = new AviancaValidator(browser, logger, config);
    this.accordionHandler = new AviancaAccordionHandler(browser, logger, config);
  }

  async checkIn(passenger) {
    let lastStep = "initialization";
    let lastFieldFilled = "none";
    let currentWindow = "INICIO";
    
    try {
      this.logger.debug("starting Avianca check-in", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        passenger: `${passenger.last_name} ${passenger.first_name}`
      });

      currentWindow = "VENTANA 1: Formulario inicial (código reserva + apellido)";
      lastStep = "validation";
      const validation = this.validate(passenger);
      if (!validation.valid) {
        throw createErrorFromCode(
          "ERR_INVALID_DATA",
          this.config,
          validation.errors.join(", ")
        );
      }

      lastStep = "navigation";
      await this.navigateToCheckIn();

      lastStep = "filling_reservation_code";
      lastFieldFilled = "reservation_code";
      await this.fillReservationData(passenger);
      lastFieldFilled = "last_name";

      lastStep = "submitting_form";
      await this.submitForm();

      // ============================================================
      // SECCIÓN 1 COMPLETADA: Llenado de formulario inicial
      // ============================================================
      
      lastStep = "checking_errors";
      await this.validator.checkForAviancaErrors();

      this.logger.info("Avianca section 1 completed: form filled and submitted", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep,
        lastFieldFilled
      });

      // ============================================================
      // SECCIÓN 2: Click en el botón "Empezar check-in" de la lista de vuelos
      // ============================================================
      
      currentWindow = "VENTANA 2: Lista de viajes pendientes";
      lastStep = "clicking_flight_checkin_button";
      const flightCheckInResult = await this.navigator.clickFlightCheckInButton(passenger);

      // Si el check-in ya estaba completado y se capturó el pasabordo, terminar exitosamente
      if (flightCheckInResult && flightCheckInResult.alreadyCompleted) {
        if (flightCheckInResult.boardingPassCaptured && flightCheckInResult.boardingPassPath) {
          this.logger.info("✓ Check-in ya estaba completado - pasabordo capturado exitosamente", {
            airline: "avianca",
            reservation: passenger.reservation_code,
            boardingPassPath: flightCheckInResult.boardingPassPath
          });
          
          return {
            success: true,
            boardingPassCaptured: true,
            boardingPassPath: flightCheckInResult.boardingPassPath,
            message: "check-in-already-completed-boarding-pass-captured"
          };
        } else {
          this.logger.info("✓ Check-in ya estaba completado - proceso finalizado", {
            airline: "avianca",
            reservation: passenger.reservation_code
          });
          
          return {
            success: true,
            boardingPassCaptured: false,
            message: "check-in-already-completed"
          };
        }
      }

      this.logger.info("Avianca section 2 completed: clicked on flight check-in button", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep,
        lastFieldFilled
      });

      // ============================================================
      // SECCIÓN 3: Llenar correo electrónico y teléfono
      // ============================================================
      
      currentWindow = "VENTANA 3: Selección de pasajeros (correo + teléfono)";
      lastStep = "filling_passenger_contact_info";
      await this.formFiller.fillContactInfo(passenger);

      this.logger.info("Avianca section 3 completed: passenger contact info filled", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep,
        lastFieldFilled
      });

      // ============================================================
      // SECCIÓN 4: Click en "Continuar" (después de llenar correo/teléfono)
      // ============================================================
      
      currentWindow = "VENTANA 3: Selección de pasajeros - Click continuar";
      lastStep = "clicking_continue_after_contact_info";
      await this.navigator.clickContinueButton();

      this.logger.info("Avianca section 4 completed: clicked continue after contact info", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep
      });

      // ============================================================
      // SECCIÓN 5: Aceptar políticas de equipaje
      // ============================================================
      
      currentWindow = "VENTANA 4: Equipaje seguro - Políticas";
      lastStep = "accepting_baggage_policies";
      await this.navigator.acceptBaggagePolicies();

      this.logger.info("Avianca section 5 completed: accepted baggage policies", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep
      });

      // ============================================================
      // SECCIÓN 6: Llenar datos personales del acordeón
      // ============================================================
      
      currentWindow = "VENTANA 5: Datos personales (género, país residencia, propósito, fecha nacimiento)";
      lastStep = "filling_personal_data_accordion";
      await this.accordionHandler.fillPersonalDataAccordion(passenger);

      this.logger.info("Avianca section 6 completed: personal data accordion filled", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep
      });

      // ============================================================
      // SECCIÓN 7: Llenar documento de viaje del acordeón
      // ============================================================
      
      currentWindow = "VENTANA 6: Documento de viaje (tipo, número, país, fecha caducidad)";
      lastStep = "filling_travel_document_accordion";
      await this.accordionHandler.fillTravelDocumentAccordion(passenger);

      this.logger.info("Avianca section 7 completed: travel document accordion filled", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep
      });

      // ============================================================
      // SECCIÓN 8: Llenar contacto de emergencia del acordeón
      // ============================================================
      
      currentWindow = "VENTANA 7: Contacto de emergencia (nombre, teléfono, país)";
      lastStep = "filling_emergency_contact_accordion";
      await this.accordionHandler.fillEmergencyContactAccordion(passenger);

      this.logger.info("Avianca section 8 completed: emergency contact accordion filled", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        lastStep
      });

      // ============================================================
      // SECCIÓN 9: Cerrar modal de selección de asientos (si aparece)
      // ============================================================
      
      currentWindow = "VENTANA 8: Selección de asientos";
      lastStep = "closing_seat_selection_modal";
      
      try {
        const page = this.browser.getPage();
        await this.browser.delay(2000);
        
        // Buscar y cerrar el modal de selección de asientos
        const modalCloseSelectors = [
          "button[aria-label*='cerrar']",
          "button[aria-label*='close']",
          "button.close",
          ".modal button.close",
          "[role='dialog'] button[aria-label*='cerrar']",
          "[role='dialog'] button[aria-label*='close']",
          "button:has-text('×')",
          "button:has-text('X')",
          ".close-button",
          "[class*='close'][class*='button']"
        ];
        
        // Buscar el modal primero
        const modal = await page.$("[role='dialog'], .modal, [class*='modal'], [class*='dialog']").catch(() => null);
        
        if (modal) {
          // Buscar el botón de cerrar dentro del modal
          for (const selector of modalCloseSelectors) {
            try {
              const closeButton = await modal.$(selector).catch(() => null);
              if (closeButton) {
                const isVisible = await closeButton.isVisible().catch(() => false);
                if (isVisible) {
                  await closeButton.click();
                  this.logger.info("seat selection modal closed", {
                    airline: "avianca",
                    reservation: passenger.reservation_code,
                    selector: selector
                  });
                  await this.browser.delay(1000);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
          
          // Si no encontramos el botón dentro del modal, buscar en toda la página
          for (const selector of modalCloseSelectors) {
            try {
              const closeButton = await page.$(selector).catch(() => null);
              if (closeButton) {
                const isVisible = await closeButton.isVisible().catch(() => false);
                if (isVisible) {
                  await closeButton.click();
                  this.logger.info("seat selection modal closed (found in page)", {
                    airline: "avianca",
                    reservation: passenger.reservation_code,
                    selector: selector
                  });
                  await this.browser.delay(1000);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }
        }
      } catch (error) {
        this.logger.warn("could not close seat selection modal, continuing", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          error: error.message
        });
      }

      // ============================================================
      // CAPTURA DEL PASABORDO - PROCESO COMPLETADO CON ÉXITO
      // ============================================================
      
      try {
        const page = this.browser.getPage();
        
        // Esperar un poco para asegurar que la página esté cargada
        await this.browser.delay(2000);
        
        // Verificar si estamos en la página del pasabordo
        const detectionResult = await page.evaluate(() => {
          const pageText = document.body.textContent || '';
          const hasBoardingPassText = pageText.includes('Tu pasabordo') || 
                                      pageText.includes('pasabordo') || 
                                      pageText.includes('boarding pass') ||
                                      pageText.includes('Enviar pasabordos') ||
                                      pageText.includes('AV8394') ||
                                      pageText.includes('GYE') && pageText.includes('BOG');
          const hasBackButton = document.querySelector('button.back') !== null ||
                               document.querySelector('.footer-wrapper button.back') !== null ||
                               document.querySelector('button.mat-stroked-button.back') !== null;
          const hasBoardingPassElements = document.querySelector('[class*="boarding"]') !== null;
          
          return {
            isBoardingPassPage: hasBoardingPassText || hasBackButton || hasBoardingPassElements,
            hasBoardingPassText,
            hasBackButton,
            hasBoardingPassElements,
            pageUrl: window.location.href
          };
        });

        this.logger.info("boarding pass page detection result", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          ...detectionResult
        });

        const isBoardingPassPage = detectionResult.isBoardingPassPage;

        if (isBoardingPassPage || detectionResult.hasBackButton) {
          this.logger.info("✓ Check-in completado exitosamente - detectada página del pasabordo", {
            airline: "avianca",
            reservation: passenger.reservation_code,
            reason: detectionResult.hasBackButton ? "botón Volver detectado" : "texto del pasabordo detectado"
          });
          
          await this.browser.delay(3000); // Esperar a que la página cargue completamente
          
          // Intentar capturar el pasabordo
          let boardingPassPath = null;
          try {
            this.logger.info("intentando capturar pasabordo...", {
              airline: "avianca",
              reservation: passenger.reservation_code
            });
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
            // Reintentar después de un delay
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
            this.logger.info("✓ Pasabordo capturado y guardado exitosamente", {
              airline: "avianca",
              reservation: passenger.reservation_code,
              path: boardingPassPath
            });
            
            // Hacer clic en "Volver" para completar el proceso
            await this.navigator.clickBackButton(page, passenger);
            
            // Proceso completado exitosamente - retornar indicando éxito con pasabordo
            return {
              success: true,
              boardingPassCaptured: true,
              boardingPassPath: boardingPassPath,
              message: "check-in-completed-with-boarding-pass"
            };
          } else {
            this.logger.warn("página del pasabordo detectada pero no se pudo capturar, intentando captura de respaldo", {
              airline: "avianca",
              reservation: passenger.reservation_code
            });
            
            // Intentar captura de respaldo
            await this.browser.delay(2000);
            try {
              boardingPassPath = await this.browser.captureBoardingPass(passenger);
              if (boardingPassPath) {
                this.logger.info("✓ Pasabordo capturado exitosamente (captura de respaldo)", {
                  airline: "avianca",
                  reservation: passenger.reservation_code,
                  path: boardingPassPath
                });
                
                // Hacer clic en "Volver" después de la captura de respaldo
                await this.navigator.clickBackButton(page, passenger);
                
                return {
                  success: true,
                  boardingPassCaptured: true,
                  boardingPassPath: boardingPassPath,
                  message: "check-in-completed-with-boarding-pass-backup"
                };
              }
            } catch (backupError) {
              this.logger.warn("captura de respaldo también falló", {
                airline: "avianca",
                reservation: passenger.reservation_code,
                error: backupError.message
              });
            }
            
            // Aún así, consideramos éxito porque llegamos al pasabordo
            await this.navigator.clickBackButton(page, passenger);
            
            return {
              success: true,
              boardingPassCaptured: false,
              message: "check-in-completed-boarding-pass-page-detected"
            };
          }
        } else {
          this.logger.debug("boarding pass page not detected, check-in may still be in progress", {
            airline: "avianca",
            reservation: passenger.reservation_code
          });
        }
      } catch (error) {
        this.logger.warn("could not capture boarding pass screenshot", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          error: error.message
        });
      }

      // ============================================================
      // VERIFICACIÓN FINAL: Captura de respaldo del pasabordo
      // ============================================================

      // Captura de respaldo: verificar una vez más si estamos en la página del pasabordo
      try {
        const page = this.browser.getPage();
        const finalDetection = await page.evaluate(() => {
          const pageText = document.body.textContent || '';
          const hasBoardingPassText = pageText.includes('Tu pasabordo') || 
                                      pageText.includes('pasabordo') || 
                                      pageText.includes('Enviar pasabordos') ||
                                      (pageText.includes('GYE') && pageText.includes('BOG'));
          const hasBackButton = document.querySelector('button.back') !== null ||
                               document.querySelector('.footer-wrapper button.back') !== null ||
                               document.querySelector('button.mat-stroked-button.back') !== null;
          
          return {
            isBoardingPassPage: hasBoardingPassText || hasBackButton,
            hasBoardingPassText,
            hasBackButton,
            pageUrl: window.location.href
          };
        });

        this.logger.info("verificación final de página del pasabordo", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          ...finalDetection
        });

        if (finalDetection.isBoardingPassPage || finalDetection.hasBackButton) {
          this.logger.info("detectada página del pasabordo al final del proceso, capturando...", {
            airline: "avianca",
            reservation: passenger.reservation_code,
            reason: finalDetection.hasBackButton ? "botón Volver detectado" : "texto del pasabordo detectado"
          });
          
          await this.browser.delay(2000);
          
          let boardingPassPath = null;
          try {
            boardingPassPath = await this.browser.captureBoardingPass(passenger);
            if (!boardingPassPath) {
              this.logger.warn("captura final retornó null, reintentando...", {
                airline: "avianca",
                reservation: passenger.reservation_code
              });
              await this.browser.delay(2000);
              boardingPassPath = await this.browser.captureBoardingPass(passenger);
            }
          } catch (finalCaptureError) {
            this.logger.error("error en captura final", {
              airline: "avianca",
              reservation: passenger.reservation_code,
              error: finalCaptureError.message
            });
          }
          
          if (boardingPassPath) {
            this.logger.info("✓ Pasabordo capturado exitosamente (captura final)", {
              airline: "avianca",
              reservation: passenger.reservation_code,
              path: boardingPassPath
            });
            
            // Hacer clic en "Volver"
            await this.navigator.clickBackButton(page, passenger);
            
            return {
              success: true,
              boardingPassCaptured: true,
              boardingPassPath: boardingPassPath,
              message: "check-in-completed-with-boarding-pass-final"
            };
          } else {
            this.logger.warn("no se pudo capturar el pasabordo en la verificación final", {
              airline: "avianca",
              reservation: passenger.reservation_code
            });
          }
        }
      } catch (finalCaptureError) {
        this.logger.warn("captura final no ejecutada o falló", {
          airline: "avianca",
          reservation: passenger.reservation_code,
          error: finalCaptureError.message
        });
      }

      // Si llegamos aquí sin capturar el pasabordo, lanzar error
      // porque el proceso debe terminar con pasabordo capturado
      throw createErrorFromCode(
        "ERR_DOWNLOAD_FAILED",
        this.config,
        "check-in completed but boarding pass was not captured"
      );

    } catch (error) {
      this.logger.error("Avianca check-in failed", {
        airline: "avianca",
        reservation: passenger.reservation_code,
        currentWindow,
        lastStep,
        lastFieldFilled,
        error: error.message,
        code: error.code
      });

      const enrichedError = new Error(error.message);
      enrichedError.code = error.code;
      enrichedError.lastStep = lastStep;
      enrichedError.lastFieldFilled = lastFieldFilled;
      // Formato más claro para el CSV: incluir ventana y paso específico
      enrichedError.context = `${currentWindow} | Paso: ${lastStep}${lastFieldFilled !== 'none' ? ` | Último campo: ${lastFieldFilled}` : ''}`;

      throw enrichedError;
    }
  }

  async fillReservationData(passenger) {
    try {
      this.logger.debug("filling Avianca reservation data with Angular events", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();
      const reservationSelector = "input[formcontrolname='reservationNumber']";
      const lastNameSelector = "input[formcontrolname='lastNames']";

      await page.click(reservationSelector);
      await this.browser.delay(100);
      await page.fill(reservationSelector, "");
      await page.type(reservationSelector, passenger.reservation_code.toUpperCase(), { delay: 100 });
      await this.browser.delay(100);

      await page.click(lastNameSelector);
      await this.browser.delay(100);
      await page.fill(lastNameSelector, "");
      await page.type(lastNameSelector, passenger.last_name.toUpperCase(), { delay: 100 });
      await this.browser.delay(100);

      await page.click("body");

      this.logger.debug("reservation data filled successfully", {
        airline: "avianca"
      });
    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }
}

module.exports = Avianca;

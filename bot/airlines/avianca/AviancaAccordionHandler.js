const { createErrorFromCode } = require("../../errors");

class AviancaAccordionHandler {
  constructor(browser, logger, config) {
    this.browser = browser;
    this.logger = logger;
    this.config = config;
  }

  getTimeout() {
    return this.config.get("timeout.default") || 30000;
  }

  /**
   * Expande un acordeón por su texto de título
   * @param {string} accordionTitle - Texto del título del acordeón (ej: "Datos personales")
   */
  async expandAccordion(accordionTitle) {
    const page = this.browser.getPage();
    
    try {
      this.logger.debug(`expanding accordion: ${accordionTitle}`);
      
      // Buscar el acordeón iterando sobre todos los headers
      let accordionHeader = null;
      const headers = await page.$$('mat-expansion-panel-header');
      
      for (const header of headers) {
        const text = await header.textContent();
        if (text && text.includes(accordionTitle)) {
          accordionHeader = header;
          break;
        }
      }
      
      if (accordionHeader) {
        const isExpanded = await accordionHeader.evaluate(el => {
          return el.getAttribute('aria-expanded') === 'true';
        });
        
        // Siempre expandir si no está expandido
        if (!isExpanded) {
          await accordionHeader.click();
          await this.browser.delay(500);
        } else {
          // Si ya está expandido, solo esperar un poco para asegurar que esté visible
          await this.browser.delay(300);
        }
        return true;
      } else {
        this.logger.warn(`accordion header not found: ${accordionTitle}`);
        return false;
      }
    } catch (error) {
      this.logger.warn(`could not expand accordion: ${accordionTitle}`, { error: error.message });
      return false;
    }
  }

  /**
   * Click en el botón "Guardar y continuar" dentro de un acordeón
   */
  async clickSaveAndContinue() {
    const page = this.browser.getPage();
    
    const saveButtonSelectors = [
      "button.mat-flat-button.submit[type='submit']",
      "button.new-button-document-validation[type='submit']",
      "button.submit[type='submit']:has-text('Guardar y continuar')",
      ".btn-wrapper button.submit[type='submit']",
      "button:has-text('Guardar y continuar')",
      "button[type='submit']"
    ];

    const { element: button, selectorUsed } = await this.findClickableElementBySelectors(
      saveButtonSelectors,
      {
        timeout: 10000,
        state: "visible",
        required: false,
        logSelector: true
      }
    );

    if (button) {
      await button.scrollIntoViewIfNeeded();
      await this.browser.delay(500);
      
      // Intentar hacer submit del formulario
      try {
        // Primero intentar hacer click normal
        await button.click();
        this.logger.debug("save and continue button clicked", { selector: selectorUsed });
      } catch (clickError) {
        // Si falla el click, intentar con JavaScript para asegurar el submit
        try {
          await button.evaluate(el => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.click();
          });
          this.logger.debug("save and continue button clicked via JavaScript", { selector: selectorUsed });
        } catch (jsError) {
          this.logger.warn("could not click save button", { 
            clickError: clickError.message,
            jsError: jsError.message 
          });
        }
      }
      
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await this.browser.delay(1000);
      return true;
    } else {
      this.logger.warn("save button not found, data may still be saved");
      return false;
    }
  }

  // Helper method para encontrar elementos simples
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

  async fillPersonalDataAccordion(passenger) {
    try {
      this.logger.debug("filling personal data accordion", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: this.getTimeout()
      });

      await this.browser.delay(300);

      await this.expandAccordion("Datos personales");

      const genderMap = {
        "F": "Femenino",
        "M": "Masculino",
        "X": "Sin especificar",
        "": "Sin especificar"
      };

      const genderText = genderMap[passenger.gender] || "Sin especificar";

      try {
        this.logger.debug("selecting gender", { gender: genderText });
        const genderSelect = await page.waitForSelector("mat-select[formcontrolname='gender']", {
          timeout: 5000
        });
        
        if (genderSelect) {
          const currentValue = await genderSelect.evaluate(el => {
            const valueText = el.querySelector('.mat-select-value-text span');
            return valueText ? valueText.textContent.trim() : '';
          });
          
          this.logger.debug("current gender value", { currentValue, expected: genderText });
          
          if (!currentValue || currentValue === "Sin especificar" || currentValue !== genderText) {
            await genderSelect.click();
            await this.browser.delay(800);
            
            const option = await page.waitForSelector(`mat-option:has-text("${genderText}")`, {
              timeout: 5000
            }).catch(() => null);
            
            if (option) {
              await option.click();
              this.logger.debug("gender selected", { gender: genderText });
              await this.browser.delay(500);
            } else {
              this.logger.warn("gender option not found, trying keyboard navigation");
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              await this.browser.delay(500);
            }
          } else {
            this.logger.debug("gender already has correct value", { gender: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not select gender", { error: error.message });
      }

      try {
        this.logger.debug("selecting residence country", { country: passenger.residence_country });
        const residenceInput = await page.$("input[formcontrolname='countryResidence']");
        
        if (residenceInput) {
          const currentValue = await residenceInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await residenceInput.click();
            await this.browser.delay(200);
            await residenceInput.fill(passenger.residence_country);
            await this.browser.delay(500);
            
            const autocompletePanel = await page.waitForSelector("mat-autocomplete", {
              timeout: 5000,
              state: "visible"
            }).catch(() => null);
            
            if (autocompletePanel) {
              await this.browser.delay(500);
              
              // Simular flecha abajo y luego Enter para seleccionar la primera opción
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              this.logger.debug("residence country selected (arrow down + enter)", { country: passenger.residence_country });
              await this.browser.delay(500);
            } else {
              await page.keyboard.press("Enter");
              this.logger.debug("residence country entered via keyboard (no autocomplete panel)", { country: passenger.residence_country });
              await this.browser.delay(500);
            }
            
            const finalValue = await residenceInput.inputValue();
            if (!finalValue || finalValue.trim() === "") {
              this.logger.warn("residence country may not have been selected correctly");
            }
          } else {
            this.logger.debug("residence country already has a value, keeping it", { country: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not select residence country", { error: error.message });
      }

      try {
        this.logger.debug("selecting visit purpose", { purpose: passenger.visit_purpose });
        
        const purposeMap = {
          "Turismo": "Turismo, vacaciones, placer",
          "turismo": "Turismo, vacaciones, placer",
          "Negocios": "Negocios",
          "negocios": "Negocios",
          "Estudios": "Estudios",
          "estudios": "Estudios",
          "Transito": "Tránsito",
          "transito": "Tránsito"
        };
        
        const purposeText = purposeMap[passenger.visit_purpose] || passenger.visit_purpose;
        
        const purposeSelect = await page.waitForSelector("mat-select[formcontrolname='purposeOfVisit']", {
          timeout: 5000
        });
        
        if (purposeSelect) {
          const currentValue = await purposeSelect.evaluate(el => {
            const valueText = el.querySelector('.mat-select-value-text span');
            return valueText ? valueText.textContent.trim() : '';
          });
          
          this.logger.debug("current visit purpose value", { currentValue, expected: purposeText });
          
          if (!currentValue || currentValue === "Elige el propósito de su visita" || currentValue !== purposeText) {
            await purposeSelect.click();
            await this.browser.delay(800);
            
            const option = await page.waitForSelector(`mat-option:has-text("${purposeText}")`, {
              timeout: 5000
            }).catch(() => null);
            
            if (option) {
              await option.click();
              this.logger.debug("visit purpose selected", { purpose: purposeText });
              await this.browser.delay(500);
            } else {
              this.logger.warn("visit purpose option not found, trying keyboard navigation");
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              await this.browser.delay(500);
            }
          } else {
            this.logger.debug("visit purpose already has correct value", { purpose: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not select visit purpose", { error: error.message });
      }

      try {
        this.logger.debug("checking birth date field");
        const birthDateInput = await page.$("input[type='text'][placeholder*='dd/mm'], input[name*='birth'], input[name*='fecha']");
        if (birthDateInput) {
          const currentValue = await birthDateInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "" || currentValue.includes("dd/mm")) {
            const birthDateFormatted = passenger.birth_date.split('-').reverse().join('/');
            await birthDateInput.click();
            await this.browser.delay(100);
            await birthDateInput.fill(birthDateFormatted);
            this.logger.debug("birth date filled", { birthDate: birthDateFormatted });
            await this.browser.delay(100);
          } else {
            this.logger.debug("birth date already has a value, keeping it", { birthDate: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not handle birth date field", { error: error.message });
      }

      await this.browser.delay(500);

      // Click save button using the helper method
      await this.clickSaveAndContinue();

    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async fillTravelDocumentAccordion(passenger) {
    try {
      this.logger.debug("filling travel document accordion", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: this.getTimeout()
      });

      await this.browser.delay(300);

      await this.expandAccordion("Documento de viaje");

      const documentTypeMap = {
        "CC": ["Documento de identificación", "Cédula de ciudadanía"],
        "CE": ["Cédula de extranjería"],
        "PA": ["Pasaporte"],
        "TI": ["Tarjeta de identidad"],
        "NIT": ["NIT"]
      };

      const documentTypeOptions = documentTypeMap[passenger.document_type] || ["Pasaporte"];
      const documentTypeText = documentTypeOptions[0];

      try {
        this.logger.debug("selecting document type", { type: documentTypeText, alternatives: documentTypeOptions });
        
        const docTypeSelect = await page.waitForSelector("mat-select[formcontrolname*='documentType'], mat-select[formcontrolname*='document_type'], mat-select[formcontrolname*='type']", {
          timeout: 5000
        }).catch(() => null);
        
        if (docTypeSelect) {
          const currentValue = await docTypeSelect.evaluate(el => {
            const valueText = el.querySelector('.mat-select-value-text span');
            return valueText ? valueText.textContent.trim() : '';
          });
          
          this.logger.debug("current document type value", { currentValue, expected: documentTypeText });
          
          // Verificar si el valor actual coincide con alguna de las opciones esperadas
          const currentMatches = documentTypeOptions.some(option => 
            currentValue && currentValue.toLowerCase().includes(option.toLowerCase())
          );
          
          if (!currentValue || currentValue.trim() === "" || !currentMatches) {
            await docTypeSelect.click();
            await this.browser.delay(800);
            
            // Intentar encontrar la opción con cualquiera de los textos posibles
            let typeOption = null;
            for (const optionText of documentTypeOptions) {
              typeOption = await page.waitForSelector(`mat-option:has-text("${optionText}")`, {
                timeout: 2000
              }).catch(() => null);
              if (typeOption) {
                this.logger.debug("found document type option", { text: optionText });
                break;
              }
            }
            
            if (typeOption) {
              await typeOption.click();
              this.logger.debug("document type selected", { type: documentTypeText });
              await this.browser.delay(500);
            } else {
              this.logger.warn("document type option not found, trying keyboard navigation");
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              await this.browser.delay(500);
            }
          } else {
            this.logger.debug("document type already has correct value", { type: currentValue });
          }
        } else {
          this.logger.warn("document type select field not found");
        }
      } catch (error) {
        this.logger.warn("could not select document type", { error: error.message });
      }

      try {
        this.logger.debug("checking document number field");
        
        const docNumberSelectors = [
          "input[formcontrolname*='documentNumber']",
          "input[formcontrolname*='document_number']",
          "input[formcontrolname*='number']",
          "input[placeholder*='Número']",
          "input[placeholder*='número']"
        ];
        
        let docNumberInput = null;
        for (const selector of docNumberSelectors) {
          docNumberInput = await page.$(selector).catch(() => null);
          if (docNumberInput) {
            const labelText = await page.evaluate(el => {
              const parent = el.closest('mat-form-field') || el.closest('div');
              const label = parent?.querySelector('label, mat-label');
              return label?.textContent || '';
            }, docNumberInput);
            
            if (labelText.includes('Número') && labelText.includes('documento')) {
              break;
            }
          }
        }
        
        if (docNumberInput) {
          const currentValue = await docNumberInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await docNumberInput.click();
            await this.browser.delay(100);
            await docNumberInput.fill(passenger.document_number);
            this.logger.debug("document number filled", { number: passenger.document_number });
            await this.browser.delay(200);
          } else {
            this.logger.debug("document number already has a value, keeping it", { number: currentValue });
          }
        } else {
          this.logger.warn("document number input field not found");
        }
      } catch (error) {
        this.logger.warn("could not fill document number", { error: error.message });
      }

      try {
        this.logger.debug("checking first name field in document");
        
        // Primero intentar con selectores específicos (sin verificar label)
        let firstNameInput = await page.$("input[formcontrolname='documentName']").catch(() => null);
        
        if (!firstNameInput) {
          firstNameInput = await page.$("input.document-name-input").catch(() => null);
        }
        
        // Si no encontramos con selectores específicos, usar selectores genéricos con verificación de label
        if (!firstNameInput) {
          const firstNameSelectors = [
            "input[formcontrolname*='documentName']",
            "input[formcontrolname*='firstName']",
            "input[formcontrolname*='first_name']",
            "input[formcontrolname*='name']",
            "input[placeholder*='nombre']",
            "input[placeholder*='Nombres']"
          ];
          
          for (const selector of firstNameSelectors) {
            const inputs = await page.$$(selector);
            for (const input of inputs) {
              const labelText = await page.evaluate(el => {
                const parent = el.closest('mat-form-field') || el.closest('div');
                const label = parent?.querySelector('label, mat-label');
                return label?.textContent || '';
              }, input);
              
              if (labelText.includes('nombre') && (labelText.includes('documento') || labelText.includes('como aparece'))) {
                firstNameInput = input;
                break;
              }
            }
            if (firstNameInput) break;
          }
        }
        
        if (firstNameInput) {
          const currentValue = await firstNameInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await firstNameInput.click();
            await this.browser.delay(100);
            await firstNameInput.fill(passenger.first_name);
            this.logger.debug("first name filled in document", { name: passenger.first_name });
            await this.browser.delay(200);
          } else {
            this.logger.debug("first name already has a value, keeping it", { name: currentValue });
          }
        } else {
          this.logger.warn("first name input field not found");
        }
      } catch (error) {
        this.logger.warn("could not handle first name field", { error: error.message });
      }

      try {
        this.logger.debug("checking last name field in document");
        
        // Primero intentar con selectores específicos (sin verificar label)
        let lastNameInput = await page.$("input[formcontrolname='documentSurname']").catch(() => null);
        
        if (!lastNameInput) {
          lastNameInput = await page.$("input.document-surname-input").catch(() => null);
        }
        
        // Si no encontramos con selectores específicos, usar selectores genéricos con verificación de label
        if (!lastNameInput) {
          const lastNameSelectors = [
            "input[formcontrolname*='documentSurname']",
            "input[formcontrolname*='lastName']",
            "input[formcontrolname*='last_name']",
            "input[formcontrolname*='surname']",
            "input[placeholder*='apellido']",
            "input[placeholder*='Apellidos']"
          ];
          
          for (const selector of lastNameSelectors) {
            const inputs = await page.$$(selector);
            for (const input of inputs) {
              const labelText = await page.evaluate(el => {
                const parent = el.closest('mat-form-field') || el.closest('div');
                const label = parent?.querySelector('label, mat-label');
                return label?.textContent || '';
              }, input);
              
              if (labelText.includes('apellido') && (labelText.includes('documento') || labelText.includes('como aparece'))) {
                lastNameInput = input;
                break;
              }
            }
            if (lastNameInput) break;
          }
        }
        
        if (lastNameInput) {
          const currentValue = await lastNameInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await lastNameInput.click();
            await this.browser.delay(100);
            await lastNameInput.fill(passenger.last_name);
            this.logger.debug("last name filled in document", { name: passenger.last_name });
            await this.browser.delay(200);
          } else {
            this.logger.debug("last name already has a value, keeping it", { name: currentValue });
          }
        } else {
          this.logger.warn("last name input field not found");
        }
      } catch (error) {
        this.logger.warn("could not handle last name field", { error: error.message });
      }

      try {
        this.logger.debug("selecting nationality", { nationality: passenger.document_nationality });
        
        const nationalitySelectors = [
          "input[placeholder*='nacionalidad']",
          "input[placeholder*='Nacionalidad']",
          "input[formcontrolname*='nationality']",
          "input[formcontrolname*='Nationality']"
        ];
        
        let nationalityInput = null;
        for (const selector of nationalitySelectors) {
          nationalityInput = await page.$(selector).catch(() => null);
          if (nationalityInput) {
            const labelText = await page.evaluate(el => {
              const parent = el.closest('mat-form-field') || el.closest('div');
              const label = parent?.querySelector('label, mat-label');
              return label?.textContent || '';
            }, nationalityInput);
            
            if (labelText.includes('Nacionalidad') && labelText.includes('documento')) {
              break;
            }
          }
        }
        
        if (!nationalityInput) {
          const allInputs = await page.$$("input[type='text']");
          for (const input of allInputs) {
            const labelText = await page.evaluate(el => {
              const parent = el.closest('mat-form-field') || el.closest('div');
              const label = parent?.querySelector('label, mat-label');
              return label?.textContent || '';
            }, input);
            
            if (labelText.includes('Nacionalidad') && labelText.includes('documento') && !labelText.includes('emisor')) {
              nationalityInput = input;
              break;
            }
          }
        }
        
        if (nationalityInput) {
          const currentValue = await nationalityInput.inputValue();
          
          let nationalityValue = passenger.document_nationality;
          if (nationalityValue === "Colombia") {
            nationalityValue = "Colombiano";
          }
          
          if (!currentValue || currentValue.trim() === "") {
            await nationalityInput.click();
            await this.browser.delay(200);
            await nationalityInput.fill(nationalityValue);
            await this.browser.delay(500);
            
            const autocompletePanel = await page.waitForSelector("mat-autocomplete", {
              timeout: 5000,
              state: "visible"
            }).catch(() => null);
            
            if (autocompletePanel) {
              await this.browser.delay(500);
              
              // Simular flecha abajo y luego Enter para seleccionar la primera opción
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              this.logger.debug("nationality selected (arrow down + enter)", { nationality: nationalityValue });
              await this.browser.delay(500);
            } else {
              await page.keyboard.press("Enter");
              this.logger.debug("nationality entered via keyboard (no autocomplete)", { nationality: nationalityValue });
              await this.browser.delay(500);
            }
            
            const finalValue = await nationalityInput.inputValue();
            if (!finalValue || finalValue.trim() === "") {
              this.logger.warn("nationality may not have been filled correctly");
            }
          } else {
            this.logger.debug("nationality already has a value, keeping it", { country: currentValue });
          }
        } else {
          this.logger.warn("nationality input field not found");
        }
      } catch (error) {
        this.logger.warn("could not select nationality", { error: error.message });
      }

      try {
        this.logger.debug("selecting issuing country");
        const issuingInputs = await page.$$("input[placeholder*='país'], input[value='Colombia']");
        for (const input of issuingInputs) {
          const labelText = await page.evaluate(el => {
            const parent = el.closest('div');
            const label = parent?.querySelector('label');
            return label?.textContent || '';
          }, input);

          if (labelText.includes('emisor')) {
            const currentValue = await input.inputValue();
            
            if (!currentValue || currentValue.trim() === "") {
              await input.click();
              await this.browser.delay(100);
              await input.fill(passenger.document_issuing_country);
              await this.browser.delay(100);
              
              const countryOption = await page.$(`text=${passenger.document_issuing_country}`);
              if (countryOption) {
                await countryOption.click();
                this.logger.debug("issuing country selected", { country: passenger.document_issuing_country });
                await this.browser.delay(100);
              }
              break;
            } else {
              this.logger.debug("issuing country already has a value, keeping it", { country: currentValue });
            }
          }
        }
      } catch (error) {
        this.logger.warn("could not select issuing country", { error: error.message });
      }

      try {
        this.logger.debug("checking expiry date field");
        
        const expiryDateSelectors = [
          "input[formcontrolname*='expiry']",
          "input[formcontrolname*='expiration']",
          "input[formcontrolname*='expiryDate']",
          "input[placeholder*='caducidad']",
          "input[placeholder*='Caducidad']",
          "input[placeholder*='dd/mm']"
        ];
        
        let expiryDateInput = null;
        for (const selector of expiryDateSelectors) {
          const inputs = await page.$$(selector);
          for (const input of inputs) {
            const labelText = await page.evaluate(el => {
              const parent = el.closest('mat-form-field') || el.closest('div');
              const label = parent?.querySelector('label, mat-label');
              return label?.textContent || '';
            }, input);
            
            if (labelText.includes('caducidad') || labelText.includes('expiración')) {
              expiryDateInput = input;
              break;
            }
          }
          if (expiryDateInput) break;
        }
        
        if (expiryDateInput && passenger.document_expiry_date) {
          const currentValue = await expiryDateInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "" || currentValue.includes("dd/mm") || currentValue.includes("dd/MM")) {
            const expiryDateFormatted = passenger.document_expiry_date.split('-').reverse().join('/');
            await expiryDateInput.click();
            await this.browser.delay(100);
            await expiryDateInput.fill(expiryDateFormatted);
            this.logger.debug("expiry date filled", { expiryDate: expiryDateFormatted });
            await this.browser.delay(200);
          } else {
            this.logger.debug("expiry date already has a value, keeping it", { expiryDate: currentValue });
          }
        } else if (!expiryDateInput) {
          this.logger.warn("expiry date input field not found");
        } else if (!passenger.document_expiry_date) {
          this.logger.warn("document_expiry_date not provided in CSV");
        }
      } catch (error) {
        this.logger.warn("could not handle expiry date field", { error: error.message });
      }

      await this.browser.delay(500);

      // Click save button
      await this.clickSaveAndContinue();

    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }

  async fillEmergencyContactAccordion(passenger) {
    try {
      this.logger.debug("filling emergency contact accordion", {
        airline: "avianca",
        reservation: passenger.reservation_code
      });

      const page = this.browser.getPage();

      await page.waitForLoadState("networkidle", {
        timeout: this.getTimeout()
      });

      await this.browser.delay(300);

      await this.expandAccordion("Contacto de emergencia");

      try {
        this.logger.debug("checking emergency contact name field");
        const nameInput = await page.$("input[formcontrolname='name']");
        if (nameInput) {
          const currentValue = await nameInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await nameInput.click();
            await this.browser.delay(100);
            await nameInput.fill(passenger.emergency_contact_name);
            this.logger.debug("emergency contact name filled", { name: passenger.emergency_contact_name });
            await this.browser.delay(100);
          } else {
            this.logger.debug("emergency contact name already has a value, keeping it", { name: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not fill emergency contact name", { error: error.message });
      }

      try {
        this.logger.debug("selecting phone prefix for emergency contact");
        const prefixInput = await page.$("input[formcontrolname='phoneCountryCode']");
        if (prefixInput) {
          const currentValue = await prefixInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await prefixInput.click();
            await this.browser.delay(100);
            await prefixInput.fill(passenger.emergency_contact_phone_prefix);
            await this.browser.delay(200);
            
            const autocompletePanel = await page.waitForSelector("mat-autocomplete", {
              timeout: 3000,
              state: "visible"
            }).catch(() => null);
            
            if (autocompletePanel) {
              await this.browser.delay(500);
              
              // Simular flecha abajo y luego Enter para seleccionar la primera opción
              await page.keyboard.press("ArrowDown");
              await this.browser.delay(200);
              await page.keyboard.press("Enter");
              this.logger.debug("phone prefix selected (arrow down + enter)", { prefix: passenger.emergency_contact_phone_prefix });
              await this.browser.delay(100);
            } else {
              await page.keyboard.press("Enter");
              this.logger.debug("phone prefix entered via keyboard (no autocomplete panel)", { prefix: passenger.emergency_contact_phone_prefix });
              await this.browser.delay(100);
            }
          } else {
            this.logger.debug("phone prefix already has a value, keeping it", { prefix: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not select phone prefix", { error: error.message });
      }

      try {
        this.logger.debug("checking emergency contact phone field");
        const phoneInput = await page.$("input[formcontrolname='number']");
        if (phoneInput) {
          const currentValue = await phoneInput.inputValue();
          
          if (!currentValue || currentValue.trim() === "") {
            await phoneInput.click();
            await this.browser.delay(100);
            await phoneInput.fill(passenger.emergency_contact_phone);
            this.logger.debug("emergency contact phone filled", { phone: passenger.emergency_contact_phone });
            await this.browser.delay(100);
          } else {
            this.logger.debug("emergency contact phone already has a value, keeping it", { phone: currentValue });
          }
        }
      } catch (error) {
        this.logger.warn("could not fill emergency contact phone", { error: error.message });
      }

      try {
        this.logger.debug("selecting emergency contact country");
        const countryInput = await page.$("input[formcontrolname='countryCode']");
        if (countryInput) {
          const currentValue = await countryInput.inputValue();
          
          // Limpiar el campo si tiene un valor que no es válido o está vacío
          if (!currentValue || currentValue.trim() === "" || currentValue !== passenger.emergency_contact_country) {
            // Hacer click y enfocar el campo
            await countryInput.click();
            await this.browser.delay(200);
            
            // Limpiar el campo primero
            await countryInput.fill("");
            await this.browser.delay(100);
            
            // Escribir el país
            await countryInput.fill(passenger.emergency_contact_country);
            await this.browser.delay(300); // Esperar un poco después de escribir
            
            // Presionar Enter directamente para confirmar la selección
            await page.keyboard.press("Enter");
            await this.browser.delay(500);
            
            this.logger.debug("emergency contact country entered and confirmed with Enter", { 
              country: passenger.emergency_contact_country
            });
          } else {
            this.logger.debug("emergency contact country already has a value, keeping it", { country: currentValue });
          }
        } else {
          this.logger.warn("emergency contact country input field not found");
        }
      } catch (error) {
        this.logger.warn("could not select emergency contact country", { error: error.message });
      }

      await this.browser.delay(1000); // Esperar más tiempo antes de hacer click en guardar

      // Verificar que no haya errores de validación antes de continuar
      const hasErrors = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('.mat-error, [role="alert"], .error-message');
        return Array.from(errorElements).some(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && el.textContent.trim() !== '';
        });
      });
      
      if (hasErrors) {
        this.logger.warn("validation errors detected, attempting to fix by reselecting country...", {
          airline: "avianca",
          reservation: passenger.reservation_code
        });
        
        // Intentar solucionar el error volviendo al campo de país y presionando Enter
        try {
          const countryInput = await page.$("input[formcontrolname='countryCode']");
          if (countryInput) {
            await countryInput.click();
            await this.browser.delay(200);
            await page.keyboard.press("Enter");
            await this.browser.delay(500);
            this.logger.debug("attempted to fix country selection by pressing Enter");
          }
        } catch (fixError) {
          this.logger.warn("could not fix country selection", { error: fixError.message });
        }
        
        await this.browser.delay(1000);
      }

      // Click save button (incluso si hay errores, intentar hacer click)
      const saveResult = await this.clickSaveAndContinue();
      
      if (!saveResult) {
        this.logger.warn("save button click may have failed, waiting and retrying...");
        await this.browser.delay(2000);
        await this.clickSaveAndContinue();
      }

    } catch (error) {
      throw createErrorFromCode("ERR_DOM_CHANGED", this.config, error.message);
    }
  }
}

module.exports = AviancaAccordionHandler;

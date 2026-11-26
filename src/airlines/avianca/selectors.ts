/**
 * Selectors of the Avianca web check-in (Angular Material). Each step lists
 * candidates from the most specific to the most generic so a cosmetic change
 * on the site does not break the whole flow.
 */
export const SELECTORS = {
  reservationCode: ["input[formcontrolname='reservationNumber']"],
  lastName: ["input[formcontrolname='lastNames']"],
  searchReservation: ["button.button-submit", "button[type='submit']"],
  errorBanner: [".error-message", ".alert-danger", "[role='alert']", ".form-error", ".help-text.error"],
  captcha: ["iframe[src*='recaptcha']", "iframe[src*='hcaptcha']", "#challenge-form"],
  startCheckIn: [
    "button:has-text('Empezar check-in')",
    "button:has-text('Comenzar check-in')",
    "button:has-text('Iniciar check-in')",
    "a:has-text('Empezar check-in')",
  ],
  viewBoardingPasses: [
    "button:has-text('Ver pasabordos')",
    "button:has-text('Ver pase de abordar')",
    "a:has-text('Ver pasabordos')",
  ],
  contactEmail: ["input[formcontrolname='email']", "input[type='email']"],
  contactPhone: ["input.phone-number-input", "input[formcontrolname='phoneNumber']", "input[type='tel']"],
  continue: ["button#continue", "button:has-text('Continuar')"],
  acceptBaggage: ["button:has-text('Aceptar y continuar')", "button:has-text('Aceptar')"],
  saveAndContinue: ["button:has-text('Guardar y continuar')", "button.submit[type='submit']"],
  fieldError: ["mat-error"],
  personal: {
    gender: ["mat-select[formcontrolname='gender']"],
    residenceCountry: ["input[formcontrolname='countryResidence']"],
    visitPurpose: ["mat-select[formcontrolname='purposeOfVisit']"],
    birthDate: ["input[formcontrolname='birthDate']", "input[placeholder*='dd/mm']"],
  },
  document: {
    type: ["mat-select[formcontrolname='documentType']", "mat-select[formcontrolname*='documentType']"],
    number: ["input[formcontrolname='documentNumber']", "input[formcontrolname*='documentNumber']"],
    firstName: ["input[formcontrolname='documentName']"],
    lastName: ["input[formcontrolname='documentSurname']"],
    nationality: ["input[formcontrolname='nationality']", "input[placeholder*='acionalidad']"],
    issuingCountry: ["input[formcontrolname='issuingCountry']", "input[placeholder*='expedición']"],
    expiryDate: ["input[formcontrolname='expiryDate']", "input[placeholder*='aducidad']"],
  },
  emergency: {
    name: ["input[formcontrolname='name']"],
    phonePrefix: ["input[formcontrolname='phoneCountryCode']"],
    phone: ["input[formcontrolname='number']"],
    country: ["input[formcontrolname='countryCode']"],
  },
  seatDialog: ["[role='dialog']", "mat-dialog-container"],
  closeDialog: ["button[aria-label*='errar']", "button[aria-label*='lose']", "button:has-text('Omitir')"],
  boardingPass: ["text=Tu pasabordo", "button:has-text('Enviar pasabordos')", "[class*='boarding-pass']"],
} as const;

export const PANEL_TITLES = {
  personal: "Datos personales",
  document: "Documento de viaje",
  emergency: "Contacto de emergencia",
} as const;

export const GENDER_LABELS = { M: "Masculino", F: "Femenino", X: "Sin especificar", "": "Sin especificar" } as const;

export const VISIT_PURPOSE_LABELS = {
  Turismo: "Turismo, vacaciones, placer",
  Negocios: "Negocios",
  Estudios: "Estudios",
  Transito: "Tránsito",
} as const;

export const DOCUMENT_TYPE_LABELS = {
  CC: ["Cédula de ciudadanía", "Documento de identificación"],
  CE: ["Cédula de extranjería"],
  PA: ["Pasaporte"],
  TI: ["Tarjeta de identidad"],
} as const;

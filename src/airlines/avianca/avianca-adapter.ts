import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import type { Logger } from "pino";
import { firstOf, type BrowserSession } from "../../browser/browser-session.js";
import { CheckInError, classifyAirlineMessage, toCheckInError } from "../../domain/check-in-error.js";
import type { Passenger } from "../../domain/passenger.js";
import type { AirlineAdapter, CheckInOutcome } from "../airline-adapter.js";
import { boardingPassFile, errorScreenshotFile } from "../output-paths.js";
import {
  DOCUMENT_TYPE_LABELS,
  GENDER_LABELS,
  PANEL_TITLES,
  SELECTORS,
  VISIT_PURPOSE_LABELS,
} from "./selectors.js";

export interface AviancaOptions {
  checkInUrl: string;
  outputDir: string;
}

const AUTOCOMPLETE_WAIT_MS = 3_000;
const SEAT_DIALOG_WAIT_MS = 5_000;

function toAviancaDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");

  return `${day ?? ""}/${month ?? ""}/${year ?? ""}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Runs one passenger through the Avianca web check-in, step by step. */
class AviancaFlow {
  private step = "inicio";

  constructor(
    private readonly page: Page,
    private readonly passenger: Passenger,
  ) {}

  get currentStep(): string {
    return this.step;
  }

  async run(checkInUrl: string): Promise<{ alreadyCheckedIn: boolean }> {
    await this.at("búsqueda de la reserva", () => this.searchReservation(checkInUrl));
    const state = await this.at("resultado de la búsqueda", () => this.reservationState());
    if (state === "checked-in") {
      await this.at("apertura del pasabordo", () => this.click(SELECTORS.viewBoardingPasses));
      await this.at("pasabordo", () => this.waitForBoardingPass());

      return { alreadyCheckedIn: true };
    }

    await this.at("inicio del check-in", () => this.click(SELECTORS.startCheckIn));
    await this.at("datos de contacto", () => this.fillContact());
    await this.at("políticas de equipaje", () => this.click(SELECTORS.acceptBaggage));
    await this.at(PANEL_TITLES.personal, () => this.fillPersonalData());
    await this.at(PANEL_TITLES.document, () => this.fillTravelDocument());
    await this.at(PANEL_TITLES.emergency, () => this.fillEmergencyContact());
    await this.at("selección de silla", () => this.dismissSeatSelection());
    await this.at("pasabordo", () => this.waitForBoardingPass());

    return { alreadyCheckedIn: false };
  }

  private async at<T>(step: string, action: () => Promise<T>): Promise<T> {
    this.step = step;
    try {
      return await action();
    } catch (error) {
      const failure = toCheckInError(error);
      if (failure.code === "ERR_TIMEOUT") {
        throw new CheckInError("ERR_TIMEOUT", `paso ${step}`, { cause: error });
      }
      throw failure;
    }
  }

  private async searchReservation(checkInUrl: string): Promise<void> {
    await this.page.goto(checkInUrl, { waitUntil: "domcontentloaded" });
    await firstOf(this.page, SELECTORS.reservationCode).fill(this.passenger.reservation_code);
    await firstOf(this.page, SELECTORS.lastName).fill(this.passenger.last_name);
    await this.click(SELECTORS.searchReservation);
  }

  private async reservationState(): Promise<"pending" | "checked-in"> {
    const outcome = firstOf(this.page, [
      ...SELECTORS.startCheckIn,
      ...SELECTORS.viewBoardingPasses,
      ...SELECTORS.errorBanner,
      ...SELECTORS.captcha,
    ]);
    await outcome.waitFor({ state: "visible" });
    await this.failOnBlockingScreen();

    return (await firstOf(this.page, SELECTORS.viewBoardingPasses).isVisible()) ? "checked-in" : "pending";
  }

  private async failOnBlockingScreen(): Promise<void> {
    if (await firstOf(this.page, SELECTORS.captcha).isVisible()) {
      throw new CheckInError("ERR_CAPTCHA");
    }
    const banner = firstOf(this.page, SELECTORS.errorBanner);
    if (await banner.isVisible()) {
      const text = (await banner.innerText()).trim();
      throw new CheckInError(classifyAirlineMessage(text), text);
    }
  }

  private async fillContact(): Promise<void> {
    await firstOf(this.page, SELECTORS.contactEmail).fill(this.passenger.email);
    await firstOf(this.page, SELECTORS.contactPhone).fill(this.passenger.phone);
    await this.click(SELECTORS.continue);
  }

  private async fillPersonalData(): Promise<void> {
    const panel = await this.openPanel(PANEL_TITLES.personal);
    await this.choose(panel, SELECTORS.personal.gender, [GENDER_LABELS[this.passenger.gender]]);
    await this.autocomplete(panel, SELECTORS.personal.residenceCountry, this.passenger.residence_country);
    await this.choose(panel, SELECTORS.personal.visitPurpose, [VISIT_PURPOSE_LABELS[this.passenger.visit_purpose]]);
    await firstOf(panel, SELECTORS.personal.birthDate).fill(toAviancaDate(this.passenger.birth_date));
    await this.save(panel);
  }

  private async fillTravelDocument(): Promise<void> {
    const panel = await this.openPanel(PANEL_TITLES.document);
    await this.choose(panel, SELECTORS.document.type, DOCUMENT_TYPE_LABELS[this.passenger.document_type]);
    await firstOf(panel, SELECTORS.document.number).fill(this.passenger.document_number);
    await firstOf(panel, SELECTORS.document.firstName).fill(this.passenger.first_name);
    await firstOf(panel, SELECTORS.document.lastName).fill(this.passenger.last_name);
    await this.autocomplete(panel, SELECTORS.document.nationality, this.passenger.document_nationality);
    await this.autocomplete(panel, SELECTORS.document.issuingCountry, this.passenger.document_issuing_country);
    if (this.passenger.document_expiry_date !== "") {
      await firstOf(panel, SELECTORS.document.expiryDate).fill(toAviancaDate(this.passenger.document_expiry_date));
    }
    await this.save(panel);
  }

  private async fillEmergencyContact(): Promise<void> {
    const panel = await this.openPanel(PANEL_TITLES.emergency);
    await firstOf(panel, SELECTORS.emergency.name).fill(this.passenger.emergency_contact_name);
    await this.autocomplete(panel, SELECTORS.emergency.phonePrefix, this.passenger.emergency_contact_phone_prefix);
    await firstOf(panel, SELECTORS.emergency.phone).fill(this.passenger.emergency_contact_phone);
    await this.autocomplete(panel, SELECTORS.emergency.country, this.passenger.emergency_contact_country);
    await this.save(panel);
  }

  private async dismissSeatSelection(): Promise<void> {
    const dialog = firstOf(this.page, SELECTORS.seatDialog);
    const appeared = await dialog
      .waitFor({ state: "visible", timeout: SEAT_DIALOG_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await firstOf(dialog, SELECTORS.closeDialog).click();
      await dialog.waitFor({ state: "hidden" });
    }
  }

  private async waitForBoardingPass(): Promise<void> {
    await firstOf(this.page, SELECTORS.boardingPass).waitFor({ state: "visible" });
  }

  private async openPanel(title: string): Promise<Locator> {
    const header = this.page.locator("mat-expansion-panel-header", { hasText: title }).first();
    await header.waitFor({ state: "visible" });
    if ((await header.getAttribute("aria-expanded")) !== "true") {
      await header.click();
    }

    return this.page.locator("mat-expansion-panel", { has: header });
  }

  private async save(panel: Locator): Promise<void> {
    await firstOf(panel, SELECTORS.saveAndContinue).click();
    const collapsed = panel.locator("mat-expansion-panel-header[aria-expanded='false']");
    const fieldError = firstOf(panel, SELECTORS.fieldError);
    await collapsed.or(fieldError).first().waitFor({ state: "visible" });
    if (await fieldError.isVisible()) {
      throw new CheckInError("ERR_INVALID_DATA", (await fieldError.innerText()).trim());
    }
  }

  /** Opens a mat-select and picks the first option matching any of the labels. */
  private async choose(scope: Locator, selectors: readonly string[], labels: readonly string[]): Promise<void> {
    await firstOf(scope, selectors).click();
    const pattern = new RegExp(labels.map(escapeRegExp).join("|"), "i");
    await this.page.locator("mat-option", { hasText: pattern }).first().click();
  }

  /** Types into an autocomplete and picks the suggestion, falling back to Enter. */
  private async autocomplete(scope: Locator, selectors: readonly string[], value: string): Promise<void> {
    const input = firstOf(scope, selectors);
    await input.fill(value);
    const option = this.page.locator("mat-option", { hasText: new RegExp(escapeRegExp(value), "i") }).first();
    const suggested = await option
      .waitFor({ state: "visible", timeout: AUTOCOMPLETE_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    if (suggested) {
      await option.click();
    } else {
      await input.press("Enter");
    }
  }

  private async click(selectors: readonly string[]): Promise<void> {
    await firstOf(this.page, selectors).click();
  }
}

export class AviancaAdapter implements AirlineAdapter {
  readonly airline = "avianca";

  constructor(
    private readonly session: BrowserSession,
    private readonly options: AviancaOptions,
    private readonly logger: Logger,
  ) {}

  async checkIn(passenger: Passenger): Promise<CheckInOutcome> {
    const page = await this.session.newPage();
    const flow = new AviancaFlow(page, passenger);
    try {
      const { alreadyCheckedIn } = await flow.run(this.options.checkInUrl);
      const boardingPass = boardingPassFile(this.options.outputDir, passenger, "png");
      await mkdir(join(boardingPass, ".."), { recursive: true });
      await page.screenshot({ path: boardingPass, fullPage: true });

      return { boardingPass, alreadyCheckedIn };
    } catch (error) {
      await this.captureError(page, passenger, flow.currentStep);
      throw toCheckInError(error);
    } finally {
      await page.context().close();
    }
  }

  async close(): Promise<void> {
    await this.session.close();
  }

  private async captureError(page: Page, passenger: Passenger, step: string): Promise<void> {
    const path = errorScreenshotFile(this.options.outputDir, passenger);
    try {
      await mkdir(join(path, ".."), { recursive: true });
      await page.screenshot({ path, fullPage: true });
      this.logger.info({ reservation: passenger.reservation_code, step, screenshot: path }, "error screenshot saved");
    } catch (error) {
      this.logger.warn({ reservation: passenger.reservation_code, err: error }, "error screenshot not saved");
    }
  }
}

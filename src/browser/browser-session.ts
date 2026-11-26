import { chromium, type Browser, type Locator, type Page } from "playwright";

export interface BrowserOptions {
  headless: boolean;
  slowMoMs: number;
  stepTimeoutMs: number;
  navigationTimeoutMs: number;
}

/**
 * One Chromium process per run and one isolated context per passenger, so
 * cookies and session state never leak from one reservation to the next.
 */
export class BrowserSession {
  private constructor(
    private readonly browser: Browser,
    private readonly options: BrowserOptions,
  ) {}

  static async launch(options: BrowserOptions): Promise<BrowserSession> {
    const browser = await chromium.launch({ headless: options.headless, slowMo: options.slowMoMs });

    return new BrowserSession(browser, options);
  }

  async newPage(): Promise<Page> {
    const context = await this.browser.newContext({
      locale: "es-CO",
      timezoneId: "America/Bogota",
      viewport: { width: 1366, height: 900 },
    });
    context.setDefaultTimeout(this.options.stepTimeoutMs);
    context.setDefaultNavigationTimeout(this.options.navigationTimeoutMs);

    return context.newPage();
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

/** First visible match among several candidate selectors, most specific first. */
export function firstOf(scope: Page | Locator, selectors: readonly string[]): Locator {
  const [head, ...rest] = selectors;
  if (head === undefined) {
    throw new Error("firstOf needs at least one selector");
  }

  return rest
    .reduce((locator, selector) => locator.or(scope.locator(selector)), scope.locator(head))
    .filter({ visible: true })
    .first();
}

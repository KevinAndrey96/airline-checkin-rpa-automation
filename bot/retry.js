class RetryManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.maxAttempts = config.get("retry.maxAttempts");
    this.backoffConfig = config.get("retry.backoff");
  }

  async execute(fn, context = {}) {
    const { passenger, operation } = context;
    let lastError = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        this.logger.info(`attempt ${attempt} of ${this.maxAttempts}`, {
          operation,
          airline: passenger?.airline,
          reservation: passenger?.reservation_code
        });

        const result = await fn();

        if (attempt > 1) {
          this.logger.info(`operation succeeded on attempt ${attempt}`, {
            operation,
            airline: passenger?.airline,
            reservation: passenger?.reservation_code
          });
        }

        return { success: true, result, attempts: attempt };
      } catch (error) {
        lastError = error;

        this.logger.warn(`attempt ${attempt} failed`, {
          operation,
          error: error.message,
          code: error.code,
          recoverable: error.recoverable,
          airline: passenger?.airline,
          reservation: passenger?.reservation_code
        });

        if (!error.recoverable) {
          this.logger.info("error not recoverable, stopping retries", {
            operation,
            code: error.code
          });
          break;
        }

        if (attempt < this.maxAttempts) {
          const delay = this.calculateBackoff(attempt);
          this.logger.info(`waiting ${delay}ms before retry`, { attempt });
          await this.sleep(delay);
        }
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: this.maxAttempts
    };
  }

  calculateBackoff(attempt) {
    const delay =
      this.backoffConfig.initial * Math.pow(this.backoffConfig.multiplier, attempt - 1);

    return Math.min(delay, this.backoffConfig.max);
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RetryManager;

const { describe, it } = require("node:test");
const assert = require("node:assert");
const RetryManager = require("../bot/retry");
const { RecoverableError, PermanentError } = require("../bot/errors");

const createMockConfig = () => ({
  get: key => {
    if (key === "retry.maxAttempts") return 3;
    if (key === "retry.backoff") {
      return { initial: 10, multiplier: 2, max: 100 };
    }
    return null;
  }
});

const createMockLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
});

describe("RetryManager", () => {
  it("should calculate exponential backoff correctly", () => {
    const retry = new RetryManager(createMockConfig(), createMockLogger());
    // initial: 10, multiplier: 2, max: 100
    assert.strictEqual(retry.calculateBackoff(1), 10);
    assert.strictEqual(retry.calculateBackoff(2), 20);
    assert.strictEqual(retry.calculateBackoff(3), 40);
    assert.strictEqual(retry.calculateBackoff(5), 100); // capped at max 100
  });

  it("should succeed on the first attempt if fn succeeds", async () => {
    const retry = new RetryManager(createMockConfig(), createMockLogger());
    let callCount = 0;

    const result = await retry.execute(async () => {
      callCount++;
      return "BOARDING_PASS_SAVED";
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result, "BOARDING_PASS_SAVED");
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(callCount, 1);
  });

  it("should retry on recoverable errors and succeed eventually", async () => {
    const retry = new RetryManager(createMockConfig(), createMockLogger());
    let callCount = 0;

    const result = await retry.execute(async () => {
      callCount++;
      if (callCount < 2) {
        throw new RecoverableError("ERR_TIMEOUT", "Temporary timeout");
      }
      return "RECOVERED";
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.result, "RECOVERED");
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(callCount, 2);
  });

  it("should immediately abort retries on non-recoverable errors", async () => {
    const retry = new RetryManager(createMockConfig(), createMockLogger());
    let callCount = 0;

    const result = await retry.execute(async () => {
      callCount++;
      throw new PermanentError("ERR_ALREADY_CHECKED_IN", "Passenger already checked in");
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(result.error.code, "ERR_ALREADY_CHECKED_IN");
  });
});

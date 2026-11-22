const { describe, it } = require("node:test");
const assert = require("node:assert");
const config = require("../bot/config").load();
const AirlineFactory = require("../bot/airlines/AirlineFactory");
const BaseAirline = require("../bot/airlines/BaseAirline");
const Avianca = require("../bot/airlines/Avianca");

const createMockLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
});

const createMockBrowser = () => ({
  getPage: () => ({}),
  delay: () => Promise.resolve()
});

describe("AirlineFactory & BaseAirline", () => {
  it("should create an instance of Avianca adapter", () => {
    const factory = new AirlineFactory(config, createMockLogger(), createMockBrowser());
    const adapter = factory.create("avianca");

    assert.ok(adapter instanceof Avianca);
    assert.ok(adapter instanceof BaseAirline);
    assert.strictEqual(adapter.getCode(), "avianca");
    assert.strictEqual(adapter.getName(), "Avianca");
  });

  it("should throw when requesting an unknown airline", () => {
    const factory = new AirlineFactory(config, createMockLogger(), createMockBrowser());
    assert.throws(
      () => {
        factory.create("unknown_air");
      },
      /airline adapter not found: unknown_air/
    );
  });

  it("should reject registering adapters that do not inherit from BaseAirline", () => {
    const factory = new AirlineFactory(config, createMockLogger(), createMockBrowser());
    class FakeAdapter {}

    assert.throws(
      () => {
        factory.register("fake", FakeAdapter);
      },
      /must extend BaseAirline/
    );
  });

  it("should validate passenger fields using BaseAirline validation", () => {
    const factory = new AirlineFactory(config, createMockLogger(), createMockBrowser());
    const adapter = factory.create("avianca");

    const validPassenger = {
      reservation_code: "AV123X",
      last_name: "GOMEZ",
      email: "gomez@example.com",
      birth_date: "1990-01-01"
    };
    const validResult = adapter.validate(validPassenger);
    assert.strictEqual(validResult.valid, true);

    const invalidPassenger = {
      reservation_code: "",
      last_name: ""
    };
    const invalidResult = adapter.validate(invalidPassenger);
    assert.strictEqual(invalidResult.valid, false);
    assert.ok(invalidResult.errors.length >= 2);
  });
});

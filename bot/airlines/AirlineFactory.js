const BaseAirline = require("./BaseAirline");
const Avianca = require("./Avianca");

class AirlineFactory {
  constructor(config, logger, browser) {
    this.config = config;
    this.logger = logger;
    this.browser = browser;
    this.adapters = new Map();
    this.registerAdapters();
  }

  registerAdapters() {
    this.register("avianca", Avianca);
  }

  register(airlineCode, AdapterClass) {
    if (!(AdapterClass.prototype instanceof BaseAirline)) {
      throw new Error(`adapter ${AdapterClass.name} must extend BaseAirline`);
    }

    this.adapters.set(airlineCode.toLowerCase(), AdapterClass);
  }

  create(airlineCode) {
    const code = airlineCode.toLowerCase();

    if (!this.adapters.has(code)) {
      throw new Error(`airline adapter not found: ${airlineCode}`);
    }

    if (!this.config.isAirlineEnabled(code)) {
      throw new Error(`airline not enabled: ${airlineCode}`);
    }

    const AdapterClass = this.adapters.get(code);
    const adapter = new AdapterClass(this.config, this.logger, this.browser);
    adapter.init(code);

    this.logger.info("airline adapter created", {
      airline: code,
      name: adapter.getName()
    });

    return adapter;
  }

  getSupportedAirlines() {
    return Array.from(this.adapters.keys());
  }

  isSupported(airlineCode) {
    return this.adapters.has(airlineCode.toLowerCase());
  }
}

module.exports = AirlineFactory;

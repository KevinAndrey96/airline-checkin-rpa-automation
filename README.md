# Airline Check-In RPA Automation

> Enterprise-grade Robotic Process Automation (RPA) and AI-driven workflow engine designed for travel agencies to automate high-volume airline check-ins and boarding pass extraction.

[![CI](https://github.com/KevinAndrey96/airline-checkin-rpa-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/KevinAndrey96/airline-checkin-rpa-automation/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/playwright-v1.40.0-blue.svg)](https://playwright.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Origin and Motivation

In a high-volume travel agency, passenger check-in is one of the most critical yet repetitive operational bottlenecks. Travel agents frequently receive extensive manifests of passengers traveling across different airlines (such as Avianca and Copa Airlines). Manually opening each airline portal, entering reservation codes, filling passenger contact info, accepting terms, dodging upselling modals, selecting seats, and downloading individual boarding passes takes hours every single day.

This project was built directly to solve that operational pain. It provides a production-ready automated check-in engine that reads passenger manifests, securely handles multi-step airline workflows, bypasses anti-bot heuristics via browser stealth, and outputs clean PDF/PNG boarding passes directly into organized agency storage.

---

## Architectural Highlights

The platform combines deterministic browser automation with autonomous AI agents:

```
                  +-----------------------------------+
                  |   passengers.csv (Manifest)       |
                  +-----------------+-----------------+
                                    |
                           [proper-lockfile]
                                    v
                  +-----------------------------------+
                  |        CSV Manager & Engine       |
                  |  - Schema Validation (Joi)        |
                  |  - Concurrency Lock & Backoff     |
                  |  - Transactional Status Updates   |
                  +--------+-----------------+--------+
                           |                 |
         +-----------------+                 +------------------+
         v                                                      v
+-------------------------------+             +----------------------------------+
| Playwright Stealth Core       |             | Skyvern AI Agent Core            |
| (Avianca Adapter)             |             | (Copa Airlines Adapter)          |
| - Multi-selector fallback     |             | - Vision-Language Web Agent      |
| - Accordion traversal         |             | - Dynamic Form Reasoning         |
| - Bot fingerprint evasion     |             | - Local LLM / Cloud Backend      |
+---------------+---------------+             +-----------------+----------------+
                |                                               |
                +-----------------------+-----------------------+
                                        |
                                        v
                  +-----------------------------------+
                  |     Output & Audit Trail          |
                  |  - Boarding Passes (PDF / PNG)    |
                  |  - Structured Execution Logs      |
                  |  - Error Screenshots              |
                  +-----------------------------------+
```

### 1. Resilient Playwright RPA Engine
- **Stealth Evasion**: Integrated with `puppeteer-extra-plugin-stealth` to mask automation headers, disable `navigator.webdriver`, and evade cloud anti-bot filters.
- **Multi-Selector Fallbacks**: Airline web portals frequently deploy minor DOM updates. Every interactive element utilizes prioritized selector chains with JavaScript evaluation fallbacks.
- **Accordion and Modal Handlers**: Gracefully handles multi-step passenger flows, contact info modals, baggage disclosures, and seat selection prompts.
- **Artifact Pipeline**: Intercepts native downloads and applies optional watermarks using `pdf-lib`.

### 2. Skyvern Vision-Language AI Workflows
- **Autonomous Navigation**: Integrates with the Skyvern agent protocol to execute natural-language check-in tasks on complex multi-carrier interfaces (such as Copa Airlines).
- **Self-Healing Automation**: Accommodates unanticipated UI changes through computer vision and browser action synthesis without requiring hardcoded selector updates.

### 3. State Management and Fault Tolerance
- **File Locking**: Safe multi-process execution via `proper-lockfile` preventing data corruption when multiple workers process the CSV manifest.
- **Error Categorization**: Distinguishes between recoverable network errors (handled via exponential backoff in `RetryManager`), permanent reservation issues (e.g., invalid booking reference), and manual intervention alerts (e.g., CAPTCHA challenges).
- **Crash Recovery**: Automatically resets interrupted `IN_PROGRESS` records to `PENDING` upon restart.

---

## Repository Structure

```
.
├── bot/                            # Playwright RPA engine
│   ├── airlines/                   # Airline adapter implementations
│   │   ├── avianca/                # Modular handlers for Avianca portal
│   │   │   ├── AviancaAccordionHandler.js
│   │   │   ├── AviancaFormFiller.js
│   │   │   ├── AviancaNavigator.js
│   │   │   └── AviancaValidator.js
│   │   ├── AirlineFactory.js       # Adapter factory and registry
│   │   ├── Avianca.js              # Primary Avianca check-in workflow
│   │   └── BaseAirline.js          # Base adapter interface
│   ├── utils/                      # Validators and screenshot utilities
│   ├── browser.js                  # Stealth browser manager
│   ├── config.js                   # Configuration loader
│   ├── csv.js                      # CSV manager with proper-lockfile
│   ├── errors.js                   # Hierarchical error system
│   ├── logger.js                   # Winston structured logger
│   ├── main.js                     # Main bot orchestrator
│   ├── pdf.js                      # Boarding pass processor
│   └── retry.js                    # Exponential backoff retry manager
├── skyvern-bot/                    # Autonomous AI agent integration
│   ├── airlines/copa/              # Copa Airlines Skyvern workflow
│   ├── client/SkyvernClient.js     # Skyvern REST client
│   └── main.js                     # Skyvern bot runner
├── config/                         # System and airline configurations
│   ├── airlines.json
│   ├── default.json
│   └── error-codes.json
├── test/                           # Automated unit test suite
│   ├── airline-factory.test.js
│   ├── csv.test.js
│   ├── errors.test.js
│   ├── retry.test.js
│   └── validators.test.js
├── Dockerfile                      # Playwright container definition
├── docker-compose.yml              # Containerized deployment orchestration
├── passengers.example.csv          # Sample passenger manifest
└── package.json                    # Project metadata and npm scripts
```

---

## Getting Started

### Prerequisites
- Node.js 20.x or 22.x
- npm 9+
- Optional: Docker and Docker Compose

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/KevinAndrey96/airline-checkin-rpa-automation.git
   cd airline-checkin-rpa-automation
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Install Playwright browser binaries:
   ```bash
   npm run install-browsers
   ```

4. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

---

## Manifest Configuration

Populate `passengers.csv` using the schema illustrated in `passengers.example.csv`:

| Column | Description | Example |
|---|---|---|
| `airline` | Airline identifier (`avianca`, `copa`, `satena`) | `avianca` |
| `reservation_code` | 6-character PNR code | `AV123X` |
| `last_name` | Passenger primary surname | `GOMEZ HERRERA` |
| `first_name` | Passenger given name | `ALEJANDRO` |
| `document_type` | Identification type (`CC`, `PA`, `CE`) | `CC` |
| `document_number` | Identification number | `1098765432` |
| `birth_date` | Date of birth (YYYY-MM-DD) | `1992-05-14` |
| `email` | Notification email address | `passenger@example.com` |
| `phone` | Contact phone with country code | `+573001234567` |
| `seat_preference` | Seat preference (`WINDOW`, `AISLE`, `NONE`) | `WINDOW` |
| `checkin_status` | Status (`PENDING`, `IN_PROGRESS`, `SUCCESS`, `ERROR`) | `PENDING` |

---

## Running the Bot

### Standard Playwright Mode (Avianca)

Run in testing mode with browser visible:
```bash
npm run dev
```

Run in production mode (headless, optimized delays):
```bash
npm run setup:prod
npm start
```

### Autonomous AI Mode (Skyvern)

Run the autonomous AI agent for Copa Airlines:
```bash
npm run start:skyvern
```

---

## Docker Deployment

To execute unattended bulk check-in jobs within an isolated container:

```bash
docker compose build
docker compose up
```

Boarding passes and execution logs will be written to `./boarding_passes` and `./logs` on the host machine.

---

## Testing

The project includes an automated test suite executed via the native Node.js test runner:

```bash
npm test
```

### Test Coverage Highlights:
- **Validators**: Verifies strict schema compliance, date formats, phone conventions, and uppercase normalization.
- **Error Classification**: Validates error recovery states, severity tracking, and contextual logging.
- **Retry Mechanism**: Tests exponential backoff calculation and immediate abort on permanent errors.
- **Concurrency & Locking**: Ensures file lock acquisition and release safety under multi-worker conditions.
- **Airline Factory**: Tests dynamic adapter instantiation and interface contracts.

---

## License

This project is licensed under the MIT License.

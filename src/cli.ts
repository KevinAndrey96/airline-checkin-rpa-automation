#!/usr/bin/env node
import { existsSync } from "node:fs";
import { runCli } from "./app.js";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

process.exitCode = await runCli(process.argv.slice(2), process.env, process.stdout);

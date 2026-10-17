#!/usr/bin/env node
/**
 * Lista workflows en Skyvern local para obtener el COPA_SKYVERN_WORKFLOW_ID.
 *
 * Uso: node skyvern-bot/scripts/list-workflows.js
 */

require("dotenv").config({ path: "skyvern-bot/.env" });

const apiUrl = (process.env.SKYVERN_API_URL || "http://localhost:8000/v1").replace(/\/$/, "");
const apiKey = process.env.SKYVERN_API_KEY;

if (!apiKey) {
  console.error("Falta SKYVERN_API_KEY en skyvern-bot/.env");
  process.exit(1);
}

async function main() {
  const response = await fetch(`${apiUrl}/workflows?page=1&page_size=50`, {
    headers: { "x-api-key": apiKey }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const workflows = await response.json();

  if (!Array.isArray(workflows) || workflows.length === 0) {
    console.log("No hay workflows. Crea 'CheckIn COPA' en http://localhost:8080");
    return;
  }

  console.log("\nWorkflows disponibles:\n");
  for (const wf of workflows) {
    const title = wf.title || wf.workflow_title || "(sin título)";
    const wpid = wf.workflow_permanent_id || wf.workflow_id || "?";
    console.log(`  ${title}`);
    console.log(`    ID: ${wpid}\n`);
  }

  console.log("Copia el wpid_ del workflow CheckIn COPA a skyvern-bot/.env:");
  console.log("  COPA_SKYVERN_WORKFLOW_ID=wpid_...\n");
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});

"""
Copa Airlines web check-in: Skyvern code workflow.

Publicar en Skyvern UI (Workflows → Code) o re-importar tras editar.
Luego copiar el workflow_permanent_id (wpid_...) a skyvern-bot/.env:

  COPA_SKYVERN_WORKFLOW_ID=wpid_xxxx
  COPA_SKYVERN_MODE=workflow
"""

from __future__ import annotations

from typing import Any

import skyvern
from pydantic import BaseModel, Field
from skyvern import RunContext, SkyvernPage

COPA_HOME_URL = "https://www.copa.com/"
COPA_CHECKIN_URL = "https://checkin.copaair.com/"


class WorkflowParameters(BaseModel):
    """Parámetros explícitos del workflow (preferidos)."""

    last_name: str = Field(default="", description="Apellido(s) como en la reserva, sin espacios")
    reservation_code: str = Field(default="", description="Código PNR de 6 caracteres")


class GeneratedWorkflowParameters(BaseModel):
    """Compatibilidad con nombres auto-generados por Skyvern UI."""

    cu_l_es_el_apellido_que_desea_ingresar: str = Field(
        description="¿Cuál es el apellido que desea ingresar?",
        default="",
    )
    what_is_the_reservation_code: str = Field(
        description="What is the reservation code?",
        default="",
    )
    last_name: str = Field(default="", description="Apellido(s) como en la reserva")
    reservation_code: str = Field(default="", description="Código PNR de 6 caracteres")


def _resolve_last_name(context: RunContext) -> str:
    params = context.parameters
    for key in ("last_name", "cu_l_es_el_apellido_que_desea_ingresar"):
        value = str(params.get(key) or "").strip()
        if value:
            return value.replace(" ", "")
    return ""


def _resolve_reservation_code(context: RunContext) -> str:
    params = context.parameters
    for key in ("reservation_code", "what_is_the_reservation_code"):
        value = str(params.get(key) or "").strip().upper()
        if value:
            return value
    return ""


@skyvern.workflow(title="CheckIn COPA")
async def run_workflow(parameters: WorkflowParameters | dict[str, Any]):
    parameters = parameters.model_dump() if isinstance(parameters, WorkflowParameters) else parameters
    await skyvern.setup(parameters, GeneratedWorkflowParameters)

    await skyvern.run_task(
        prompt="Entra a la página web de Copa Airlines",
        max_steps=10,
        engine="skyvern-2.0",
        label="Visit",
    )

    await skyvern.action(
        prompt='Busca la sección "Check-In" en la barra superior y haz clic',
        label="block_1",
    )

    await skyvern.run_task(
        prompt=(
            "En checkin.copaair.com ingresa apellido y código de reserva, "
            "luego haz clic en Find Reservation"
        ),
        url=COPA_CHECKIN_URL,
        max_steps=15,
        engine="skyvern-2.0",
        label="block_2",
    )


@skyvern.cached(cache_key="Visit")
async def visit(page: SkyvernPage, context: RunContext):
    await skyvern.goto(url=COPA_HOME_URL, label="goto_copa_home")


@skyvern.cached(cache_key="block_1")
async def block_1(page: SkyvernPage, context: RunContext):
    await page.click(
        selector='a:has-text("Check-In")',
        ai="fallback",
        prompt=(
            "Acceder a la sección Check-In desde la barra de navegación superior de copa.com"
        ),
    )


@skyvern.cached(cache_key="block_2")
async def block_2(page: SkyvernPage, context: RunContext):
    last_name = _resolve_last_name(context)
    reservation_code = _resolve_reservation_code(context)

    await page.goto(COPA_CHECKIN_URL)

    await page.fill(
        selector='input[aria-label="Enter the last name that appears in your reservation"]',
        value=last_name,
        ai="fallback",
        prompt="¿Cuál es el apellido que desea ingresar?",
    )

    await page.fill(
        selector=(
            'input[aria-label="You can type either an alphanumeric code of 6 digits in case of '
            'you have a PNR code, or a numeric code of 13 digits in case of you have an '
            'e-ticket number, or a number of 9 digits if it is a ConnectMiles number."]'
        ),
        value=reservation_code,
        ai="fallback",
        prompt="What is the reservation code?",
    )

    await page.click(
        selector=(
            'button[aria-label="Press enter to search your reservation and continue with '
            'your checkin process."]'
        ),
        ai="fallback",
        prompt="Haz clic en Find Reservation para buscar la reserva y continuar el check-in",
    )

    await page.complete()

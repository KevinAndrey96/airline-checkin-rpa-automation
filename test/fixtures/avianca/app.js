// Fake Avianca check-in used by the end-to-end tests. Reservation codes drive
// the scenario: NOEXIST fails the search, DONE01 is already checked in,
// BADDOC rejects the travel document and SLOW01 never shows the boarding pass.
const $ = (selector, root = document) => root.querySelector(selector);
const form = {};
const saved = new Set();
let reservation = "";

function show(id) {
  for (const section of document.querySelectorAll("body > section")) {
    section.hidden = section.id !== id;
  }
}

function openOverlay(options, onPick) {
  const overlay = $("#overlay");
  overlay.replaceChildren();
  for (const label of options) {
    const option = document.createElement("mat-option");
    option.textContent = label;
    option.addEventListener("click", () => {
      overlay.replaceChildren();
      onPick(label);
    });
    overlay.append(option);
  }
}

for (const select of document.querySelectorAll("mat-select")) {
  select.addEventListener("click", () => {
    openOverlay(select.dataset.options.split("|"), (label) => {
      select.textContent = label;
      form[select.getAttribute("formcontrolname")] = label;
    });
  });
}

for (const input of document.querySelectorAll("input[data-options]")) {
  input.addEventListener("input", () => {
    const typed = input.value.toLowerCase();
    const matches = input.dataset.options.split("|").filter((label) => label.toLowerCase().includes(typed));
    openOverlay(matches, (label) => {
      const pattern = input.dataset.valuePattern;
      input.value = pattern ? label.match(new RegExp(pattern))[0] : label;
    });
  });
}

for (const header of document.querySelectorAll("mat-expansion-panel-header")) {
  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    header.nextElementSibling.hidden = expanded;
  });
}

function collect(panel) {
  for (const input of panel.querySelectorAll("input")) {
    form[input.getAttribute("formcontrolname")] = input.value;
  }
}

function fail(panel, message) {
  let error = $("mat-error", panel);
  if (!error) {
    error = document.createElement("mat-error");
    $(".body", panel).prepend(error);
  }
  error.textContent = message;
}

for (const panel of document.querySelectorAll("mat-expansion-panel")) {
  $("button.submit", panel).addEventListener("click", () => {
    collect(panel);
    const empty = [...panel.querySelectorAll("input:not([formcontrolname='expiryDate'])")].some((input) => input.value === "");
    if (empty) {
      fail(panel, "Completa los campos obligatorios");
      return;
    }
    if (panel.dataset.panel === "document" && reservation === "BADDOC") {
      fail(panel, "El número de documento no es válido");
      return;
    }
    $("mat-error", panel)?.remove();
    $("mat-expansion-panel-header", panel).click();
    saved.add(panel.dataset.panel);
    if (saved.size === 3) {
      setTimeout(() => {
        $("#seats").hidden = false;
      }, 300);
    }
  });
}

function boardingPass() {
  if (reservation === "SLOW01") {
    return;
  }
  $("#pax").textContent = `${form.documentName ?? ""} ${form.documentSurname ?? ""}`.trim() || reservation;
  show("pass");
  fetch("/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reservation, ...form }),
  });
}

$("button.button-submit").addEventListener("click", () => {
  reservation = $("input[formcontrolname='reservationNumber']").value;
  form.lastNames = $("input[formcontrolname='lastNames']").value;
  const banner = $(".error-message");
  setTimeout(() => {
    if (reservation === "NOEXIST") {
      banner.textContent = "No encontramos una reserva con esos datos.";
      banner.hidden = false;
      return;
    }
    show("trips");
    const done = reservation === "DONE01";
    $("#trip-status").textContent = done ? "Check-in realizado" : "Check-in disponible";
    $("#start").hidden = done;
    $("#view").hidden = !done;
  }, 200);
});

$("#start").addEventListener("click", () => show("contact"));
$("#view").addEventListener("click", boardingPass);
$("#continue").addEventListener("click", () => {
  form.email = $("input[formcontrolname='email']").value;
  form.phone = $(".phone-number-input").value;
  show("baggage");
});
$("#accept").addEventListener("click", () => show("details"));
$("#seats button").addEventListener("click", () => {
  $("#seats").hidden = true;
  boardingPass();
});

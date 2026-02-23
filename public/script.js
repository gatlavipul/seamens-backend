const SHIRT_FIELDS = [
  "Shoulder",
  "Chest / Bust",
  "Waist",
  "Hip",
  "Sleeve Length",
  "Armhole (Round)",
  "Neck",
  "Shirt / Top Length",
];

const PANT_FIELDS = [
  "Waist (Pant Waist)",
  "Hip",
  "Inseam (Inner Leg Length)",
  "Outseam (Full Pant Length)",
  "Thigh",
  "Knee",
  "Ankle / Bottom Opening",
];

const SUIT_FIELDS = [...SHIRT_FIELDS, ...PANT_FIELDS, "Coat Length (Optional)"];

let currentType = "shirt";
let lastSavedReceipt = null;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toFieldId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function createMeasurementFields(containerId, fields, prefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = fields
    .map((field) => {
      const id = `${prefix}_${toFieldId(field)}`;
      return `
        <label>
          ${field}
          <input type="text" data-measure="${prefix}" data-label="${field}" id="${id}" placeholder="Enter ${field}">
        </label>
      `;
    })
    .join("");
}

function setStatus(message, isError) {
  const status = document.getElementById("statusText");
  status.textContent = message || "";
  status.classList.toggle("error", !!isError);
}

function setTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
  document.getElementById(tabId).classList.add("active");
  document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add("active");
}

function setMeasurementType(type) {
  currentType = type;
  document.querySelectorAll(".type-btn").forEach((btn) => btn.classList.remove("active"));
  document.querySelector(`.type-btn[data-type="${type}"]`).classList.add("active");
  document.querySelectorAll(".measurement-fields").forEach((box) => box.classList.remove("active"));
  document.getElementById(`${type}Fields`).classList.add("active");
}

function addBillingRow(prefill = {}) {
  const body = document.getElementById("billingBody");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td class="serial"></td>
    <td>
      <select class="item-type">
        <option value="Shirt">Shirt</option>
        <option value="Pant">Pant</option>
        <option value="Suit">Suit</option>
      </select>
    </td>
    <td><input type="text" class="item-description" placeholder="Description"></td>
    <td><input type="number" class="item-amount" min="0" step="0.01" value="${prefill.amount || 0}"></td>
    <td><button class="danger-btn" type="button">Remove</button></td>
  `;

  row.querySelector(".item-type").value = prefill.type || "Shirt";
  row.querySelector(".item-description").value = prefill.description || "";
  row.querySelector(".danger-btn").addEventListener("click", () => {
    row.remove();
    recalculateRows();
  });
  row.querySelector(".item-amount").addEventListener("input", recalculateRows);

  body.appendChild(row);
  recalculateRows();
}

function recalculateRows() {
  let total = 0;
  document.querySelectorAll("#billingBody tr").forEach((row, idx) => {
    row.querySelector(".serial").textContent = String(idx + 1);
    total += Number(row.querySelector(".item-amount").value || 0);
  });

  const advance = Number(document.getElementById("advancePaid").value || 0);
  document.getElementById("totalAmount").value = money(total);
  document.getElementById("balanceAmount").value = money(total - advance);
}

function collectMeasurements(type) {
  const result = {};
  document.querySelectorAll(`input[data-measure="${type}"]`).forEach((input) => {
    const label = input.dataset.label || input.id;
    result[label] = input.value.trim();
  });
  return result;
}

function collectItems() {
  return Array.from(document.querySelectorAll("#billingBody tr"))
    .map((row) => ({
      type: row.querySelector(".item-type").value,
      description: row.querySelector(".item-description").value.trim(),
      amount: Number(row.querySelector(".item-amount").value || 0),
    }))
    .filter((item) => item.description);
}

function validateForm(payload) {
  if (!payload.customerName) return "Customer name is required.";
  if (!payload.phone) return "Phone number is required.";
  if (!payload.deliveryDate) return "Delivery date is required.";
  if (payload.items.length === 0) return "Add at least one billing item.";
  return "";
}

async function loadNextReceipt() {
  const res = await fetch("/api/next-receipt-number");
  if (!res.ok) throw new Error("Failed to load next receipt number");
  const data = await res.json();
  document.getElementById("receiptNo").value = data.receiptNo;
}

async function saveReceipt() {
  setStatus("");
  const payload = {
    customerName: document.getElementById("customerName").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    date: document.getElementById("orderDate").value,
    deliveryDate: document.getElementById("deliveryDate").value,
    totalAmount: Number(document.getElementById("totalAmount").value || 0),
    advancePaid: Number(document.getElementById("advancePaid").value || 0),
    measurementType: currentType,
    measurements: collectMeasurements(currentType),
    items: collectItems(),
  };

  const validationMsg = validateForm(payload);
  if (validationMsg) {
    setStatus(validationMsg, true);
    return;
  }

  const res = await fetch("/api/receipts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to save receipt");
  }

  lastSavedReceipt = data;
  document.getElementById("printCurrentBtn").disabled = false;
  setStatus(`Receipt ${data.receiptNo} saved successfully.`);
  await loadNextReceipt();
  await searchHistory();
}

function formatMeasurements(measurements) {
  const rows = Object.entries(measurements || {}).filter((entry) => entry[1]);
  if (rows.length === 0) {
    return "<p>No measurements entered.</p>";
  }
  return `
    <table class="print-table">
      <thead><tr><th>Measurement</th><th>Value</th></tr></thead>
      <tbody>
        ${rows.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderPrint(receipt) {
  const printArea = document.getElementById("printArea");
  const itemsHtml = (receipt.items || [])
    .map(
      (item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(item.item_type || item.type || "")}</td>
        <td>${escapeHtml(item.description || "")}</td>
        <td>${money(item.amount)}</td>
      </tr>`
    )
    .join("");

  printArea.innerHTML = `
    <section class="print-page">
      <h2>Seamens Tailor & Textile</h2>
      <div class="print-meta">
        <p><strong>Receipt No:</strong> ${escapeHtml(receipt.receiptNo)}</p>
        <p><strong>Date:</strong> ${escapeHtml(receipt.date)}</p>
        <p><strong>Customer:</strong> ${escapeHtml(receipt.customerName)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(receipt.phone)}</p>
        <p><strong>Delivery Date:</strong> ${escapeHtml(receipt.deliveryDate)}</p>
      </div>
      <table class="print-table">
        <thead>
          <tr><th>S.No</th><th>Type</th><th>Description</th><th>Amount</th></tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div class="print-amounts">
        <p><strong>Total Amount:</strong> ${money(receipt.totalAmount)}</p>
        <p><strong>Advance Paid:</strong> ${money(receipt.advancePaid)}</p>
        <p><strong>Balance Amount:</strong> ${money(receipt.balanceAmount)}</p>
      </div>
      <p class="signature">Signature: _____________________</p>
    </section>

    <section class="print-page">
      <h2>Measurement Details</h2>
      <div class="print-meta">
        <p><strong>Receipt No:</strong> ${escapeHtml(receipt.receiptNo)}</p>
        <p><strong>Customer:</strong> ${escapeHtml(receipt.customerName)}</p>
        <p><strong>Delivery Date:</strong> ${escapeHtml(receipt.deliveryDate)}</p>
        <p><strong>Type:</strong> ${escapeHtml((receipt.measurementType || "").toUpperCase())}</p>
      </div>
      ${formatMeasurements(receipt.measurements)}
    </section>
  `;
}

function printReceipt(receipt) {
  renderPrint(receipt);
  window.print();
}

function historyCard(row) {
  const card = document.createElement("div");
  card.className = "history-card";
  card.innerHTML = `
    <p><strong>Receipt:</strong> ${escapeHtml(row.receiptNo)}</p>
    <p><strong>Name:</strong> ${escapeHtml(row.customerName)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(row.phone)}</p>
    <p><strong>Date:</strong> ${escapeHtml(row.date)}</p>
    <p><strong>Delivery:</strong> ${escapeHtml(row.deliveryDate)}</p>
    <p><strong>Total:</strong> ${money(row.totalAmount)} | <strong>Advance:</strong> ${money(row.advancePaid)} | <strong>Balance:</strong> ${money(row.balanceAmount)}</p>
    <button class="secondary-btn" type="button">View & Print</button>
  `;
  card.querySelector("button").addEventListener("click", async () => {
    const res = await fetch(`/api/receipts/${row.id}`);
    if (!res.ok) {
      setStatus("Failed to load receipt details.", true);
      return;
    }
    const receipt = await res.json();
    printReceipt(receipt);
  });
  return card;
}

async function searchHistory() {
  const q = document.getElementById("searchQuery").value.trim();
  const date = document.getElementById("searchDate").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (date) params.set("date", date);

  const res = await fetch(`/api/receipts?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Failed to load history");
  }
  const data = await res.json();
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  if (data.length === 0) {
    list.innerHTML = "<p>No records found.</p>";
    return;
  }
  data.forEach((row) => list.appendChild(historyCard(row)));
}

function clearForm() {
  document.getElementById("customerName").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("deliveryDate").value = "";
  document.getElementById("advancePaid").value = "0";
  document.getElementById("billingBody").innerHTML = "";
  addBillingRow();
  recalculateRows();
  document.querySelectorAll('.measurement-fields input').forEach((i) => {
    i.value = "";
  });
  setMeasurementType("shirt");
}

function init() {
  document.getElementById("orderDate").value = today();

  createMeasurementFields("shirtFields", SHIRT_FIELDS, "shirt");
  createMeasurementFields("pantFields", PANT_FIELDS, "pant");
  createMeasurementFields("suitFields", SUIT_FIELDS, "suit");

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });
  document.querySelectorAll(".type-btn").forEach((btn) => {
    btn.addEventListener("click", () => setMeasurementType(btn.dataset.type));
  });

  document.getElementById("addItemBtn").addEventListener("click", () => addBillingRow());
  document.getElementById("advancePaid").addEventListener("input", recalculateRows);
  document.getElementById("saveReceiptBtn").addEventListener("click", async () => {
    try {
      await saveReceipt();
      clearForm();
    } catch (err) {
      setStatus(err.message || "Save failed.", true);
    }
  });

  document.getElementById("printCurrentBtn").addEventListener("click", () => {
    if (lastSavedReceipt) {
      printReceipt(lastSavedReceipt);
    }
  });

  document.getElementById("searchBtn").addEventListener("click", async () => {
    try {
      await searchHistory();
    } catch (err) {
      setStatus(err.message || "Search failed.", true);
    }
  });

  document.getElementById("clearSearchBtn").addEventListener("click", async () => {
    document.getElementById("searchQuery").value = "";
    document.getElementById("searchDate").value = "";
    try {
      await searchHistory();
    } catch (err) {
      setStatus(err.message || "Search failed.", true);
    }
  });

  addBillingRow();
  loadNextReceipt().catch(() => setStatus("Could not load next receipt number.", true));
  searchHistory().catch(() => setStatus("Could not load history.", true));
}

init();

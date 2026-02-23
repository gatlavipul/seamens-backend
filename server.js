const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

const db = new sqlite3.Database("./database.db");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

function toReceiptNo(num) {
  const safe = Number.isFinite(num) ? num : 1;
  return String(Math.max(1, Math.floor(safe))).padStart(4, "0");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT UNIQUE NOT NULL,
      order_date TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      delivery_date TEXT NOT NULL,
      total_amount REAL NOT NULL,
      advance_paid REAL NOT NULL,
      balance_amount REAL NOT NULL,
      measurement_type TEXT NOT NULL,
      measurements_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL,
      line_no INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY(receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
    )
  `);

  await run(`CREATE INDEX IF NOT EXISTS idx_receipts_receipt_no ON receipts(receipt_no)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_receipts_customer_name ON receipts(customer_name)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_receipts_phone ON receipts(phone)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_receipts_delivery_date ON receipts(delivery_date)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_items_receipt_id ON receipt_items(receipt_id)`);
}

async function getNextReceiptNumber() {
  const row = await get(`SELECT receipt_no FROM receipts ORDER BY CAST(receipt_no AS INTEGER) DESC LIMIT 1`);
  if (!row || !row.receipt_no) {
    return "0001";
  }
  return toReceiptNo(Number(row.receipt_no) + 1);
}

async function getReceiptWithItemsById(id) {
  const receipt = await get(`SELECT * FROM receipts WHERE id = ?`, [id]);
  if (!receipt) {
    return null;
  }
  const items = await all(
    `SELECT line_no, item_type, description, amount
     FROM receipt_items
     WHERE receipt_id = ?
     ORDER BY line_no ASC`,
    [id]
  );
  return {
    id: receipt.id,
    receiptNo: receipt.receipt_no,
    date: receipt.order_date,
    customerName: receipt.customer_name,
    phone: receipt.phone,
    deliveryDate: receipt.delivery_date,
    totalAmount: receipt.total_amount,
    advancePaid: receipt.advance_paid,
    balanceAmount: receipt.balance_amount,
    measurementType: receipt.measurement_type,
    measurements: JSON.parse(receipt.measurements_json || "{}"),
    items,
    createdAt: receipt.created_at,
  };
}

app.get("/api/next-receipt-number", async (req, res) => {
  try {
    const next = await getNextReceiptNumber();
    res.json({ receiptNo: next });
  } catch (err) {
    res.status(500).json({ error: "Failed to generate receipt number" });
  }
});

app.post("/api/receipts", async (req, res) => {
  try {
    const payload = req.body || {};

    const customerName = normalizeText(payload.customerName);
    const phone = normalizeText(payload.phone);
    const date = normalizeText(payload.date);
    const deliveryDate = normalizeText(payload.deliveryDate);
    const measurementType = normalizeText(payload.measurementType).toLowerCase();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const measurements = payload.measurements && typeof payload.measurements === "object" ? payload.measurements : {};

    if (!customerName || !phone || !date || !deliveryDate) {
      res.status(400).json({ error: "Customer name, phone, date and delivery date are required" });
      return;
    }
    if (!["shirt", "pant", "suit"].includes(measurementType)) {
      res.status(400).json({ error: "Measurement type must be Shirt, Pant or Suit" });
      return;
    }
    if (items.length === 0) {
      res.status(400).json({ error: "At least one billing item is required" });
      return;
    }

    const normalizedItems = items.map((item, index) => ({
      lineNo: index + 1,
      type: normalizeText(item.type),
      description: normalizeText(item.description),
      amount: normalizeNumber(item.amount),
    })).filter((item) => item.type && item.description);

    if (normalizedItems.length === 0) {
      res.status(400).json({ error: "Billing items must include type and description" });
      return;
    }

    const totalFromItems = normalizedItems.reduce((sum, item) => sum + item.amount, 0);
    const totalAmount = normalizeNumber(payload.totalAmount || totalFromItems);
    const advancePaid = normalizeNumber(payload.advancePaid);
    const balanceAmount = totalAmount - advancePaid;

    await run("BEGIN TRANSACTION");
    try {
      const receiptNo = await getNextReceiptNumber();
      const insert = await run(
        `INSERT INTO receipts (
          receipt_no, order_date, customer_name, phone, delivery_date,
          total_amount, advance_paid, balance_amount, measurement_type, measurements_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptNo,
          date,
          customerName,
          phone,
          deliveryDate,
          totalAmount,
          advancePaid,
          balanceAmount,
          measurementType,
          JSON.stringify(measurements),
        ]
      );

      for (const item of normalizedItems) {
        await run(
          `INSERT INTO receipt_items (receipt_id, line_no, item_type, description, amount)
           VALUES (?, ?, ?, ?, ?)`,
          [insert.id, item.lineNo, item.type, item.description, item.amount]
        );
      }
      await run("COMMIT");

      const result = await getReceiptWithItemsById(insert.id);
      res.status(201).json(result);
    } catch (innerErr) {
      await run("ROLLBACK");
      throw innerErr;
    }
  } catch (err) {
    if (String(err.message || "").includes("UNIQUE constraint failed: receipts.receipt_no")) {
      res.status(409).json({ error: "Receipt number collision. Please retry." });
      return;
    }
    res.status(500).json({ error: "Failed to save receipt" });
  }
});

app.get("/api/receipts", async (req, res) => {
  try {
    const q = normalizeText(req.query.q || "").toLowerCase();
    const date = normalizeText(req.query.date || "");
    const params = [];
    const where = [];

    if (q) {
      where.push(`(
        LOWER(customer_name) LIKE ? OR
        phone LIKE ? OR
        receipt_no LIKE ?
      )`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (date) {
      where.push("(delivery_date = ? OR order_date = ?)");
      params.push(date, date);
    }

    const rows = await all(
      `SELECT id, receipt_no, order_date, customer_name, phone, delivery_date, total_amount, advance_paid, balance_amount
       FROM receipts
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY id DESC
       LIMIT 300`,
      params
    );

    res.json(
      rows.map((row) => ({
        id: row.id,
        receiptNo: row.receipt_no,
        date: row.order_date,
        customerName: row.customer_name,
        phone: row.phone,
        deliveryDate: row.delivery_date,
        totalAmount: row.total_amount,
        advancePaid: row.advance_paid,
        balanceAmount: row.balance_amount,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to load receipts" });
  }
});

app.get("/api/receipts/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid receipt ID" });
      return;
    }

    const receipt = await getReceiptWithItemsById(id);
    if (!receipt) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }
    res.json(receipt);
  } catch (err) {
    res.status(500).json({ error: "Failed to load receipt details" });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database init failed", err);
    process.exit(1);
  });

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const db = new sqlite3.Database("./database.db");

// Create table if not exists
db.run(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE,
  name TEXT,
  phone TEXT,
  delivery_date TEXT,
  total REAL,
  advance REAL,
  balance REAL
)
`);

// Save customer
app.post("/add-customer", (req, res) => {
  const { receipt_no, name, phone, delivery_date, total, advance, balance } = req.body;

  db.run(
    `INSERT INTO customers (receipt_no, name, phone, delivery_date, total, advance, balance)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [receipt_no, name, phone, delivery_date, total, advance, balance],
    function (err) {
      if (err) {
        return res.status(500).send("Error saving data");
      }
      res.send("Saved Successfully");
    }
  );
});

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on port 3000");
});
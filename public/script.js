function saveData() {
  const total = Number(document.getElementById("total").value);
  const advance = Number(document.getElementById("advance").value);

  const data = {
    receipt_no: document.getElementById("receipt").value,
    name: document.getElementById("name").value,
    phone: document.getElementById("phone").value,
    delivery_date: document.getElementById("delivery").value,
    total: total,
    advance: advance,
    balance: total - advance
  };

  fetch("/add-customer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  })
  .then(res => res.text())
  .then(msg => alert(msg));
}
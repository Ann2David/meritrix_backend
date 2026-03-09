require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= PAYMENT VERIFICATION ================= */

async function verifyPaystack(reference) {
  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  return response.data.data.status === "success";
}

async function verifyFlutterwave(transaction_id) {
  const response = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
    headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
  });
  return response.data.data.status === "successful";
}

/* ================= ROUTES ================= */

app.post("/verify-payment", async (req, res) => {
  console.log("--- Payment Verification Request ---");
  try {
    const { paymentProvider, reference, transaction_id, name, email, startTime, endTime } = req.body;
    let paymentVerified = false;

    // 1. Verify Payment
    if (paymentProvider === "paystack") {
      paymentVerified = await verifyPaystack(reference);
    } else if (paymentProvider === "flutterwave") {
      paymentVerified = await verifyFlutterwave(transaction_id);
    }

    if (!paymentVerified) {
      console.log("❌ Payment not verified.");
      return res.status(400).json({ message: "Payment not verified" });
    }

    // 2. Trigger Make.com Webhook
    console.log("--- Sending Data to Make.com ---");
    try {
      await axios.post(process.env.MAKE_WEBHOOK_URL, {
        customer_name: name,
        customer_email: email,
        start_time: startTime, // ISO format from frontend
        end_time: endTime,     // ISO format from frontend
        payment_method: paymentProvider,
        transaction_ref: reference || transaction_id,
        amount: (paymentProvider === "paystack") ? "Verified" : "Successful" 
      });
      console.log("✅ Make.com Scenario Triggered.");
    } catch (makeError) {
      console.error("⚠️ Make.com Webhook Error:", makeError.message);
    }

    // 3. Final Response
    return res.status(200).json({ message: "Success" });

  } catch (error) {
    console.error("🚨 SYSTEM ERROR:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

// TEST ROUTE for Make.com
app.get("/test-make", async (req, res) => {
    try {
        await axios.post(process.env.MAKE_WEBHOOK_URL, {
            customer_name: "Test Admin",
            customer_email: "annapauladav@gmail.com",
            start_time: new Date().toISOString(),
            end_time: new Date(Date.now() + 3600000).toISOString(),
            payment_method: "test",
            transaction_ref: "TEST-REF-123"
        });
        res.json({ message: "Test sent! Check your Make.com scenario." });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
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

    // 2. Trigger Zapier (The "All-in-One" Step)
    // This replaces Google Calendar and AhaSend code
    console.log("--- Sending Data to Zapier ---");
    try {
      await axios.post(process.env.ZAPIER_WEBHOOK_URL, {
        customer_name: name,
        customer_email: email,
        start_time: startTime,
        end_time: endTime,
        provider: paymentProvider,
        ref: reference || transaction_id
      });
      console.log("✅ Zapier received the booking data.");
    } catch (zapierError) {
      // We log the error but still tell the user "Success" because the money was paid
      console.error("⚠️ Zapier Connection Issue:", zapierError.message);
    }

    // 3. Final Response to Frontend
    return res.status(200).json({ 
        message: "Booking process completed successfully",
        status: "success" 
    });

  } catch (error) {
    console.error("🚨 SYSTEM ERROR:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= HELPERS ================= */

async function sendEmails(name, email, startTime) {
  try {
    // 1. Send Confirmation to Client
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Booking Confirmed | Meritrix Global',
      html: `<strong>Hi ${name},</strong><p>Your session for ${startTime} is confirmed. We look forward to meeting you!</p>`
    });

    // 2. Send Alert to Admin
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `🚨 New Booking: ${name}`,
      html: `<p>New booking received from ${name} (${email}) for ${startTime}.</p>`
    });

    console.log("✅ Resend: Both emails sent successfully.");
  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

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
  const { paymentProvider, reference, transaction_id, name, email, startTime } = req.body;

  try {
    let paymentVerified = false;

    // Payment Verification Logic
    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    }

    if (paymentVerified) {
      console.log(`✅ Payment Verified for ${name}`);
      
      // Trigger Emails Directly
      await sendEmails(name, email, startTime);
      
      return res.status(200).json({ message: "Payment verified and emails sent." });
    } else {
      return res.status(400).json({ message: "Payment verification failed." });
    }
  } catch (error) {
    console.error("🚨 System Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

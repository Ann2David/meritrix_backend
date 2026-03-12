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
async function sendEmails(name, email, duration) {
  try {
    const finalDuration = duration || "Consultation"; 
    // Since they already picked their time, we change the wording from "Schedule" to "Confirmation"
    
    // 1. CLIENT RECEIPT (Premium Dark Mode)
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Booking Confirmed | Meritrix Global',
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 20px;">
            <h1 style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #888;">Meritrix Global</h1>
            <h2 style="font-size: 24px; margin: 20px 0;">Payment Verified.</h2>
            <p style="color: #ccc; line-height: 1.6;">Hello ${name}, your <strong>${finalDuration}-minute</strong> session has been successfully booked.</p>
            <p style="color: #ccc; line-height: 1.6;">Since you've already selected your slot, please check your inbox for a separate calendar invite containing the Google Meet link.</p>
            <div style="margin-top: 30px; padding: 20px; border-top: 1px solid #222;">
               <p style="font-size: 12px; color: #666;">If you need to reschedule, please refer to the link in the original Calendly email.</p>
            </div>
          </div>
        </div>
      `
    });

    // 2. ADMIN ALERT (To your Gmail)
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `💰 Payment Success: ${name}`,
      html: `<p><strong>${name}</strong> has just paid for a <strong>${finalDuration} min</strong> session via the website.</p>`
    });

    console.log(`✅ Confirmation sent to ${email}`);
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
  const { paymentProvider, reference, transaction_id, name, email, duration } = req.body;

  try {
    let paymentVerified = false;

    // PAYSTACK CHECK
    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    } 
    // FLUTTERWAVE CHECK
    else if (paymentProvider === "flutterwave") {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "successful";
    }

    if (paymentVerified) {
      const finalDuration = duration || "60"; 
      
      // Trigger emails
      await sendEmails(name, email, finalDuration);
      
      return res.status(200).json({ 
        success: true,
        message: "Payment verified." 
      });

    } else {
      return res.status(400).json({ success: false, message: "Verification failed." });
    }
  } catch (error) {
    console.error("🚨 System Error:", error.response?.data || error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Add this temporarily to server.js
app.get("/test-resend", async (req, res) => {
  try {
    await sendEmails(
      "Test User", 
      "meritrixconsult@gmail.com", // Change this to your personal email to see the client view
      "Monday, March 10th @ 4:00 PM"
    );
    res.send("Test emails sent! Check your inbox.");
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});

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
  // 1. Create a meeting in Google Calendar for a future date (e.g., 2027) 
  // 2. Copy the "meet.google.com/xxx-xxxx-xxx" link and paste it here:
  const permanentMeetLink = "https://meet.google.com/hhf-sjns-gwy"; 

  try {
    const finalDuration = duration || "60"; 

    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Payment Confirmed | Your Meeting Link',
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 24px; border-bottom: 4px solid #ff8811;">
            <h1 style="font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #888; margin-bottom: 20px;">Meritrix Global</h1>
            <h2 style="font-size: 26px; font-weight: 600; margin-bottom: 20px;">Booking Confirmed</h2>
            
            <p style="color: #ccc; font-size: 16px; line-height: 1.6;">Hello ${name}, your <strong>${finalDuration}-minute session</strong> is verified.</p>
            
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 30px; margin: 30px 0; border: 1px solid #333;">
               <p style="margin: 0 0 15px; color: #fff; font-weight: 600; font-size: 16px;">Your Google Meet Link</p>
               <a href="${permanentMeetLink}" style="background-color: #ff8811; color: #000; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">Join Meeting Room</a>
               <p style="margin: 15px 0 0; color: #666; font-size: 12px;">Link: ${permanentMeetLink}</p>
            </div>

            <p style="font-size: 13px; color: #666; line-height: 1.5;">Please check your calendar for the automatic invite. A reminder will be sent to you 24 hours before we begin.</p>
          </div>
        </div>
      `
    });
    // ... admin notification logic remains the same
 

    // 2. ADMIN NOTIFICATION
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `💰 Payment Verified: ${name}`,
      html: `<p>Payment of <strong>${finalDuration} mins</strong> confirmed for <strong>${name}</strong> (${email}). Meeting link has been dispatched via Calendly.</p>`
    });

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

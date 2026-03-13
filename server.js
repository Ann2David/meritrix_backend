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
  // Use your permanent Google Meet link as a backup/direct access
  const permanentMeetLink = "https://meet.google.com/hhf-sjns-gwy"; 
  const isOneHour = duration === "60" || duration === 60;

  try {
    // 1. CLIENT CONFIRMATION EMAIL (The Luxury Black Receipt)
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Booking Confirmed | Meritrix Global',
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 24px; border-bottom: 4px solid #ff8811;">
            <h1 style="font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #888; margin-bottom: 20px;">Meritrix Global</h1>
            <h2 style="font-size: 26px; font-weight: 600; margin-bottom: 20px;">Payment Verified</h2>
            
            <p style="color: #ccc; font-size: 16px; line-height: 1.6;">Hello ${name}, your <strong>${duration}-minute session</strong> is now fully secured.</p>
            
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 30px; margin: 30px 0; border: 1px solid #333;">
               <p style="margin: 0 0 15px; color: #fff; font-weight: 600; font-size: 16px;">Access Your Meeting Room</p>
               <a href="${permanentMeetLink}" style="background-color: #ff8811; color: #000; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">JOIN GOOGLE MEET</a>
            </div>

            ${isOneHour ? `
            <div style="background: #222; padding: 15px; border-radius: 10px; border-left: 4px solid #ff8811; margin-bottom: 20px; text-align: left;">
                <p style="margin: 0; color: #ff8811; font-weight: bold; font-size: 14px;">NOTE FOR 1-HOUR SESSION:</p>
                <p style="margin: 5px 0 0; color: #aaa; font-size: 12px;">Your calendar invite may initially show 30 minutes. Don't worry—your full 1-hour deep dive is confirmed on our end.</p>
            </div>
            ` : ''}

            <p style="font-size: 13px; color: #666; line-height: 1.5;">You will receive an automatic Google Calendar invite shortly. A reminder will be sent 24 hours before we begin.</p>
          </div>
        </div>
      `
    });

    // 2. ADMIN NOTIFICATION (So you know to check the calendar)
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `💰 Payment Verified: ${name} (${duration} mins)`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h3>New Confirmed Booking</h3>
          <p><strong>Client:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Duration:</strong> ${duration} Minutes</p>
          <p><strong>Action Required:</strong> ${isOneHour ? "⚠️ Please open Google Calendar and extend this 30-min booking to 1 hour." : "None (Standard 30-min slot)."}</p>
        </div>
      `
    });

  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

/* ... verification functions (verifyPaystack, verifyFlutterwave) stay exactly the same ... */

/* ================= ROUTES ================= */
app.post("/verify-payment", async (req, res) => {
  const { paymentProvider, reference, transaction_id, name, email, duration } = req.body;

  try {
    let paymentVerified = false;

    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    } 
    else if (paymentProvider === "flutterwave") {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "successful";
    }

    if (paymentVerified) {
      // Trigger emails with the duration passed from frontend
      await sendEmails(name, email, duration);
      
      return res.status(200).json({ 
        success: true,
        message: "Payment verified and emails sent." 
      });

    } else {
      return res.status(400).json({ success: false, message: "Verification failed." });
    }
  } catch (error) {
    console.error("🚨 System Error:", error.response?.data || error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
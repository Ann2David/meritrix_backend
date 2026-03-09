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
    const mainColor = "#000000"; 
    const accentColor = "#6366f1"; 

    // 1. CLIENT CONFIRMATION (Luxury Minimalist)
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Booking Confirmed | Meritrix Global',
      html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff; padding: 40px 0; color: #111111;">
          <div style="max-width: 550px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 24px; overflow: hidden;">
            <div style="padding: 40px; text-align: center; border-bottom: 1px solid #f3f4f6;">
               <h1 style="font-size: 14px; letter-spacing: 4px; text-transform: uppercase; margin: 0; color: #6b7280;">Meritrix Global</h1>
            </div>
            
            <div style="padding: 40px;">
              <h2 style="font-size: 28px; font-weight: 600; margin-bottom: 24px; letter-spacing: -1px;">Your session is confirmed.</h2>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Hello ${name}, your strategy consultation is officially on the calendar. We look forward to our session.</p>
              
              <div style="background-color: #000000; border-radius: 16px; padding: 32px; margin: 32px 0; color: #ffffff; text-align: center;">
                <p style="margin: 0; font-size: 12px; text-transform: uppercase; opacity: 0.6; letter-spacing: 1px;">Selected Date & Time</p>
                <p style="margin: 12px 0 0; font-size: 20px; font-weight: 500;">${startTime}</p>
              </div>

              <div style="text-align: center;">
                <a href="https://meet.google.com/your-default-link" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 18px 36px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 15px;">Join Strategy Session</a>
              </div>
            </div>

            <div style="padding: 30px; background-color: #fafafa; text-align: center;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">&copy; 2026 Meritrix Global Strategy Studio</p>
            </div>
          </div>
        </div>
      `
    });

    // 2. ADMIN NOTIFICATION (Functional & Sharp)
    await resend.emails.send({
      from: 'Meritrix System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `🚨 New Booking: ${name}`,
      html: `
        <div style="font-family: 'Inter', sans-serif; background-color: #f3f4f6; padding: 30px;">
          <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; border: 1px solid #d1d5db;">
            <h3 style="margin-top: 0; color: #111827; font-size: 18px;">New Lead Acquired</h3>
            <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
            
            <table style="width: 100%; font-size: 14px; line-height: 2;">
              <tr>
                <td style="color: #6b7280; width: 100px;">Client:</td>
                <td style="font-weight: 600; color: #111827;">${name}</td>
              </tr>
              <tr>
                <td style="color: #6b7280;">Email:</td>
                <td><a href="mailto:${email}" style="color: ${accentColor};">${email}</a></td>
              </tr>
              <tr>
                <td style="color: #6b7280;">Time:</td>
                <td style="font-weight: 600; color: #111827;">${startTime}</td>
              </tr>
            </table>

            <div style="margin-top: 25px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
              This booking has been verified via Paystack and synced to your Google Calendar.
            </div>
          </div>
        </div>
      `
    });

    console.log(`✅ Success: Confirmation sent to ${email} and Admin alert sent.`);
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

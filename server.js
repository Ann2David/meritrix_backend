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
    const mainColor = "#000000";
    
    // Define your Calendly links here
    const calendlyLink = duration === "60" 
      ? "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation" 
      : "https://calendly.com/meritrixconsult/30min";

    // 1. CLIENT CONFIRMATION (The Bridge to Calendly)
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Payment Received | Next Step: Schedule Your Session',
      html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff; padding: 40px 0; color: #111111;">
          <div style="max-width: 550px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 24px; overflow: hidden;">
            <div style="padding: 40px; text-align: center; border-bottom: 1px solid #f3f4f6;">
               <h1 style="font-size: 14px; letter-spacing: 4px; text-transform: uppercase; margin: 0; color: #6b7280;">Meritrix Global</h1>
            </div>
            
            <div style="padding: 40px;">
              <h2 style="font-size: 28px; font-weight: 600; margin-bottom: 24px; letter-spacing: -1px;">Payment Confirmed.</h2>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">Hello ${name}, thank you for booking a <strong>${duration}-minute</strong> strategy consultation.</p>
              <p style="font-size: 16px; line-height: 1.6; color: #4b5563;">To finalize your booking, please click the button below to select a date and time that works best for you.</p>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${calendlyLink}" style="display: inline-block; background-color: #000000; color: #ffffff; padding: 20px 40px; border-radius: 12px; text-decoration: none; font-weight: 600; font-size: 16px;">Schedule Your Session</a>
              </div>

              <p style="font-size: 13px; color: #9ca3af; text-align: center;">Once scheduled, you will receive a Google Meet invite automatically.</p>
            </div>

            <div style="padding: 30px; background-color: #fafafa; text-align: center;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">&copy; 2026 Meritrix Global Strategy Studio</p>
            </div>
          </div>
        </div>
      `
    });

    // 2. ADMIN NOTIFICATION (Keep you updated on the money)
    await resend.emails.send({
      from: 'Meritrix System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `💰 New Payment: ${name} (${duration} mins)`,
      html: `
        <div style="font-family: sans-serif; background-color: #f3f4f6; padding: 30px;">
          <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; border: 1px solid #d1d5db;">
            <h3 style="margin-top: 0; color: #111827;">Payment Verified</h3>
            <p><strong>Client:</strong> ${name}</p>
            <p><strong>Package:</strong> ${duration} Minute Session</p>
            <p><strong>Next Step:</strong> Client has been sent the link to book their time on Calendly.</p>
          </div>
        </div>
      `
    });

    console.log(`✅ Success: Payment confirmation sent to ${email}`);
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
  // We swapped startTime for duration
  const { paymentProvider, reference, transaction_id, name, email, duration } = req.body;

  try {
    let paymentVerified = false;

    // 1. Paystack Verification
    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    } 
    // 2. Flutterwave Verification
    else if (paymentProvider === "flutterwave") {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "successful";
    }

    if (paymentVerified) {
      console.log(`✅ Payment Verified for ${name} (${duration} mins)`);
      
      // Pass the duration to your updated sendEmails function
      await sendEmails(name, email, duration);
      
      return res.status(200).json({ 
        message: "Payment verified and booking email sent.",
        // Optional: Send the link back to the frontend for an immediate redirect
        calendlyUrl: duration === "60" ? "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation" : "https://calendly.com/meritrixconsult/30min"
      });
    } else {
      console.log(`❌ Verification failed for ${name}`);
      return res.status(400).json({ message: "Payment verification failed." });
    }
  } catch (error) {
    // Detailed error logging to help you catch 401s or API issues
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

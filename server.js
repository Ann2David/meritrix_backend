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
    // Fallback logic to prevent "undefined"
    const finalDuration = duration || "Strategy"; 
    const calendlyLink = duration === "60" 
      ? "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation" 
      : "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation";

    // 1. CLIENT CONFIRMATION (High-Contrast for Mobile Visibility)
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Payment Received | Schedule Your Meritrix Session',
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #000000; padding: 40px 0; color: #ffffff;">
          <div style="max-width: 550px; margin: 0 auto; background-color: #111111; border-radius: 24px; overflow: hidden; border: 1px solid #333333;">
            <div style="padding: 40px; text-align: center; border-bottom: 1px solid #222222;">
               <h1 style="font-size: 14px; letter-spacing: 4px; text-transform: uppercase; margin: 0; color: #888888;">Meritrix Global</h1>
            </div>
            <div style="padding: 40px; text-align: center;">
              <h2 style="font-size: 28px; font-weight: 600; margin-bottom: 24px;">Payment Confirmed.</h2>
              <p style="font-size: 16px; color: #cccccc; line-height: 1.6;">Hello ${name}, thank you for your payment for a <strong>${finalDuration}-minute</strong> consultation.</p>
              <p style="font-size: 16px; color: #cccccc; line-height: 1.6;">Please click the button below to pick your date and time on my calendar.</p>
              
              <div style="margin: 40px 0;">
                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td align="center">
                      <a href="${calendlyLink}" target="_blank" style="background-color: #ffffff; border-radius: 12px; color: #000000; display: inline-block; font-size: 16px; font-weight: bold; line-height: 60px; text-align: center; text-decoration: none; width: 260px;">Schedule Your Session</a>
                    </td>
                  </tr>
                </table>
              </div>
              <p style="font-size: 13px; color: #666666;">A Google Meet link will be generated automatically after you pick a slot.</p>
            </div>
          </div>
        </div>
      `
    });

    // 2. ADMIN NOTIFICATION (Your Personal Alert)
    await resend.emails.send({
      from: 'Meritrix System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `💰 New Payment: ${name} (${finalDuration} mins)`,
      html: `
        <div style="font-family: sans-serif; background-color: #f3f4f6; padding: 30px;">
          <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; padding: 30px; border: 1px solid #d1d5db;">
            <h3 style="margin-top: 0; color: #111827;">Payment Verified</h3>
            <p style="color: #4b5563;"><strong>Client:</strong> ${name}</p>
            <p style="color: #4b5563;"><strong>Package:</strong> ${finalDuration} Minute Session</p>
            <p style="color: #4b5563;"><strong>Status:</strong> Success. Client redirected to Calendly.</p>
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #9ca3af;">
              Check your Google Calendar for the upcoming invite from Calendly.
            </div>
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
  // Extract all data, ensuring 'duration' is included
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
      // Logic check: if duration is missing from frontend, default to 30
      const finalDuration = duration || "30"; 
      
      console.log(`✅ Success: Payment for ${name} confirmed (${finalDuration} mins).`);
      
      // Trigger the email with the new white button template
      await sendEmails(name, email, finalDuration);
      
      // Define your URLs once to keep code clean
      const oneHourLink = "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation";
      const thirtyMinLink = "https://calendly.com/meritrixconsult/1-hour-deep-dive-consultation";

      return res.status(200).json({ 
        message: "Payment verified and booking email sent.",
        calendlyUrl: finalDuration === "60" ? oneHourLink : thirtyMinLink
      });

    } else {
      console.log(`❌ Verification failed for ${name}`);
      return res.status(400).json({ message: "Payment verification failed." });
    }
  } catch (error) {
    // This logs the specific API error (like a 401 or 400 from Paystack)
    console.error("🚨 API/System Error:", error.response?.data || error.message);
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

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= GOOGLE CALENDAR SETUP ================= */
let keys;
try {
  if (process.env.NODE_ENV === "production") {
    keys = require("./google-key.json");
  } else {
    keys = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  }
} catch (error) {
  console.error("Failed to load Google Keys:", error.message);
}

const auth = new google.auth.GoogleAuth({
  credentials: keys,
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

const calendar = google.calendar({ version: "v3" });

async function createCalendarEvent(booking) {
  const client = await auth.getClient();
  await calendar.events.insert({
    auth: client,
    calendarId: process.env.ADMIN_EMAIL,
    requestBody: {
      summary: `Consultation with ${booking.name}`,
      description: `Client Name: ${booking.name}\nClient Email: ${booking.email}`, 
      start: { dateTime: booking.startTime, timeZone: "Africa/Lagos" },
      end: { dateTime: booking.endTime, timeZone: "Africa/Lagos" },
    },
  });
}

/* ================= EMAIL SETUP (AHASEND v2 API) ================= */
async function sendEmails(booking) {
  try {
    const senderEmail = 'bookings@meritrixglobal.com';
    const accountId = process.env.AHASEND_ACCOUNT_ID; 
    const apiUrl = `https://api.ahasend.com/v2/accounts/${accountId}/messages`;

    // 1. Send to Client
    console.log(`--- Dispatching Client Email: ${booking.email} ---`);
    await axios.post(apiUrl, {
      from: { email: senderEmail, name: "Meritrix Global" },
      recipients: [{ email: booking.email, name: booking.name }],
      subject: "Booking Confirmation - Meritrix Global",
      html_content: `<p>Hello ${booking.name}, your booking for ${booking.startTime} is confirmed.</p>`
    }, {
      headers: { 
        "Authorization": `Bearer ${process.env.AHASEND_API_KEY}`,
        "Content-Type": "application/json" 
      },
    });
    console.log("✅ Client email accepted by AhaSend.");

    // 2. Wait 2 seconds (Prevents rate-limit/spam flagging)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 3. Send to Admin
    console.log(`--- Dispatching Admin Alert: ${process.env.ADMIN_EMAIL} ---`);
    await axios.post(apiUrl, {
      from: { email: senderEmail, name: "System Alert" },
      recipients: [{ email: process.env.ADMIN_EMAIL, name: "Victoria Olanipekun" }],
      subject: "New Booking Received",
      html_content: `<p>New booking from ${booking.name} for ${booking.startTime}.</p>`
    }, {
      headers: { 
        "Authorization": `Bearer ${process.env.AHASEND_API_KEY}`,
        "Content-Type": "application/json" 
      },
    });
    console.log("✅ Admin alert accepted by AhaSend.");

  } catch (error) {
    // This will log the EXACT error (e.g., 401 Unauthorized, 400 Bad Request)
    console.error("❌ AhaSend v2 Error Details:", error.response?.data || error.message);
    throw error; 
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
  console.log("--- Payment Verification Request ---");
  try {
    const { paymentProvider, reference, transaction_id, name, email, startTime, endTime } = req.body;
    let paymentVerified = false;

    if (paymentProvider === "paystack") {
      paymentVerified = await verifyPaystack(reference);
    } else if (paymentProvider === "flutterwave") {
      paymentVerified = await verifyFlutterwave(transaction_id);
    }

    if (!paymentVerified) {
      console.log("❌ Payment not verified.");
      return res.status(400).json({ message: "Payment not verified" });
    }

    const booking = { name, email, startTime, endTime };

    // Run Background Tasks
    try {
      await createCalendarEvent(booking);
      console.log("✅ Calendar Updated.");
    } catch (e) { console.error("Calendar Error:", e.message); }

    try {
      await sendEmails(booking);
      console.log("✅ Emails Sent.");
    } catch (e) { console.error("Email Error:", e.message); }

    res.json({ message: "Booking process completed successfully" });

  } catch (error) {
    console.error("🚨 SYSTEM ERROR:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// TEST ROUTE: Visit https://meritrix-backend.onrender.com/test-email
app.get("/test-email", async (req, res) => {
  try {
    const testBooking = {
      name: "Test User",
      email: process.env.ADMIN_EMAIL, 
      startTime: "March 7th, 2026 at 10:00 AM",
    };
    await sendEmails(testBooking);
    res.json({ status: "Success", message: "v2 Test email sent via AhaSend!" });
  } catch (error) {
    res.status(500).json({ 
      status: "Error", 
      message: error.message,
      details: error.response?.data || "Check X-API-KEY and Verified Domain."
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
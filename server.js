require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= GOOGLE CALENDAR SETUP ================= */

/* ================= GOOGLE CALENDAR SETUP ================= */
let keys;

try {
  if (process.env.NODE_ENV === "production") {
    // On Render: Load the Secret File you created
    keys = require("./google-key.json");
  } else {
    // Locally: Parse the string from your .env
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
/* ================= GOOGLE CALENDAR SETUP ================= */

async function createCalendarEvent(booking) {
  const client = await auth.getClient();

  await calendar.events.insert({
    auth: client,
    calendarId: process.env.ADMIN_EMAIL,
    requestBody: {
      summary: `Consultation with ${booking.name}`,
      // Put the email here so you still see it in the calendar
      description: `Client Name: ${booking.name}\nClient Email: ${booking.email}`, 
      start: {
        dateTime: booking.startTime,
        timeZone: "Africa/Lagos",
      },
      end: {
        dateTime: booking.endTime,
        timeZone: "Africa/Lagos",
      },
      // REMOVE the attendees block entirely
      // attendees: [ ... ] 
    },
  });
}



/* ================= EMAIL SETUP (RESEND API) ================= */
const { Resend } = require('resend');

// Initialize Resend with your API Key
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmails(booking) {
  try {
    // 1. Send Confirmation to Client
    await resend.emails.send({
      // Use 'send' subdomain as verified in your cPanel DNS
      from: 'Meritrix Global <bookings@send.meritrixglobal.com>',
      to: booking.email,
      subject: "Booking Confirmation - Meritrix Global",
      html: `
        <div style="font-family: sans-serif; line-height: 1.6;">
          <h2>Your booking is confirmed 🎉</h2>
          <p>Hello <strong>${booking.name}</strong>,</p>
          <p>Your consultation has been successfully scheduled.</p>
          <p><strong>Date & Time:</strong> ${booking.startTime} (WAT)</p>
          <hr />
          <p>We look forward to speaking with you.</p>
        </div>
      `,
    });

    // 2. Send Alert to Admin
    await resend.emails.send({
      from: 'System Alert <alerts@send.meritrixglobal.com>',
      to: process.env.ADMIN_EMAIL,
      subject: "New Booking Received",
      html: `
        <h2>New Booking Alert</h2>
        <p><strong>Client:</strong> ${booking.name}</p>
        <p><strong>Email:</strong> ${booking.email}</p>
        <p><strong>Time:</strong> ${booking.startTime}</p>
      `,
    });

    console.log("✅ Resend API: Emails sent successfully.");
  } catch (error) {
    console.error("❌ Resend API Error:", error.message);
    // We throw the error so the test route can catch it and show you why it failed
    throw error; 
  }
}

/* ================= PAYMENT VERIFICATION ================= */

async function verifyPaystack(reference) {
  const response = await axios.get(
    `https://api.paystack.co/transaction/verify/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  return response.data.data.status === "success";
}

async function verifyFlutterwave(transaction_id) {
  const response = await axios.get(
    `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
    {
      headers: {
        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
      },
    }
  );

  return response.data.data.status === "successful";
}

/* ================= VERIFY PAYMENT ROUTE ================= */
/* ================= VERIFY PAYMENT ROUTE ================= */

app.post("/verify-payment", async (req, res) => {
  try {
    const {
      paymentProvider,
      reference,
      transaction_id,
      name,
      email,
      startTime,
      endTime,
    } = req.body;

    let paymentVerified = false;

    // 1. Verify Payment
    if (paymentProvider === "paystack") {
      paymentVerified = await verifyPaystack(reference);
    } else if (paymentProvider === "flutterwave") {
      paymentVerified = await verifyFlutterwave(transaction_id);
    }

    if (!paymentVerified) {
      return res.status(400).json({ message: "Payment not verified" });
    }

    const booking = { name, email, startTime, endTime };

    // 2. Attempt Google Calendar (Isolated)
    try {
      await createCalendarEvent(booking);
      console.log("✅ Google Calendar event created.");
    } catch (calError) {
      console.error("❌ Google Calendar Error:", calError.message);
      // We don't 'return' here, so the code continues to the email step
    }

    // 3. Attempt Email (Isolated)
    try {
      await sendEmails(booking);
      console.log("✅ Confirmation emails sent.");
    } catch (mailError) {
      console.error("❌ Nodemailer Error:", mailError.message);
    }

    // 4. Send success to frontend regardless of minor background failures
    res.json({ message: "Booking process completed successfully" });

  } catch (error) {
    console.error("SYSTEM ERROR:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});


/* ================= EMAIL DEBUG ROUTE ================= 
app.get("/test-email", async (req, res) => {
  try {
    const testBooking = {
      name: "Test User",
      email: process.env.ADMIN_EMAIL, 
      startTime: "March 6th, 2026 at 10:00 AM",
    };

    console.log("Attempting to send test email via Resend...");
    await sendEmails(testBooking);
    
    res.json({ 
      status: "Success", 
      message: `Check ${process.env.ADMIN_EMAIL} for the test email via Resend!` 
    });
  } catch (error) {
    res.status(500).json({ 
      status: "Error", 
      message: error.message,
      details: "Check if RESEND_API_KEY is set in Render and DNS is verified."
    });
  }
});
*/


/* ================= START SERVER ================= */

// Render requires the server to listen on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running and listening on port ${PORT}`);
});



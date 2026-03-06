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



/* ================= EMAIL SETUP (NODEMAILER) ================= */

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmails(booking) {
  try {
    console.log("Starting Nodemailer dispatch...");

    // Email to client
    const clientMailOptions = {
      from: `"Meritrix Global" <${process.env.EMAIL_USER}>`,
      to: booking.email,
      subject: "Booking Confirmation - Meritrix Global",
      html: `
        <h2>Your booking is confirmed 🎉</h2>
        <p>Dear ${booking.name},</p>
        <p>Your consultation has been successfully scheduled.</p>

        <p><strong>Date:</strong> ${booking.startTime}</p>

        <p>Thank you for booking with Meritrix Global.</p>
      `,
    };

    await transporter.sendMail(clientMailOptions);
    console.log("Client email sent");

    // Email to admin
    const adminMailOptions = {
      from: `"Booking System" <${process.env.EMAIL_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: "New Booking Received",
      html: `
        <h2>New Booking Alert</h2>
        <p><strong>Name:</strong> ${booking.name}</p>
        <p><strong>Email:</strong> ${booking.email}</p>
        <p><strong>Start Time:</strong> ${booking.startTime}</p>
        <p><strong>End Time:</strong> ${booking.endTime}</p>
      `,
    };

    await transporter.sendMail(adminMailOptions);
    console.log("Admin email sent");

  } catch (error) {
    console.error("Email sending failed:", error);
    throw error;
  }
}

/* ================= VERIFY PAYMENT ROUTE ================= */
 app.post("/verify-payment", async (req, res) => {
  console.log("--- NEW BOOKING REQUEST RECEIVED ---");
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
    console.log(`Step 1: Verifying ${paymentProvider} payment...`);
    if (paymentProvider === "paystack") {
      paymentVerified = await verifyPaystack(reference);
    } else if (paymentProvider === "flutterwave") {
      paymentVerified = await verifyFlutterwave(transaction_id);
    }

    if (!paymentVerified) {
      console.log("❌ Payment Verification Failed.");
      return res.status(400).json({ message: "Payment not verified" });
    }
    console.log("✅ Payment Verified Successfully.");

    const booking = { name, email, startTime, endTime };

    // 2. Attempt Google Calendar
    try {
      console.log("Step 2: Creating Calendar Event...");
      await createCalendarEvent(booking);
      console.log("✅ Google Calendar event created.");
    } catch (calError) {
      console.error("❌ Google Calendar Error:", calError.message);
    }

    // 3. Attempt Email (THE CRITICAL STEP)
    console.log(`Step 3: Dispatching Resend email to ${email}...`);
    try {
      await sendEmails(booking);
      console.log("✅ Resend API: Confirmation emails sent.");
    } catch (mailError) {
      // This will now catch the SPECIFIC Resend error (403, 401, etc.)
      console.error("❌ Resend API ERROR IN ROUTE:", mailError.message);
    }

    // 4. Send success to frontend
    res.json({ message: "Booking process completed successfully" });

  } catch (error) {
    console.error("🚨 CRITICAL SYSTEM ERROR:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

/* ================= EMAIL DEBUG ROUTE =================*/
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



/* ================= START SERVER ================= */

// Render requires the server to listen on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running and listening on port ${PORT}`);
});



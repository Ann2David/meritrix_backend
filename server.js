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



/* ================= EMAIL SETUP (AHASEND) ================= */

async function sendEmails(booking) {
  try {
    console.log("Sending email via AhaSend...");

    const emailData = {
      from: process.env.ADMIN_EMAIL,
      to: [booking.email],
      subject: "Booking Confirmation - Meritrix Global",
      html: `
        <h2>Your booking is confirmed 🎉</h2>
        <p>Hello ${booking.name},</p>

        <p>Your consultation has been successfully scheduled.</p>

        <p><strong>Start Time:</strong> ${booking.startTime}</p>
        <p><strong>End Time:</strong> ${booking.endTime}</p>

        <p>Thank you for choosing Meritrix Global.</p>
      `
    };

    await axios.post(
      "https://api.ahasend.com/v1/email/send",
      emailData,
      {
        headers: {
          Authorization: `Bearer ${process.env.AHASEND_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Client confirmation email sent");

    // ADMIN EMAIL
    await axios.post(
      "https://api.ahasend.com/v1/email/send",
      {
        from: process.env.ADMIN_EMAIL,
        to: [process.env.ADMIN_EMAIL],
        subject: "New Booking Received",
        html: `
          <h2>New Booking</h2>

          <p><strong>Name:</strong> ${booking.name}</p>
          <p><strong>Email:</strong> ${booking.email}</p>
          <p><strong>Start:</strong> ${booking.startTime}</p>
          <p><strong>End:</strong> ${booking.endTime}</p>
        `
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.AHASEND_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Admin alert email sent");

  } catch (error) {
    console.error("AhaSend email error:", error.response?.data || error.message);
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

    // 3. Attempt Email via AhaSend
    console.log(`Step 3: Sending email via AhaSend to ${email}...`);
    try {
      await sendEmails(booking); // this is the function we set up for AhaSend
      console.log("✅ AhaSend: Confirmation emails sent.");
    } catch (mailError) {
      console.error("❌ AhaSend ERROR IN ROUTE:", mailError.response?.data || mailError.message);
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



require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { google } = require("googleapis");
const { Resend } = require("resend");

const app = express();
app.use(cors());
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);

const PORT = process.env.PORT || 5000;

/* ================= GOOGLE CALENDAR SETUP ================= */

const keys = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

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
      description: `Client: ${booking.name}\nEmail: ${booking.email}`,
      start: {
        dateTime: booking.startTime,
        timeZone: "Africa/Lagos",
      },
      end: {
        dateTime: booking.endTime,
        timeZone: "Africa/Lagos",
      },
      attendees: [
        { email: booking.email },
        { email: process.env.ADMIN_EMAIL }
      ],
    },
    sendUpdates: "all",
  });
}

/* ================= EMAIL FUNCTION ================= */

async function sendConfirmationEmails(booking) {
  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: booking.email,
    subject: "Booking Confirmed",
    html: `
      <h2>Your booking is confirmed 🎉</h2>
      <p>Date: ${booking.startTime}</p>
      <p>We look forward to meeting you.</p>
    `,
  });

  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: process.env.ADMIN_EMAIL,
    subject: "New Booking Received",
    html: `
      <h2>New Booking Alert</h2>
      <p>Client: ${booking.name}</p>
      <p>Email: ${booking.email}</p>
      <p>Time: ${booking.startTime}</p>
    `,
  });
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

app.post("/verify-payment", async (req, res) => {
  try {
    const {
      paymentProvider,
      reference,
      transaction_id,
      name,
      email,
      startTime,
      endTime
    } = req.body;

    let paymentVerified = false;

    if (paymentProvider === "paystack") {
      paymentVerified = await verifyPaystack(reference);
    }

    if (paymentProvider === "flutterwave") {
      paymentVerified = await verifyFlutterwave(transaction_id);
    }

    if (!paymentVerified) {
      return res.status(400).json({ message: "Payment not verified" });
    }

    const booking = { name, email, startTime, endTime };

    await createCalendarEvent(booking);
    await sendConfirmationEmails(booking);

    res.json({ message: "Booking successful and confirmed" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
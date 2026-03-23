require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Resend } = require("resend");
const { google } = require('googleapis');
const path = require('path');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/* ================= GOOGLE CALENDAR CONFIG ================= */
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'service-account.json'), 
  scopes: ['https://www.googleapis.com/auth/calendar'],
});
const calendar = google.calendar({ version: 'v3', auth });

/* ================= NEW: CREATE CALENDAR EVENT FUNCTION ================= */
async function createCalendarEvent(name, email, appointmentString, duration) {
    try {
        console.log(`Parsing appointment string: ${appointmentString}`); // Debugging

        // 1. Split "2026-03-25 at 09:00 AM"
        const parts = appointmentString.split(' at ');
        const datePart = parts[0]; // "2026-03-25"
        const timePart = parts[1]; // "09:00 AM"

        // 2. Extract hours and minutes
        const [time, modifier] = timePart.split(' ');
        let [hours, minutes] = time.split(':');

        // 3. Convert to 24-hour format
        let finalHours = parseInt(hours);
        if (modifier === 'PM' && finalHours !== 12) finalHours += 12;
        if (modifier === 'AM' && finalHours === 12) finalHours = 0;

        // 4. Construct a clean ISO string for Google (Lagos Time +01:00)
        // Format: YYYY-MM-DDTHH:mm:ss+01:00
        const isoStart = `${datePart}T${finalHours.toString().padStart(2, '0')}:${minutes}:00+01:00`;
        
        // 5. Calculate End Time
        const startDate = new Date(isoStart);
        const endDate = new Date(startDate.getTime() + parseInt(duration) * 60000);

        const event = {
            summary: `Strategy Session: ${name}`,
            description: `1-on-1 Consultation with Meritrix Global. Duration: ${duration} mins.`,
            start: { 
                dateTime: isoStart, 
                timeZone: 'Africa/Lagos' 
            },
            end: { 
                dateTime: endDate.toISOString(), 
                timeZone: 'Africa/Lagos' 
            },
            attendees: [{ email: email }, { email: 'meritrixconsult@gmail.com' }],
            conferenceData: {
                createRequest: { 
                    requestId: "meritrix-" + Date.now(), 
                    conferenceSolutionKey: { type: "hangoutsMeet" } 
                }
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'meritrixconsult@gmail.com',
            resource: event,
            conferenceDataVersion: 1,
            sendUpdates: 'all',
        });

        console.log(`✅ Event Created successfully!`);
        return response.data.htmlLink;
    } catch (error) {
        console.error("❌ Google Calendar Create Error:", error.message);
        // Log the full error to see if it's a formatting issue or a permission issue
        if (error.response && error.response.data) {
            console.error("Full Error Data:", JSON.stringify(error.response.data));
        }
        return null;
    }
}

/* ================= HELPERS ================= */

async function sendEmails(name, email, duration, meetingLink) {
  try {
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Session Activated | Meritrix Global',
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 24px; border-bottom: 4px solid #ff8811;">
            <h1 style="font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #888; margin-bottom: 20px;">Meritrix Global</h1>
            <h2 style="font-size: 26px; font-weight: 600; margin-bottom: 20px;">Payment Verified</h2>
            <p style="color: #ccc; font-size: 16px; line-height: 1.6;">Hello ${name}, your <strong>${duration}-minute session</strong> is confirmed.</p>
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #333; text-align: left;">
               <p style="margin: 0; color: #fff; font-weight: 600;">Your Meeting Access:</p>
               <p style="color: #aaa; font-size: 14px; margin-top: 10px;">
                Check your Google Calendar for the invite or use the link below:<br>
                <a href="${meetingLink}" style="color: #ff8811;">View Calendar Event</a>
               </p>
            </div>
          </div>
        </div>
      `
    });

    // ADMIN NOTIFICATION
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `✅ NEW BOOKING: ${name}`,
      html: `<p>User <strong>${name}</strong> has paid and booked a ${duration} min session.</p>`
    });

  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

/* ================= VERIFY PAYMENT & CREATE EVENT ================= */

app.post("/verify-payment", async (req, res) => {
  const { paymentProvider, reference, transaction_id, name, email, duration, appointment } = req.body;

  try {
    let paymentVerified = false;

    // 1. Verify with Paystack or Flutterwave
    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    } else if (paymentProvider === "flutterwave") {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "successful";
    }

    if (paymentVerified) {
      console.log(`💰 Payment confirmed. Creating calendar event for ${email}...`);

      // 2. CREATE THE ACTUAL GOOGLE CALENDAR EVENT NOW
      const calendarLink = await createCalendarEvent(name, email, appointment, duration);

      // 3. SEND EMAILS WITH THE LINK
      await sendEmails(name, email, duration, calendarLink);
      
      return res.status(200).json({ success: true, message: "Booking complete!" });
    } else {
      return res.status(400).json({ success: false, message: "Verification failed." });
    }
  } catch (error) {
    console.error("🚨 System Error:", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
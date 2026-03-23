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
        console.log(`[PROCESS] Creating event for: ${appointmentString}`);

        const parts = appointmentString.split(' at ');
        const datePart = parts[0];
        const [time, modifier] = parts[1].split(' ');
        let [hours, minutes] = time.split(':');

        let finalHours = parseInt(hours);
        if (modifier === 'PM' && finalHours !== 12) finalHours += 12;
        if (modifier === 'AM' && finalHours === 12) finalHours = 0;

        const HH = finalHours.toString().padStart(2, '0');
        const MM = minutes.toString().padStart(2, '0');

        const isoStart = `${datePart}T${HH}:${MM}:00+01:00`;
        const startMillis = new Date(`${datePart}T${HH}:${MM}:00`).getTime();
        const durationMillis = (parseInt(duration) || 60) * 60000;
        const endDateObj = new Date(startMillis + durationMillis);

        const isoEnd = `${datePart}T${endDateObj.getHours().toString().padStart(2, '0')}:${endDateObj.getMinutes().toString().padStart(2, '0')}:00+01:00`;

        const event = {
            summary: `Strategy Session: ${name}`,
            description: `Client: ${email}\nDuration: ${duration} mins.`,
            start: { dateTime: isoStart, timeZone: 'Africa/Lagos' },
            end: { dateTime: isoEnd, timeZone: 'Africa/Lagos' },
            conferenceData: {
                createRequest: { 
                    requestId: `mtx-${Date.now()}`, 
                    conferenceSolutionKey: { type: 'hangoutsMeet' } 
                }
            },
        };

        const response = await calendar.events.insert({
            calendarId: 'meritrixconsult@gmail.com',
            resource: event,
            conferenceDataVersion: 1, // Crucial for Meet link generation
        });

        // Extra careful check for the meet link
        let meetLink = null;
        if (response.data.conferenceData && response.data.conferenceData.entryPoints) {
            meetLink = response.data.conferenceData.entryPoints[0].uri;
        }

        console.log("✅ Calendar Event Created. Link:", meetLink || "No link generated");
        return meetLink || "https://meet.google.com/lookup/meritrix"; // Fallback link
    } catch (error) {
        console.error("❌ Calendar Error:", error.message);
        // RETURN A STRING INSTEAD OF THROWING ERROR
        // This ensures the verify-payment route continues to send the email
        return "Victoria will send your Google Meet link shortly."; 
    }
}

/* ================= HELPERS ================= */

  async function sendEmails(name, email, duration, meetingLink) {
  try {
    // Ensure meetingLink is a valid string and not null
    const finalLink = meetingLink && meetingLink.startsWith('http') 
                      ? meetingLink 
                      : 'https://calendar.google.com';

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
                Click the button below to join the session or view the event:
               </p>
               <a href="${finalLink}" target="_blank" style="display: inline-block; background: #ff8811; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 8px; font-weight: bold; margin-top: 10px;">
                Join Meeting / View Event
               </a>
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

   console.log("✅ Confirmation email sent to client.");
  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

/* ================= VERIFY PAYMENT & CREATE EVENT ================= */

app.post("/verify-payment", async (req, res) => {
    const { paymentProvider, reference, transaction_id, name, email, duration, appointment } = req.body;
    console.log(`[1/3] Verifying payment for ${email}...`);

    try {
        let paymentVerified = false;
        
        // --- Verification Logic ---
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
            console.log(`[2/3] Payment Success. Creating Calendar for ${name}...`);

            // We await the calendar link to ensure the email has the correct URL
            const meetLink = await createCalendarEvent(name, email, appointment, duration);

            console.log(`[3/3] Sending Confirmation Email...`);
            // Pass the meetLink (or a fallback) to the email function
            await sendEmails(name, email, duration, meetLink);
            
            return res.status(200).json({ success: true, meetLink });
        }
        
        console.log(`❌ Payment Verification Failed for ${email}`);
        res.status(400).json({ success: false });

    } catch (error) {
        console.error("🚨 System Error:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Resend } = require("resend");
const { google } = require('googleapis');
const path = require('path');
const ics = require('ics'); // NEW: For calendar attachments

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

/* ================= HELPERS: CALENDAR LOGIC ================= */

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

        // Fixed ISO string formatting
        const isoStart = `${datePart}T${HH}:${MM}:00+01:00`;
        const startMillis = new Date(`${datePart}T${HH}:${MM}:00`).getTime();
        const durationMillis = (parseInt(duration) || 60) * 60000;
        const endDateObj = new Date(startMillis + durationMillis);
        
        // Formatting end time correctly for ISO
        const endHH = endDateObj.getHours().toString().padStart(2, '0');
        const endMM = endDateObj.getMinutes().toString().padStart(2, '0');
        const isoEnd = `${datePart}T${endHH}:${endMM}:00+01:00`;

        const event = {
            summary: `Strategy Session: ${name}`,
            description: `Consultation with Meritrix Global.\nClient: ${email}`,
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
            // CRITICAL: This must be 1 to enable Google Meet generation
            conferenceDataVersion: 1, 
        });

        // Robust link extraction
        const meetLink = response.data.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;
        
        console.log("✅ Google Meet Generated:", meetLink);
        return meetLink || "https://meet.google.com/lookup/meritrix"; 

    } catch (error) {
        console.error("❌ Calendar Error:", error.message);
        // Fallback so the email still has a link
        return "https://meet.google.com/lookup/meritrix"; 
    }
}

/* ================= HELPERS: EMAIL LOGIC ================= */

async function sendEmails(name, email, duration, meetingLink, appointmentString) {
  try {
    const finalLink = (meetingLink && meetingLink.startsWith('http')) ? meetingLink : 'https://calendar.google.com';

    // Parse for ICS file
    const parts = appointmentString.split(' at ');
    const [y, m, d] = parts[0].split('-').map(Number);
    const [time, modifier] = parts[1].split(' ');
    let [h, min] = time.split(':').map(Number);
    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0;

    const { error, value } = ics.createEvent({
      start: [y, m, d, h, min],
      duration: { minutes: parseInt(duration) || 60 },
      title: `Strategy Session: ${name}`,
      description: `Join Meeting: ${finalLink}`,
      location: 'Google Meet',
      url: finalLink,
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      organizer: { name: 'Victoria', email: 'bookings@meritrixglobal.com' },
      attendees: [{ name: name, email: email, rsvp: true }]
    });

    const attachments = !error ? [{ content: Buffer.from(value).toString('base64'), filename: 'invite.ics' }] : [];

    // 1. Client Email
    await resend.emails.send({
      from: 'Victoria <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Session Activated | Meritrix Global',
      attachments: attachments,
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 24px; border-bottom: 4px solid #ff8811;">
            <h2 style="font-size: 26px; font-weight: 600; margin-bottom: 20px;">Payment Verified</h2>
            <p style="color: #ccc;">Hello ${name}, your ${duration}-minute session is confirmed.</p>
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #333; text-align: left;">
               <p style="margin: 0; color: #fff; font-weight: 600;">Meeting Access:</p>
               <a href="${finalLink}" target="_blank" style="display: inline-block; background: #ff8811; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 8px; font-weight: bold; margin-top: 10px;">
                Join Google Meet
               </a>
               <p style="color: #888; font-size: 12px; margin-top: 15px;">A calendar invite has been attached to this email.</p>
            </div>
          </div>
        </div>
      `
    });

    // 2. Admin Notification
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `✅ NEW BOOKING: ${name}`,
      html: `<p>User <strong>${name}</strong> has paid and booked a ${duration} min session.</p>`
    });

    console.log("✅ Emails & ICS sent.");
  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

/* ================= VERIFY PAYMENT ROUTE ================= */

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
            console.log(`[2/3] Payment Success. Sending instant response to user...`);
            
            // 1. Tell the user it's done immediately
            res.status(200).json({ success: true, message: "Booking confirmed! Check your email." });

            // 2. Heavy work happens in the background (no 'await' on this function)
            (async () => {
                try {
                    const meetLink = await createCalendarEvent(name, email, appointment, duration);
                    await sendEmails(name, email, duration, meetLink, appointment);
                    console.log(`[3/3] Background tasks (Calendar/Email) finished for ${email}`);
                } catch (bgError) {
                    console.error("🚨 Background Task Error:", bgError.message);
                }
            })();
            
            return; 
        }

        res.status(400).json({ success: false, message: "Payment could not be verified." });

    } catch (error) {
        console.error("🚨 System Error:", error.message);
        if (!res.headersSent) res.status(500).json({ message: "Internal Server Error" });
    }
});

// This gives the Cron-job something to find!
app.get("/", (req, res) => {
  res.status(200).send("Meritrix Backend is Live and Awake.");
});

// Or a specific health check route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "up" });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
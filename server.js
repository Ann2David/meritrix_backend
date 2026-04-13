require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Resend } = require("resend");
const { google } = require('googleapis');
const path = require('path');
const ics = require('ics');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

/* ================= GOOGLE CALENDAR INITIALIZATION ================= */

const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, 'service-account.json'), 
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

/* ================= AVAILABILITY LOGIC ================= */

// 1. Fetches booked times for a specific date (to gray out buttons on frontend)
app.get("/get-booked-slots", async (req, res) => {
    const { date } = req.query; // Expects "YYYY-MM-DD"
    if (!date) return res.status(400).json({ error: "Date is required" });

    try {
        const response = await calendar.events.list({
            calendarId: 'meritrixconsult@gmail.com',
            timeMin: `${date}T00:00:00+01:00`,
            timeMax: `${date}T23:59:59+01:00`,
            singleEvents: true,
            timeZone: 'Africa/Lagos'
        });

        const bookedTimes = response.data.items.map(event => {
    const dateObj = new Date(event.start.dateTime);
    return dateObj.toLocaleTimeString('en-US', { 
        hour: '2-digit',   // Changed from 'numeric' to '2-digit'
        minute: '2-digit', 
        hour12: true,
        timeZone: 'Africa/Lagos' 
    });
});

        res.json({ bookedTimes });
    } catch (error) {
        console.error("Error fetching slots:", error.message);
        res.status(500).json({ error: "Could not fetch booked slots" });
    }
});

// 2. Strict check using FreeBusy (Safety net before payment)
async function isSlotBusy(appointmentString, duration) {
    try {
        const parts = appointmentString.split(' at ');
        const datePart = parts[0].trim(); 
        const timeParts = parts[1].trim().split(' ');
        let [hours, minutes] = timeParts[0].split(':');

        let finalHours = parseInt(hours);
        if (timeParts[1] === 'PM' && finalHours !== 12) finalHours += 12;
        if (timeParts[1] === 'AM' && finalHours === 12) finalHours = 0;

        const startStr = `${datePart}T${finalHours.toString().padStart(2, '0')}:${minutes}:00+01:00`;
        const start = new Date(startStr);
        const end = new Date(start.getTime() + (parseInt(duration) || 60) * 60000);

        const check = await calendar.freebusy.query({
            requestBody: {
                timeMin: start.toISOString(),
                timeMax: end.toISOString(),
                timeZone: 'Africa/Lagos',
                items: [{ id: 'meritrixconsult@gmail.com' }]
            }
        });

        const busySlots = check.data.calendars['meritrixconsult@gmail.com'].busy;
        return busySlots.length > 0;
    } catch (error) {
        console.error("Conflict Check Error:", error.message);
        return false; 
    }
}

/* ================= ROUTES ================= */

app.post("/check-availability", async (req, res) => {
    const { appointment, duration } = req.body;
    if (!appointment) return res.status(400).json({ error: "Missing appointment" });

    const busy = await isSlotBusy(appointment, duration);
    if (busy) {
        return res.status(400).json({ 
            available: false, 
            message: "This slot was just taken. Please pick another time." 
        });
    }
    res.status(200).json({ available: true });
});

/* ================= CALENDAR & EMAIL HELPERS ================= */

async function createCalendarEvent(name, email, appointmentString, duration) {
    try {
        const myStableMeetLink = "https://meet.google.com/tie-farj-eyz"; 
        const parts = appointmentString.split(' at ');
        const datePart = parts[0].trim();
        const timeParts = parts[1].trim().split(' ');
        let [hours, minutes] = timeParts[0].split(':');

        let finalHours = parseInt(hours);
        if (timeParts[1] === 'PM' && finalHours !== 12) finalHours += 12;
        if (timeParts[1] === 'AM' && finalHours === 12) finalHours = 0;

        const startIso = `${datePart}T${finalHours.toString().padStart(2, '0')}:${minutes}:00+01:00`;
        const start = new Date(startIso);
        const end = new Date(start.getTime() + (parseInt(duration) || 60) * 60000);

        const event = {
            summary: `Strategy Session (${duration}m): ${name}`,
            description: `Consultation with Meritrix Global.\nClient: ${email}\nJoin: ${myStableMeetLink}`,
            start: { dateTime: start.toISOString(), timeZone: 'Africa/Lagos' },
            end: { dateTime: end.toISOString(), timeZone: 'Africa/Lagos' },
            location: myStableMeetLink
        };

        await calendar.events.insert({ calendarId: 'meritrixconsult@gmail.com', resource: event });
        return myStableMeetLink; 
    } catch (error) {
        console.error("❌ Calendar Error:", error.message);
        return "https://meet.google.com/tie-farj-eyz"; 
    }
}

async function sendEmails(name, email, duration, meetingLink, appointmentString) {
  try {
    const finalLink = (meetingLink && meetingLink.startsWith('http')) ? meetingLink : 'https://meet.google.com/tie-farj-eyz';

    // Parse the date and time
    const parts = appointmentString.split(' at ');
    const [y, m, d] = parts[0].split('-').map(Number);
    const [time, modifier] = parts[1].split(' ');
    let [h, min] = time.split(':').map(Number);
    
    if (modifier === 'PM' && h !== 12) h += 12;
    if (modifier === 'AM' && h === 12) h = 0;

    // --- FIX START ---
    const { error, value } = ics.createEvent({
      start: [y, m, d, h, min],
      duration: { minutes: parseInt(duration) || 60 },
      title: `Strategy Session: ${name}`,
      description: `Join Meeting: ${finalLink}`,
      location: 'Google Meet',
      url: finalLink,
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      startInputType: 'local', // CRITICAL: Tells the file to use local time, not UTC
      startOutputType: 'local',
      organizer: { name: 'Meritrix', email: 'bookings@meritrixglobal.com' },
      attendees: [{ name: name, email: email, rsvp: true }]
    });
    // --- FIX END ---

    const attachments = !error ? [{ 
        content: Buffer.from(value).toString('base64'), 
        filename: 'invite.ics',
        type: 'text/calendar',
        disposition: 'attachment'
    }] : [];

    // Send to Client
    await resend.emails.send({
      from: 'Meritrix <bookings@meritrixglobal.com>',
      to: email,
      subject: 'Session Activated | Meritrix Global',
      attachments: attachments,
      html: `
        <div style="font-family: sans-serif; background-color: #000; padding: 40px; color: #fff; text-align: center;">
          <div style="max-width: 500px; margin: 0 auto; background: #111; border: 1px solid #333; padding: 40px; border-radius: 24px; border-bottom: 4px solid #ff8811;">
            <h2 style="font-size: 26px; font-weight: 600; margin-bottom: 20px;">Payment Verified</h2>
            <p style="color: #ccc;">Hello ${name}, your session is confirmed for <strong>${appointmentString}</strong>.</p>
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #333; text-align: left;">
               <p style="margin: 0; color: #fff; font-weight: 600;">Meeting Access:</p>
               <a href="${finalLink}" target="_blank" style="display: inline-block; background: #ff8811; color: #fff; text-decoration: none; padding: 12px 25px; border-radius: 8px; font-weight: bold; margin-top: 10px;">
                Join Google Meet
               </a>
               <p style="color: #888; font-size: 12px; margin-top: 15px;">A calendar invite (.ics) is attached. Open it to add this to your phone's calendar.</p>
            </div>
          </div>
        </div>
      `
    });

    // Send to Admin
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `✅ NEW BOOKING: ${name}`,
      html: `<p><strong>${name}</strong> booked for <strong>${appointmentString}</strong> (${duration} mins).</p>`
    });

    console.log("✅ Emails sent correctly.");
  } catch (err) { 
    console.error("Email Error:", err.message); 
  }
}

/* ================= VERIFY PAYMENT ROUTE ================= */

app.post("/verify-payment", async (req, res) => {
    const { name, email, duration, appointment, reference, transaction_id, paymentProvider } = req.body;
    try {
        let paymentVerified = false;
        if (paymentProvider === "paystack") {
            const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
                headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
            });
            paymentVerified = resp.data.data.status === "success";
        } else if (paymentProvider === "flutterwave") {
            const idToVerify = transaction_id || reference;
            const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${idToVerify}/verify`, {
                headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
            });
            paymentVerified = resp.data.data.status === "successful";
        }

        if (paymentVerified) {
            res.status(200).json({ success: true, message: "Booking confirmed!" });
            (async () => {
                try {
                    const meetLink = await createCalendarEvent(name, email, appointment, duration);
                    await sendEmails(name, email, duration, meetLink, appointment);
                } catch (bgError) { console.error("🚨 Background Error:", bgError.message); }
            })();
            return;
        }
        res.status(400).json({ success: false, message: "Payment failed verification." });
    } catch (error) {
        console.error("🚨 System Error:", error.message);
        if (!res.headersSent) res.status(500).json({ message: "Internal Server Error" });
    }
});

/* ================= HEALTH & PORT ================= */

app.get("/", (req, res) => res.status(200).send("Meritrix Backend Active."));
app.get("/health", (req, res) => res.status(200).json({ status: "up" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
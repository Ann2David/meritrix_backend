require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const { Resend } = require("resend");
const { google } = require('googleapis');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Memory store to track if a booking has been paid. 
// eventId is the key.
let pendingBookings = {};

const path = require('path'); // Add this at the top of server.js

/* ================= GOOGLE CALENDAR CONFIG ================= */
const auth = new google.auth.GoogleAuth({
  // This creates an absolute path to the file in your root folder
  keyFile: path.join(__dirname, 'service-account.json'), 
  scopes: ['https://www.googleapis.com/auth/calendar.events'],
});
const calendar = google.calendar({ version: 'v3', auth });

/**
 * Automatically deletes an event if payment isn't confirmed
 */
async function deleteCalendarEvent(eventId) {
    try {
        await calendar.events.delete({
            calendarId: 'primary', 
            eventId: eventId,
            sendUpdates: 'all', // Notifies the user their "reservation" was cancelled
        });
        console.log(`🗑️ Unpaid booking deleted: ${eventId}`);
    } catch (error) {
        console.error("❌ Google Delete Error:", error.message);
    }
}

/* ================= HELPERS ================= */

async function sendEmails(name, email, duration) {
  const isOneHour = duration === "60" || duration === 60;

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
            
            <p style="color: #ccc; font-size: 16px; line-height: 1.6;">Hello ${name}, your payment for the <strong>${duration}-minute session</strong> has been received.</p>
            
            <div style="background-color: #1a1a1a; border-radius: 12px; padding: 25px; margin: 30px 0; border: 1px solid #333; text-align: left;">
               <p style="margin: 0; color: #fff; font-weight: 600;">How to join:</p>
               <p style="color: #aaa; font-size: 14px; margin-top: 10px;">
                1. Open the <strong>Google Calendar invitation</strong> sent to your inbox.<br>
                2. Click the <strong>"Join with Google Meet"</strong> button inside that invite.<br>
                3. We will start exactly at the scheduled time.
               </p>
            </div>

            ${isOneHour ? `
            <p style="font-size: 12px; color: #ff8811; margin-bottom: 20px;">Note: I have manually updated your 1-hour session on the calendar.</p>
            ` : ''}

            <p style="font-size: 11px; color: #555;">If you cannot find the Google Calendar invite, please check your Spam folder.</p>
          </div>
        </div>
      `
    });

    // ADMIN NOTIFICATION
    await resend.emails.send({
      from: 'System <bookings@meritrixglobal.com>',
      to: 'meritrixconsult@gmail.com',
      subject: `✅ PAID: ${name} (${duration} mins)`,
      html: `<p>User <strong>${name}</strong> has paid. Match this with the Google Calendar notification you just received. ${isOneHour ? "<strong>REMINDER: Extend the meeting to 1 hour.</strong>" : ""}</p>`
    });

  } catch (error) {
    console.error("❌ Resend Error:", error.message);
  }
}

/* ================= GOOGLE CALENDAR DELETE FUNCTION ================= */
  async function deleteCalendarEvent(googleEventId) {
    // 1. CLEAN THE ID: Remove "@google.com" if it exists
    const cleanEventId = googleEventId.split('@')[0];
    
    console.log(`📡 Attempting to delete cleaned event ID: ${cleanEventId}`);

    try {
        await calendar.events.delete({
            calendarId: 'meritrixconsult@gmail.com', 
            eventId: cleanEventId, // Use the cleaned ID here
            sendUpdates: 'all', 
        });
        console.log(`✅ SUCCESS: Unpaid booking deleted: ${cleanEventId}`);
    } catch (error) {
        console.error("❌ GOOGLE API ERROR:", error.message);
        
        if (error.message.includes("Not Found")) {
            console.error("👉 Check: Ensure the Service Account is added to the 'meritrixconsult' calendar sharing settings with 'Make changes to events' permission.");
        }
    }
}
/* ================= UPDATED RESERVE ROUTE (5 MINS) ================= */
app.post("/reserve-slot", (req, res) => {
    const { googleEventId, email } = req.body;
    
    if (!googleEventId) return res.status(400).json({ error: "Missing event ID" });

    console.log(`⏱️ TIMER START: 5-minute countdown for ${email} (${googleEventId})`);

    // Track the booking
    pendingBookings[googleEventId] = { 
        email, 
        paid: false, 
        createdAt: Date.now() 
    };

    // SET THE 5-MINUTE TIMER (300,000 ms)
    setTimeout(() => {
        console.log(`⏳ 5 minutes up. Checking payment for: ${googleEventId}`);

        if (pendingBookings[googleEventId] && !pendingBookings[googleEventId].paid) {
            console.log(`🚫 Payment NOT verified. Proceeding to delete...`);
            deleteCalendarEvent(googleEventId);
        } else {
            console.log(`✨ Payment was verified! Keeping the booking.`);
        }
        
        // Clean up memory
        delete pendingBookings[googleEventId];
    }, 300000); 

    res.json({ success: true, message: "5-minute timer started." });
});

/**
 * STEP 3: Verification & Activation
 */
app.post("/verify-payment", async (req, res) => {
  // We added email here to help find the booking in memory
  const { paymentProvider, reference, transaction_id, name, email, duration } = req.body;

  try {
    let paymentVerified = false;

    // 1. VERIFY WITH GATEWAY (Keep your existing axios logic)
    if (paymentProvider === "paystack") {
      const resp = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "success";
    } 
    else if (paymentProvider === "flutterwave") {
      const resp = await axios.get(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
        headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` }
      });
      paymentVerified = resp.data.data.status === "successful";
    }

    if (paymentVerified) {
      console.log(`💰 Payment confirmed for: ${email}`);

      // 2. STOP THE TIMER (The "Defuse" Logic)
      // We look through pendingBookings to find the one matching this email
      const bookingId = Object.keys(pendingBookings).find(
        id => pendingBookings[id].email === email
      );

      if (bookingId) {
        pendingBookings[bookingId].paid = true;
        console.log(`✨ TIMER DEFUSED for event: ${bookingId}. This booking will NOT be deleted.`);
      } else {
        console.log(`⚠️ Warning: Payment verified but no pending booking found for ${email}. (Maybe the 5 mins already passed?)`);
      }

      // 3. SEND EMAILS
      await sendEmails(name, email, duration);
      
      return res.status(200).json({ 
        success: true,
        message: "Payment verified, timer stopped, and emails sent." 
      });

    } else {
      return res.status(400).json({ success: false, message: "Verification failed." });
    }
  } catch (error) {
    console.error("🚨 System Error:", error.response?.data || error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
});




app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
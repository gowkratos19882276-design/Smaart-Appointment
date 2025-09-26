import { Router } from 'express';
import nodemailer from 'nodemailer';
import { ObjectId } from 'mongodb';

const router = Router();

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// POST /api/book
router.post('/book', async (req, res) => {
  const { doctorId, doctorName, date, time, patient_email } = req.body || {};
  if ((!doctorId && !doctorName) || !date || !time || !patient_email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const db = req.app.locals.db;
    let doctor;
    if (doctorId && ObjectId.isValid(doctorId)) {
      doctor = await db.collection('doctors').findOne({ _id: new ObjectId(doctorId) });
    }
    if (!doctor && doctorName) {
      doctor = await db.collection('doctors').findOne({ name: doctorName });
    }
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });

    const availabilityIndex = (doctor.availability || []).findIndex(
      a => a.date === date && a.time === time && a.available !== false
    );
    if (availabilityIndex === -1) {
      return res.status(400).json({ error: 'Selected slot is no longer available' });
    }

    // Atomic update without transactions (works on standalone)
    const doctorsColl = db.collection('doctors');
    const appointmentsColl = db.collection('appointments');

    const updateRes = await doctorsColl.updateOne(
      {
        _id: doctor._id,
        availability: { $elemMatch: { date, time, available: { $ne: false } } }
      },
      { $set: { 'availability.$.available': false } }
    );
    if (updateRes.modifiedCount !== 1) {
      throw new Error('Slot taken');
    }

    const appointmentDoc = {
      doctor: doctor.name,
      date,
      time,
      patient_email,
      createdAt: new Date()
    };
    await appointmentsColl.insertOne(appointmentDoc);

    // Send email
    const transporter = createTransport();
    const info = await transporter.sendMail({
      from: `SMAART HEALTHCARE <${process.env.SMTP_USER}>`,
      to: patient_email,
      subject: `[SMAART HEALTHCARE] Appointment Confirmation — ${doctor.name} on ${date} at ${time}`,
      text: `SMAART HEALTHCARE\n\nAppointment Confirmation\n\nDear Patient,\n\nWe are pleased to confirm your appointment with ${doctor.name} on ${date} at ${time}.\n\nAppointment Details:\n• Doctor: ${doctor.name}\n• Date: ${date}\n• Time: ${time}\n\nWhat to Expect:\n• Please arrive 10 minutes early to complete any formalities.\n• Bring any relevant medical records and a list of current medications.\n\nChanges & Cancellations:\nIf you need to reschedule or cancel, please reply to this email at least 24 hours in advance.\n\nContact Us:\nSMAART HEALTHCARE\nEmail: ${process.env.SMTP_USER}\n\nWe look forward to seeing you.\n\nWarm regards,\nSMAART HEALTHCARE`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
          <div style="text-align:center; padding: 12px 0; font-weight: 800; font-size: 18px; letter-spacing: 1px; color:#111827;">SMAART HEALTHCARE</div>
          <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:16px;">
            <h2 style="margin:0 0 8px; font-size:18px; color:#111827;">Appointment Confirmation</h2>
            <p style="margin:0 0 12px;">Dear Patient,</p>
            <p style="margin:0 0 12px;">We are pleased to confirm your appointment with <strong>${doctor.name}</strong> on <strong>${date}</strong> at <strong>${time}</strong>.</p>
            <div style="margin:12px 0; padding:12px; background:#ffffff; border:1px solid #e5e7eb; border-radius:6px;">
              <p style="margin:0 0 6px;"><strong>Appointment Details</strong></p>
              <ul style="margin:0; padding-left:18px;">
                <li>Doctor: ${doctor.name}</li>
                <li>Date: ${date}</li>
                <li>Time: ${time}</li>
              </ul>
            </div>
            <p style="margin:12px 0 6px;"><strong>What to Expect</strong></p>
            <ul style="margin:0 0 12px; padding-left:18px;">
              <li>Please arrive 10 minutes early to complete any formalities.</li>
              <li>Bring any relevant medical records and a list of current medications.</li>
            </ul>
            <p style="margin:12px 0 6px;"><strong>Changes & Cancellations</strong></p>
            <p style="margin:0 0 12px;">If you need to reschedule or cancel, please reply to this email at least 24 hours in advance.</p>
            <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;" />
            <p style="margin:0; font-size:12px; color:#6b7280;">
              SMAART HEALTHCARE<br/>
              Email: <a href="mailto:${process.env.SMTP_USER}">${process.env.SMTP_USER}</a>
            </p>
          </div>
        </div>
      `
    });

    res.json({
      success: true,
      message: `Your appointment with ${doctor.name} on ${date} at ${time} is confirmed.`,
      appointment: appointmentDoc,
      emailId: info.messageId
    });
  } catch (err) {
    console.error('Booking error', err);
    const msg = err && err.message === 'Slot taken' ? 'Selected slot is no longer available' : 'Failed to book appointment';
    res.status(500).json({ error: msg });
  }
});

export default router;



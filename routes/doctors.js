import { Router } from 'express';
import { ObjectId } from 'mongodb';

const router = Router();

// GET /api/doctors - list doctors
router.get('/doctors', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const doctors = await db.collection('doctors').find({}).project({}).toArray();
    res.json(doctors);
  } catch (err) {
    console.error('Error fetching doctors', err);
    res.status(500).json({ error: 'Failed to fetch doctors' });
  }
});

// GET /api/doctors/:id/availability - availability for a doctor
router.get('/doctors/:id/availability', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const id = req.params.id;
    let doctor;
    // Accept either ObjectId or name
    if (ObjectId.isValid(id)) {
      doctor = await db.collection('doctors').findOne({ _id: new ObjectId(id) });
    }
    if (!doctor) {
      doctor = await db.collection('doctors').findOne({ name: id });
    }
    if (!doctor) return res.status(404).json({ error: 'Doctor not found' });
    const availability = (doctor.availability || []).filter(a => a.available !== false);
    res.json({ doctorId: doctor._id, availability });
  } catch (err) {
    console.error('Error fetching availability', err);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

export default router;




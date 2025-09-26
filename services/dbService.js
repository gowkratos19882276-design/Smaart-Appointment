// DB helpers for doctors and appointments
// Expect to be passed a connected MongoDB db instance (database: medical_bot)

export function getCollections(db) {
  return {
    doctors: db.collection('doctors'),
    appointments: db.collection('appointments'),
  };
}

export async function listDoctors(db, { specialization } = {}) {
  const { doctors } = getCollections(db);
  const query = specialization ? { specialization } : {};
  const docs = await doctors.find(query).project({ name: 1, specialization: 1, availability: 1 }).toArray();
  return docs.map(d => ({ id: String(d._id), name: d.name, specialization: d.specialization, availability: d.availability || [] }));
}

export async function findDoctorByName(db, name) {
  const { doctors } = getCollections(db);
  const doc = await doctors.findOne({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
  if (!doc) return null;
  return { id: String(doc._id), name: doc.name, specialization: doc.specialization, availability: doc.availability || [] };
}

export async function isSlotAvailable(db, doctorId, date, time) {
  const { doctors } = getCollections(db);
  const doc = await doctors.findOne({ _id: new (await import('mongodb')).ObjectId(doctorId) });
  if (!doc) return false;
  const avail = (doc.availability || []).find(a => a.date === date);
  if (!avail) return false;
  if (!avail.times || !avail.times.includes(time)) return false;
  // Check not already booked
  const { appointments } = getCollections(db);
  const existing = await appointments.findOne({ doctorId: String(doc._id), date, time });
  return !existing;
}

export async function createAppointment(db, { doctorId, doctorName, patientEmail, date, time }) {
  const { appointments } = getCollections(db);
  const doc = {
    doctorId,
    doctorName,
    patientEmail,
    date,
    time,
    createdAt: new Date(),
  };
  const res = await appointments.insertOne(doc);
  return { id: String(res.insertedId), ...doc };
}

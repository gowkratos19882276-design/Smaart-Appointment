import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/medical_bot';

function generateAvailability(days = 5) {
  const slots = ['09:00', '10:30', '12:00', '14:00', '15:30'];
  const out = [];
  const today = new Date();
  for (let d = 1; d <= days; d++) {
    const dt = new Date(today);
    dt.setDate(today.getDate() + d);
    const date = dt.toISOString().slice(0, 10);
    for (const time of slots) {
      out.push({ date, time, available: true });
    }
  }
  return out;
}

const SPECIALTIES = [
  'Cardiologist', 'Dermatologist', 'Neurologist', 'Orthopedic Surgeon', 'Pediatrician',
  'Psychiatrist', 'Ophthalmologist', 'ENT Specialist', 'Endocrinologist', 'Gastroenterologist',
  'Oncologist', 'Pulmonologist', 'Rheumatologist', 'Urologist', 'Nephrologist',
  'Gynecologist', 'Dentist', 'General Surgeon', 'Physician', 'Allergist'
];

const NAMES = [
  'Dr. Aanya Mehra', 'Dr. Rohan Kapoor', 'Dr. Priya Nair', 'Dr. Arjun Patel', 'Dr. Kavya Rao',
  'Dr. Manish Verma', 'Dr. Sneha Iyer', 'Dr. Kunal Shah', 'Dr. Nisha Gupta', 'Dr. Vivek Sinha',
  'Dr. Farah Khan', 'Dr. Dev Malhotra', 'Dr. Riya Desai', 'Dr. Aditya Joshi', 'Dr. Neha Bhat',
  'Dr. Ishaan Roy', 'Dr. Meera Kulkarni', 'Dr. Aarav Sengupta', 'Dr. Sanjana Menon', 'Dr. Rahul Saxena',
  'Dr. Zoya Ali', 'Dr. Nitin Kulkarni', 'Dr. Varun Batra', 'Dr. Shreya Pandey', 'Dr. Pooja Chawla',
  'Dr. Akash Tiwari', 'Dr. Tanya Anand', 'Dr. Saurabh Jain', 'Dr. Riddhi Shah', 'Dr. Kiran Dev'
];

async function main() {
  const client = new MongoClient(mongoUri, { ignoreUndefined: true });
  await client.connect();
  const db = client.db('medical_bot');
  const coll = db.collection('doctors');

  // Create 20 new doctors (additive) with random specializations
  const docs = [];
  const startIndex = Math.floor(Math.random() * (NAMES.length - 20));
  for (let i = 0; i < 20; i++) {
    const name = NAMES[(startIndex + i) % NAMES.length];
    const specialization = SPECIALTIES[i % SPECIALTIES.length];
    docs.push({
      name,
      specialization,
      availability: generateAvailability(7)
    });
  }

  let inserted = 0, updated = 0;
  for (const baseDoc of docs) {
    // Make name unique if already exists
    let uniqueName = baseDoc.name;
    let suffix = 1;
    // Check for conflicts and append a numeric suffix
    while (await coll.findOne({ name: uniqueName })) {
      suffix += 1;
      uniqueName = `${baseDoc.name} (${suffix})`;
    }
    const doc = { ...baseDoc, name: uniqueName };

    const res = await coll.insertOne(doc);
    if (res.insertedId) inserted += 1; else updated += 0;
  }

  console.log(`Seed complete. Inserted: ${inserted}, matched(existing): ${updated}`);
  await client.close();
}

main().catch((e) => {
  console.error('Seed error', e);
  process.exit(1);
});

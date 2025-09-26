import { Router } from 'express';

const router = Router();

// Simple keyword-based specialization detection
function detectSpecialization(text) {
  const t = (text || '').toLowerCase();
  const map = [
    { keys: ['heart', 'cardiac', 'chest pain', 'hypertension'], spec: 'Cardiologist' },
    { keys: ['skin', 'rash', 'acne', 'derma'], spec: 'Dermatologist' },
    { keys: ['bone', 'fracture', 'joint', 'knee', 'orthopedic', 'orthopaedic'], spec: 'Orthopedic' },
    { keys: ['tooth', 'teeth', 'dental', 'gum'], spec: 'Dentist' },
    { keys: ['eye', 'vision', 'ophthalm'], spec: 'Ophthalmologist' },
    { keys: ['ear', 'nose', 'throat', 'ent', 'sinus'], spec: 'ENT' },
    { keys: ['brain', 'seizure', 'neuro', 'stroke', 'migraine'], spec: 'Neurologist' },
    { keys: ['child', 'kid', 'pediatric'], spec: 'Pediatrician' },
    { keys: ['pregnan', 'gyneco', 'gyno', 'women health', 'obstetric'], spec: 'Gynecologist' },
    { keys: ['sugar', 'diabetes', 'thyroid', 'endocrin'], spec: 'Endocrinologist' },
    { keys: ['kidney', 'renal', 'nephro'], spec: 'Nephrologist' },
    { keys: ['lung', 'asthma', 'copd', 'pulmon'], spec: 'Pulmonologist' },
    { keys: ['stomach', 'abdomen', 'gastric', 'ulcer', 'gastro', 'digest'], spec: 'Gastroenterologist' },
    { keys: ['cancer', 'onco', 'tumor', 'tumour'], spec: 'Oncologist' },
    { keys: ['mental', 'depression', 'anxiety', 'psychi'], spec: 'Psychiatrist' },
    { keys: ['fever', 'cold', 'cough', 'flu', 'general'], spec: 'General Physician' }
  ];
  for (const item of map) {
    if (item.keys.some(k => t.includes(k))) return item.spec;
  }
  return null;
}

// POST /api/message - send message to AI model
router.post('/message', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Booking intent detection and doctor suggestion
    const lower = message.toLowerCase();
    const isBookingIntent = /(\bappointment\b|\bbook\b|\bschedule\b|\breservation\b)/i.test(message);
    const detectedSpec = detectSpecialization(lower);

    if (isBookingIntent || detectedSpec) {
      try {
        const db = req.app.locals.db;
        const coll = db.collection('doctors');
        const query = detectedSpec ? { specialization: detectedSpec } : {};
        const doc = await coll.findOne(query);
        const doctor = doc ? { _id: String(doc._id), name: doc.name, specialization: doc.specialization || null } : null;
        const specialization = detectedSpec || (doctor && (doctor.specialization || null));
        const reply = specialization
          ? `I can help you book an appointment. Based on your message, a ${specialization} would be appropriate. I will take you to the appointment section now and suggest a doctor.`
          : `I can help you book an appointment. I will take you to the appointment section now. Please choose a specialization.`;
        return res.json({
          reply,
          intent: 'booking',
          specialization: specialization || null,
          doctor
        });
      } catch (e) {
        // If DB lookup fails, still redirect to booking
        return res.json({
          reply: 'I can help you book an appointment. I will take you to the appointment section now.',
          intent: 'booking'
        });
      }
    }

    // Get Ollama URL from environment and normalize
    const rawUrl = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
    const endpoint = /\/api\/generate$/i.test(rawUrl) ? rawUrl : `${rawUrl}/api/generate`;
    const model = process.env.OLLAMA_MODEL || 'qwen3:1.7b';

    // Send request to Ollama
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        // Medical-only instruction; avoid chain-of-thought / <think> blocks
        prompt: `You are a medical-only assistant. Strictly answer only questions related to health, medicine, symptoms, diagnosis, treatment, medications, lifestyle for health, or healthcare logistics. If the user asks about non-medical topics, politely refuse and redirect to medical topics. Do not include any internal reasoning, chain-of-thought, or <think> tags. If it's a serious medical concern, recommend consulting a healthcare professional.\n\nUser question: ${message}\n\nProvide a concise medical answer (no <think>):`,
        stream: false,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 500
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Ollama error:', errorText);
      return res.status(500).json({ 
        error: 'AI model is not available. Please make sure Ollama is running.',
        detail: errorText 
      });
    }

    const data = await response.json();
    let reply = data.response || 'I apologize, but I could not generate a response.';
    // Strip any <think>...</think> content if present
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to AI model. Please ensure Ollama is running.',
      detail: error.message 
    });
  }
});

export default router;

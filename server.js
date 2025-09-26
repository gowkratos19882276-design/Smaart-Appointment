import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

// Load env
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));
// If needed in the future, serve extra static directories here

// MongoDB connection
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/medical_bot';
const mongoClient = new MongoClient(mongoUri, { ignoreUndefined: true });
let db;

async function connectMongo() {
  await mongoClient.connect();
  // If URI has db, driver uses it; otherwise default database name is after last /. We'll enforce `medical_bot`.
  db = mongoClient.db('medical_bot');
  app.locals.db = db;
  app.locals.mongoClient = mongoClient;
  console.log('Connected to MongoDB');
}

// Routes
import doctorsRouter from './routes/doctors.js';
import bookingRouter from './routes/booking.js';
import chatRouter from './routes/chat.js';
// Removed legacy local WebRTC voice route in favor of Vapi

// Vapi now uses Public Key flow from the client; no server token minting is needed.

app.use('/api', (req, res, next) => {
  if (!db) return res.status(503).json({ error: 'Database not connected yet' });
  next();
});

app.use('/api', doctorsRouter);
app.use('/api', bookingRouter);
app.use('/api', chatRouter);
// Legacy voice route removed; Vapi handled entirely by client SDK (Public Key flow)

// Vapi AI endpoints
app.get('/api/vapi/status', (req, res) => {
  res.json({ configured: !!(process.env.VAPI_ASSISTANT_ID) });
});
// Expose non-sensitive assistant info to the client
app.get('/api/vapi/info', (req, res) => {
  res.json({
    assistantId: process.env.VAPI_ASSISTANT_ID || '',
    publicKey: process.env.VAPI_PUBLIC_KEY || ''
  });
});
// No /client-token endpoints needed in Public Key flow

// Health check for Ollama connectivity (optional)
app.get('/api/ollama/health', async (req, res) => {
  try {
    const base = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || process.env['ollama.base-url'] || 'http://localhost:11434').replace(/\/$/, '');
    res.json({ ok: true, base });
  } catch (_e) {
    res.status(200).json({ ok: false });
  }
});

// Fallback to index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const basePort = Number(process.env.PORT || 5000);

async function startServer(preferredPort) {
  await connectMongo();
  let currentPort = preferredPort;
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await new Promise((resolve) => {
      const server = app
        .listen(currentPort, () => {
          console.log(`Server listening on http://localhost:${currentPort}`);
          resolve({ ok: true });
        })
        .once('error', (err) => {
          if (err && err.code === 'EADDRINUSE') {
            console.error(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
            resolve({ ok: false, retry: true });
          } else {
            console.error('Server failed to start:', err);
            resolve({ ok: false, retry: false });
          }
        });
    });
    if (result.ok) return;
    if (result.retry) {
      currentPort += 1;
      continue;
    }
    break;
  }
  console.error('Unable to find a free port. Please free a port and retry.');
  process.exit(1);
}

startServer(basePort).catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});



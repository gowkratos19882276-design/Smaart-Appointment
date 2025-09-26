import { Router } from 'express';
import wrtc from 'wrtc';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { synthesizeSpeech } from '../services/piperService.js';
import { synthesizeSpeechWindows } from '../services/windowsTtsService.js';
import { transcribeAudio } from '../services/whisperService.js';
import { generateWithOllama } from '../services/ollamaService.js';
import { listDoctors, findDoctorByName, isSlotAvailable, createAppointment } from '../services/dbService.js';

const router = Router();

// Simple WAV writer and reader helpers
function writeWavHeader(buffer, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = buffer.length;
  const fileSize = 44 + dataSize - 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, buffer]);
}

function parseWavToPCM(filePath) {
  const buf = fs.readFileSync(filePath);
  const fmt = buf.slice(0, 44);
  const audio = buf.slice(44);
  const sampleRate = fmt.readUInt32LE(24);
  const channels = fmt.readUInt16LE(22);
  const bitsPerSample = fmt.readUInt16LE(34);
  return { pcm: audio, sampleRate, channels, bitsPerSample };
}

// Receptionist Dialogue Manager
class ReceptionistState {
  constructor() {
    this.stage = 'greet';
    this.context = { doctor: null, date: null, time: null, email: null };
  }
}

async function handleReceptionistTurn(db, text, state) {
  const reply = { text: '', done: false };
  const lower = (text || '').toLowerCase();
  const bookingIntent = /(appointment|book|schedule|reserve)/i.test(text || '');

  if (state.stage === 'greet') {
    state.stage = 'askDoctor';
    reply.text = 'Hello, this is the Smart Health receptionist. How may I help you today? If you want to book an appointment, please tell me the doctor or specialization.';
    return reply;
  }

  if (state.stage === 'askDoctor') {
    if (!bookingIntent && lower.trim()) {
      // non booking -> LLM fallback
      const llm = await generateWithOllama(`User asked: ${text}. Provide a concise answer.`, {
        model: process.env.OLLAMA_MODEL || 'mistral',
      });
      reply.text = llm;
      reply.done = false; // keep line open
      return reply;
    }
    // Try match doctor by name or list options
    const doctors = await listDoctors(db, {});
    if (!text || !text.trim()) {
      reply.text = `We have the following doctors available: ${doctors.map(d => `${d.name} (${d.specialization})`).join(', ')}. Which doctor would you like?`;
      return reply;
    }
    const found = await findDoctorByName(db, text.trim());
    if (!found) {
      reply.text = `I couldn't find that doctor. Available doctors are: ${doctors.map(d => d.name).join(', ')}. Please say the doctor's name.`;
      return reply;
    }
    state.context.doctor = found;
    state.stage = 'askDate';
    reply.text = `Great. For Dr. ${found.name}. Please tell me the date. For example, say "September 15".`;
    return reply;
  }

  if (state.stage === 'askDate') {
    const dateMatch = (text || '').match(/(\d{4}-\d{2}-\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/i);
    if (!dateMatch) {
      reply.text = 'Please say the date like "September 15" or "2025-09-15".';
      return reply;
    }
    // Very light normalization: keep the raw; UI/ops can standardize. Expect doctors.availability to have ISO like 2025-09-15
    state.context.date = dateMatch[0];
    state.stage = 'askTime';
    reply.text = 'Thanks. Now tell me a time, like "10:00 AM" or "14:30".';
    return reply;
  }

  if (state.stage === 'askTime') {
    const timeMatch = (text || '').match(/(\b\d{1,2}:\d{2}\s*(am|pm)?\b|\b\d{1,2}\s*(am|pm)\b)/i);
    if (!timeMatch) {
      reply.text = 'Please say a time like "10:00 AM" or "14:30".';
      return reply;
    }
    state.context.time = timeMatch[0].toUpperCase();
    state.stage = 'askEmail';
    reply.text = 'Got it. What is your email address for the booking confirmation?';
    return reply;
  }

  if (state.stage === 'askEmail') {
    const emailMatch = (text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!emailMatch) {
      reply.text = 'Please provide a valid email address like name@example.com.';
      return reply;
    }
    state.context.email = emailMatch[0];
    state.stage = 'confirm';
    reply.text = `Confirming: appointment with Dr. ${state.context.doctor.name} on ${state.context.date} at ${state.context.time}. Should I confirm?`;
    return reply;
  }

  if (state.stage === 'confirm') {
    if (/\b(yes|confirm|sure|go ahead|okay|ok)\b/i.test(text || '')) {
      // Check availability + create
      const ok = await isSlotAvailable(db, state.context.doctor.id, state.context.date, state.context.time);
      if (!ok) {
        state.stage = 'askTime';
        reply.text = 'Sorry, that slot is no longer available. Please choose a different time.';
        return reply;
      }
      const appt = await createAppointment(db, {
        doctorId: state.context.doctor.id,
        doctorName: state.context.doctor.name,
        patientEmail: state.context.email,
        date: state.context.date,
        time: state.context.time,
      });
      reply.text = `Your appointment with Dr. ${state.context.doctor.name} is confirmed for ${state.context.date} at ${state.context.time}. A confirmation email has been sent.`;
      reply.done = true;
      state.stage = 'done';
      return reply;
    }
    reply.text = 'Okay. Should I proceed with the booking? Please say yes to confirm or say a new time/date.';
    return reply;
  }

  reply.text = 'How may I assist you further?';
  return reply;
}

// Manage a single WebRTC session
router.post('/voice/session', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const { sdp } = req.body;
    if (!sdp) return res.status(400).json({ error: 'Missing SDP offer' });

    const pc = new wrtc.RTCPeerConnection({
      iceServers: [],
    });

    const state = new ReceptionistState();

    // Nonstandard sinks/sources for audio
    const { RTCAudioSink, RTCAudioSource } = wrtc.nonstandard || {};
    const audioSource = new RTCAudioSource();
    const audioTrack = audioSource.createTrack();
    pc.addTrack(audioTrack);

    let audioSink = null;

    pc.ontrack = (event) => {
      const [track] = event.streams[0] ? event.streams[0].getAudioTracks() : [event.track];
      if (!track) return;
      if (RTCAudioSink) {
        audioSink = new RTCAudioSink(track);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
        try { audioTrack.stop(); } catch {}
        if (audioSink) try { audioSink.stop(); } catch {}
        try { pc.close(); } catch {}
      }
    };

    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Kick off an async loop to process inbound audio every few seconds
    const SAMPLE_RATE = 48000; // node-webrtc sink frames are usually 48kHz
    let pcmChunks = [];
    let active = true;

    function linearResampleInt16(int16In, inRate, outRate) {
      if (inRate === outRate) return new Int16Array(int16In); // copy
      const ratio = outRate / inRate;
      const outLen = Math.max(1, Math.round(int16In.length * ratio));
      const out = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const t = i / ratio; // position in input samples
        const i0 = Math.floor(t);
        const i1 = Math.min(i0 + 1, int16In.length - 1);
        const frac = t - i0;
        const s0 = int16In[i0] || 0;
        const s1 = int16In[i1] || s0;
        out[i] = (s0 * (1 - frac) + s1 * frac) | 0;
      }
      return out;
    }

    async function speak(text) {
      try {
        const engine = (process.env.TTS_ENGINE || 'piper').toLowerCase();
        let wavPath;
        if (engine === 'windows_sapi') {
          wavPath = await synthesizeSpeechWindows(text, {});
        } else {
          try {
            wavPath = await synthesizeSpeech(text, {});
          } catch (e) {
            console.warn('[voice] Piper TTS failed, falling back to Windows SAPI:', e.message);
            wavPath = await synthesizeSpeechWindows(text, {});
          }
        }
        const { pcm, sampleRate } = parseWavToPCM(wavPath);
        console.log(`[voice] TTS wav ready: rate=${sampleRate}Hz, bytes=${pcm.length}`);
        const targetRate = 48000;
        // Convert PCM buffer to Int16Array view
        const inInt16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
        const resampled = linearResampleInt16(inInt16, sampleRate, targetRate);
        // Stream to peer in frames of 10ms at 48kHz mono: 480 samples
        const frameSize = 480;
        let frames = 0;
        for (let i = 0; i < resampled.length; i += frameSize) {
          let slice = resampled.subarray(i, i + frameSize);
          if (slice.length < frameSize) {
            // pad last chunk with zeros to reach exact 480 samples
            const padded = new Int16Array(frameSize);
            padded.set(slice, 0);
            slice = padded;
          }
          // Convert to a Buffer of exactly 960 bytes (480 samples * 2 bytes)
          const chunk = Buffer.from(slice.buffer, slice.byteOffset, frameSize * 2);
          audioSource.onData({ samples: chunk, sampleRate: 48000, bitsPerSample: 16, channelCount: 1, numberOfFrames: frameSize });
          await new Promise(r => setTimeout(r, 10));
          frames++;
        }
        console.log(`[voice] TTS streamed ${frames} frames (~${(frames*10)|0}ms)`);
        fs.unlink(wavPath, () => {});
      } catch (e) {
        console.error('TTS playback error:', e);
      }
    }

    // Initial greeting
    speak('Hello, this is the Smart Health receptionist. How may I help you today?');

    if (audioSink) {
      audioSink.ondata = (data) => {
        if (!active) return;
        // data.samples Int16Array at 48kHz mono/stereo, use first channel only
        const samples = data.samples;
        // Append raw PCM 16-bit little endian mono
        const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
        pcmChunks.push(buf);
      };

      // Periodically transcribe last few seconds
      (async function loop() {
        while (active) {
          await new Promise(r => setTimeout(r, 3500));
          const chunks = pcmChunks;
          pcmChunks = [];
          if (!chunks.length) continue;
          const mono = Buffer.concat(chunks);
          const wav = writeWavHeader(mono, 48000, 1, 16);
          const tmp = path.join(os.tmpdir(), `in_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
          fs.writeFileSync(tmp, wav);
          try {
            const text = await transcribeAudio(tmp, { language: 'en' });
            if (text && text.trim()) {
              const turn = await handleReceptionistTurn(db, text.trim(), state);
              if (turn.text) await speak(turn.text);
            }
          } catch (e) {
            console.error('STT error:', e.message);
          } finally {
            fs.unlink(tmp, () => {});
          }
        }
      })();
    }

    res.json({ sdp: pc.localDescription.sdp });
  } catch (e) {
    console.error('Voice session error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

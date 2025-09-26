import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Piper TTS via CLI. Requires piper in PATH and a voice model .onnx set by PIPER_MODEL.
// Returns path to generated WAV file.
export async function synthesizeSpeech(text, {
  piperBin = process.env.PIPER_BIN || 'piper',
  modelPath = process.env.PIPER_MODEL, // e.g., en_US-lessac-medium.onnx
  outDir = os.tmpdir(),
  // sampleRate intentionally not forced; use model's native rate to avoid crashes on some Windows builds
} = {}) {
  if (!modelPath) throw new Error('PIPER_MODEL is not set. Please set env var to your Piper .onnx model path');
  if (!text || !text.trim()) throw new Error('Piper TTS received empty text');
  const outFile = path.join(outDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  const inFile = path.join(outDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(inFile, text, 'utf8');
  return new Promise((resolve, reject) => {
    const args = ['--model', modelPath, '--input_file', inFile, '--output_file', outFile];
    // If a config JSON exists next to the model or env PIPER_CONFIG is set, include it
    try {
      const envCfg = process.env.PIPER_CONFIG;
      let cfg = envCfg && envCfg.trim() ? envCfg.trim() : '';
      if (!cfg) {
        const guess = modelPath.replace(/\.onnx$/i, '.json');
        if (fs.existsSync(guess)) cfg = guess;
      }
      if (cfg) {
        args.push('--config', cfg);
      }
    } catch (_) { /* ignore */ }
    const proc = spawn(piperBin, args, { stdio: ['ignore', 'inherit', 'inherit'], shell: false });
    proc.on('error', (e) => {
      try { fs.unlink(inFile, () => {}); } catch(_) {}
      const err = new Error(`Failed to start Piper: ${e.message}. BIN=${piperBin} ARGS=${args.join(' ')}`);
      reject(err);
    });
    proc.on('exit', (code) => {
      try { fs.unlink(inFile, () => {}); } catch(_) {}
      if (code !== 0) return reject(new Error(`Piper exited with code ${code}`));
      resolve(outFile);
    });
  });
}

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Whisper Service using local CLI (e.g., whisper.cpp or OpenAI Whisper if installed as CLI)
// Expects a WAV/MP3/OGG audio file path and returns a transcription string.
// Configure the binary via WHISPER_BIN or rely on `whisper` in PATH.
export async function transcribeAudio(filePath, {
  language = 'en',
  model = process.env.WHISPER_MODEL || 'base',
  whisperBin = process.env.WHISPER_BIN || 'whisper',
} = {}) {
  // We'll try multiple binaries until one succeeds
  const candidateBins = Array.from(new Set([
    whisperBin,
    'whisper-cli.exe',
    'whisper-cli',
    'main.exe',
    'main',
    'whisper',
    'whisper.cpp',
  ].filter(Boolean)));

  const errors = [];

  for (const bin of candidateBins) {
    try {
      // whisper.cpp style (main/whisper-cli): -m <modelPath> -f <wav> -l en -otxt -of <base>
      if (/(main|whisper-cli|whisper\.cpp)/i.test(bin)) {
        const outBase = path.join(os.tmpdir(), `whisper_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        const txtPath = `${outBase}.txt`;
        const modelPath = process.env.WHISPER_MODEL_PATH || '';
        const finalArgs = [];
        if (modelPath) finalArgs.push('-m', modelPath);
        finalArgs.push('-f', filePath, '-l', language, '-otxt', '-of', outBase);

        await new Promise((resolve, reject) => {
          const proc = spawn(bin, finalArgs, { stdio: 'inherit', shell: true });
          proc.on('error', reject);
          proc.on('exit', (code) => {
            if (code !== 0) return reject(new Error(`Whisper (${bin}) exited with code ${code}`));
            resolve(null);
          });
        });
        const text = fs.readFileSync(txtPath, 'utf8');
        try { fs.unlink(txtPath, () => {}); } catch {}
        return text.trim();
      }

      // Generic whisper CLI style: whisper audio.wav --model base --language en --output_format txt --output_dir tmp
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
      await new Promise((resolve, reject) => {
        const proc = spawn(bin, [
          filePath,
          '--model', model,
          '--language', language,
          '--output_format', 'txt',
          '--output_dir', outDir,
        ], { shell: true });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code !== 0) return reject(new Error(`Whisper (${bin}) exited with code ${code}: ${stderr}`));
          resolve(null);
        });
      });
      const files = fs.readdirSync(outDir).filter(f => f.endsWith('.txt'));
      if (!files.length) throw new Error('No transcription file produced by Whisper');
      const text = fs.readFileSync(path.join(outDir, files[0]), 'utf8');
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
      return text.trim();
    } catch (e) {
      errors.push(`${bin}: ${e && e.message ? e.message : String(e)}`);
      continue;
    }
  }

  throw new Error(`All Whisper binaries failed. Tried: ${candidateBins.join(', ')}\nErrors:\n${errors.join('\n')}`);
}

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

// Windows SAPI TTS via PowerShell + System.Speech (fully local)
// Produces a WAV file and returns its path.
export async function synthesizeSpeechWindows(text, {
  voice = process.env.SAPI_VOICE || '', // e.g., "Microsoft Zira Desktop"
  outDir = os.tmpdir(),
} = {}) {
  if (!text || !text.trim()) throw new Error('Windows TTS received empty text');
  const outFile = path.join(outDir, `sapi_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);

  // Use a small PowerShell script to synthesize
  const psScript = `
param(
  [string]$Text,
  [string]$OutPath,
  [string]$Voice
)
Add-Type -AssemblyName System.Speech
$spk = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  if ($Voice -and $Voice.Trim().Length -gt 0) {
    try { $spk.SelectVoice($Voice) } catch { }
  }
  $spk.Rate = 0
  $spk.Volume = 100
  $spk.SetOutputToWaveFile($OutPath)
  $spk.Speak($Text)
} finally {
  $spk.Dispose()
}
`;
  const psPath = path.join(outDir, `sapi_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(psPath, psScript, 'utf8');

  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath, '-Text', text, '-OutPath', outFile];
    if (voice && voice.trim()) {
      args.push('-Voice', voice);
    }
    const proc = spawn('powershell', args, { stdio: ['ignore', 'inherit', 'inherit'] });
    proc.on('error', (e) => {
      try { fs.unlink(psPath, () => {}); } catch(_) {}
      reject(new Error(`Failed to start PowerShell SAPI TTS: ${e.message}`));
    });
    proc.on('exit', (code) => {
      try { fs.unlink(psPath, () => {}); } catch(_) {}
      if (code !== 0) return reject(new Error(`PowerShell SAPI TTS exited with code ${code}`));
      resolve(outFile);
    });
  });
}

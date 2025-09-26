// Ollama service: simple text generation wrapper
export async function generateWithOllama(prompt, {
  baseUrl = (process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, ''),
  model = process.env.OLLAMA_MODEL || 'mistral',
  system = 'You are a helpful, concise medical receptionist. Do not output <think> tags.',
  temperature = 0.7,
  top_p = 0.9,
  max_tokens = 400,
} = {}) {
  const endpoint = /\/api\/generate$/i.test(baseUrl) ? baseUrl : `${baseUrl}/api/generate`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: `${system}\n\n${prompt}`, stream: false, options: { temperature, top_p, max_tokens } }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Ollama error: ${txt}`);
  }
  const data = await resp.json();
  let reply = data.response || '';
  reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return reply;
}

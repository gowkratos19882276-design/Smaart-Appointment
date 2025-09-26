(() => {
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const micBtn = document.getElementById('mic');

  const State = {
    mode: null, // 'booking' | 'chat'
    booking: {
      selectedSpecialization: null,
      selectedDoctor: null,
      selectedDate: null,
      selectedTime: null
    }
  };

  function addMessage(text, role = 'bot', buttons = []) {
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${role}`;
    avatar.textContent = role === 'bot' ? 'MB' : 'You';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    const container = document.createElement('div');
    container.style.maxWidth = '100%';
    container.appendChild(bubble);

    if (buttons && buttons.length) {
      const btns = document.createElement('div');
      btns.className = 'btns';
      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.success ? ' success' : '');
        btn.textContent = b.label;
        btn.onclick = b.onClick;
        btns.appendChild(btn);
      });
      container.appendChild(btns);
    }

    msg.appendChild(avatar);
    msg.appendChild(container);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Speak bot replies aloud using Web Speech API
    if (role === 'bot') {
      speak(text);
    }
  }

  function start() {
    addMessage('Would you like to Book an Appointment or General Chat?', 'bot', [
      { label: 'Book Appointment', primary: true, onClick: () => chooseBooking() },
      { label: 'General Chat', onClick: () => chooseChat() }
    ]);
  }

  function chooseBooking() {
    State.mode = 'booking';
    addMessage('Book Appointment selected.', 'user');
    // reset booking selections
    State.booking.selectedSpecialization = null;
    State.booking.selectedDoctor = null;
    State.booking.selectedDate = null;
    State.booking.selectedTime = null;
    loadSpecializations();
  }

  function chooseChat() {
    State.mode = 'chat';
    addMessage('General Chat selected.', 'user');
    addMessage('Ask me anything medical-related.');
  }

  async function loadDoctors() {
    addMessage('Fetching available doctors...');
    try {
      const res = await fetch('/api/doctors');
      const doctors = await res.json();
      if (!Array.isArray(doctors) || doctors.length === 0) {
        addMessage('No doctors available. Please try later.');
        return;
      }
      addMessage('Please select a doctor:', 'bot', doctors.map((d) => ({
        label: `${d.name} — ${d.specialization || ''}`.trim(),
        onClick: () => selectDoctor(d)
      })));
    } catch (e) {
      addMessage('Failed to load doctors.');
    }
  }

  // New: Specialization-first flow
  async function loadSpecializations() {
    addMessage('Fetching specializations...');
    try {
      const res = await fetch('/api/doctors');
      const doctors = await res.json();
      if (!Array.isArray(doctors) || doctors.length === 0) {
        addMessage('No doctors available. Please try later.');
        return;
      }
      const specs = Array.from(new Set(doctors.map(d => (d.specialization || 'General')))).sort();
      addMessage('Please select a specialization:', 'bot', specs.map(s => ({
        label: s,
        onClick: () => selectSpecialization(s, doctors)
      })));
    } catch (_) {
      addMessage('Failed to load specializations.');
    }
  }

  function selectSpecialization(spec, allDoctors) {
    State.booking.selectedSpecialization = spec;
    addMessage(`Specialization selected: ${spec}`, 'user');
    // Filter doctors by specialization and show list
    const filtered = (allDoctors || []).filter(d => (d.specialization || 'General') === spec);
    if (!filtered.length) {
      addMessage('No doctors in this specialization. Please choose another.');
      // Offer to choose specialization again
      loadSpecializations();
      return;
    }
    addMessage('Please select a doctor:', 'bot', filtered.map(d => ({
      label: `${d.name} — ${d.specialization || ''}`.trim(),
      onClick: () => selectDoctor(d)
    })));
  }

  async function selectDoctor(doctor) {
    State.booking.selectedDoctor = doctor;
    addMessage(`Doctor selected: ${doctor.name}`, 'user');
    addMessage('Fetching available dates...');
    try {
      const res = await fetch(`/api/doctors/${doctor._id}/availability`);
      const data = await res.json();
      const availability = Array.isArray(data.availability) ? data.availability : [];
      if (availability.length === 0) {
        addMessage('No availability for this doctor. Choose another.');
        return;
      }
      const byDate = availability.reduce((acc, a) => {
        if (!acc[a.date]) acc[a.date] = [];
        acc[a.date].push(a.time);
        return acc;
      }, {});
      const dates = Object.keys(byDate).sort();
      addMessage('Select a date:', 'bot', dates.map(date => ({ label: date, onClick: () => selectDate(date, byDate[date]) })));
    } catch (e) {
      addMessage('Failed to load availability.');
    }
  }

  function selectDate(date, times) {
    State.booking.selectedDate = date;
    addMessage(`Date selected: ${date}`, 'user');
    const timeButtons = times.map(t => ({ label: t, onClick: () => selectTime(t) }));
    addMessage('Select a time:', 'bot', timeButtons);
  }

  function selectTime(time) {
    State.booking.selectedTime = time;
    addMessage(`Time selected: ${time}`, 'user');
    addMessage('Please enter your email in the input and press Send.');
  }

  async function handleSend() {
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';

    if (State.mode === 'chat') {
      addMessage(text, 'user');
      await sendToModel(text);
      return;
    }

    if (State.mode === 'booking') {
      if (!State.booking.selectedDoctor || !State.booking.selectedDate || !State.booking.selectedTime) {
        addMessage(text, 'user');
        addMessage('Please choose doctor, date, and time using the buttons above.');
        return;
      }
      const email = text;
      addMessage(email, 'user');
      await confirmBooking(email);
      return;
    }

    // If no mode chosen, interpret as choosing a mode
    addMessage(text, 'user');
    addMessage('Please choose an option:', 'bot', [
      { label: 'Book Appointment', primary: true, onClick: () => chooseBooking() },
      { label: 'General Chat', onClick: () => chooseChat() }
    ]);
  }

  async function sendToModel(message) {
    try {
      sendBtn.disabled = true;
      const res = await fetch('/api/message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // If backend detected booking intent, ask for confirmation before switching
        if (data && data.intent === 'booking') {
          const combined = `${data.reply ? data.reply.trim() + ' ' : ''}Shall I take you to the appointment section? Please select the Yes or No option.`;
          addMessage(combined, 'bot', [
            {
              label: 'Yes',
              primary: true,
              onClick: async () => {
                // Move UI into booking mode only after consent
                chooseBooking();
                try {
                  const docs = await fetch('/api/doctors').then(r => r.json()).catch(() => []);
                  if (data.doctor) {
                    const suggested = (Array.isArray(docs) ? docs.find(d => String(d._id) === String(data.doctor._id)) : null) || data.doctor;
                    if (suggested) {
                      addMessage(`Suggested doctor: ${suggested.name}${suggested.specialization ? ' — ' + suggested.specialization : ''}`, 'bot');
                      // Preselect doctor and fetch availability
                      await selectDoctor(suggested);
                      return;
                    }
                  }
                  if (data.specialization) {
                    // Auto-pick specialization to narrow choices
                    selectSpecialization(data.specialization, Array.isArray(docs) ? docs : []);
                    return;
                  }
                } catch (_) {
                  // Fall through to booking UI without auto-selection
                }
              }
            },
            {
              label: 'No',
              onClick: () => {
                addMessage('Okay. If you need to book later, just say "appointment" anytime.', 'bot');
              }
            }
          ]);
          return;
        }
        // Regular chat reply
        if (data.reply) {
          addMessage(data.reply);
        } else {
          addMessage('No response from model.');
        }
      } else if (!res.ok) {
        const detail = data && (data.reply || data.error || data.detail || JSON.stringify(data));
        addMessage(`Model error: ${detail}`);
      }
    } catch (e) {
      addMessage('Failed to reach the model. Is Ollama running?');
    } finally {
      sendBtn.disabled = false;
    }
  }

  async function confirmBooking(patient_email) {
    try {
      sendBtn.disabled = true;
      const payload = {
        doctorId: State.booking.selectedDoctor._id,
        date: State.booking.selectedDate,
        time: State.booking.selectedTime,
        patient_email
      };
      const res = await fetch('/api/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        addMessage(`✅ Your appointment with ${State.booking.selectedDoctor.name} on ${State.booking.selectedDate} at ${State.booking.selectedTime} is confirmed.`, 'bot');
      } else {
        addMessage(data.error || 'Failed to book the appointment.');
      }
    } catch (e) {
      addMessage('Booking failed. Please try again.');
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(); });

  // --------------------
  // Voice: Text-to-Speech
  // --------------------
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      // Try to pick a natural English voice
      const pickVoice = () => {
        const voices = synth.getVoices && synth.getVoices ? synth.getVoices() : [];
        let v = voices.find(v => v.lang && v.lang.startsWith('en') && /female/i.test(v.name || ''))
              || voices.find(v => v.lang && v.lang.startsWith('en'))
              || null;
        if (v) utter.voice = v;
      };
      if (synth.getVoices && synth.getVoices().length) {
        pickVoice();
      } else if (typeof synth.onvoiceschanged !== 'undefined') {
        synth.onvoiceschanged = () => pickVoice();
      }
      // Stop any ongoing speech and speak new reply
      try { synth.cancel(); } catch(_){}
      synth.speak(utter);
    } catch (_) {
      // ignore TTS errors
    }
  }

  function stopSpeaking() {
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch (_) {
      // ignore
    }
  }

  // --------------------
  // Voice: Speech-to-Text (Web Speech API)
  // --------------------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognizing = false;
  let finalTranscript = '';
  let micPermissionChecked = false;
  let micPermissionGranted = false;

  function ensureRecognition() {
    if (!SpeechRecognition) return null;
    if (recognition) return recognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.continuous = false; // more reliable single-utterance mode in Chrome

    recognition.onstart = () => {
      recognizing = true;
      finalTranscript = '';
      if (micBtn) micBtn.classList.add('recording');
      try { inputEl.dataset.prevPlaceholder = inputEl.placeholder; } catch(_){}
      inputEl.placeholder = 'Listening…';
      try { console.debug('[Mic] onstart'); } catch(_){}
    };
    recognition.onerror = (e) => {
      // Surface helpful errors
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        addMessage('Microphone access was blocked. Please allow mic permission in your browser and try again.', 'bot');
      } else if (e && e.error === 'no-speech') {
        addMessage("I didn't catch that. Please try speaking again.", 'bot');
      } else if (e && e.error === 'audio-capture') {
        addMessage('No microphone was found. Please check your audio input device.', 'bot');
      }
    };
    recognition.onresult = (event) => {
      try { console.debug('[Mic] onresult', event); } catch(_){}
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      // Optionally show interim in the input field
      inputEl.value = (finalTranscript || interim).trim();
    };
    recognition.onnomatch = () => {
      addMessage("I couldn't understand you. Please try again.", 'bot');
    };
    recognition.onspeechend = () => {
      try { recognition.stop(); } catch(_){}
    };
    recognition.onaudioend = () => {
      // audio stream ended
    };
    recognition.onend = () => {
      try { console.debug('[Mic] onend'); } catch(_){}
      recognizing = false;
      if (micBtn) micBtn.classList.remove('recording');
      if (inputEl && inputEl.dataset && inputEl.dataset.prevPlaceholder !== undefined) {
        inputEl.placeholder = inputEl.dataset.prevPlaceholder || 'Type a message...';
        delete inputEl.dataset.prevPlaceholder;
      } else {
        inputEl.placeholder = 'Type a message...';
      }
      // If we captured something, submit it like typed input
      const text = (finalTranscript || inputEl.value || '').trim();
      if (text) {
        // Ensure the input holds the final transcript before sending
        inputEl.value = text;
        handleSend();
      }
    };
    return recognition;
  }

  async function ensureMicPermission() {
    if (micPermissionChecked) return micPermissionGranted;
    micPermissionChecked = true;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // immediately stop tracks; we only needed the permission prompt
        stream.getTracks().forEach(t => t.stop());
        micPermissionGranted = true;
      } else {
        micPermissionGranted = true; // assume allowed if not available
      }
    } catch (err) {
      micPermissionGranted = false;
      addMessage('Microphone permission denied. Please allow access and try again.', 'bot');
    }
    return micPermissionGranted;
  }

  async function toggleMic() {
    const rec = ensureRecognition();
    if (!rec) {
      // Web Speech API not supported
      addMessage('Speech recognition not supported in this browser. Try Chrome.', 'bot');
      return;
    }
    if (recognizing) {
      try { rec.stop(); } catch(_){}
      return;
    }
    try {
      // Stop TTS so it doesn't hold the audio focus
      stopSpeaking();
      const ok = await ensureMicPermission();
      if (!ok) return;
      finalTranscript = '';
      rec.start();
    } catch (_) {
      // starting twice throws, ignore
    }
  }

  if (micBtn) {
    micBtn.addEventListener('click', toggleMic);
  }

  // Kickoff
  addMessage('Welcome to smaart healthcare clinic');
  start();
})();



// ----------------------------
// Voice Receptionist UI (Vapi only, Public Key flow)
// ----------------------------
(() => {
  const startBtn = document.getElementById('startCall');
  const endBtn = document.getElementById('endCall');
  const remoteAudio = document.getElementById('remoteAudio');

  let vapiClient = null;
  let vapiActive = false;

  async function waitForVapiReady(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if ((window && (window.Vapi || window.VapiWeb)) || window.__VAPI_READY__) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  function ensureVapi() {
    const VapiGlobal = (window && (window.Vapi || window.VapiWeb)) || null;
    if (!VapiGlobal) throw new Error('Vapi Web SDK not loaded.');
    return VapiGlobal;
  }

  async function startCall() {
    try {
      if (vapiActive) return;
      // Wait for SDK to finish loading from CDN
      const ready = await waitForVapiReady();
      if (!ready) {
        throw new Error('Vapi Web SDK not loaded.');
      }
      const assistantInfo = await fetch('/api/vapi/info').then(r => r.json()).catch(() => ({}));
      const assistantId = assistantInfo.assistantId || '';
      if (!assistantId) {
        alert('Assistant ID not configured on server. Set VAPI_ASSISTANT_ID in .env.');
        return;
      }
      const publicKey = assistantInfo.publicKey || ((window && window.VAPI_PUBLIC_KEY) || '');
      if (!publicKey) {
        alert('Vapi Public Key is missing. Set VAPI_PUBLIC_KEY in your .env and restart the server.');
        return;
      }

      const VapiGlobal = ensureVapi();
      let client = null;
      try {
        // Preferred: global constructor Vapi(apiToken)
        if (typeof VapiGlobal === 'function') {
          client = new VapiGlobal(publicKey);
        } else if (VapiGlobal && typeof VapiGlobal.default === 'function') {
          client = new VapiGlobal.default(publicKey);
        } else if (VapiGlobal && typeof VapiGlobal.Client === 'function') {
          // Some builds expose a Client factory/class
          client = new VapiGlobal.Client({ apiToken: publicKey, publicKey });
          if (client.connect) await client.connect();
        } else if (VapiGlobal && typeof VapiGlobal.createClient === 'function') {
          client = await VapiGlobal.createClient({ apiToken: publicKey, publicKey });
        }
      } catch (e) {
        console.error('Vapi client init error:', e);
      }
      if (!client) throw new Error('Vapi Web SDK initialization failed (public key mode)');

      // Attach audio element
      try {
        if (client.attachAudioElement) client.attachAudioElement(remoteAudio);
        else if (client.setAudioElement) client.setAudioElement(remoteAudio);
      } catch (_) {}

      // Start voice session (library expects assistantId as first argument when using default export class)
      if (client.start) await client.start(assistantId);
      else if (client.startCall) await client.startCall(assistantId);
      else if (client.connect && !client.connected) await client.connect({ assistantId });

      vapiClient = client;
      vapiActive = true;
      if (startBtn) startBtn.style.display = 'none';
      if (endBtn) endBtn.style.display = 'inline-block';
    } catch (e) {
      console.error('Vapi start error:', e);
      alert('Failed to start Vapi voice session: ' + (e && e.message ? e.message : e));
    }
  }

  function endCall() {
    if (vapiActive && vapiClient) {
      try {
        if (vapiClient.stop) vapiClient.stop();
        else if (vapiClient.end) vapiClient.end();
        else if (vapiClient.disconnect) vapiClient.disconnect();
      } catch (_) {}
      vapiClient = null;
      vapiActive = false;
      if (remoteAudio) {
        try { remoteAudio.srcObject = null; } catch (_) {}
      }
    }
    if (startBtn) startBtn.style.display = 'inline-block';
    if (endBtn) endBtn.style.display = 'none';
  }

  if (startBtn) startBtn.addEventListener('click', startCall);
  if (endBtn) endBtn.addEventListener('click', endCall);
})();

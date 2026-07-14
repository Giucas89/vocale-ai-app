// State Management
let isListening = false;
let isSpeaking = false;
let listeningMode = localStorage.getItem('vocale_listening_mode') || 'manual';
let apiKey = localStorage.getItem('vocale_api_key') || '';
let username = localStorage.getItem('vocale_username') || '';
let locationContext = localStorage.getItem('vocale_location') || 'Generico';
let modelId = localStorage.getItem('vocale_model_id') || 'gemini-3.1-flash-lite';

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const micInstruction = document.getElementById('mic-instruction');
const statusDiv = document.getElementById('status');
const heardBox = document.getElementById('heard-box');
const heardTextSpan = document.getElementById('heard-text');

// Suggestion Buttons
const suggestBtns = [
    document.getElementById('suggest-1'),
    document.getElementById('suggest-2'),
    document.getElementById('suggest-3')
];
const customBtn = document.getElementById('custom-btn');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const settingsOpenBtn = document.getElementById('settings-open-btn');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const apiKeyInput = document.getElementById('api-key-input');
const usernameInput = document.getElementById('username-input');
const locationSelect = document.getElementById('location-select');
const listeningModeSelect = document.getElementById('listening-mode-select');
const modelSelect = document.getElementById('model-select');
const voiceSelect = document.getElementById('voice-select');
const voiceRate = document.getElementById('voice-rate');
const voicePitch = document.getElementById('voice-pitch');
const rateVal = document.getElementById('rate-val');
const pitchVal = document.getElementById('pitch-val');
const clearMemoryBtn = document.getElementById('clear-memory-btn');

// Emergency inputs DOM
const emLblInputs = [
    document.getElementById('em-lbl-1'),
    document.getElementById('em-lbl-2'),
    document.getElementById('em-lbl-3'),
    document.getElementById('em-lbl-4')
];
const emTxtInputs = [
    document.getElementById('em-txt-1'),
    document.getElementById('em-txt-2'),
    document.getElementById('em-txt-3'),
    document.getElementById('em-txt-4')
];
const emergencyBar = document.getElementById('emergency-bar');

// Custom Text Elements
const customModal = document.getElementById('custom-modal');
const customCloseBtn = document.getElementById('custom-close-btn');
const customTextInput = document.getElementById('custom-text-input');
const customClearBtn = document.getElementById('custom-clear-btn');
const customSpeakBtn = document.getElementById('custom-speak-btn');
const predictiveWordsGrid = document.getElementById('predictive-words-grid');

// Web Audio Visualizer State
let audioCtx = null;
let analyser = null;
let dataArray = null;
let sourceNode = null;
let micStream = null;
let animationId = null;
const visualizerCanvas = document.getElementById('audio-visualizer');
const canvasCtx = visualizerCanvas.getContext('2d');

// CAA Dictionary for autocomplete (~50 high impact words)
const caaDictionary = [
    'voglio', 'posso', 'devo', 'ho', 'sono', 'non', 'sì', 'no', 'grazie', 'per favore', 
    'aiuto', 'bagno', 'acqua', 'caffè', 'cibo', 'fame', 'sete', 'dolore', 'medico', 'letto', 
    'dormire', 'mangiare', 'bere', 'andare', 'parlare', 'capito', 'stanco', 'caldo', 'freddo', 'bene', 
    'male', 'chiaro', 'scusa', 'pronto', 'adesso', 'dopo', 'domani', 'oggi', 'casa', 'fuori', 
    'qui', 'lì', 'perché', 'cosa', 'chi', 'come', 'quando', 'dove', 'piace'
];

// Default emergency button configurations
const defaultEmergencies = [
    { label: "🚨 AIUTO", text: "Aiuto!" },
    { label: "🥤 SETE", text: "Ho sete" },
    { label: "🚾 BAGNO", text: "Devo andare in bagno" },
    { label: "⚠️ DOLORE", text: "Sento dolore" }
];

// Web Speech Recognition Setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let interimSilenceTimer = null; // Timer for speech debounce

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.interimResults = true; // Enabled interim results for live visual feedback and fast debounce
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        updateMicUI(true);
        if (listeningMode === 'continuous') {
            showStatus("Ascolto passivo attivo...");
        } else {
            showStatus("Ti ascolto...");
        }
    };

    recognition.onend = () => {
        // Clear interim timer
        if (interimSilenceTimer) {
            clearTimeout(interimSilenceTimer);
            interimSilenceTimer = null;
        }

        if (isListening && listeningMode === 'continuous' && !isSpeaking) {
            // Auto-restart in continuous mode if we are still active and not speaking
            setTimeout(() => {
                if (isListening && listeningMode === 'continuous' && !isSpeaking) {
                    try {
                        recognition.start();
                    } catch (e) {
                        console.error("Impossibile riavviare il microfono:", e);
                    }
                }
            }, 300);
        } else {
            updateMicUI(false);
            if (!isSpeaking) {
                if (apiKey) {
                    showStatus(listeningMode === 'continuous' ? "Ascolto in pausa" : "Tocca il microfono per parlare");
                } else {
                    showStatus("Imposta la chiave API per iniziare");
                }
            }
        }
    };

    recognition.onresult = (event) => {
        // Clear existing debounce timer on every new speech token
        if (interimSilenceTimer) {
            clearTimeout(interimSilenceTimer);
            interimSilenceTimer = null;
        }

        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        // Case A: Browser already sent the final transcript
        if (finalTranscript.trim().length > 0) {
            processSpeechResult(finalTranscript.trim());
            return;
        }

        // Case B: Interim transcript (real-time stream)
        if (interimTranscript.trim().length > 0) {
            heardTextSpan.textContent = interimTranscript;
            heardBox.classList.remove('hidden');
            heardBox.classList.remove('alert-glow');

            // Start debounce timer (wait 500ms of absolute silence before processing)
            interimSilenceTimer = setTimeout(() => {
                console.log("Silenzio rilevato. Processo trascrizione intermedia per accelerare la risposta.");
                // Stop microphone to finalize speech stream
                if (recognition) {
                    recognition.stop();
                }
                processSpeechResult(interimTranscript.trim());
            }, 500);
        }
    };

    recognition.onerror = (event) => {
        console.warn("Riconoscimento vocale interrotto o errore:", event.error);
        if (event.error === 'no-speech') {
            return; // Normal, will auto-restart
        }
        if (event.error === 'not-allowed') {
            showStatus("Permesso microfono negato!");
            isListening = false;
            updateMicUI(false);
        }
    };
} else {
    showStatus("Browser non supportato per la dettatura.");
    micBtn.disabled = true;
}

// Process Speech Result
function processSpeechResult(text) {
    heardTextSpan.textContent = text;
    heardBox.classList.remove('hidden');
    heardBox.classList.remove('alert-glow');

    let userDirectlyAddressed = false;

    // Check Username Mention
    if (username && text.toLowerCase().includes(username.toLowerCase())) {
        userDirectlyAddressed = true;
        heardBox.classList.add('alert-glow');
        
        // Haptic Alert for Phone
        if (navigator.vibrate) {
            try {
                navigator.vibrate([150, 100, 150]);
            } catch (err) {
                console.log("Vibrate ignored by browser security:", err);
            }
        }
        
        // Clear glowing after 4s
        setTimeout(() => {
            heardBox.classList.remove('alert-glow');
        }, 4000);
    }

    if (listeningMode === 'manual') {
        isListening = false;
        updateMicUI(false);
    }

    processSpeechContext(text, userDirectlyAddressed);
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Load Saved Settings
    apiKeyInput.value = apiKey;
    usernameInput.value = username;
    locationSelect.value = locationContext;
    listeningModeSelect.value = listeningMode;
    modelSelect.value = modelId;
    
    // Sliders init
    voiceRate.value = localStorage.getItem('vocale_voice_rate') || '1.0';
    voicePitch.value = localStorage.getItem('vocale_voice_pitch') || '1.0';
    rateVal.textContent = voiceRate.value + 'x';
    pitchVal.textContent = voicePitch.value;

    // Load Emergency Buttons
    const emergencies = getEmergencyConfig();
    emergencies.forEach((item, index) => {
        if (emLblInputs[index]) emLblInputs[index].value = item.label;
        if (emTxtInputs[index]) emTxtInputs[index].value = item.text;
    });
    renderEmergencyFooter();

    // Check API Key
    if (!apiKey) {
        showStatus("Imposta la chiave API nelle Impostazioni (icona ⚙️)");
    } else {
        showStatus(listeningMode === 'continuous' ? "Ascolto passivo pronto. Attiva col microfono." : "Tocca il microfono per parlare");
        enablePredictiveButtons(false);
    }

    // TTS Voice loading
    populateVoiceList();
});

// Settings & Range event listeners
voiceRate.addEventListener('input', () => rateVal.textContent = voiceRate.value + 'x');
voicePitch.addEventListener('input', () => pitchVal.textContent = voicePitch.value);

// Open Settings
settingsOpenBtn.addEventListener('click', () => {
    apiKeyInput.value = localStorage.getItem('vocale_api_key') || '';
    usernameInput.value = localStorage.getItem('vocale_username') || '';
    locationSelect.value = localStorage.getItem('vocale_location') || 'Generico';
    listeningModeSelect.value = localStorage.getItem('vocale_listening_mode') || 'manual';
    modelSelect.value = localStorage.getItem('vocale_model_id') || 'gemini-3.1-flash-lite';
    
    const currentEm = getEmergencyConfig();
    currentEm.forEach((item, index) => {
        if (emLblInputs[index]) emLblInputs[index].value = item.label;
        if (emTxtInputs[index]) emTxtInputs[index].value = item.text;
    });

    populateVoiceList();
    settingsModal.classList.remove('hidden');
});

// Close Settings
settingsCloseBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

// Save Settings
settingsSaveBtn.addEventListener('click', () => {
    apiKey = apiKeyInput.value.trim();
    username = usernameInput.value.trim();
    locationContext = locationSelect.value;
    listeningMode = listeningModeSelect.value;
    modelId = modelSelect.value;
    
    localStorage.setItem('vocale_api_key', apiKey);
    localStorage.setItem('vocale_username', username);
    localStorage.setItem('vocale_location', locationContext);
    localStorage.setItem('vocale_listening_mode', listeningMode);
    localStorage.setItem('vocale_model_id', modelId);
    localStorage.setItem('vocale_voice_rate', voiceRate.value);
    localStorage.setItem('vocale_voice_pitch', voicePitch.value);
    localStorage.setItem('vocale_voice_name', voiceSelect.value);

    // Save Emergencies
    const newEm = [];
    for (let i = 0; i < 4; i++) {
        newEm.push({
            label: emLblInputs[i].value.trim() || defaultEmergencies[i].label,
            text: emTxtInputs[i].value.trim() || defaultEmergencies[i].text
        });
    }
    localStorage.setItem('vocale_emergency_buttons', JSON.stringify(newEm));
    renderEmergencyFooter();

    settingsModal.classList.add('hidden');

    // Handle Mic restart if listening mode changed
    if (isListening) {
        isListening = false;
        if (recognition) {
            recognition.stop();
        }
    }

    if (apiKey) {
        showStatus(listeningMode === 'continuous' ? "Ascolto passivo pronto. Attiva col microfono." : "Tocca il microfono per parlare");
        enablePredictiveButtons(false);
    } else {
        showStatus("Imposta la chiave API nelle Impostazioni (icona ⚙️)");
        disableAllSuggestions();
    }
});

// Clear History
clearMemoryBtn.addEventListener('click', () => {
    if (confirm("Vuoi davvero cancellare la cronologia delle tue risposte?")) {
        localStorage.removeItem('vocale_history');
        alert("Cronologia cancellata.");
    }
});

// Microphone Interaction
micBtn.addEventListener('click', () => {
    if (!apiKey) {
        settingsOpenBtn.click();
        return;
    }

    if (!recognition) {
        alert("Riconoscimento vocale non disponibile.");
        return;
    }

    if (isListening) {
        isListening = false;
        recognition.stop();
        showStatus("Ascolto in pausa");
    } else {
        isListening = true;
        try {
            recognition.start();
        } catch (e) {
            console.error("Errore all'avvio del microfono:", e);
        }
    }
});

// Open Custom Text Modal
customBtn.addEventListener('click', () => {
    customModal.classList.remove('hidden');
    customTextInput.focus();
    updatePredictivePills(); // Load dynamic starter words
});

// Close Custom Text Modal
customCloseBtn.addEventListener('click', () => {
    customModal.classList.add('hidden');
});

// Custom Text Clear
customClearBtn.addEventListener('click', () => {
    customTextInput.value = '';
    customTextInput.focus();
    updatePredictivePills();
});

// Custom Text Speak
customSpeakBtn.addEventListener('click', () => {
    const text = customTextInput.value.trim();
    if (text) {
        speak(text);
        customModal.classList.add('hidden');
        customTextInput.value = '';
    }
});

// Word pills predictive generator
function updatePredictivePills() {
    const text = customTextInput.value;
    const words = text.split(' ');
    const lastWord = words[words.length - 1].toLowerCase().trim();
    
    let suggestions = [];
    
    if (lastWord === '') {
        // Initial starter suggestions
        suggestions = ['voglio', 'posso', 'devo', 'ho', 'sono', 'non'];
    } else {
        // Match prefix in dictionary
        suggestions = caaDictionary.filter(word => word.startsWith(lastWord));
        
        // Fill up to 6 suggestions if needed
        if (suggestions.length < 6) {
            const fillers = ['grazie', 'bagno', 'aiuto', 'cibo', 'acqua', 'bene'];
            for (let filler of fillers) {
                if (!suggestions.includes(filler) && filler !== lastWord) {
                    suggestions.push(filler);
                }
                if (suggestions.length >= 6) break;
            }
        }
    }
    
    suggestions = suggestions.slice(0, 6);
    
    // Inject elements
    predictiveWordsGrid.innerHTML = '';
    suggestions.forEach(word => {
        const btn = document.createElement('button');
        btn.className = 'word-pill';
        btn.textContent = word;
        btn.onclick = () => {
            const wordsList = customTextInput.value.split(' ');
            wordsList[wordsList.length - 1] = word;
            customTextInput.value = wordsList.join(' ') + ' ';
            customTextInput.focus();
            updatePredictivePills();
        };
        predictiveWordsGrid.appendChild(btn);
    });
}

// Bind typing predictions
customTextInput.addEventListener('input', updatePredictivePills);

// Emergency buttons dynamic logic
function getEmergencyConfig() {
    const saved = localStorage.getItem('vocale_emergency_buttons');
    return saved ? JSON.parse(saved) : defaultEmergencies;
}

// Emergency buttons renderer
function renderEmergencyFooter() {
    const config = getEmergencyConfig();
    emergencyBar.innerHTML = ''; // Clear
    
    config.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'emergency-btn';
        if (item.label.includes('AIUTO') || item.label.includes('🚨')) {
            btn.classList.add('help');
        }
        btn.textContent = item.label;
        btn.onclick = () => speak(item.text);
        emergencyBar.appendChild(btn);
    });
}

// Helpers
function showStatus(text) {
    statusDiv.textContent = text;
}

function updateMicUI(listening) {
    if (listening) {
        micBtn.classList.add('listening');
        micInstruction.textContent = listeningMode === 'continuous' ? "Sempre in ascolto (Tocca per pausare)" : "Ascolto in corso...";
        startVisualizer();
    } else {
        micBtn.classList.remove('listening');
        micInstruction.textContent = listeningMode === 'continuous' ? "Tocca per attivare ascolto continuo" : "Tocca per parlare";
        stopVisualizer();
    }
}

function enablePredictiveButtons(hasData) {
    suggestBtns.forEach((btn, index) => {
        btn.disabled = false;
        btn.classList.remove('empty');
        if (!hasData) {
            btn.querySelector('.btn-text').textContent = `Tasto rapido ${index + 1}`;
        }
    });
}

function disableAllSuggestions() {
    suggestBtns.forEach(btn => {
        btn.disabled = true;
        btn.classList.add('empty');
        btn.querySelector('.btn-text').textContent = "Caricamento...";
    });
}

// TTS Voice loading
function populateVoiceList() {
    if (typeof speechSynthesis === 'undefined') return;
    
    const voices = speechSynthesis.getVoices();
    const selectedVoiceName = localStorage.getItem('vocale_voice_name');
    
    voiceSelect.innerHTML = '';
    
    // Italian on top
    const itVoices = voices.filter(voice => voice.lang.includes('it'));
    const otherVoices = voices.filter(voice => !voice.lang.includes('it'));
    const sorted = [...itVoices, ...otherVoices];
    
    sorted.forEach(voice => {
        const option = document.createElement('option');
        option.textContent = `${voice.name} (${voice.lang})`;
        option.value = voice.name;
        
        if (voice.name === selectedVoiceName) {
            option.selected = true;
        } else if (!selectedVoiceName && voice.lang.startsWith('it')) {
            option.selected = true;
            localStorage.setItem('vocale_voice_name', voice.name);
        }
        
        voiceSelect.appendChild(option);
    });
}

if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = populateVoiceList;
}

// Speak logic
function speak(text) {
    if (!text) return;
    
    if ('speechSynthesis' in window) {
        isSpeaking = true;
        
        // Stop recognition to prevent self-looping feedback
        if (recognition && isListening) {
            recognition.stop();
        }
        
        const utterance = new SpeechSynthesisUtterance(text);
        
        const voices = speechSynthesis.getVoices();
        const selectedVoiceName = localStorage.getItem('vocale_voice_name');
        const selectedVoice = voices.find(v => v.name === selectedVoiceName);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        
        utterance.rate = parseFloat(localStorage.getItem('vocale_voice_rate') || '1.0');
        utterance.pitch = parseFloat(localStorage.getItem('vocale_voice_pitch') || '1.0');
        
        window.speechSynthesis.cancel();
        
        utterance.onend = () => {
            isSpeaking = false;
            saveToHistory(text);
            
            // Resume listening in passive mode
            if (isListening && listeningMode === 'continuous' && recognition) {
                try {
                    recognition.start();
                } catch (e) {
                    console.error("Riavvio microfono post-parola fallito:", e);
                }
            }
        };
        
        utterance.onerror = () => {
            isSpeaking = false;
            if (isListening && listeningMode === 'continuous' && recognition) {
                try {
                    recognition.start();
                } catch (e) {
                    console.error("Riavvio microfono post-errore fallito:", e);
                }
            }
        };
        
        window.speechSynthesis.speak(utterance);
        
        const oldStatus = statusDiv.textContent;
        showStatus(`🗣️ "${text}"`);
        setTimeout(() => {
            if (statusDiv.textContent === `🗣️ "${text}"`) {
                showStatus(oldStatus);
            }
        }, 3000);
        
    } else {
        alert("Sintesi vocale non supportata nel browser.");
    }
}

// Local history management
function getHistory() {
    const hist = localStorage.getItem('vocale_history');
    return hist ? JSON.parse(hist) : [];
}

function saveToHistory(text) {
    if (!text || text.length < 2) return;
    
    // Ignore emergency phrases
    const isEmergency = getEmergencyConfig().some(item => item.text === text);
    if (isEmergency) return;
    
    let history = getHistory();
    history = history.filter(item => item !== text);
    history.unshift(text);
    history = history.slice(0, 15);
    localStorage.setItem('vocale_history', JSON.stringify(history));
}

// Time of day context helper
function getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 12) return 'mattina';
    if (hour >= 12 && hour < 18) return 'pomeriggio';
    if (hour >= 18 && hour < 24) return 'sera';
    return 'notte';
}

// Real-Time Audio Canvas Visualizer
async function startVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
    
    // Set matching bounds
    visualizerCanvas.width = visualizerCanvas.offsetWidth;
    visualizerCanvas.height = visualizerCanvas.offsetHeight;

    try {
        // Try requesting real mic stream for visual analysis
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) {
            audioCtx = new AudioContextClass();
        }
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }
        
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        sourceNode = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        sourceNode.connect(analyser);
        
        drawRealTimeWave();
        console.log("Real-time visualizer initialized.");
    } catch (e) {
        // Normal on iOS/Safari when WebSpeech holds microhpone lock. Fallback to procedural wave.
        console.log("Falling back to simulated waves (iOS/Safari mic lock compatibility).");
        drawSimulatedWave();
    }
}

function stopVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    
    // Clear canvas bounds
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
}

function drawRealTimeWave() {
    if (!isListening) return;
    
    animationId = requestAnimationFrame(drawRealTimeWave);
    
    analyser.getByteTimeDomainData(dataArray);
    
    canvasCtx.fillStyle = 'rgba(11, 15, 25, 0.4)';
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = '#06b6d4'; // Cyan neon
    canvasCtx.shadowBlur = 6;
    canvasCtx.shadowColor = 'rgba(6, 182, 212, 0.8)';
    
    canvasCtx.beginPath();
    
    const sliceWidth = visualizerCanvas.width * 1.0 / dataArray.length;
    let x = 0;
    
    for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * visualizerCanvas.height / 2;
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        
        x += sliceWidth;
    }
    
    canvasCtx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;
}

let simulatedPhase = 0;
function drawSimulatedWave() {
    if (!isListening) return;
    
    animationId = requestAnimationFrame(drawSimulatedWave);
    
    canvasCtx.fillStyle = 'rgba(11, 15, 25, 0.4)';
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    
    canvasCtx.lineWidth = 3;
    canvasCtx.strokeStyle = '#06b6d4';
    canvasCtx.shadowBlur = 6;
    canvasCtx.shadowColor = 'rgba(6, 182, 212, 0.8)';
    
    canvasCtx.beginPath();
    
    const width = visualizerCanvas.width;
    const height = visualizerCanvas.height;
    
    const noise = Math.random() * 0.15;
    const amplitude = (height / 3.2) * (0.6 + noise); 
    
    for (let x = 0; x < width; x++) {
        // Multi-harmonic sine waves
        const angle1 = (x / width) * Math.PI * 4 + simulatedPhase;
        const angle2 = (x / width) * Math.PI * 8 - simulatedPhase * 1.4;
        const y = (height / 2) + Math.sin(angle1) * amplitude * 0.75 + Math.sin(angle2) * amplitude * 0.25;
        
        if (x === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }
    
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;
    
    simulatedPhase += 0.14; // Wave oscillation speed
}

// Local Offline Fallback Processor
function processOfflineFallback(transcript) {
    const raw = transcript.toLowerCase();
    let suggestions = [];
    
    if (raw.includes('fame') || raw.includes('mangiare') || raw.includes('cibo') || raw.includes('pranzo') || raw.includes('cena') || raw.includes('pasta')) {
        suggestions = ["Sì, ho fame", "No, sono a posto", "Vorrei mangiare qualcosa"];
    } else if (raw.includes('sete') || raw.includes('bere') || raw.includes('acqua') || raw.includes('caffè') || raw.includes('bibita')) {
        suggestions = ["Sì, ho sete", "Vorrei dell'acqua", "Un caffè, grazie"];
    } else if (raw.includes('stai') || raw.includes('senti') || raw.includes('salute') || raw.includes('stanco') || raw.includes('triste')) {
        suggestions = ["Sto bene, grazie", "Sono stanco", "Non mi sento molto bene"];
    } else if (raw.includes('male') || raw.includes('dolore') || raw.includes('aiuto') || raw.includes('medico') || raw.includes('fa male')) {
        suggestions = ["Sento dolore qui", "Ho bisogno di aiuto", "Tutto a posto per ora"];
    } else if (raw.includes('bagno') || raw.includes('toilette') || raw.includes('pipì')) {
        suggestions = ["Devo andare in bagno", "No, sono a posto", "Mi aiuti ad andare?"];
    } else if (raw.includes('ciao') || raw.includes('salve') || raw.includes('giorno') || raw.includes('sera')) {
        suggestions = ["Ciao, come stai?", "Buongiorno", "Piacere di vederti"];
    } else if (raw.includes('vuoi') || raw.includes('piace') || raw.includes('fai') || raw.includes('ti va')) {
        suggestions = ["Sì, volentieri", "No, grazie", "Non saprei"];
    } else {
        // Safe default
        suggestions = ["Sì", "No", "Non ho capito"];
    }
    
    updateSuggestions(suggestions);
    showStatus("Scegli cosa dire (Offline/Fallback):");
}

// Gemini AI Call (Optimized speed configs)
async function processSpeechContext(text, userDirectlyAddressed = false) {
    // If offline, bypass and trigger local parsing
    if (!navigator.onLine) {
        processOfflineFallback(text);
        return;
    }

    if (!apiKey) return;
    
    showStatus("L'IA sta pensando...");
    
    const history = getHistory();
    const historyContext = history.length > 0 
        ? history.join(', ')
        : "Nessuno storico.";

    const timeOfDay = getTimeOfDay();
    
    let targetAlertInstruction = "";
    if (userDirectlyAddressed) {
        targetAlertInstruction = " ATTENZIONE: l'interlocutore ha chiamato l'utente per nome; dai priorità a risposte dirette o saluti.";
    }

    const systemPrompt = `Motore CAA per muto. Rispondi al contesto con 3 opzioni in italiano, brevi (1-4 parole), naturali ed empatiche.
Dati utente: Ora: ${timeOfDay}, Luogo: ${locationContext}.${targetAlertInstruction}
Tono/Storico preferito: ${historyContext}.
Rispondi SOLO con array JSON di 3 stringhe. Es: ["Sì, grazie", "No, a posto", "Non ho capito"]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [
            {
                role: "user",
                parts: [{ text: `Contesto udito nell'ambiente: "${text}"` }]
            }
        ],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "array",
                items: {
                    type: "string"
                }
            },
            temperature: 0.3, // Lower temperature speeds up calculations and increases formatting strictness
            maxOutputTokens: 80 // Restricting output length limits search space and saves processing time
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        let suggestions = JSON.parse(responseText);
        if (Array.isArray(suggestions) && suggestions.length >= 3) {
            updateSuggestions(suggestions.slice(0, 3));
            showStatus("Scegli cosa dire:");
        } else {
            throw new Error("JSON non conforme alle 3 risposte.");
        }
    } catch (error) {
        console.error("Errore API Gemini, avvio fallback locale:", error);
        processOfflineFallback(text);
    }
}

function updateSuggestions(options) {
    suggestBtns.forEach((btn, index) => {
        const text = options[index];
        btn.disabled = false;
        btn.classList.remove('empty');
        btn.querySelector('.btn-text').textContent = text;
        btn.onclick = () => speak(text);
    });
}

// Resize handler to ensure visualizer canvas resolution matches layout
window.addEventListener('resize', () => {
    if (isListening && visualizerCanvas) {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    }
});

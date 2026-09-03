// State Management
let isListening = false;
let isSpeaking = false;
let listeningMode = localStorage.getItem('vocale_listening_mode') || 'manual';
let apiKey = localStorage.getItem('vocale_api_key') || '';
let username = localStorage.getItem('vocale_username') || '';
let locationContext = localStorage.getItem('vocale_location') || 'Generico';
let savedModel = localStorage.getItem('vocale_model_id');
if (!savedModel || savedModel.includes('3.1') || savedModel.includes('3.5') || savedModel.includes('2.5-flash-lite')) {
    savedModel = 'gemini-2.0-flash';
    localStorage.setItem('vocale_model_id', savedModel);
}
let modelId = savedModel;
let activeUtterance = null; // Prevent SpeechSynthesisUtterance garbage collection freeze
let speechWatchdogTimer = null;
let aiInstructions = localStorage.getItem('vocale_ai_instructions') || '';
let currentTone = localStorage.getItem('vocale_tone') || 'informale';
let lastHeardText = '';
let lastUserDirectlyAddressed = false;
let currentAiAbortController = null;

// Haptic Feedback Helper (Mobile Vibration)
function triggerHaptic(duration = 35) {
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(duration);
        } catch (e) {
            // Ignore vibration rejections
        }
    }
}

// Network Status Management
function updateNetworkStatus() {
    const badge = document.getElementById('network-badge');
    if (!badge) return;
    if (navigator.onLine) {
        badge.className = 'network-badge online';
        badge.title = 'Stato Rete: Online (Gemini)';
        const textSpan = badge.querySelector('.badge-text');
        if (textSpan) textSpan.textContent = 'Online';
    } else {
        badge.className = 'network-badge offline';
        badge.title = 'Stato Rete: Offline (Dizionario Locale)';
        const textSpan = badge.querySelector('.badge-text');
        if (textSpan) textSpan.textContent = 'Offline';
    }
}
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// DOM Elements
const micBtn = document.getElementById('mic-btn');
const micInstruction = document.getElementById('mic-instruction');
const statusDiv = document.getElementById('status');
const heardBox = document.getElementById('heard-box');
const heardTextSpan = document.getElementById('heard-text');
const regenBtn = document.getElementById('regen-btn');

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
const instructionsInput = document.getElementById('instructions-input');
const usernameInput = document.getElementById('username-input');
const locationSelect = document.getElementById('location-select');
const listeningModeSelect = document.getElementById('listening-mode-select');
const modelSelect = document.getElementById('model-select');
const voiceSelect = document.getElementById('voice-select');
const voiceRate = document.getElementById('voice-rate');
const voicePitch = document.getElementById('voice-pitch');
const rateVal = document.getElementById('rate-val');
const pitchVal = document.getElementById('pitch-val');
const voicePreviewBtn = document.getElementById('voice-preview-btn');
const exportBackupBtn = document.getElementById('export-backup-btn');
const importBackupBtn = document.getElementById('import-backup-btn');
const importBackupFile = document.getElementById('import-backup-file');
const clearMemoryBtn = document.getElementById('clear-memory-btn');

// History Modal Elements
const historyModal = document.getElementById('history-modal');
const historyOpenBtn = document.getElementById('history-open-btn');
const historyCloseBtn = document.getElementById('history-close-btn');
const historyDoneBtn = document.getElementById('history-done-btn');
const historyClearBtn = document.getElementById('history-clear-btn');
const historyChatLog = document.getElementById('history-chat-log');

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
                interimSilenceTimer = null;
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
    lastHeardText = text;
    heardTextSpan.textContent = text;
    heardBox.classList.remove('hidden');
    heardBox.classList.remove('alert-glow');

    let userDirectlyAddressed = false;

    // Check Username Mention
    if (username && text.toLowerCase().includes(username.toLowerCase())) {
        userDirectlyAddressed = true;
        heardBox.classList.add('alert-glow');
        
        // Haptic Alert for Phone
        triggerHaptic([150, 100, 150]);
        
        // Clear glowing after 4s
        setTimeout(() => {
            heardBox.classList.remove('alert-glow');
        }, 4000);
    }
    lastUserDirectlyAddressed = userDirectlyAddressed;

    if (listeningMode === 'manual') {
        isListening = false;
        updateMicUI(false);
    }

    // Save to chat history as interlocutore
    saveToChatHistory('interlocutore', text);

    processSpeechContext(text, userDirectlyAddressed);
}

// Dynamic Model Discovery from Gemini API
async function populateAvailableModels(key) {
    if (!key) return;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data && Array.isArray(data.models)) {
            const viableModels = data.models.filter(m => 
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') &&
                (m.name.includes('flash') || m.name.includes('lite') || m.name.includes('pro')) &&
                !m.name.includes('embedding') && !m.name.includes('vision') && !m.name.includes('imagen') && !m.name.includes('aqa')
            );
            
            if (viableModels.length > 0) {
                const currentVal = modelSelect.value || modelId;
                modelSelect.innerHTML = '';
                
                viableModels.forEach(m => {
                    const rawId = m.name.replace('models/', '');
                    const opt = document.createElement('option');
                    opt.value = rawId;
                    
                    let label = m.displayName || rawId;
                    if (rawId.includes('flash-lite')) {
                        label += ' (Ultra Veloce ⚡)';
                    } else if (rawId.includes('flash')) {
                        label += ' (Flash Bilanciato 🚀)';
                    }
                    opt.textContent = label;
                    if (rawId === currentVal) {
                        opt.selected = true;
                    }
                    modelSelect.appendChild(opt);
                });

                if (!modelSelect.value && modelSelect.options.length > 0) {
                    const preferred = Array.from(modelSelect.options).find(o => o.value.includes('flash-lite')) || modelSelect.options[0];
                    preferred.selected = true;
                }
            }
        }
    } catch (e) {
        console.warn("Impossibile recuperare i modelli dinamicamente dall'API:", e);
    }
}

// Tone & Response Styles
const toneDescriptions = {
    informale: 'Stile informale, colloquiale, amichevole ed empatico (usa il "tu", esclamazioni naturali, linguaggio sciolto e spontaneo).',
    formale: 'Stile formale, educato, rispettoso e professionale (usa il "Lei", formule di cortesia e lessico accurato).',
    scherzoso: 'Stile simpatico, brillante, ironico, spiritoso ed espressivo (battute leggere, risposte vivaci ed energiche).',
    sintetico: 'Stile ultra-sintetico, telegrafico ed essenziale (1-2 parole al massimo, zero fronzoli).'
};

function initTonePills() {
    const pills = document.querySelectorAll('.tone-pill');
    pills.forEach(pill => {
        if (pill.dataset.tone === currentTone) {
            pill.classList.add('active');
            pill.setAttribute('aria-checked', 'true');
        } else {
            pill.classList.remove('active');
            pill.setAttribute('aria-checked', 'false');
        }
        pill.addEventListener('click', () => {
            triggerHaptic(30);
            pills.forEach(p => {
                p.classList.remove('active');
                p.setAttribute('aria-checked', 'false');
            });
            pill.classList.add('active');
            pill.setAttribute('aria-checked', 'true');
            currentTone = pill.dataset.tone;
            localStorage.setItem('vocale_tone', currentTone);
            
            // If we have previously heard text, regenerate immediately with new tone
            if (lastHeardText && apiKey && navigator.onLine) {
                processSpeechContext(lastHeardText, lastUserDirectlyAddressed, true);
            }
        });
    });
}

// Conversation History Log Renderer
function renderHistoryLog() {
    if (!historyChatLog) return;
    const history = getChatHistory();
    
    if (history.length === 0) {
        historyChatLog.innerHTML = `
            <div class="history-empty-state">
                <span class="material-symbols-outlined">chat</span>
                <p>Nessun dialogo recente registrato.</p>
            </div>
        `;
        return;
    }

    historyChatLog.innerHTML = '';
    history.forEach(turn => {
        const turnDiv = document.createElement('div');
        turnDiv.className = `chat-turn ${turn.role === 'utente' ? 'utente' : 'interlocutore'}`;
        
        const senderSpan = document.createElement('span');
        senderSpan.className = 'chat-sender';
        senderSpan.textContent = turn.role === 'utente' ? (username || 'Tu') : 'Interlocutore';
        
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'chat-bubble';
        bubbleDiv.textContent = turn.text;
        
        turnDiv.appendChild(senderSpan);
        turnDiv.appendChild(bubbleDiv);
        historyChatLog.appendChild(turnDiv);
    });

    historyChatLog.scrollTop = historyChatLog.scrollHeight;
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
        loadInitialSuggestions();
    } else {
        showStatus(listeningMode === 'continuous' ? "Ascolto passivo pronto. Attiva col microfono." : "Tocca il microfono per parlare");
        loadInitialSuggestions();
        populateAvailableModels(apiKey);
    }

    // TTS Voice loading
    populateVoiceList();
    
    // Tone Selector init & Network badge
    initTonePills();
    updateNetworkStatus();
});

// Settings & Range event listeners
voiceRate.addEventListener('input', () => rateVal.textContent = voiceRate.value + 'x');
voicePitch.addEventListener('input', () => pitchVal.textContent = voicePitch.value);
apiKeyInput.addEventListener('change', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        populateAvailableModels(key);
    }
});

// Regenerate Button
if (regenBtn) {
    regenBtn.addEventListener('click', () => {
        triggerHaptic(30);
        if (!lastHeardText) {
            showStatus("Ascolta o detta una frase prima di rigenerare");
            return;
        }
        processSpeechContext(lastHeardText, lastUserDirectlyAddressed, true);
    });
}

// History Modal Events
if (historyOpenBtn) {
    historyOpenBtn.addEventListener('click', () => {
        triggerHaptic(30);
        renderHistoryLog();
        historyModal.classList.remove('hidden');
    });
}

if (historyCloseBtn) {
    historyCloseBtn.addEventListener('click', () => {
        triggerHaptic(20);
        historyModal.classList.add('hidden');
    });
}

if (historyDoneBtn) {
    historyDoneBtn.addEventListener('click', () => {
        triggerHaptic(20);
        historyModal.classList.add('hidden');
    });
}

if (historyClearBtn) {
    historyClearBtn.addEventListener('click', () => {
        triggerHaptic(40);
        if (confirm("Vuoi cancellare la cronologia dei dialoghi recenti?")) {
            localStorage.removeItem('vocale_chat_history');
            renderHistoryLog();
        }
    });
}

// Open Settings
settingsOpenBtn.addEventListener('click', () => {
    triggerHaptic(30);
    apiKeyInput.value = localStorage.getItem('vocale_api_key') || '';
    instructionsInput.value = localStorage.getItem('vocale_ai_instructions') || '';
    usernameInput.value = localStorage.getItem('vocale_username') || '';
    locationSelect.value = localStorage.getItem('vocale_location') || 'Generico';
    listeningModeSelect.value = localStorage.getItem('vocale_listening_mode') || 'manual';
    modelSelect.value = modelId;
    
    const currentKey = apiKeyInput.value.trim() || apiKey;
    if (currentKey) {
        populateAvailableModels(currentKey);
    }
    
    const currentEm = getEmergencyConfig();
    currentEm.forEach((item, index) => {
        if (emLblInputs[index]) emLblInputs[index].value = item.label;
        if (emTxtInputs[index]) emTxtInputs[index].value = item.text;
    });

    populateVoiceList();
    settingsModal.classList.remove('hidden');
});

// Close Settings
settingsCloseBtn.addEventListener('click', () => {
    triggerHaptic(20);
    settingsModal.classList.add('hidden');
});

// Voice Preview in Settings
if (voicePreviewBtn) {
    voicePreviewBtn.addEventListener('click', () => {
        triggerHaptic(30);
        if ('speechSynthesis' in window) {
            const previewUtterance = new SpeechSynthesisUtterance("Ciao! Questa è la voce selezionata per Vocale AI.");
            const voices = speechSynthesis.getVoices();
            const selectedVoice = voices.find(v => v.name === voiceSelect.value);
            if (selectedVoice) {
                previewUtterance.voice = selectedVoice;
            }
            previewUtterance.rate = parseFloat(voiceRate.value || '1.0');
            previewUtterance.pitch = parseFloat(voicePitch.value || '1.0');
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(previewUtterance);
        }
    });
}

// Backup & Restore Handlers
if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', () => {
        triggerHaptic(30);
        const backupData = {
            app: "Vocale AI",
            version: 1,
            exportedAt: new Date().toISOString(),
            settings: {
                vocale_api_key: localStorage.getItem('vocale_api_key') || '',
                vocale_ai_instructions: localStorage.getItem('vocale_ai_instructions') || '',
                vocale_username: localStorage.getItem('vocale_username') || '',
                vocale_location: localStorage.getItem('vocale_location') || 'Generico',
                vocale_listening_mode: localStorage.getItem('vocale_listening_mode') || 'manual',
                vocale_model_id: localStorage.getItem('vocale_model_id') || 'gemini-2.5-flash-lite',
                vocale_voice_name: localStorage.getItem('vocale_voice_name') || '',
                vocale_voice_rate: localStorage.getItem('vocale_voice_rate') || '1.0',
                vocale_voice_pitch: localStorage.getItem('vocale_voice_pitch') || '1.0',
                vocale_tone: localStorage.getItem('vocale_tone') || 'informale',
                vocale_emergency_buttons: localStorage.getItem('vocale_emergency_buttons') || '',
                vocale_phrase_frequencies: localStorage.getItem('vocale_phrase_frequencies') || ''
            }
        };

        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vocale_ai_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

if (importBackupBtn) {
    importBackupBtn.addEventListener('click', () => {
        triggerHaptic(30);
        if (importBackupFile) importBackupFile.click();
    });
}

if (importBackupFile) {
    importBackupFile.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data && data.settings) {
                    Object.entries(data.settings).forEach(([key, val]) => {
                        if (val !== undefined && val !== null) {
                            localStorage.setItem(key, val);
                        }
                    });
                    triggerHaptic([50, 50, 50]);
                    alert("Backup ripristinato con successo! Ricarico l'app.");
                    window.location.reload();
                } else {
                    throw new Error("Formato file backup non valido.");
                }
            } catch (err) {
                alert("Errore durante l'importazione del backup: " + err.message);
            }
        };
        reader.readAsText(file);
    });
}

// Save Settings
settingsSaveBtn.addEventListener('click', () => {
    apiKey = apiKeyInput.value.trim();
    aiInstructions = instructionsInput.value.trim();
    username = usernameInput.value.trim();
    locationContext = locationSelect.value;
    listeningMode = listeningModeSelect.value;
    modelId = modelSelect.value;
    
    localStorage.setItem('vocale_api_key', apiKey);
    localStorage.setItem('vocale_ai_instructions', aiInstructions);
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
        loadInitialSuggestions();
    } else {
        showStatus("Imposta la chiave API nelle Impostazioni (icona ⚙️)");
        loadInitialSuggestions();
    }
});

// Clear History
clearMemoryBtn.addEventListener('click', () => {
    if (confirm("Vuoi davvero cancellare la cronologia delle tue risposte?")) {
        localStorage.removeItem('vocale_history');
        localStorage.removeItem('vocale_chat_history');
        localStorage.removeItem('vocale_phrase_frequencies');
        renderHistoryLog();
        loadInitialSuggestions();
        alert("Cronologia cancellata.");
    }
});

// Microphone Interaction
micBtn.addEventListener('click', () => {
    triggerHaptic(35);
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
    triggerHaptic(25);
    customModal.classList.remove('hidden');
    customTextInput.focus();
    updatePredictivePills(); // Load dynamic starter words
});

// Close Custom Text Modal
customCloseBtn.addEventListener('click', () => {
    triggerHaptic(20);
    customModal.classList.add('hidden');
});

// Custom Text Clear
customClearBtn.addEventListener('click', () => {
    triggerHaptic(20);
    customTextInput.value = '';
    customTextInput.focus();
    updatePredictivePills();
});

// Custom Text Speak
customSpeakBtn.addEventListener('click', () => {
    triggerHaptic(35);
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
            triggerHaptic(20);
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
        btn.onclick = () => {
            triggerHaptic(40);
            speak(item.text);
        };
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

function loadInitialSuggestions() {
    const topPhrases = getTopPreferredPhrases(3);
    const starterPhrases = ["Sì, certamente!", "Grazie mille!", "Tutto a posto!"];
    const initialPhrases = topPhrases.length >= 3 
        ? topPhrases.slice(0, 3) 
        : [...topPhrases, ...starterPhrases].slice(0, 3);
    
    updateSuggestions(initialPhrases);
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

// Speak logic (Protected with Watchdog & GC Retention)
function speak(text) {
    if (!text) return;
    
    if ('speechSynthesis' in window) {
        isSpeaking = true;
        
        // Stop recognition to prevent self-looping audio feedback
        if (recognition && isListening) {
            try { recognition.stop(); } catch(e) {}
        }

        // Clear any pending speech watchdog timer
        if (speechWatchdogTimer) {
            clearTimeout(speechWatchdogTimer);
            speechWatchdogTimer = null;
        }
        
        const utterance = new SpeechSynthesisUtterance(text);
        activeUtterance = utterance; // Prevent garbage collection mid-speech
        
        const voices = speechSynthesis.getVoices();
        const selectedVoiceName = localStorage.getItem('vocale_voice_name');
        const selectedVoice = voices.find(v => v.name === selectedVoiceName);
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
        
        utterance.rate = parseFloat(localStorage.getItem('vocale_voice_rate') || '1.0');
        utterance.pitch = parseFloat(localStorage.getItem('vocale_voice_pitch') || '1.0');

        const finalizeSpeech = () => {
            if (speechWatchdogTimer) {
                clearTimeout(speechWatchdogTimer);
                speechWatchdogTimer = null;
            }
            activeUtterance = null;
            isSpeaking = false;
            
            // Resume listening in passive continuous mode
            if (isListening && listeningMode === 'continuous' && recognition) {
                setTimeout(() => {
                    if (isListening && listeningMode === 'continuous' && !isSpeaking) {
                        try {
                            recognition.start();
                        } catch (e) {
                            console.error("Riavvio microfono post-parola fallito:", e);
                        }
                    }
                }, 300);
            }
        };
        
        utterance.onend = () => {
            saveToHistory(text);
            finalizeSpeech();
        };
        
        utterance.onerror = (e) => {
            console.warn("Evento errore sintesi vocale:", e);
            finalizeSpeech();
        };

        // Safety watchdog: WebKit on iOS/Chrome can occasionally drop onend
        const wordsCount = text.trim().split(/\s+/).length;
        const estimatedDurationMs = Math.max(4500, wordsCount * 1200);
        speechWatchdogTimer = setTimeout(() => {
            if (isSpeaking) {
                console.warn("Watchdog sintesi vocale scattato: forzatura reset isSpeaking.");
                finalizeSpeech();
            }
        }, estimatedDurationMs);

        // Resume engine if paused by browser
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
        
        window.speechSynthesis.cancel();
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

function getPhraseFrequencies() {
    const freq = localStorage.getItem('vocale_phrase_frequencies');
    return freq ? JSON.parse(freq) : {};
}

function saveToFrequencies(text) {
    if (!text || text.length < 2) return;
    
    // Ignore emergency phrases
    const isEmergency = getEmergencyConfig().some(item => item.text === text);
    if (isEmergency) return;
    
    let frequencies = getPhraseFrequencies();
    frequencies[text] = (frequencies[text] || 0) + 1;
    localStorage.setItem('vocale_phrase_frequencies', JSON.stringify(frequencies));
}

function getTopPreferredPhrases(limit = 5) {
    const frequencies = getPhraseFrequencies();
    return Object.entries(frequencies)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(entry => entry[0]);
}

function getChatHistory() {
    const hist = localStorage.getItem('vocale_chat_history');
    return hist ? JSON.parse(hist) : [];
}

function saveToChatHistory(role, text) {
    if (!text) return;
    let history = getChatHistory();
    history.push({ role, text });
    if (history.length > 8) { // Keep last 8 turns (4 full exchanges)
        history.shift();
    }
    localStorage.setItem('vocale_chat_history', JSON.stringify(history));
}

function formatChatHistoryForPrompt() {
    const history = getChatHistory();
    if (history.length === 0) return "Nessuna conversazione precedente.";
    return history.map(turn => `${turn.role === 'utente' ? 'Utente' : 'Interlocutore'}: "${turn.text}"`).join('\n');
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

    // Save to frequencies and chat history
    saveToFrequencies(text);
    saveToChatHistory('utente', text);
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
        animationId = null;
    }
    
    // Set matching bounds
    if (visualizerCanvas.offsetWidth > 0) {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    }

    // iOS/WebKit safe mode: avoid getUserMedia collision with Web Speech recognition
    const isIOSorSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                          (navigator.vendor && navigator.vendor.includes('Apple'));
    if (isIOSorSafari) {
        drawSimulatedWave();
        return;
    }

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
        // Fallback to procedural wave
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
    
    // Auto-resize bounds if canvas became visible or layout shifted
    if (visualizerCanvas.offsetWidth > 0 && visualizerCanvas.width !== visualizerCanvas.offsetWidth) {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    }
    
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
    
    // Auto-resize bounds if canvas became visible or layout shifted
    if (visualizerCanvas.offsetWidth > 0 && visualizerCanvas.width !== visualizerCanvas.offsetWidth) {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    }
    
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

// Local Offline Fallback Processor (Extended CAA Heuristics)
function processOfflineFallback(transcript) {
    const raw = transcript.toLowerCase();
    let suggestions = [];
    
    // 1. Cibo & Pasti
    if (raw.includes('fame') || raw.includes('mangiare') || raw.includes('cibo') || raw.includes('pranzo') || raw.includes('cena') || raw.includes('pasta') || raw.includes('pizza') || raw.includes('ristorante')) {
        suggestions = ["Sì, ho fame!", "Cosa mangiamo?", "Non ho molta fame"];
    // 2. Bevande & Caffè
    } else if (raw.includes('sete') || raw.includes('bere') || raw.includes('acqua') || raw.includes('caffè') || raw.includes('caffe') || raw.includes('tè') || raw.includes('bibita')) {
        suggestions = ["Un bicchiere d'acqua!", "Un caffè, grazie!", "No, grazie, a posto"];
    // 3. Saluti & Incontri
    } else if (raw.includes('ciao') || raw.includes('salve') || raw.includes('buongiorno') || raw.includes('buonasera') || raw.includes('piacere')) {
        suggestions = ["Ciao! Come stai?", "Buongiorno a tutti!", "Piacere di vederti!"];
    // 4. Benessere & Salute
    } else if (raw.includes('come stai') || raw.includes('senti') || raw.includes('salute') || raw.includes('stanco') || raw.includes('sonno')) {
        suggestions = ["Sto bene, grazie!", "Sono un po' stanco", "Potrebbe andare meglio"];
    // 5. Dolore & Bisogno di Aiuto
    } else if (raw.includes('male') || raw.includes('dolore') || raw.includes('aiuto') || raw.includes('medico') || raw.includes('fa male') || raw.includes('soccorso')) {
        suggestions = ["Sento dolore qui!", "Ho bisogno di aiuto", "Tranquilli, sto bene"];
    // 6. Bagno & Fisiologia
    } else if (raw.includes('bagno') || raw.includes('toilette') || raw.includes('pipì') || raw.includes('pipi')) {
        suggestions = ["Devo andare in bagno!", "Mi puoi accompagnare?", "No, sono a posto"];
    // 7. Scelte, Proposte & Inviti ("vuoi", "ti va", "andiamo", "preferisci")
    } else if (raw.includes('vuoi') || raw.includes('ti va') || raw.includes('andiamo') || raw.includes('preferisci') || raw.includes('facciamo')) {
        suggestions = ["Sì, volentieri!", "Perché no? Ci sto!", "Preferisco di no oggi"];
    // 8. Opinioni & Dibattiti ("cosa pensi", "secondo te", "d'accordo")
    } else if (raw.includes('pensi') || raw.includes('secondo te') || raw.includes('d\'accordo') || raw.includes('daccordo') || raw.includes('idea')) {
        suggestions = ["Sono d'accordo!", "Secondo me no", "Dipende dalla situazione"];
    // 9. Tempo, Orari & Ritardo
    } else if (raw.includes('quando') || raw.includes('ora') || raw.includes('orario') || raw.includes('tardi') || raw.includes('presto') || raw.includes('tempo')) {
        suggestions = ["A che ora?", "Facciamo più tardi?", "Dobbiamo fare presto!"];
    // 10. Luoghi & Spostamenti
    } else if (raw.includes('dove') || raw.includes('uscire') || raw.includes('casa') || raw.includes('fuori') || raw.includes('posto')) {
        suggestions = ["Dove andiamo?", "Restiamo qui tranquilli", "Usciamo all'aria aperta!"];
    // 11. Meteo & Ambiente
    } else if (raw.includes('freddo') || raw.includes('caldo') || raw.includes('pioggia') || raw.includes('tempo') || raw.includes('aria')) {
        suggestions = ["Fa molto caldo!", "Fa abbastanza freddo", "Si sta benissimo!"];
    } else {
        // Fallback Universale Triadico
        suggestions = ["Sì, certamente!", "Puoi rispiegare?", "Non sono convinto"];
    }
    
    updateSuggestions(suggestions);
    showStatus("Scegli cosa dire (Offline):");
}

// Gemini AI Call (Optimized speed configs & Concurrency control)
async function processSpeechContext(text, userDirectlyAddressed = false, isRegenerate = false) {
    lastHeardText = text;
    lastUserDirectlyAddressed = userDirectlyAddressed;

    // If offline, bypass and trigger local parsing
    if (!navigator.onLine) {
        processOfflineFallback(text);
        return;
    }

    if (!apiKey) return;

    // Cancel in-flight request if present
    if (currentAiAbortController) {
        currentAiAbortController.abort();
    }
    currentAiAbortController = new AbortController();
    
    showStatus(isRegenerate ? `Rigenero opzioni (${currentTone})...` : "L'IA sta pensando...");
    
    const preferred = getTopPreferredPhrases(5);
    const preferredContext = preferred.length > 0
        ? preferred.join(', ')
        : "Nessuna frase preferita ancora.";

    const chatHistoryContext = formatChatHistoryForPrompt();
    const timeOfDay = getTimeOfDay();
    
    let targetAlertInstruction = "";
    if (userDirectlyAddressed) {
        targetAlertInstruction = " NOTA: L'interlocutore si è rivolto DIRETTAMENTE all'utente per nome; la prima opzione DEVE essere una risposta diretta o saluto.";
    }

    const toneInstruction = toneDescriptions[currentTone] || toneDescriptions.informale;

    const userProfileInstruction = aiInstructions 
        ? `Profilo e preferenze personalizzate dell'utente: "${aiInstructions}"`
        : 'Stile di default: Neutro, amichevole, chiaro ed educato.';

    const regenInstruction = isRegenerate 
        ? "IMPORTANTE (Rigenerazione): Fornisci 3 opzioni COMPLETAMENTE DIVERSE dalle precedenti, esplorando nuove prospettive o risposte inattese." 
        : "";

    const systemPrompt = `Sei un Facilitatore Conversazionale Avanzato per un utente non-verbale che comunica in tempo reale tramite CAA (Comunicazione Aumentativa e Alternativa).
L'utente ascolta la conversazione circostante (discorsi d'ambiente tra più persone o domande dirette a lui).

IL TUO OBIETTIVO:
Generare esattamente 3 frasi in italiano pronte per essere pronunciate tramite sintesi vocale (TTS).

REGOLA DELLA TRIADE COMUNICATIVA (Le 3 opzioni DEVONO coprire 3 scopi differenti per arricchire il dialogo):
- Opzione 1 [Reazione / Assenso / Risposta Diretta]: Accordo, disaccordo netto, opinione o risposta immediata.
- Opzione 2 [Rilancio / Domanda / Approfondimento]: Domanda stimolante per approfondire o chiedere chiarimenti.
- Opzione 3 [Proposta / Iniziativa / Battuta / Bisogno]: Cambio punto di vista, battuta spiritosa, proposta attiva o espressione di un bisogno.

VINCOLI DI QUALITÀ E LUNGHEZZA:
1. Brevità assoluta: da 1 a 5 parole per opzione (MAI frasi lunghe).
2. Punteggiatura espressiva: usa sempre '!' o '?' per guidare l'espressività della voce TTS.
3. Naturalezza parlata: evita formule artificiali ("Certamente ritengo che..."). Usa italiano autentico e vivo.
4. Registro richiesto: ${toneInstruction}
${userProfileInstruction}
${regenInstruction}

ESEMPI FEW-SHOT:
- Udito: "Stasera ordiniamo una pizza o andiamo al ristorante cinese?" (Informale)
  ["Voto per la pizza!", "A che ora ordiniamo?", "Preferisco il cinese!"]
- Udito: "La riunione è fissata per le dieci di domani mattina." (Formale)
  ["Sarò puntuale!", "Serve preparare qualcosa?", "Invio il promemoria"]
- Udito: "Ho dimenticato di nuovo dove ho parcheggiato l'auto!" (Scherzoso)
  ["Sei un disastro!", "Hai provato a piedi?", "Colpa dei parcheggi!"]
- Udito: "Vuoi un caffè o preferisci un bicchiere d'acqua fresca?" (Sintetico)
  ["Un caffè, grazie!", "Solo acqua fresca", "Niente per ora"]

CONTESTO ATTUALE:
- Cronologia recente:
${chatHistoryContext}
- Frasi abituali dell'utente: ${preferredContext}
- Ambiente: Ora: ${timeOfDay}, Luogo: ${locationContext}.${targetAlertInstruction}

Rispondi con un array JSON di 3 stringhe: ["Opzione 1", "Opzione 2", "Opzione 3"]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [
            {
                role: "user",
                parts: [{ text: `Contesto udito: "${text}"` }]
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
            temperature: isRegenerate ? 0.75 : 0.4,
            maxOutputTokens: 90
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: currentAiAbortController.signal
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error("Nessun testo generato dall'API.");
        
        // Clean possible markdown code fences (```json ... ```)
        let cleanJson = responseText.trim();
        if (cleanJson.startsWith('```')) {
            cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        }

        let parsed = JSON.parse(cleanJson);
        let suggestions = [];

        if (Array.isArray(parsed)) {
            suggestions = parsed;
        } else if (parsed && typeof parsed === 'object') {
            const arrayProp = Object.values(parsed).find(val => Array.isArray(val));
            if (arrayProp) {
                suggestions = arrayProp;
            }
        }

        if (suggestions.length >= 3) {
            updateSuggestions(suggestions.slice(0, 3));
            showStatus("Scegli cosa dire:");
        } else {
            throw new Error("JSON non conforme alle 3 risposte.");
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log("Richiesta Gemini annullata per nuovo input vocale.");
            return;
        }
        console.error("Errore API Gemini, avvio fallback locale:", error);
        processOfflineFallback(text);
    } finally {
        currentAiAbortController = null;
    }
}

// Material Symbols Mapping (Extended 100+ CAA Dictionary)
const materialIconMapping = {
    // Accordo / Dissenso & Reazioni
    'si': 'thumb_up', 'sì': 'thumb_up', 'd\'accordo': 'handshake', 'esatto': 'check_circle', 'certo': 'verified',
    'ok': 'check', 'va bene': 'thumb_up', 'perfetto': 'done_all', 'fantastico': 'auto_awesome',
    'no': 'thumb_down', 'mai': 'block', 'sbagliato': 'cancel', 'impossibile': 'do_not_disturb',
    'forse': 'help_center', 'dipende': 'balance', 'non so': 'question_mark', 'boh': 'question_mark',
    
    // Cortesia, Saluti & Relazioni
    'grazie': 'volunteer_activism', 'prego': 'waving_hand', 'per favore': 'potted_plant',
    'ciao': 'waving_hand', 'buongiorno': 'light_mode', 'buonasera': 'dark_mode', 'buonanotte': 'bedtime',
    'salve': 'waving_hand', 'arrivederci': 'flight_takeoff', 'scusa': 'sentiment_dissatisfied', 'scusami': 'sentiment_dissatisfied',
    'amico': 'group', 'famiglia': 'family_restroom', 'mamma': 'face_3', 'papà': 'face_6',
    
    // Bisogni primari, Fisiologia & Emergenza
    'aiuto': 'emergency', 'bagno': 'wc', 'toilette': 'wc', 'pipì': 'wc',
    'acqua': 'local_drink', 'sete': 'local_drink', 'bere': 'local_drink', 'bibita': 'sports_bar',
    'caffe': 'coffee', 'caffè': 'coffee', 'te': 'emoji_food_beverage', 'tè': 'emoji_food_beverage',
    'cibo': 'restaurant', 'fame': 'restaurant', 'mangiare': 'restaurant', 'pranzo': 'lunch_dining', 'cena': 'dinner_dining',
    'pane': 'bakery_dining', 'pasta': 'dinner_dining', 'pizza': 'local_pizza', 'frutta': 'nutrition',
    'letto': 'bed', 'dormire': 'bedtime', 'riposo': 'hotel', 'stanco': 'bedtime',
    'dolore': 'medical_services', 'male': 'sentiment_dissatisfied', 'medico': 'health_and_safety', 'ospedale': 'local_hospital',
    'pillola': 'medication', 'medicina': 'medication', 'infermiere': 'medical_services',
    
    // Emozioni & Stati d'animo
    'bene': 'sentiment_satisfied', 'felice': 'mood', 'contento': 'mood', 'sorriso': 'sentiment_very_satisfied',
    'triste': 'sentiment_dissatisfied', 'piangere': 'sentiment_very_dissatisfied', 'arrabbiato': 'sentiment_very_dissatisfied',
    'caldo': 'light_mode', 'freddo': 'ac_unit', 'bello': 'auto_awesome', 'brutto': 'thumb_down',
    'paura': 'warning', 'ansia': 'heart_broken', 'tranquillo': 'spa', 'calma': 'spa', 'fastidio': 'do_not_disturb',
    'amore': 'favorite', 'piace': 'favorite', 'adoro': 'favorite',
    
    // Luoghi & Spostamenti
    'casa': 'home', 'fuori': 'forest', 'lavoro': 'work', 'ufficio': 'business', 'scuola': 'school',
    'negozio': 'store', 'supermercato': 'shopping_cart', 'parco': 'park',
    'andare': 'directions_walk', 'camminare': 'directions_walk', 'uscire': 'door_open', 'entrare': 'meeting_room',
    'auto': 'directions_car', 'macchina': 'directions_car', 'bus': 'directions_bus', 'treno': 'train', 'metro': 'subway',
    
    // Azioni, Comunicazione & Pensiero
    'parlare': 'forum', 'ascoltare': 'hearing', 'guardare': 'visibility', 'vedere': 'visibility',
    'chiamare': 'call', 'telefono': 'smartphone', 'scrivere': 'edit_note', 'leggere': 'menu_book',
    'pensare': 'psychology', 'capito': 'lightbulb', 'idea': 'lightbulb', 'ricordare': 'memory',
    'aspettare': 'hourglass_empty', 'presto': 'speed', 'tardi': 'update_disabled',
    'aprire': 'lock_open', 'chiudere': 'lock', 'accendere': 'power_settings_new', 'spegnere': 'power_off',
    
    // Domande & Tempo
    'cosa': 'quiz', 'chi': 'person_search', 'dove': 'location_on', 'quando': 'calendar_month',
    'perché': 'help', 'come': 'tune', 'quanto': 'calculate',
    'adesso': 'schedule', 'ora': 'schedule', 'dopo': 'arrow_forward', 'domani': 'event', 'oggi': 'today',
    'tempo': 'schedule', 'musica': 'music_note', 'tv': 'tv', 'gioco': 'sports_esports'
};

function getMaterialIconForText(text) {
    if (!text) return 'chat_bubble_outline';
    const cleanText = text.toLowerCase().trim();
    
    // 1. Direct match
    if (materialIconMapping[cleanText]) return materialIconMapping[cleanText];
    
    // 2. Keyword/substring match
    for (const [key, icon] of Object.entries(materialIconMapping)) {
        if (cleanText.includes(key)) {
            return icon;
        }
    }

    // 3. Smart Heuristic Fallback based on punctuation and patterns
    if (cleanText.includes('?')) return 'help_outline';
    if (cleanText.includes('!')) return 'campaign';
    if (/\d/.test(cleanText)) return 'tag';
    
    return 'chat_bubble_outline';
}

function updateSuggestions(options) {
    suggestBtns.forEach((btn, index) => {
        const text = options[index];
        btn.disabled = false;
        btn.classList.remove('empty');
        
        // Find matching icon
        const iconName = getMaterialIconForText(text);
        
        // Remove previous icon if it exists
        const existingIcon = btn.querySelector('.btn-icon');
        if (existingIcon) {
            existingIcon.remove();
        }
        
        // Inject new Material Icon
        if (iconName) {
            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined btn-icon';
            iconSpan.textContent = iconName;
            btn.insertBefore(iconSpan, btn.querySelector('.btn-text'));
        }
        
        btn.querySelector('.btn-text').textContent = text;
        btn.onclick = () => {
            triggerHaptic(35);
            speak(text);
        };
    });
}

// Resize handler to ensure visualizer canvas resolution matches layout
window.addEventListener('resize', () => {
    if (isListening && visualizerCanvas) {
        visualizerCanvas.width = visualizerCanvas.offsetWidth;
        visualizerCanvas.height = visualizerCanvas.offsetHeight;
    }
});

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('[PWA] Service Worker registrato con successo scope:', reg.scope))
            .catch(err => console.error('[PWA] Registrazione Service Worker fallita:', err));
    });
}

// sidepanel.js - Sourcing Copilot v2.9.5

let companies = new Set();
let companyLinks = {};
let results = [];
let roles = [];
let activeRoleId = null;
let candidateScore = null;
let editingRoleId = null;
let currentCandidate = { name: '', url: '', pageText: '', source: 'linkedin' };
let sessionHistory = [];
let historyFilter = 'all';
let compareFilter = 'all';
let notesTimer = null;
let pendingDimensions = [];
let toneSample = '';
let recruiterRoleTitle = '';
let recruiterCompanyName = '';
let aiProvider = 'gemini';
let githubToken = '';
let autoScanTimer = null;
let lastAutoScan = 0;
let confirmResolver = null;

const MODEL_SCORE = 'gemini-2.5-flash';  // better instruction following for nuanced evidence rules — scoring, extraction, analysis
const MODEL_WRITE = 'gemini-2.5-flash';          // reasoning — outreach generation, revision, dimension generation
const AUTO_SCAN_COOLDOWN = 10000;
const OUTREACH_LIMITS = { connection: 280, inmail_body: 1300 };
const OUTREACH_TARGETS = { connection: 180, inmail_body: 900 };

function getSourceTagLabel(source) {
  if (source === 'pdf') return 'LinkedInPDFScan';
  if (source === 'github') return 'GitHubProfileScan';
  return 'LinkedInProfileScan';
}

function normalizeLinkedInProfileUrl(url) {
  if (!url) return '';
  var clean = String(url).trim().replace(/[.,;:]+$/, '');
  clean = clean.replace(/^chrome-extension:\/\/[^/]+\//i, '');
  clean = clean.replace(/^\/+/, '');
  var match = clean.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[^\s)\]>"']+/i);
  if (!match) return '';
  clean = match[0].replace(/[.,;:]+$/, '');
  return /^https?:\/\//i.test(clean) ? clean : 'https://' + clean;
}

function findLinkedInProfileUrl(text) {
  if (!text) return '';
  const directMatch = String(text).match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^\s)\]>"']+/i);
  if (directMatch) return normalizeLinkedInProfileUrl(directMatch[0]);
  const stripped = String(text).replace(/\s+/g, '');
  const compactMatch = stripped.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[^\s)\]>"']+/i);
  if (!compactMatch) return '';
  return normalizeLinkedInProfileUrl(compactMatch[0]);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
  await loadFromStorage();
  renderUI();
  setupEventListeners();
  initConfirmDialog();
  autoScanCurrentTab();
  // Initialise GitHub tab state on panel open
  chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
    showGitHubTabState(t?.url);
  });
});

async function loadFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'aiProvider', 'githubToken', 'roles', 'activeRoleId', 'history', 'toneSample', 'recruiterRoleTitle', 'recruiterCompanyName'], (data) => {
      if (data.apiKey) document.getElementById('apiKeyInput').value = data.apiKey;
      if (data.githubToken) {
        githubToken = data.githubToken;
        const gtEl = document.getElementById('githubTokenInput');
        if (gtEl) gtEl.value = data.githubToken;
      }
      if (data.aiProvider) {
        aiProvider = data.aiProvider;
        document.getElementById('providerSelect').value = data.aiProvider;
        updateApiKeyPlaceholder(data.aiProvider);
      }
      if (data.toneSample) {
        toneSample = data.toneSample;
        var tsEl = document.getElementById('toneSampleInput');
        if (tsEl) tsEl.value = data.toneSample;
      }
      if (data.recruiterRoleTitle) {
        recruiterRoleTitle = data.recruiterRoleTitle;
        var roleTitleEl = document.getElementById('recruiterRoleTitleInput');
        if (roleTitleEl) roleTitleEl.value = data.recruiterRoleTitle;
      }
      if (data.recruiterCompanyName) {
        recruiterCompanyName = data.recruiterCompanyName;
        var companyNameEl = document.getElementById('recruiterCompanyNameInput');
        if (companyNameEl) companyNameEl.value = data.recruiterCompanyName;
      }
      roles = data.roles || [];
      activeRoleId = data.activeRoleId || null;
      sessionHistory = data.history || [];
      resolve();
    });
  });
}

function renderUI() {
  renderRoles();
  updateRoleBar();
  renderResults();
  renderHistory();
  renderCompareView();
  updateAnalyseSection();
}

function wire(id, evt, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener(evt, fn);
}

function setupEventListeners() {
  document.querySelectorAll('.tab').forEach(function(tab) {
    tab.addEventListener('click', function() { switchTab(tab.dataset.tab); });
  });
  wire('settingsTabBtn', 'click', function() { switchTab('settings'); });
  wire('scanBtn', 'click', scanCompanies);
  wire('scoreProfileBtn', 'click', scoreProfile);
  wire('pdfInput', 'change', handlePdfUpload);
  setupPdfDropzone();
  setupGitHubTab();
  setupJdDropzone();
  wire('refreshBtn', 'click', function() { autoScanCurrentTab(true); });
  wire('analyseBtn', 'click', analyseCompanies);
  wire('clearBtn', 'click', clearAll);
  wire('addManualBtn', 'click', addManual);
  wire('manualInput', 'keydown', function(e) { if (e.key === 'Enter') addManual(); });
  wire('notesArea', 'input', function() { clearTimeout(notesTimer); notesTimer = setTimeout(saveNotes, 800); });
  wire('saveSettingsBtn', 'click', saveSettings);
  wire('saveApiKeyBtn', 'click', function() {
    saveSettings();
    var note = document.getElementById('apiKeySavedNote');
    if (note) {
      note.textContent = '✓ API key saved.';
      note.style.color = 'var(--accent)';
    }
  });
  wire('providerSelect', 'change', function(e) {
    updateApiKeyPlaceholder(e.target.value);
    document.getElementById('apiKeyInput').value = '';
  });
  wire('saveRoleBtn', 'click', saveRole);
  wire('generateDimsBtn', 'click', generateDimensions);
  wire('generateOutreachBtn', 'click', generateOutreach);
  wire('outreachFormat', 'change', updateOutreachCharCount);
  wire('outreachBody', 'input', updateOutreachCharCount);
  wire('outreachFeedbackBtn', 'click', reviseOutreach);
  wire('downloadAllCsvBtn', 'click', function() { downloadHistoryCsv(); });

  // Source filter pills
  function setupFilterBar(barId, getFilter, setFilter, renderFn) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', function() {
        bar.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        setFilter(pill.dataset.filter);
        renderFn();
      });
    });
  }
  setupFilterBar('historyFilterBar', () => historyFilter, v => { historyFilter = v; }, renderHistory);
  setupFilterBar('compareFilterBar', () => compareFilter, v => { compareFilter = v; }, renderCompareView);

  wire('addRoleBtn', 'click', function() {
    var form = document.getElementById('addRoleForm');
    var isOpen = form.style.display !== 'none';
    editingRoleId = null;
    document.getElementById('roleNameInput').value = '';
    document.getElementById('roleIcpInput').value = '';
    document.getElementById('rolePromptInput').value = '';
    document.getElementById('roleCompellingInput').value = '';
    document.getElementById('roleCompetitorsInput').value = '';
    document.querySelectorAll('#companyTypeOptions input').forEach(function(cb) { cb.checked = false; });
    document.getElementById('saveRoleBtn').textContent = 'Save Role';
    document.getElementById('dimensionsEditor').style.display = 'none';
    document.getElementById('dimensionsList').innerHTML = '';
    pendingDimensions = [];
    // Reset JD upload state
    const jdFn = document.getElementById('jdFileName');
    const jdSt = document.getElementById('jdStatus');
    const jdEr = document.getElementById('jdError');
    if (jdFn) { jdFn.textContent = ''; jdFn.style.display = 'none'; }
    if (jdSt) jdSt.style.display = 'none';
    if (jdEr) jdEr.style.display = 'none';
    form.style.display = isOpen ? 'none' : 'block';
  });
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.action === 'linkedinProfileLoaded') {
      const isGitHub = msg.url && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(msg.url);
      if (isGitHub) {
        githubData = null;
        const scanBtn = document.getElementById('githubScanBtn');
        if (scanBtn) scanBtn.textContent = '⌥ Scan GitHub Profile';
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.dataset.tab === 'github' && githubToken) {
          runGitHubAnalysis();
        } else {
          showGitHubTabState(msg.url);
        }
      } else {
        githubData = null;
        showGitHubTabState(null);
        clearTimeout(autoScanTimer);
        autoScanTimer = setTimeout(function() { autoScanCurrentTab(); }, 1500);
      }
    }
  });

  // Auto-scan GitHub when switching to GitHub tab
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function() {
      if (tab.dataset.tab === 'github') {
        chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
          showGitHubTabState(t?.url);
        });
      }
    });
  });
}


function setupPdfDropzone() {
  var dropzone = document.getElementById('pdfDropzone');
  var input = document.getElementById('pdfInput');
  if (!dropzone || !input) return;

  function openPicker() { input.click(); }
  dropzone.addEventListener('click', openPicker);
  dropzone.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  });
  ['dragenter', 'dragover'].forEach(function(evt) {
    dropzone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach(function(evt) {
    dropzone.addEventListener(evt, function(e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function(e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
      showError('Please upload a PDF file.');
      return;
    }
    handlePdfUpload({ file: file });
  });
}

function initConfirmDialog() {
  wire('confirmCancelBtn', 'click', function() { closeConfirmDialog(false); });
  wire('confirmOkBtn', 'click', function() { closeConfirmDialog(true); });
  var overlay = document.getElementById('confirmOverlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeConfirmDialog(false);
    });
  }
  document.addEventListener('keydown', function(e) {
    var overlayEl = document.getElementById('confirmOverlay');
    if (!overlayEl || !overlayEl.classList.contains('show')) return;
    if (e.key === 'Escape') closeConfirmDialog(false);
  });
}

function openConfirmDialog(title, message, confirmLabel, cancelLabel) {
  return new Promise(function(resolve) {
    confirmResolver = resolve;
    var overlay = document.getElementById('confirmOverlay');
    var titleEl = document.getElementById('confirmTitle');
    var textEl = document.getElementById('confirmText');
    var okBtn = document.getElementById('confirmOkBtn');
    var cancelBtn = document.getElementById('confirmCancelBtn');
    if (titleEl) titleEl.textContent = title || 'Are you sure?';
    if (textEl) textEl.textContent = message || 'Please confirm this action.';
    if (okBtn) okBtn.textContent = confirmLabel || 'Yes, delete';
    if (cancelBtn) cancelBtn.textContent = cancelLabel || 'No, go back';
    if (overlay) {
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden', 'false');
    }
  });
}

function closeConfirmDialog(confirmed) {
  var overlay = document.getElementById('confirmOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (confirmResolver) {
    var resolver = confirmResolver;
    confirmResolver = null;
    resolver(Boolean(confirmed));
  }
}

// --- Auto-scan ---

async function autoScanCurrentTab(manual = false) {
  const now = Date.now();
  if (!manual && now - lastAutoScan < AUTO_SCAN_COOLDOWN) return;
  lastAutoScan = now;
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isLinkedInProfile = tab?.url?.includes('linkedin.com/in/') || tab?.url?.includes('linkedin.com/talent/') || tab?.url?.includes('linkedin.com/recruiter/');
    const isGitHubProfile = tab?.url && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(tab.url);
    if (!isLinkedInProfile && !isGitHubProfile) {
      if (manual) showError('Open a LinkedIn or GitHub profile to scan.');
      return;
    }
    const pageData = await getPageData(tab.id);
    if (!pageData?.pageText) return;

    const autoSource = pageData.isGitHub ? 'github' : 'linkedin';
    currentCandidate = {
      name: pageData.candidateName || extractNameFromTitle(pageData.pageTitle) || 'Unknown Candidate',
      url: pageData.url || tab.url,
      pageText: pageData.pageText,
      source: autoSource
    };
    if (pageData.companyLinks) companyLinks = { ...companyLinks, ...pageData.companyLinks };
    document.getElementById('candidateName').textContent = currentCandidate.name;
    document.getElementById('candidateMeta').textContent = autoSource === 'github' ? 'GitHub profile' : 'LinkedIn profile';
    document.getElementById('autoBadge').style.display = 'inline';

    companies.clear();
    results = [];
    candidateScore = null;
    document.getElementById('notesArea').value = '';
    document.getElementById('notesSaved').textContent = '';
    renderCompanyTags();
    renderResults();
    updateAnalyseSection();
    document.getElementById('detectedSection').style.display = 'none';
    document.getElementById('clearBtn').style.display = 'none';
    hideError();
    extractCompanies(pageData.pageText, apiKey);
  } catch(err) {
    if (manual) showError('Could not read page: ' + err.message);
  }
}

async function getPageData(tabId) {
  // Side panels cannot call scripting.executeScript — route through background relay
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: 'getPageData', tabId }, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (resp?.error) reject(new Error(resp.error));
      else resolve(resp);
    });
  });
}

function extractNameFromTitle(title) {
  if (!title) return '';
  const match = title.match(/^([^|]+)\s*\|/);
  return match ? match[1].trim() : '';
}

// --- Gemini API ---
async function callAI(apiKey, prompt, temperature = 0.2, model = MODEL_SCORE) {
  if (aiProvider === 'openai') return callOpenAI(apiKey, prompt, temperature);
  if (aiProvider === 'anthropic') return callAnthropic(apiKey, prompt, temperature);
  return callGemini(apiKey, prompt, temperature, model);
}

async function callGemini(apiKey, prompt, temperature = 0.2, model = MODEL_SCORE) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: 8000,
        ...(model === MODEL_SCORE ? { thinkingConfig: { thinkingBudget: 0 } } : {})
      }
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error('Free tier rate limit reached. Enable billing at aistudio.google.com to continue — costs ~£2-3/month for normal use.');
    }
    throw new Error(`Gemini API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  const data = await res.json();
  const parts = data.candidates?.flatMap(c => c.content?.parts || []) || [];
  return parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
}


async function callGeminiWithParts(apiKey, parts, maxOutputTokens, temperature = 0.2, model = MODEL_WRITE) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature, maxOutputTokens: maxOutputTokens || 8000 }
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 429) {
      throw new Error('Gemini rate limit reached. Paid tiers work best for PDF analysis.');
    }
    throw new Error(`Gemini API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  const data = await res.json();
  const outParts = data.candidates?.flatMap(c => c.content?.parts || []) || [];
  return outParts.filter(p => p.text && !p.thought).map(p => p.text).join('');
}

async function callAnthropic(apiKey, prompt, temperature = 0.2) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 8000,
      system: 'You are an expert recruiter assistant. Follow all instructions precisely. Return only valid JSON when asked — no markdown, no code fences, no explanation.',
      messages: [{ role: 'user', content: prompt }],
      temperature
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  const data = await res.json();
  return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
}

async function callPdfAI(apiKey, prompt, pdfBase64, filename, temperature = 0) {
  if (aiProvider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 8000,
        system: 'You are an expert recruiter assistant. Follow all instructions precisely. Return only valid JSON when asked — no markdown, no code fences, no explanation.',
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }],
        temperature
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Anthropic API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  }
  if (aiProvider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_file',
              filename: filename || 'linkedin-profile.pdf',
              file_data: pdfBase64
            },
            {
              type: 'input_text',
              text: prompt
            }
          ]
        }]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OpenAI API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.output_text
      || (data.output || []).flatMap(function(item) { return item.content || []; }).map(function(part) {
        return part.text || part.output_text || (part.type === 'output_text' ? part.text : '');
      }).filter(Boolean).join('')
      || '';
  }
  return callGeminiWithParts(apiKey, [
    { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    { text: prompt }
  ], 12000, temperature);
}

async function callOpenAI(apiKey, prompt, temperature = 0.2) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert recruiter assistant. Follow all instructions precisely. Return only valid JSON when asked — no markdown, no code fences, no explanation.' },
        { role: 'user', content: prompt }
      ],
      temperature,
      max_tokens: 8000
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

function updateApiKeyPlaceholder(provider) {
  const input = document.getElementById('apiKeyInput');
  const label = document.getElementById('apiKeyLabel');
  const noteGemini = document.getElementById('apiKeyNoteGemini');
  const noteOpenAI = document.getElementById('apiKeyNoteOpenAI');
  const noteAnthropic = document.getElementById('apiKeyNoteAnthropic');
  if (provider === 'openai') {
    input.placeholder = 'sk-...';
    label.textContent = 'OpenAI API Key';
    if (noteGemini) noteGemini.style.display = 'none';
    if (noteOpenAI) noteOpenAI.style.display = 'inline';
    if (noteAnthropic) noteAnthropic.style.display = 'none';
  } else if (provider === 'anthropic') {
    input.placeholder = 'sk-ant-...';
    label.textContent = 'Anthropic API Key';
    if (noteGemini) noteGemini.style.display = 'none';
    if (noteOpenAI) noteOpenAI.style.display = 'none';
    if (noteAnthropic) noteAnthropic.style.display = 'inline';
  } else {
    input.placeholder = 'AIza...';
    label.textContent = 'Gemini API Key';
    if (noteGemini) noteGemini.style.display = 'inline';
    if (noteOpenAI) noteOpenAI.style.display = 'none';
    if (noteAnthropic) noteAnthropic.style.display = 'none';
  }
}

function parseJSON(text) {
  if (!text) return null;
  const cleaned = text
    .replace(/^```[\w]*\s*/gm, '')
    .replace(/^```\s*$/gm, '')
    .trim();

  function extractOutermostObject(str) {
    const start = str.indexOf('{');
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) return str.slice(start, i + 1); }
    }
    return null;
  }

  // Attempt to recover a truncated JSON object by closing open brackets
  function attemptRepair(str) {
    const start = str.indexOf('{');
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false;
    let lastValidClose = -1;
    for (let i = start; i < str.length; i++) {
      const c = str[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      if (c === '}') { depth--; if (depth === 0) lastValidClose = i; }
    }
    // If truncated, try to close the object at the last safe point
    if (depth > 0) {
      // Strip any incomplete trailing field, close open arrays and objects
      let partial = str.slice(start);
      partial = partial.replace(/,\s*"[^"]*"\s*:\s*[^,}]*$/, ''); // strip last incomplete field
      partial = partial.replace(/,\s*$/, ''); // strip trailing comma
      partial += '}'.repeat(depth);
      try {
        const repaired = JSON.parse(partial);
        if (typeof repaired === 'object' && repaired !== null) return repaired;
      } catch(e) {}
    }
    return null;
  }

  for (const candidate of [cleaned, text.trim(), extractOutermostObject(cleaned), extractOutermostObject(text), attemptRepair(cleaned), attemptRepair(text)]) {
    if (!candidate) continue;
    try {
      const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch(e) {}
  }
  return null;
}

// --- Extract companies ---
async function extractCompanies(pageText, apiKey) {
  if (!pageText || !apiKey) return;
  const prompt = `Extract ONLY the employer/company names from this LinkedIn profile's Experience section.

Rules:
- Return ONLY companies where this person was an employee or contractor
- Ignore companies mentioned in posts, shares, recommendations, or "People also viewed"
- Ignore education institutions
- Ignore company names that appear in the sidebar or activity feed
- Return a JSON array of strings, max 12 items
- Return [] if none found
- No markdown, no explanation, just the raw JSON array

Profile text:
${pageText.substring(0, 5000)}`;

  try {
    const text = await callAI(apiKey, prompt, 0, MODEL_SCORE);
    const clean = text.replace(/\`\`\`json|\`\`\`/g, '').trim();
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed) && parsed.length > 0) {
      parsed.filter(c => typeof c === 'string' && c.length > 1).forEach(c => companies.add(c));
      renderCompanyTags();
      document.getElementById('detectedSection').style.display = 'block';
      document.getElementById('clearBtn').style.display = 'block';
      updateAnalyseSection();
    }
  } catch(e) { /* silent fail */ }
}

async function scanCompanies() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('Add your API key in Settings first.'); return; }
  const btn = document.getElementById('scanBtn');
  btn.disabled = true; btn.innerHTML = 'Scanning...'; hideError();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageData = await getPageData(tab.id);
    if (!pageData?.pageText) { showError('Could not read page.'); return; }
    if (pageData.candidateName) {
      currentCandidate.name = pageData.candidateName;
      currentCandidate.pageText = pageData.pageText;
      document.getElementById('candidateName').textContent = pageData.candidateName;
    }
    await extractCompanies(pageData.pageText, apiKey);
    if (companies.size === 0) showError('No companies detected. Add them manually.');
  } catch(err) { showError('Scan failed: ' + err.message); }
  btn.disabled = false; btn.innerHTML = '&#x1F50D; Scan Companies';
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractCandidateFromPdf(file, apiKey) {
  const pdfBase64 = await fileToBase64(file);
  const prompt = `You are extracting structured candidate data from a LinkedIn profile PDF export.

Return ONLY a raw JSON object:
{
  "candidateName": "<name or Unknown Candidate>",
  "profileUrl": "<full LinkedIn profile URL if present, otherwise empty string>",
  "profileText": "<clean plain text of the full profile — do not truncate or summarise. Preserve all sections including full Experience with exact job titles, company names, and date ranges, Education, Skills, Certifications, Languages, and About>",
  "companies": ["<company 1>", "<company 2>"],
  "headline": "<headline if present>",
  "location": "<location if present>"
}

Rules:
- Capture the candidate's LinkedIn profile URL if it appears anywhere in the PDF
- Capture the candidate's actual work history companies only
- Exclude schools unless also an employer
- Exclude skills, interests, sidebar suggestions, references, ads, or unrelated companies
- Keep profileText faithful to the PDF content only — do not summarise or paraphrase
- profileText must preserve all sections in full: Headline, About, Experience (with all roles and date ranges), Education, Skills, Certifications, Languages
- Preserve all date ranges exactly as written — these are used for tenure calculations
- No markdown, no explanation`; 
  const text = await callPdfAI(apiKey, prompt, pdfBase64, file.name, 0);
  const parsed = parseJSON(text);
  if (!parsed || !parsed.profileText) throw new Error('Could not extract profile data from this PDF.');
  return parsed;
}

async function scoreCurrentCandidateFromText(apiKey, activeRole) {
  const customPrompt = activeRole.customPrompt ? `
ADDITIONAL INSTRUCTIONS: ${activeRole.customPrompt}` : '';
  const companyTypeStr = activeRole.companyTypes?.length
    ? `
TARGET COMPANY TYPE: ${activeRole.companyTypes.join(', ')} — score candidates higher if their background reflects experience at companies of this type. Penalise mismatches.`
    : '';
  const competitorStr = activeRole.competitors
    ? `
DIRECT COMPETITORS: ${activeRole.competitors}
COMPETITOR VERIFICATION RULES — apply strictly:
- Before crediting competitor experience, verify the company name appears explicitly and exactly in the candidate profile text above
- If a competitor name does not appear in the profile text, do not mention it anywhere in your output — not in dimensions, not in strengths, not in explore, not in the recommendation
- Do not infer, assume, or use world knowledge about related or formerly named companies
- Do not bundle companies together — each must be verified independently in the profile
- Only companies explicitly named in the profile can be cited as competitor experience`
    : '';

  const hasDimensions = activeRole.dimensions && activeRole.dimensions.length > 0;
  let dimensionsPromptSection;
  if (hasDimensions) {
    const spDimLines = activeRole.dimensions.map(function(d) {
      return `- "${d.label}" (${d.weight}% weight): ${d.description}`;
    }).join('\n');
    dimensionsPromptSection = `Score EXACTLY these dimensions (do not invent others):
${spDimLines}

SCORING RUBRIC — apply strictly to every dimension:
- 90-100: Exceptional, explicit, direct evidence. Exceeds the requirement clearly. Reserve for standout candidates only.
- 70-89: Strong, clear evidence. Meets the requirement well with named specifics.
- 50-69: Partial or indirect evidence. Some relevant experience but gaps or lack of depth.
- 30-49: Weak evidence. Tangentially relevant at best. Requirement mostly unmet.
- 0-29: No credible evidence. Requirement clearly not met based on available profile data.

CALIBRATION RULES:
- A score of 100 means PERFECT evidence — explicitly stated, exceeds requirements, no gaps whatsoever. This should be rare.
- If a requirement is not explicitly evidenced in the profile, the score must reflect that — do not award high scores for assumed or likely experience.
- Scores should differentiate candidates. If every dimension scores 80+, you have not calibrated properly.
- A profile with no relevant evidence for a dimension should score 0–15, not 30. Do not use 30 as a default floor.
- Be honest and critical. A recruiter reading this needs accurate signal, not inflated scores.

For each dimension return {"label": "<exact label>", "score": <0-100>, "note": "<one line — either quote or directly reference the exact words from the profile that support this score, or state 'not evidenced in profile'>", "weight": <weight>}
The overall score field should be left as 0 — it will be calculated from weights.`;
  } else {
    dimensionsPromptSection = `For dimensions: derive 4 meaningful labels directly from the ICP criteria above.

SCORING RUBRIC — apply strictly to every dimension:
- 90-100: Exceptional explicit evidence, exceeds requirement clearly. Reserve for standout candidates only.
- 70-89: Strong clear evidence. Meets the requirement well with named specifics.
- 50-69: Partial or indirect evidence. Some relevant experience but gaps or lack of depth.
- 30-49: Weak evidence. Tangentially relevant. Requirement mostly unmet.
- 0-29: No credible evidence. Requirement clearly not met.

CALIBRATION RULES:
- A score of 100 means perfect explicit evidence — this should be rare.
- Do not award high scores for assumed or likely experience not in the profile.
- Scores must differentiate. If every dimension scores 80+, you have not calibrated properly.
- A profile with no relevant evidence for a dimension should score 0–15, not 30. Do not use 30 as a default floor.
- Be honest and critical. A recruiter needs accurate signal, not inflated scores.

Return {"label": "...", "score": <0-100>, "note": "<one line — either quote or directly reference the exact words from the profile that support this score, or state 'not evidenced in profile'>"}
The overall "score" field must be the average of your dimension scores — not a separate holistic judgment. Tier: Strong = 70+, Potential = 45-69, Weak = <45.`;
  }

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const profileText = currentCandidate.source === 'pdf'
    ? (currentCandidate.pageText || '')
    : (currentCandidate.pageText || '').substring(0, 18000);

  const prompt = `You are an expert recruiter evaluating a candidate against a role ICP.

TODAY'S DATE: ${today}
Use this date for all tenure calculations.

ASSESSMENT RULES — READ EVERY RULE BEFORE EVALUATING.

RULE 1 — NEVER MAKE UP, ASSUME, OR HALLUCINATE CANDIDATE EXPERIENCE.
This is the most important rule. If the candidate has not explicitly written it in their profile, you cannot state it, score it, or imply it anywhere in your output. Not in dimensions. Not in strengths. Not in the recommendation. Not anywhere.

Ask yourself before writing any claim: has the candidate explicitly stated this about themselves in the profile text below?
- If YES — use it as confirmed evidence
- If NO — do not state it. Mark as "No evidence on candidate profile" or move to Worth Exploring if there is a genuine contextual signal

RULE 2 — JOB TITLES AND COMPANY NAMES ARE LABELS ONLY.
A job title tells you the candidate held that title. Nothing more.
A company name tells you the candidate worked there. Nothing more.
Do not infer what the candidate did, sold, achieved, or was responsible for based on their title or employer alone.
WRONG: "Corporate Account Executive at UiPath → candidate has SaaS sales experience and net-new logo wins"
RIGHT: "Corporate Account Executive at UiPath → candidate held this title at UiPath. No further details provided in profile."

RULE 3 — COMPANY CONTEXT MAY INFORM ENVIRONMENT, NOT EXPERIENCE.
You may use publicly established facts about well-known employers to describe the TYPE of company the candidate worked at — not what the candidate personally did there.
PERMITTED: "Candidate worked at UiPath, a SaaS company" → score SaaS environment exposure
NOT PERMITTED: "Candidate has SaaS sales experience" → requires the candidate to have stated this
If a company serves certain sectors (e.g. FS, Insurance) but the candidate does not mention selling into those sectors — do not credit sector experience. Instead add to Worth Exploring: "Employer serves [sector] — worth establishing whether candidate has directly sold into this vertical."

RULE 4 — WORTH EXPLORING IS FOR CONTEXTUAL SIGNALS ONLY.
Use the explore field when the candidate's employer context suggests possible relevance that the candidate has not confirmed.
Example: Candidate works at a company that serves Financial Services but does not mention FS experience — flag in explore: "Employer provides services to FS sector — no evidence candidate has directly sold into this vertical. Worth confirming."
Do not use explore for speculation or inference — only for genuine employer context signals.

RULE 5 — SCORE ONLY WHAT IS EVIDENCED.
A dimension with no confirmed evidence from the profile must score 0–15 and the note must state "No evidence on candidate profile."
Do not award scores based on what a role typically involves or what a company typically does.

PROCEDURAL RULES:
Tenure: Calculate only when both start AND end dates are explicitly stated. Use today's date for "Present". If dates are missing — state "dates not specified", do not estimate.
Promotions: Multiple titles at the same employer = one tenure. Treat explicit promotions as a positive signal.
Scoring: Scores must differentiate candidates. If every dimension scores 80+, recalibrate.

ROLE: ${activeRole.name}
ICP CRITERIA:
${activeRole.icp}${companyTypeStr}${competitorStr}${customPrompt}

CANDIDATE PROFILE (cleaned text from ${currentCandidate.source === 'pdf' ? 'LinkedIn PDF export — full text, no truncation' : currentCandidate.source === 'github' ? 'GitHub public profile' : 'LinkedIn page'}):
${profileText}
${currentCandidate.source === 'github' ? `
GITHUB PROFILE SCORING GUIDANCE:
GitHub profiles contain different signals to LinkedIn. Adjust your assessment accordingly:
- Career history and job titles are typically absent. Do not penalise a candidate for this — GitHub is not a CV.
- Technical depth signals: programming languages in repos, repo descriptions, pinned projects, README content, contribution volume, organisation memberships.
- Use repo names, descriptions, and languages as proxies for technical skills and domain focus.
- Stars and forks indicate community recognition of technical work — treat as positive signal.
- Bio and README may contain role, specialisation, or domain context — treat as self-described evidence.
- Where LinkedIn ICP dimensions (e.g. sales experience, quota attainment) cannot be assessed from GitHub data, score 0 and note "GitHub profile — career history not available. Verify on LinkedIn."
- Outreach hook: always reference a specific repo, project, or contribution by name. This is the primary personalisation lever.
` : ''}

Evaluate the candidate carefully. Return ONLY a raw JSON object — no markdown, no code fences:
{
  "score": <integer 0-100>,
  "tier": "<Strong|Potential|Weak>",
  "headline": "<one concise line, max 20 words — confirmed evidence only>",
  "dimensions": [<dimension objects — note field max 25 words, confirmed evidence only or 'not evidenced in profile'>],
  "strengths": ["<confirmed evidence only — max 20 words each>"],
  "gaps": ["<ICP requirements not evidenced in profile — max 20 words each>"],
  "redFlags": ["<confirmed concerns only — max 20 words each, or empty array>"],
  "explore": ["<contextual signals only — things worth probing in a screening call because the candidate's employer context suggests possible relevance not yet confirmed. Only include if there is a genuine contextual signal. If nothing qualifies, return an empty array. Do not speculate or infer. Max 25 words each>"],
  "recommendation": "<2 sentences max — confirmed evidence only>",
  "anchorCompany": "<single employer name from the profile — the one a recruiter would most want to reference in outreach>",
  "anchorJobTitle": "<the candidate's exact job title at the anchor company, copied verbatim from the profile — not a description, the exact title as written>",
  "anchorReason": "<one sentence: why this employer is the strongest outreach anchor, combining ICP experience relevance AND company type relevance — e.g. direct competitor, same B2B SaaS space, relevant market>"
}

ANCHOR COMPANY SELECTION RULES:
- anchorCompany must be a real employer explicitly named in the profile
- Choose the employer that best combines: (1) experience most relevant to the ICP dimensions AND (2) company most similar to the hiring company in type, market, or competitive position
- A direct competitor or company in the same space always beats a well-known brand unrelated to the ICP
- Do NOT default to the most prestigious or well-known employer — default to the most ICP-relevant one
- If no employer is clearly relevant, use the one with the strongest confirmed dimension evidence

${dimensionsPromptSection}
If redFlags is empty return []. If explore is empty return [].
IMPORTANT: Return the JSON object only. No markdown. No code fences. No explanation. Your entire response must start with { and end with }.`;

  const text = await callAI(apiKey, prompt, 0, MODEL_SCORE);
  const parsed = parseJSON(text);
  if (parsed && parsed.dimensions) {
    if (hasDimensions) {
      const weightedScore = activeRole.dimensions.reduce((total, dim) => {
        const result = parsed.dimensions.find(d => d.label === dim.label);
        return total + ((result?.score || 0) * dim.weight / 100);
      }, 0);
      parsed.score = Math.round(weightedScore);
      parsed.tier = parsed.score >= 70 ? 'Strong' : parsed.score >= 45 ? 'Potential' : 'Weak';
      parsed.dimensions = parsed.dimensions.map(d => {
        const def = activeRole.dimensions.find(rd => rd.label === d.label);
        return def ? { ...d, weight: def.weight } : d;
      });
    }
    if (parsed.score !== undefined) {
      parsed.tier = parsed.score >= 70 ? 'Strong' : parsed.score >= 45 ? 'Potential' : 'Weak';
    }
    candidateScore = parsed;
    addToHistory(candidateScore, activeRole.name, activeRole.id);
  } else {
    const previewText = text ? text.substring(0, 300) : 'Empty response';
    console.error('Scoring parse failed. Response preview:', previewText);
    candidateScore = { score: 0, tier: 'Weak', headline: 'Could not parse response — check console for details.', dimensions: [], strengths: [], gaps: [], redFlags: [], explore: [], recommendation: previewText };
  }
}

async function handlePdfUpload(e) {
  const file = e?.file || e?.target?.files?.[0];
  if (!file) return;
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('Add your API key in Settings first.'); return; }
  const activeRole = roles.find(r => r.id === activeRoleId);
  if (!activeRole) { showError('No active role selected. Go to Settings.'); return; }
  if (!recruiterRoleTitle || !recruiterCompanyName) { showError('Add your role title and company name in Settings before scoring.'); return; }
  const fileNameEl = document.getElementById('pdfFileName');
  if (fileNameEl) fileNameEl.textContent = file.name;
  hideError();
  switchTab('results');
  document.getElementById('resultsEmpty').style.display = 'none';
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'Reading LinkedIn PDF...';
  document.getElementById('loadingCompanyName').textContent = file.name;
  try {
    const extracted = await extractCandidateFromPdf(file, apiKey);
    currentCandidate = {
      name: extracted.candidateName || file.name.replace(/\.pdf$/i, ''),
      url: normalizeLinkedInProfileUrl(extracted.profileUrl) || findLinkedInProfileUrl(extracted.profileText) || '',
      pageText: extracted.profileText,
      source: 'pdf'
    };
    document.getElementById('candidateName').textContent = currentCandidate.name;
    document.getElementById('candidateMeta').textContent = 'LinkedIn PDF upload';
    document.getElementById('autoBadge').style.display = 'none';
    companies.clear();
    (extracted.companies || []).filter(function(c) { return typeof c === 'string' && c.trim(); }).forEach(function(c) { companies.add(c.trim()); });
    renderCompanyTags();
    document.getElementById('detectedSection').style.display = companies.size ? 'block' : 'none';
    document.getElementById('clearBtn').style.display = companies.size ? 'block' : 'none';
    updateAnalyseSection();
    document.getElementById('loadingText').textContent = 'Scoring candidate profile...';
    document.getElementById('loadingCompanyName').textContent = currentCandidate.name;
    await scoreCurrentCandidateFromText(apiKey, activeRole);
  } catch (err) {
    showError('PDF assessment failed: ' + err.message);
  }
  document.getElementById('loadingState').style.display = 'none';
  renderResults();
  if (e.target) e.target.value = '';
}

// --- GitHub Analysis ---

let githubData = null;

function githubShowError(msg) {
  const el = document.getElementById('githubError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function githubHideError() {
  const el = document.getElementById('githubError');
  if (el) el.style.display = 'none';
}

function getGitHubVisibilityTier(followers, totalStars, accountAgeDays) {
  if (followers >= 500 || totalStars >= 500 || (followers >= 100 && accountAgeDays > 1095)) return 'established';
  if (followers >= 50 || totalStars >= 50 || accountAgeDays > 365) return 'active';
  if (accountAgeDays < 180) return 'new';
  return 'passive';
}

function getLangBarColor(index) {
  const colors = ['#6366f1','#22d3ee','#4ade80','#f59e0b','#f472b6','#a78bfa','#34d399'];
  return colors[index % colors.length];
}

async function githubFetch(url) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (githubToken) headers['Authorization'] = 'Bearer ' + githubToken;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) throw new Error('GitHub API rate limit reached. Add a GitHub token in Settings to increase the limit to 5,000 req/hour.');
  if (res.status === 404) throw new Error('GitHub profile not found.');
  if (!res.ok) throw new Error('GitHub API error: ' + res.status);
  return res.json();
}

async function runGitHubAnalysis() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { githubShowError('Add your API key in Settings first.'); return; }
  if (!githubToken) { showGitHubTabState(null); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isGitHubProfile = tab?.url && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(tab.url);
  if (!isGitHubProfile) {
    document.getElementById('githubPlaceholder').style.display = 'flex';
    document.getElementById('githubResults').style.display = 'none';
    return;
  }

  const username = new URL(tab.url).pathname.replace(/\//g, '');

  document.getElementById('githubSetup').style.display = 'none';
  document.getElementById('githubPlaceholder').style.display = 'none';
  document.getElementById('githubResults').style.display = 'none';
  document.getElementById('githubLoading').style.display = 'block';
  document.getElementById('githubLoadingName').textContent = username;
  githubHideError();

  try {
    // Step 1: user profile + DOM email (parallel)
    document.getElementById('githubLoadingText').textContent = 'Fetching profile...';
    const [user, pageData] = await Promise.all([
      githubFetch(`https://api.github.com/users/${username}`),
      getPageData(tab.id)
    ]);
    // Merge DOM-scraped email as fallback when API returns null
    if (!user.email && pageData?.domEmail) user.email = pageData.domEmail;

    // Step 2: repos
    document.getElementById('githubLoadingText').textContent = 'Fetching repos...';
    const repos = await githubFetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=pushed`);
    const ownRepos = repos.filter(r => !r.fork);

    // Step 3: language bytes per repo (parallel, cap at 20 repos to stay within rate limit)
    document.getElementById('githubLoadingText').textContent = 'Analysing languages...';
    const topRepos = ownRepos.slice(0, 20);
    const langResults = await Promise.allSettled(
      topRepos.map(r => githubFetch(`https://api.github.com/repos/${username}/${r.name}/languages`))
    );

    // Aggregate language bytes
    const langTotals = {};
    langResults.forEach(result => {
      if (result.status === 'fulfilled') {
        Object.entries(result.value).forEach(([lang, bytes]) => {
          langTotals[lang] = (langTotals[lang] || 0) + bytes;
        });
      }
    });
    const totalBytes = Object.values(langTotals).reduce((a, b) => a + b, 0);
    const langsSorted = Object.entries(langTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([lang, bytes]) => ({ lang, bytes, pct: totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0 }));

    // Notable projects: top 5 by stars from own repos (include even without description)
    const notableProjects = [...ownRepos]
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 5);

    // Last active: most recent pushed_at across own repos
    const lastPushed = ownRepos.length > 0
      ? new Date(Math.max(...ownRepos.map(r => new Date(r.pushed_at))))
      : null;

    // Visibility tier
    const totalStars = ownRepos.reduce((sum, r) => sum + r.stargazers_count, 0);
    const accountAgeDays = Math.floor((Date.now() - new Date(user.created_at)) / 86400000);
    const tier = getGitHubVisibilityTier(user.followers, totalStars, accountAgeDays);

    // Step 4: model pass for summary + outreach hook
    document.getElementById('githubLoadingText').textContent = 'Generating summary...';
    // Include all own repos for model context, even those without descriptions
    const repoSummary = ownRepos.slice(0, 20).map(r =>
      `- ${r.name}${r.description ? ': ' + r.description : ''} [${r.language || 'unknown'}] ★${r.stargazers_count} updated:${r.pushed_at.slice(0,10)}`
    ).join('\n');
    const langSummary = langsSorted.map(l => `${l.lang} ${l.pct}%`).join(', ');

    const activeRole = roles.find(r => r.id === activeRoleId);
    const fitRoleName = activeRole ? activeRole.name : '';

    // Build prompt parts -- use template literals so no escaping issues
    const fitInstruction = activeRole ? `

3. SUITABILITY_FIT: Assess how well this developer's public GitHub profile aligns with the active role below. Use ONLY GitHub-visible signals: languages, repo domains, tooling inferred from repo names/descriptions, activity level. Do NOT assess soft skills, career history, or anything not evidenced in GitHub data.
- fit_tier: exactly one of "Strong technical fit", "Partial fit", or "Weak fit"
- fit_reasons: exactly 3 bullets, max 15 words each, citing specific GitHub evidence from the profile` : '';

    const fitRoleContext = activeRole ? `

ACTIVE ROLE: ${activeRole.name}
ROLE ICP:
${activeRole.icp}` : '';

    const returnSchema = activeRole
      ? `{"technical_summary": "...", "outreach_hook": "...", "fit_tier": "...", "fit_reasons": ["...", "...", "..."]}`
      : `{"technical_summary": "...", "outreach_hook": "..."}`;

    const thingCount = activeRole ? 'three' : 'two';

    const modelPrompt = `You are a technical recruiter reviewing a developer's GitHub profile. Write ${thingCount} things:

1. TECHNICAL_SUMMARY: 2-3 sentences. What do they build? Infer from repo names, languages, and any descriptions. Even without descriptions, repo names and languages reveal domain and stack. Be specific -- cite actual repo names. Do not mention languages (covered separately). If data is sparse, say what you can infer -- never say you cannot assess.

2. OUTREACH_HOOK: One sentence. Reference a specific repo by name. Natural, not salesy.${fitInstruction}

GITHUB USER: ${user.login}
BIO: ${user.bio || 'not provided'}
COMPANY: ${user.company || 'not provided'}
LANGUAGES: ${langSummary}
NOTABLE REPOS:
${repoSummary || 'No public repos found.'}${fitRoleContext}

Return ONLY a raw JSON object, no markdown, no backticks:
${returnSchema}`;

    const model = 'gemini-2.5-flash';
    const activeAiProvider = aiProvider;
    let aiResponse = '';

    if (activeAiProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: modelPrompt }], temperature: 0.3, max_tokens: 1200 })
      });
      const data = await res.json();
      aiResponse = data.choices?.[0]?.message?.content || '';
    } else if (activeAiProvider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1200, messages: [{ role: 'user', content: modelPrompt }], temperature: 0.3 })
      });
      const data = await res.json();
      aiResponse = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    } else {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: modelPrompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } } })
      });
      const data = await res.json();
      aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    let summary = '';
    let outreachHook = '';
    let fitTier = '';
    let fitReasons = [];
    try {
      // Strip markdown fences, then find outermost { } to isolate JSON even if model adds surrounding text
      let clean = aiResponse.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBrace = clean.indexOf('{');
      const lastBrace = clean.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        clean = clean.slice(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(clean);
      summary = parsed.technical_summary || '';
      outreachHook = parsed.outreach_hook || '';
      fitTier = parsed.fit_tier || '';
      fitReasons = Array.isArray(parsed.fit_reasons) ? parsed.fit_reasons : [];
    } catch(e) {
      // JSON failed -- try to pull out at least the summary from raw text
      const summaryMatch = aiResponse.match(/"technical_summary"\s*:\s*"([^"]+)"/);
      const hookMatch = aiResponse.match(/"outreach_hook"\s*:\s*"([^"]+)"/);
      summary = summaryMatch ? summaryMatch[1] : aiResponse.substring(0, 300);
      outreachHook = hookMatch ? hookMatch[1] : '';
    }

    githubData = { user, ownRepos, langsSorted, notableProjects, lastPushed, totalStars, tier, summary, outreachHook, fitTier, fitReasons, fitRoleName };

    // Save to history and results
    currentCandidate.name = user.name || user.login;
    currentCandidate.url = `https://github.com/${user.login}`;
    currentCandidate.source = 'github';
    currentCandidate.pageText = '';
    document.getElementById('candidateName').textContent = currentCandidate.name;
    document.getElementById('candidateMeta').textContent = 'GitHub profile';

    if (activeRole) {
      // Build a score object compatible with addToHistory
      const githubScore = {
        score: fitTier.toLowerCase().includes('strong') ? 75 : fitTier.toLowerCase().includes('partial') ? 50 : fitTier ? 25 : null,
        tier: fitTier.toLowerCase().includes('strong') ? 'Strong' : fitTier.toLowerCase().includes('partial') ? 'Potential' : fitTier ? 'Weak' : 'N/A',
        headline: summary ? summary.split('.')[0] + '.' : 'GitHub Technical Profile',
        dimensions: [],
        strengths: fitReasons.length ? fitReasons : [],
        gaps: [],
        redFlags: [],
        explore: [],
        recommendation: fitTier ? `${fitTier} — ${fitReasons.join(' | ')}` : 'GitHub technical profile — no active role set.'
      };
      if (githubScore.score !== null) {
        addToHistory(githubScore, activeRole.name, activeRole.id);
      }
    }

    // Render
    renderGitHubResults(githubData);

  } catch(err) {
    document.getElementById('githubLoading').style.display = 'none';
    githubShowError('Error: ' + err.message);
  }
}

function renderGitHubResults(d) {
  document.getElementById('githubLoading').style.display = 'none';
  document.getElementById('githubResults').style.display = 'block';

  const { user, langsSorted, notableProjects, lastPushed, totalStars, tier, summary, outreachHook, fitTier, fitReasons, fitRoleName } = d;

  // Header
  document.getElementById('githubCandidateName').textContent = user.name || user.login;
  const lastActiveStr = lastPushed
    ? 'Last active: ' + lastPushed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'No public activity';
  const accountYear = new Date(user.created_at).getFullYear();
  document.getElementById('githubCandidateMeta').textContent =
    `github.com/${user.login} · ${user.public_repos} public repos · ${user.followers} followers · Joined ${accountYear} · ${lastActiveStr}`;

  const tierEl = document.getElementById('githubVisibilityTier');
  tierEl.textContent = tier.charAt(0).toUpperCase() + tier.slice(1) + ' contributor';
  tierEl.className = 'github-tier-badge ' + tier;

  // Contact
  const contactEl = document.getElementById('githubContact');
  const contactRows = [
    { label: 'Email', value: user.email ? `<a href="mailto:${user.email}">${user.email}</a>` : null },
    { label: 'Location', value: user.location || null },
    { label: 'Company', value: user.company ? user.company.replace('@', '') : null },
    { label: 'Website', value: user.blog ? `<a href="${user.blog.startsWith('http') ? '' : 'https://'}${user.blog}" target="_blank">${user.blog}</a>` : null },
    { label: 'Twitter', value: user.twitter_username ? `<a href="https://twitter.com/${user.twitter_username}" target="_blank">@${user.twitter_username}</a>` : null },
    { label: 'Stars', value: totalStars > 0 ? `${totalStars} total across public repos` : null },
  ].filter(r => r.value);

  contactEl.innerHTML = contactRows.length > 0
    ? contactRows.map(r => `<div class="github-contact-row"><span class="github-contact-label">${r.label}</span><span class="github-contact-value">${r.value}</span></div>`).join('')
    : '<div class="github-contact-row" style="color:var(--text-dim);font-size:11px;">No contact details public.</div>';

  // Languages
  const langEl = document.getElementById('githubLanguages');
  langEl.innerHTML = langsSorted.length > 0
    ? langsSorted.map((l, i) => `
        <div class="github-lang-row">
          <div class="github-lang-name">${l.lang}</div>
          <div class="github-lang-bar-wrap"><div class="github-lang-bar" style="width:${l.pct}%;background:${getLangBarColor(i)};"></div></div>
          <div class="github-lang-pct">${l.pct}%</div>
        </div>`).join('')
    : '<div style="font-size:11px;color:var(--text-dim);">No language data available.</div>';

  // Projects
  const projEl = document.getElementById('githubProjects');
  projEl.innerHTML = notableProjects.length > 0
    ? notableProjects.map(r => {
        const pushed = new Date(r.pushed_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
        return `<div class="github-project-card">
          <div class="github-project-name"><a href="${r.html_url}" target="_blank">${r.name}</a></div>
          ${r.description ? `<div class="github-project-desc">${r.description}</div>` : '<div class="github-project-desc" style="color:var(--text-dim);font-style:italic;">No description provided.</div>'}
          <div class="github-project-meta">
            ${r.language ? `<span>◆ ${r.language}</span>` : ''}
            ${r.stargazers_count > 0 ? `<span>★ ${r.stargazers_count}</span>` : ''}
            ${r.forks_count > 0 ? `<span>⑂ ${r.forks_count}</span>` : ''}
            <span>Updated ${pushed}</span>
          </div>
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:var(--text-dim);">No public repos found.</div>';

  // Summary + hook
  document.getElementById('githubSummary').textContent = summary || 'Could not generate summary.';
  document.getElementById('githubOutreachHook').textContent = outreachHook || 'Could not generate outreach hook.';

  // Fit signal
  const fitSection = document.getElementById('githubFitSection');
  const fitNoRole = document.getElementById('githubFitNoRole');
  if (fitTier && fitReasons.length) {
    fitSection.style.display = 'block';
    fitNoRole.style.display = 'none';
    document.getElementById('githubFitRoleName').textContent = fitRoleName ? 'vs. ' + fitRoleName : '';
    const tierEl = document.getElementById('githubFitTier');
    tierEl.textContent = fitTier;
    tierEl.className = 'github-fit-tier ' + (
      fitTier.toLowerCase().includes('strong') ? 'strong' :
      fitTier.toLowerCase().includes('partial') ? 'partial' : 'weak'
    );
    document.getElementById('githubFitReasons').innerHTML = fitReasons
      .map(r => `<div class="github-fit-reason">${escapeHtml(r)}</div>`).join('');
  } else if (!fitTier) {
    fitSection.style.display = 'none';
    fitNoRole.style.display = 'block';
  } else {
    fitSection.style.display = 'none';
    fitNoRole.style.display = 'none';
  }
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
  }).catch(() => {});
}

function getContactPlainText() {
  const rows = document.querySelectorAll('#githubContact .github-contact-row');
  return Array.from(rows).map(row => {
    const label = row.querySelector('.github-contact-label')?.textContent?.trim() || '';
    const value = row.querySelector('.github-contact-value')?.textContent?.trim() || '';
    return `${label}: ${value}`;
  }).join('\n');
}

function getProjectsPlainText() {
  const cards = document.querySelectorAll('#githubProjects .github-project-card');
  return Array.from(cards).map(card => {
    const name = card.querySelector('.github-project-name')?.textContent?.trim() || '';
    const desc = card.querySelector('.github-project-desc')?.textContent?.trim() || '';
    const meta = card.querySelector('.github-project-meta')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    return [name, desc, meta].filter(Boolean).join(' — ');
  }).join('\n');
}

function showGitHubTabState(tabUrl) {
  if (!githubToken) {
    document.getElementById('githubSetup').style.display = 'block';
    document.getElementById('githubPlaceholder').style.display = 'none';
    document.getElementById('githubResults').style.display = 'none';
    document.getElementById('githubLoading').style.display = 'none';
    return;
  }
  const isGitHub = tabUrl && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(tabUrl);
  document.getElementById('githubSetup').style.display = 'none';
  if (isGitHub) {
    document.getElementById('githubPlaceholder').style.display = 'none';
    document.getElementById('githubLoading').style.display = 'none';
    if (githubData) {
      // Scan done -- show results, hide scan button
      document.getElementById('githubResults').style.display = 'block';
    } else {
      // No scan yet -- show scan button, hide results
      document.getElementById('githubResults').style.display = 'none';
    }
  } else {
    document.getElementById('githubPlaceholder').style.display = 'flex';
    document.getElementById('githubResults').style.display = 'none';
    document.getElementById('githubLoading').style.display = 'none';
  }
}

function setupGitHubTab() {
  document.getElementById('githubScanBtn').addEventListener('click', runGitHubAnalysis);
  document.getElementById('githubRescanBtn').addEventListener('click', runGitHubAnalysis);

  document.getElementById('githubTokenSaveBtn').addEventListener('click', function() {
    const val = (document.getElementById('githubTokenInput').value || '').trim();
    const errEl = document.getElementById('githubTokenError');
    if (!val || !val.startsWith('ghp_')) {
      errEl.textContent = 'Token looks invalid — it should start with ghp_';
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';
    githubToken = val;
    chrome.storage.local.set({ githubToken: val }, function() {
      document.getElementById('githubSetup').style.display = 'none';
      // Now show scan prompt or placeholder depending on current tab
      chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
        if (t?.url && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(t.url)) {
          document.getElementById('githubPlaceholder').style.display = 'none';
        } else {
          document.getElementById('githubPlaceholder').style.display = 'flex';
        }
      });
    });
  });

  document.getElementById('copyLanguagesBtn').addEventListener('click', function() {
    if (!githubData) return;
    const text = githubData.langsSorted.map(l => `${l.lang}: ${l.pct}%`).join('\n');
    copyToClipboard(text, this);
  });

  document.getElementById('copyFitBtn').addEventListener('click', function() {
    if (!githubData || !githubData.fitTier) return;
    const { fitTier, fitReasons, fitRoleName } = githubData;
    const text = [
      'Suitability Fit Signal' + (fitRoleName ? ' — ' + fitRoleName : ''),
      fitTier,
      ...fitReasons.map(r => '· ' + r),
      '',
      '⚠ Based on public GitHub data only — technical signals only. Career history, domain experience, and soft skills require LinkedIn or interview assessment.'
    ].join('\n');
    copyToClipboard(text, this);
  });

  document.getElementById('copyContactBtn').addEventListener('click', function() {
    copyToClipboard(getContactPlainText(), this);
  });

  document.getElementById('copyProjectsBtn').addEventListener('click', function() {
    copyToClipboard(getProjectsPlainText(), this);
  });

  document.getElementById('copySummaryBtn').addEventListener('click', function() {
    const text = document.getElementById('githubSummary').textContent.trim();
    copyToClipboard(text, this);
  });

  document.getElementById('copyHookBtn').addEventListener('click', function() {
    const text = document.getElementById('githubOutreachHook').textContent.trim();
    copyToClipboard(text, this);
  });

  document.getElementById('copyAllGithubBtn').addEventListener('click', function() {
    if (!githubData) return;
    const { user, langsSorted, totalStars, tier, summary, outreachHook, fitTier, fitReasons, fitRoleName } = githubData;
    const name = user.name || user.login;
    const langs = langsSorted.map(l => `${l.lang} ${l.pct}%`).join(', ');
    const fitBlock = fitTier && fitReasons.length ? [
      '',
      '— SUITABILITY FIT SIGNAL' + (fitRoleName ? ' — ' + fitRoleName : '') + ' —',
      fitTier,
      ...fitReasons.map(r => '· ' + r),
      '⚠ Based on public GitHub data only — technical signals only.',
    ] : [];
    const text = [
      `GITHUB TECHNICAL PROFILE — ${name}`,
      `github.com/${user.login} · ${user.public_repos} public repos · ${user.followers} followers · ${tier.charAt(0).toUpperCase() + tier.slice(1)} contributor`,
      '',
      '— CONTACT & LOCATION —',
      getContactPlainText(),
      '',
      '— LANGUAGES —',
      langs,
      '',
      '— NOTABLE PROJECTS —',
      getProjectsPlainText(),
      '',
      '— TECHNICAL SUMMARY —',
      summary,
      '',
      '— OUTREACH HOOK —',
      outreachHook,
      ...fitBlock,
    ].join('\n');
    copyToClipboard(text, this);
  });
}

// --- Score Profile ---
async function scoreProfile() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('Add your API key in Settings first.'); return; }
  const activeRole = roles.find(r => r.id === activeRoleId);
  if (!activeRole) { showError('No active role selected. Go to Settings.'); return; }
  if (!recruiterRoleTitle || !recruiterCompanyName) { showError('Add your role title and company name in Settings before scoring.'); return; }

  const btn = document.getElementById('scoreProfileBtn');
  btn.disabled = true; btn.textContent = 'Loading profile...'; hideError();

  switchTab('results');
  document.getElementById('resultsEmpty').style.display = 'none';
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'Reading profile...';
  document.getElementById('loadingCompanyName').textContent = currentCandidate.name || 'Loading';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageData = await getPageData(tab.id);
    if (!pageData?.pageText) {
      showError('Could not read page. Open a LinkedIn or GitHub profile.');
      btn.disabled = false; btn.innerHTML = '&#9733; Score Full Profile'; return;
    }
    currentCandidate.pageText = pageData.pageText;
    currentCandidate.source = pageData.isGitHub ? 'github' : 'linkedin';
    currentCandidate.url = pageData.isGitHub ? (pageData.url || tab.url) : (normalizeLinkedInProfileUrl(pageData.url || tab.url || '') || '');
    if (pageData.candidateName) {
      currentCandidate.name = pageData.candidateName;
      document.getElementById('candidateName').textContent = pageData.candidateName;
    }
    document.getElementById('candidateMeta').textContent = currentCandidate.source === 'github' ? 'GitHub profile' : 'LinkedIn profile';
    document.getElementById('autoBadge').style.display = 'inline';
  } catch(err) {
    showError('Could not read page: ' + err.message);
    btn.disabled = false; btn.innerHTML = '&#9733; Score Full Profile'; return;
  }

  btn.textContent = 'Scoring...';
  document.getElementById('loadingText').textContent = 'Scoring candidate profile...';
  document.getElementById('loadingCompanyName').textContent = currentCandidate.name;

  try {
    await scoreCurrentCandidateFromText(apiKey, activeRole);
  } catch(err) {
    showError('Scoring failed: ' + err.message);
  }

  document.getElementById('loadingState').style.display = 'none';
  renderResults();
  btn.disabled = false; btn.innerHTML = '&#9733; Score Full Profile';
}

// --- Analyse companies ---
async function analyseCompanies() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('No API key. Go to Settings.'); return; }
  const activeRole = roles.find(r => r.id === activeRoleId);
  if (!activeRole) { showError('No active role selected.'); return; }

  hideError(); results = [];
  switchTab('results');
  document.getElementById('resultsEmpty').style.display = 'none';
  document.getElementById('loadingState').style.display = 'flex';
  document.getElementById('loadingText').textContent = 'Analysing companies...';
  document.getElementById('resultsList').innerHTML = '';

  const companyList = Array.from(companies);
  for (let i = 0; i < companyList.length; i++) {
    const company = companyList[i];
    document.getElementById('loadingCompanyName').textContent = `${i + 1}/${companyList.length}: ${company}`;
    try {
      results.push(await analyseCompany(company, activeRole, apiKey));
    } catch(err) {
      results.push({ company, relevance: 'unknown', summary: err.message, meta: [], reasoning: 'API error' });
    }
    renderResults();
  }
  document.getElementById('loadingState').style.display = 'none';
}

async function analyseCompany(companyName, role, apiKey) {
  const companyTypeStr = role.companyTypes?.length
    ? `\nTARGET COMPANY TYPE: ${role.companyTypes.join(', ')} — flag if this company does not match.`
    : '';
  const prompt = `Analyse the company "${companyName}" for a recruiter hiring for:\nROLE: ${role.name}\nICP: ${role.icp}${companyTypeStr}\nBe concise. Use "Unknown" for unverifiable fields.\n\nReturn ONLY a raw JSON object — no markdown, no code fences:\n{"company": "${companyName}", "relevance": "<High|Medium|Low>", "summary": "<2-3 sentences>", "meta": ["Industry: X", "Size: X", "Stage: X", "HQ: X", "Type: <B2B|B2C|B2B+B2C|Marketplace|PLG|Unknown>"], "reasoning": "<1-2 sentences on ICP fit, mention company type match or mismatch>"}`;

  const text = await callAI(apiKey, prompt, 0, MODEL_SCORE);
  const parsed = parseJSON(text);
  if (parsed && parsed.relevance && parsed.summary) return parsed;
  return { company: companyName, relevance: 'unknown', summary: text?.substring(0, 200) || 'No response.', meta: [], reasoning: 'Parse failed.' };
}

// --- Company management ---
function addManual() {
  const input = document.getElementById('manualInput');
  const val = input.value.trim();
  if (!val) return;
  val.split(',').forEach(c => { const t = c.trim(); if (t) companies.add(t); });
  input.value = '';
  renderCompanyTags(); updateAnalyseSection();
  document.getElementById('detectedSection').style.display = 'block';
  document.getElementById('clearBtn').style.display = 'block';
}

function removeCompany(name) {
  companies.delete(name);
  renderCompanyTags(); updateAnalyseSection();
  if (companies.size === 0) document.getElementById('detectedSection').style.display = 'none';
}

function clearAll() {
  companies.clear(); companyLinks = {}; results = []; candidateScore = null;
  renderCompanyTags(); renderResults(); updateAnalyseSection();
  document.getElementById('detectedSection').style.display = 'none';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('resultsCount').textContent = '';
}

function renderCompanyTags() {
  const container = document.getElementById('companyTags');
  container.innerHTML = '';
  companies.forEach(name => {
    const tag = document.createElement('div');
    tag.className = 'company-tag';
    tag.innerHTML = `<span>${escapeHtml(name)}</span><span class="remove">&times;</span>`;
    tag.querySelector('.remove').addEventListener('click', () => removeCompany(name));
    container.appendChild(tag);
  });
}

function updateAnalyseSection() {
  document.getElementById('analyseBtn').style.display = companies.size > 0 ? 'flex' : 'none';
}

// --- Notes ---
function saveNotes() {
  const notes = document.getElementById('notesArea').value;
  const key = `notes_${currentCandidate.url || 'default'}`;
  chrome.storage.local.set({ [key]: notes }, () => {
    document.getElementById('notesSaved').textContent = 'Saved';
    setTimeout(() => { document.getElementById('notesSaved').textContent = ''; }, 1500);
  });
}

// --- History ---
function addToHistory(score, roleName, roleId) {
  const notesValue = (document.getElementById('notesArea')?.value || '').trim();
  const isGitHub = (currentCandidate.source || '') === 'github';
  const safeUrl = isGitHub
    ? (currentCandidate.url || '')
    : normalizeLinkedInProfileUrl(currentCandidate.url);
  const entry = {
    id: Date.now().toString(),
    name: currentCandidate.name,
    url: safeUrl,
    roleName,
    roleId: roleId || '',
    score: score.score,
    tier: score.tier,
    headline: score.headline,
    dimensions: score.dimensions || [],
    strengths: score.strengths || [],
    gaps: score.gaps || [],
    redFlags: score.redFlags || [],
    explore: score.explore || [],
    recommendation: score.recommendation,
    source: currentCandidate.source || 'linkedin',
    sourceLabel: getSourceTagLabel(currentCandidate.source || 'linkedin'),
    notes: notesValue,
    pageText: currentCandidate.pageText ? currentCandidate.pageText.substring(0, 18000) : '',
    timestamp: new Date().toLocaleDateString('en-GB')
  };
  sessionHistory = sessionHistory.filter(h => !(h.url === entry.url && h.roleName === entry.roleName && h.name === entry.name));
  sessionHistory.unshift(entry);
  if (sessionHistory.length > 250) sessionHistory = sessionHistory.slice(0, 250);
  chrome.storage.local.set({ history: sessionHistory });
  renderHistory();
  renderCompareView();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  const filterBar = document.getElementById('historyFilterBar');

  if (sessionHistory.length === 0) { empty.style.display = 'block'; list.innerHTML = ''; filterBar.style.display = 'none'; return; }

  // Show filter bar only if both sources exist in history
  const hasLinkedIn = sessionHistory.some(h => (h.source || 'linkedin') !== 'github');
  const hasGitHub = sessionHistory.some(h => h.source === 'github');
  filterBar.style.display = (hasLinkedIn && hasGitHub) ? 'flex' : 'none';

  const filtered = historyFilter === 'all' ? sessionHistory
    : historyFilter === 'github' ? sessionHistory.filter(h => h.source === 'github')
    : sessionHistory.filter(h => (h.source || 'linkedin') !== 'github');

  empty.style.display = filtered.length === 0 ? 'block' : 'none';
  list.innerHTML = filtered.map(h => {
    const scoreColor = h.score >= 70 ? 'var(--high)' : h.score >= 45 ? 'var(--med)' : 'var(--low)';
    const tierClass = { 'Strong': 'high', 'Potential': 'medium', 'Weak': 'low' }[h.tier] || 'unknown';
    const safeHistoryUrl = h.source === 'github' ? h.url : normalizeLinkedInProfileUrl(h.url);
    const nameEl = safeHistoryUrl
      ? `<a href="${safeHistoryUrl}" target="_blank" class="link-hover-accent">${escapeHtml(h.name)} <span class="link-arrow">↗</span></a>`
      : escapeHtml(h.name);
    const sourceLabel = h.sourceLabel || getSourceTagLabel(h.source || 'linkedin');
    return `
      <div class="history-item" data-id="${h.id}">
        <div class="history-header">
          <div>
            <div class="history-name">${nameEl}</div>
            <div class="source-tag-row"><span class="source-tag">${escapeHtml(sourceLabel)}</span></div>
          </div>
          <div class="history-score-wrap">
            <div class="history-score score-tier-${h.score >= 70 ? 'high' : h.score >= 45 ? 'med' : 'low'}">${h.score}</div>
            <span class="relevance-badge relevance-${tierClass}">${escapeHtml(h.tier)}</span>
          </div>
        </div>
        <div class="history-role">${escapeHtml(h.roleName)} · ${escapeHtml(h.timestamp)}</div>
        <div class="history-headline">${escapeHtml(h.headline || '')}</div>
      </div>`;
  }).join('');

  list.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      const entry = sessionHistory.find(h => h.id === el.dataset.id);
      if (!entry) return;
      candidateScore = entry;
      currentCandidate.name = entry.name;
      currentCandidate.url = entry.source === 'github' ? entry.url : normalizeLinkedInProfileUrl(entry.url);
      document.getElementById('candidateName').textContent = entry.name;
      var notesEl = document.getElementById('notesArea');
      if (notesEl) notesEl.value = entry.notes || '';
      renderResults();
      switchTab('results');
    });
  });
}

function renderCompareView() {
  const empty = document.getElementById('compareEmpty');
  const container = document.getElementById('compareGroups');
  const filterBar = document.getElementById('compareFilterBar');
  if (!empty || !container) return;
  if (!sessionHistory.length) {
    empty.style.display = 'block';
    container.innerHTML = '';
    if (filterBar) filterBar.style.display = 'none';
    return;
  }

  const hasLinkedIn = sessionHistory.some(h => (h.source || 'linkedin') !== 'github');
  const hasGitHub = sessionHistory.some(h => h.source === 'github');
  if (filterBar) filterBar.style.display = (hasLinkedIn && hasGitHub) ? 'flex' : 'none';

  const filteredHistory = compareFilter === 'all' ? sessionHistory
    : compareFilter === 'github' ? sessionHistory.filter(h => h.source === 'github')
    : sessionHistory.filter(h => (h.source || 'linkedin') !== 'github');

  empty.style.display = 'none';
  const grouped = filteredHistory.reduce((acc, item) => {
    const key = item.roleName || 'Unassigned role';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const roleNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  container.innerHTML = roleNames.map(function(roleName) {
    const items = grouped[roleName].slice().sort(function(a, b) {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      return (a.name || '').localeCompare(b.name || '');
    });

    const cards = items.map(function(item, idx) {
      const dimHtml = (item.dimensions || []).length
        ? (item.dimensions || []).map(function(dim) {
            var tierCls = dim.score >= 70 ? 'high' : dim.score >= 45 ? 'med' : 'low';
            var noteHtml = dim.note
              ? '<details class="compare-dim-note-wrap"><summary class="compare-dim-note-toggle">View context</summary>'
                + '<div class="compare-dim-note">' + escapeHtml(dim.note) + '</div></details>'
              : '';
            return '<div class="compare-dim-row">'
              + '<span class="compare-dim-label">' + escapeHtml(dim.label || '') + '</span>'
              + '<strong class="compare-dim-score score-tier-' + tierCls + '">' + escapeHtml(String(dim.score ?? '')) + '<span class="compare-dim-denom">/100</span></strong>'
              + '</div>'
              + noteHtml;
          }).join('')
        : '<div class="compare-mini-text">No dimensions saved.</div>';
      const scoreClass = item.score >= 70 ? 'high' : item.score >= 45 ? 'med' : 'low';
      const safeCompareUrl = item.source === 'github' ? item.url : normalizeLinkedInProfileUrl(item.url);
      const nameHtml = safeCompareUrl ? '<a href="' + safeCompareUrl + '" target="_blank">' + escapeHtml(item.name || '') + ' ↗</a>' : escapeHtml(item.name || '');
      const sourceLabel = item.sourceLabel || getSourceTagLabel(item.source || 'linkedin');

      return '<details class="compare-item">'
        + '<summary class="compare-toggle">'
        + '<div class="compare-toggle-left">'
        + '<div class="compare-rank">#' + (idx + 1) + '</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<div class="compare-item-title-row">'
        + '<div class="compare-item-name">' + nameHtml + '</div>'
        + '<div class="history-score score-tier-' + scoreClass + '">' + escapeHtml(String(item.score || 0)) + '</div>'
        + '</div>'
        + '<div class="source-tag-row"><span class="source-tag">' + escapeHtml(sourceLabel) + '</span></div>'
        + '<div class="compare-item-meta">' + escapeHtml(item.timestamp || '') + ' · ' + escapeHtml(item.tier || '') + '</div>'
        + '<div class="compare-item-inline-actions">'
        + '<button class="btn-danger compare-delete-candidate" data-entry-id="' + encodeURIComponent(item.id || '') + '" data-entry-name="' + encodeURIComponent(item.name || 'this candidate') + '" type="button">Delete candidate</button>'
        + '</div>'
        + '</div>'
        + '</div>'
        + '<div class="compare-toggle-right">'
        + '<div class="compare-caret">▾</div>'
        + '</div>'
        + '</summary>'
        + '<div class="compare-item-body">'
        + '<div class="compare-item-headline">' + escapeHtml(item.headline || 'No headline saved.') + '</div>'
        + '<div class="compare-item-grid">'
        + '<div class="compare-mini-card"><div class="compare-mini-label">Notes</div><div class="compare-mini-text">' + escapeHtml(item.notes || '—') + '</div></div>'
        + '<div class="compare-mini-card"><div class="compare-mini-label">Top dimensions</div><div class="compare-dim-list">' + dimHtml + '</div></div>'
        + '<div class="compare-mini-card"><div class="compare-mini-label">Recommendation</div><div class="compare-mini-text">' + escapeHtml(item.recommendation || '—') + '</div></div>'
        + '<div class="compare-mini-card">'
        + '<div class="compare-mini-label">Strengths</div>'
        + '<ul class="compare-bullet-list">'
        + ((item.strengths || []).length ? (item.strengths || []).map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') : '<li class="compare-bullet-empty">None noted</li>')
        + '</ul>'
        + '<div class="compare-mini-label" style="margin-top:8px;">Gaps</div>'
        + '<ul class="compare-bullet-list gaps">'
        + ((item.gaps || []).length ? (item.gaps || []).map(function(g) { return '<li>' + escapeHtml(g) + '</li>'; }).join('') : '<li class="compare-bullet-empty">None noted</li>')
        + '</ul>'
        + ((item.redFlags || []).filter(function(r) { return r && r.trim() && r.trim() !== '—'; }).length
          ? '<div class="compare-mini-label compare-red-flag-label" style="margin-top:8px;">Red Flags</div>'
            + '<ul class="compare-bullet-list red-flags">'
            + (item.redFlags || []).filter(function(r) { return r && r.trim() && r.trim() !== '—'; }).map(function(r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('')
            + '</ul>'
          : '')
        + ((item.explore || []).filter(function(e) { return e && e.trim(); }).length
          ? '<div class="compare-mini-label explore-label" style="margin-top:8px;">Worth Exploring</div>'
            + '<ul class="compare-bullet-list explore-list">'
            + (item.explore || []).filter(function(e) { return e && e.trim(); }).map(function(e) { return '<li>' + escapeHtml(e) + '</li>'; }).join('')
            + '</ul>'
          : '')
        + '</div>'
        + '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">'
        + '<button class="btn-primary compare-draft-outreach" style="font-size:11px;padding:7px 12px;" data-name="' + encodeURIComponent(item.name || '') + '" data-url="' + encodeURIComponent(item.url || '') + '" data-role="' + encodeURIComponent(item.roleName || '') + '" data-id="' + encodeURIComponent(item.id || '') + '">'
        + '&#9993; Draft Outreach'
        + '</button>'
        + '</div>'
        + '</div>'
        + '</div>'
        + '</details>';
    }).join('');

    return '<details class="compare-role-group">'
      + '<summary class="compare-role-header compare-role-toggle">'
      + '<div class="compare-role-header-main">'
      + '<div class="compare-role-title-row">'
      + '<div class="compare-role-title">' + escapeHtml(roleName) + '</div>'
      + '<div class="compare-caret">▾</div>'
      + '</div>'
      + '<div class="compare-role-meta">' + items.length + ' candidate' + (items.length === 1 ? '' : 's') + ' · ranked highest to lowest</div>'
      + '<div class="compare-role-inline-actions">'
      + '<button class="btn-secondary download-role-csv" data-role="' + encodeURIComponent(roleName) + '" type="button" style="width:auto;margin-top:0;">Download CSV</button>'
      + '<button class="btn-danger compare-delete-role" data-role="' + encodeURIComponent(roleName) + '" type="button">Delete shortlist</button>'
      + '</div>'
      + '</div>'
      + '</summary>'
      + '<div class="compare-list">'
      + cards
      + '</div>'
      + '</details>';
  }).join('');

  container.querySelectorAll('.compare-delete-candidate, .compare-delete-role, .download-role-csv').forEach(function(btn) {
    ['pointerdown', 'click'].forEach(function(evtName) {
      btn.addEventListener(evtName, function(e) {
        e.preventDefault();
        e.stopPropagation();
      });
    });
  });

  container.querySelectorAll('.download-role-csv').forEach(function(btn) {
    btn.addEventListener('click', function() {
      downloadHistoryCsv(decodeURIComponent(btn.dataset.role));
    });
  });

  container.querySelectorAll('.compare-delete-candidate').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var entryId = decodeURIComponent(btn.dataset.entryId || '');
      var entryName = decodeURIComponent(btn.dataset.entryName || 'this candidate');
      var confirmed = await openConfirmDialog(
        'Delete candidate?',
        'Are you sure you want to remove ' + entryName + ' from this shortlist?',
        'Yes, delete',
        'No, go back'
      );
      if (confirmed) deleteHistoryEntry(entryId);
    });
  });

  container.querySelectorAll('.compare-delete-role').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var roleName = decodeURIComponent(btn.dataset.role || '');
      var confirmed = await openConfirmDialog(
        'Delete shortlist?',
        'Are you sure you want to delete the entire ' + roleName + ' shortlist? This will remove every saved candidate in it.',
        'Yes, delete',
        'No, go back'
      );
      if (confirmed) deleteHistoryRole(roleName);
    });
  });

  // Draft outreach from shortlist
  container.querySelectorAll('.compare-draft-outreach').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var entryId = decodeURIComponent(btn.dataset.id || '');
      var entry = sessionHistory.find(function(h) { return h.id === entryId; });
      if (!entry) return;
      // Restore candidate context
      candidateScore = entry;
      currentCandidate.name = entry.name;
      currentCandidate.url = entry.source === 'github' ? entry.url : normalizeLinkedInProfileUrl(entry.url);
      currentCandidate.pageText = entry.pageText || '';
      currentCandidate.source = entry.source || 'linkedin';
      document.getElementById('candidateName').textContent = entry.name;
      document.getElementById('candidateMeta').textContent = (entry.source === 'pdf') ? 'LinkedIn PDF upload' : (entry.source === 'github') ? 'GitHub profile' : 'LinkedIn profile';
      // Switch to results tab and scroll to outreach
      renderResults();
      switchTab('results');
      setTimeout(function() {
        var outreachCard = document.getElementById('outreachCard');
        if (outreachCard) outreachCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
    });
  });
}

function deleteHistoryEntry(entryId) {
  if (!entryId) return;
  sessionHistory = sessionHistory.filter(function(item) { return item.id !== entryId; });
  chrome.storage.local.set({ history: sessionHistory }, function() {
    renderHistory();
    renderCompareView();
    showStatus('Candidate removed from shortlist.');
  });
}

function deleteHistoryRole(roleName) {
  if (!roleName) return;
  sessionHistory = sessionHistory.filter(function(item) { return item.roleName !== roleName; });
  chrome.storage.local.set({ history: sessionHistory }, function() {
    renderHistory();
    renderCompareView();
    showStatus('Shortlist deleted.');
  });
}

function toCsvValue(value) {
  const str = String(value == null ? '' : value).replace(/[\r\n]+/g, ' | ');
  return '"' + str.replace(/"/g, '""') + '"';
}

function buildHistoryCsvRows(items) {
  return items.slice().sort(function(a, b) {
    if ((a.roleName || '') !== (b.roleName || '')) return (a.roleName || '').localeCompare(b.roleName || '');
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return (a.name || '').localeCompare(b.name || '');
  }).map(function(item) {
    return [
      item.roleName || '',
      item.name || '',
      item.url || '',
      item.score || 0,
      item.tier || '',
      item.timestamp || '',
      item.headline || '',
      (item.dimensions || []).map(function(d) { return (d.label || '') + ': ' + (d.score ?? ''); }).join(' | '),
      (item.strengths || []).join(' | '),
      (item.gaps || []).join(' | '),
      (item.redFlags || []).join(' | '),
      (item.explore || []).join(' | '),
      item.recommendation || '',
      item.notes || ''
    ].map(toCsvValue).join(',');
  });
}

function downloadHistoryCsv(roleName) {
  const items = roleName ? sessionHistory.filter(function(item) { return item.roleName === roleName; }) : sessionHistory.slice();
  if (!items.length) return;
  const headers = ['Role','Candidate Name','Profile URL','Score','Tier','Scored On','Headline','Dimensions','Strengths','Gaps','Red Flags','Worth Exploring','Recommendation','Notes'];
  const csv = [headers.map(toCsvValue).join(',')].concat(buildHistoryCsvRows(items)).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeRole = (roleName || 'all-roles').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  a.href = url;
  a.download = 'profilefitcheck-' + safeRole + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// --- Results ---
function renderResults() {
  const list = document.getElementById('resultsList');
  const empty = document.getElementById('resultsEmpty');

  if (results.length === 0 && !candidateScore) {
    empty.style.display = 'block'; list.innerHTML = '';
    document.getElementById('resultsCount').textContent = ''; return;
  }

  empty.style.display = 'none';
  let html = '';

  if (candidateScore) {
    const s = candidateScore;
    const tierClass = { 'Strong': 'high', 'Potential': 'medium', 'Weak': 'low' }[s.tier] || 'unknown';
    const scoreColor = s.score >= 70 ? 'var(--high)' : s.score >= 45 ? 'var(--med)' : 'var(--low)';
    const safeCurrentUrl = normalizeLinkedInProfileUrl(currentCandidate.url);
    const nameLink = safeCurrentUrl
      ? `<a href="${safeCurrentUrl}" target="_blank" class="link-hover-underline-accent">${escapeHtml(currentCandidate.name || '')}</a>`
      : escapeHtml(currentCandidate.name || '');
    const strengths = (s.strengths || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const sourceLabel = getSourceTagLabel(currentCandidate.source || 'linkedin');
    const gaps = (s.gaps || []).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const redFlags = (s.redFlags || []).filter(x => x && x.trim()).map(x => `<li>${escapeHtml(x)}</li>`).join('');
    const exploreItems = (s.explore || []).filter(x => x && x.trim()).map(x => `<li>${escapeHtml(x)}</li>`).join('');

    // Dimension bars
    const dimBars = (s.dimensions || []).map(d => {
      const pct = Math.max(0, Math.min(100, d.score || 0));
      const dimTier = pct >= 70 ? 'high' : pct >= 45 ? 'med' : 'low';
      var weightLabel = d.weight ? '<span style="font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-left:4px;">'+d.weight+'%</span>' : '';
      var noteHtml = d.note ? '<div class="dim-note">'+escapeHtml(d.note)+'</div>' : '';
      return '<div class="dim-row">'
        +'<div class="dim-label">'+escapeHtml(d.label||'')+weightLabel+'</div>'
        +'<div class="dim-bar-wrap"><div class="dim-bar dim-bar-'+dimTier+'" data-pct="'+pct+'"></div></div>'
        +'<div class="dim-score score-tier-'+(pct>=70?'high':pct>=45?'med':'low')+'">'+pct+'</div>'
        +'</div>'+noteHtml;
    }).join('');

    var scoreExpNote = (s.dimensions && s.dimensions.some(function(d){return d.weight;}))
      ? 'Score is a calculated weighted average across your defined ICP dimensions. Each dimension is scored 0-100 and multiplied by its assigned weight.'
      : 'Score is a holistic AI judgment across ICP dimensions. Define weighted dimensions in role settings for a fully transparent, consistent score.';

    html += '<div style="font-size:10px;color:var(--text-muted);padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;margin-bottom:8px;line-height:1.5;">'
      + '&#9432; AI-assisted assessment — review for accuracy before making decisions.'
      + '</div>'
      + '<div class="result-card candidate-card">'
      + '<div class="candidate-card-header">'
      + '<div class="flex-fill">'
      + '<div class="candidate-label">CANDIDATE FIT &middot; ' + nameLink + '</div>'
      + '<div class="source-tag-row"><span class="source-tag">' + escapeHtml(sourceLabel) + '</span></div>'
      + '<div class="candidate-headline">' + escapeHtml(s.headline || '') + '</div>'
      + '</div>'
      + '<div class="candidate-score-wrap">'
      + '<div class="candidate-score score-tier-' + tierClass + '">' + s.score + '<span class="score-denom">/100</span></div>'
      + '<span class="relevance-badge relevance-' + tierClass + '">' + escapeHtml(s.tier) + '</span>'
      + '<div class="score-info-btn" title="How is this scored?">?</div>'
      + '</div></div>'
      + '<div class="score-explanation" id="scoreExplanation" style="display:none;">'
      + '<div class="score-exp-title">How this score works</div>'
      + '<div class="score-exp-body">'
      + '<div class="score-exp-row"><span class="score-exp-range score-tier-high">70-100</span><span class="score-exp-label">Strong</span></div>'
      + '<div class="score-exp-row"><span class="score-exp-range score-tier-med">45-69</span><span class="score-exp-label">Potential</span></div>'
      + '<div class="score-exp-row"><span class="score-exp-range score-tier-low">0-44</span><span class="score-exp-label">Weak</span></div>'
      + '<div class="score-exp-divider"></div>'
      + '<div class="score-exp-note">' + scoreExpNote + '</div>'
      + '</div></div>'
      + (dimBars ? '<div class="profile-section"><div class="profile-section-label">ICP Dimensions</div><div class="dim-grid">' + dimBars + '</div></div>' : '')
      + (strengths ? '<div class="profile-section"><div class="profile-section-label">Strengths</div><ul class="profile-list">' + strengths + '</ul></div>' : '')
      + (gaps ? '<div class="profile-section"><div class="profile-section-label">Gaps</div><ul class="profile-list gaps">' + gaps + '</ul></div>' : '')
      + (redFlags ? '<div class="profile-section"><div class="profile-section-label red-flag-label">Red Flags</div><ul class="profile-list red-flags">' + redFlags + '</ul></div>' : '')
      + (exploreItems ? '<div class="profile-section"><div class="profile-section-label explore-label">Worth Exploring</div><ul class="profile-list explore-list">' + exploreItems + '</ul></div>' : '')
      + (s.recommendation ? '<div class="result-reasoning"><strong>Recommendation:</strong> ' + escapeHtml(s.recommendation) + '</div>' : '')
      + '<div class="action-row">'
      + '<button class="copy-btn" id="copyBtn">&#128203; Copy</button>'
      + '</div></div>'
      + (results.length > 0 ? '<div class="section-label company-section-label">Company Backgrounds</div>' : '');
  }

  const order = { 'High': 0, 'Medium': 1, 'Low': 2, 'unknown': 3 };
  const sorted = [...results].sort((a, b) => (order[a.relevance] || 3) - (order[b.relevance] || 3));
  html += sorted.map(function(r) {
    var rel = (r.relevance || 'unknown').toLowerCase();
    var metaChips = (r.meta || []).map(function(m) { return '<span class="meta-chip">' + escapeHtml(m) + '</span>'; }).join('');
    var companyUrl = companyLinks[r.company] || 'https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(r.company || '');
    return '<div class="result-card">'
      + '<div class="result-header">'
      + '<div class="result-company">'
      + '<a href="' + companyUrl + '" target="_blank" class="link-hover-accent">' + escapeHtml(r.company || '') + ' <span class="link-arrow">&#8599;</span></a>'
      + '</div>'
      + '<span class="relevance-badge relevance-' + rel + '">' + escapeHtml(r.relevance || 'Unknown') + '</span>'
      + '</div>'
      + '<div class="result-summary">' + escapeHtml(r.summary || '') + '</div>'
      + (metaChips ? '<div class="result-meta">' + metaChips + '</div>' : '')
      + (r.reasoning ? '<div class="result-reasoning"><strong>ICP fit:</strong> ' + escapeHtml(r.reasoning) + '</div>' : '')
      + '</div>';
  }).join('');
  list.innerHTML = html;

  // Set bar widths from data-pct (avoids inline style= CSP violation)
  list.querySelectorAll('.dim-bar[data-pct]').forEach(el => {
    el.style.width = el.getAttribute('data-pct') + '%';
  });

  document.getElementById('resultsCount').textContent = (results.length || candidateScore) ? '(' + (results.length + (candidateScore ? 1 : 0)) + ')' : '';

  updateOutreachCard();
  wireOutreachFeedbackChips();

  // Score info toggle
  const scoreInfoBtn = document.querySelector('.score-info-btn');
  const scoreExp = document.getElementById('scoreExplanation');
  if (scoreInfoBtn && scoreExp) {
    scoreInfoBtn.addEventListener('click', () => {
      const open = scoreExp.style.display !== 'none';
      scoreExp.style.display = open ? 'none' : 'block';
      scoreInfoBtn.classList.toggle('active', !open);
    });
  }

  // Copy button
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const s = candidateScore;
      if (!s) return;
      const dimLines = (s.dimensions || []).map(d => `  ${d.label}: ${d.score}/100${d.note ? ' — ' + d.note : ''}`);
      const rfLines = (s.redFlags || []).filter(x => x?.trim()).map(x => `! ${x}`);
      const text = [
        `Candidate: ${currentCandidate.name}`,
        currentCandidate.url ? `Profile: ${currentCandidate.url}` : '',
        `Score: ${s.score}/100 (${s.tier})`,
        `${s.headline}`,
        '',
        dimLines.length ? 'ICP Dimensions:' : '', ...dimLines,
        '',
        'Strengths:', ...(s.strengths || []).map(x => `+ ${x}`),
        ...((s.explore || []).length ? ['', 'Worth Exploring:', ...(s.explore || []).map(x => `? ${x}`)] : []),
        '',
        'Gaps:', ...(s.gaps || []).map(x => `- ${x}`),
        rfLines.length ? '' : '', rfLines.length ? 'Red Flags:' : '', ...rfLines,
        '',
        `Recommendation: ${s.recommendation}`
      ].filter(l => l !== undefined).join('\n');

      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ Copied';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.innerHTML = '&#128203; Copy'; copyBtn.classList.remove('copied'); }, 2000);
      });
    });
  }

}

// --- Snapshot ---
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Settings ---
function renderRoles() {
  const list = document.getElementById('rolesList');
  if (roles.length === 0) {
    list.innerHTML = '<div class="no-roles-msg">No roles added yet.</div>';
    return;
  }
  list.innerHTML = roles.map(role => `
    <div class="role-item ${role.id === activeRoleId ? 'selected' : ''}" data-id="${role.id}">
      <span class="role-item-name">${escapeHtml(role.name)}</span>
      <div class="role-item-actions">
        ${role.id === activeRoleId ? '<span class="role-selected-indicator">ACTIVE</span>' : ''}
        <span class="role-edit" data-id="${role.id}" title="Edit">&#9998;</span>
        <span class="role-delete" data-id="${role.id}" title="Delete">&times;</span>
      </div>
    </div>`).join('');

  list.querySelectorAll('.role-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('role-delete') || e.target.classList.contains('role-edit')) return;
      activeRoleId = el.dataset.id;
      chrome.storage.local.set({ activeRoleId });
      renderRoles(); updateRoleBar();
    });
  });

  list.querySelectorAll('.role-edit').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const role = roles.find(r => r.id === el.dataset.id);
      if (!role) return;
      editingRoleId = role.id;
      document.getElementById('roleNameInput').value = role.name;
      document.getElementById('roleIcpInput').value = role.icp;
      document.getElementById('rolePromptInput').value = role.customPrompt || '';
      document.getElementById('roleCompellingInput').value = role.compellingPitch || '';
      document.getElementById('roleCompetitorsInput').value = role.competitors || '';
      document.querySelectorAll('#companyTypeOptions input').forEach(cb => {
        cb.checked = (role.companyTypes || []).includes(cb.value);
      });
      // Load existing dimensions if present
      if (role.dimensions && role.dimensions.length > 0) {
        pendingDimensions = [...role.dimensions];
        renderDimensionsEditor();
        document.getElementById('dimensionsEditor').style.display = 'block';
        document.getElementById('generateDimsBtn').textContent = '⚡ Regenerate Dimensions';
      } else {
        pendingDimensions = [];
        document.getElementById('dimensionsEditor').style.display = 'none';
        document.getElementById('dimensionsList').innerHTML = '';
        document.getElementById('generateDimsBtn').textContent = '⚡ Generate Scoring Dimensions';
      }
      document.getElementById('saveRoleBtn').textContent = 'Update Role';
      document.getElementById('addRoleForm').style.display = 'block';
    });
  });

  list.querySelectorAll('.role-delete').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      roles = roles.filter(r => r.id !== el.dataset.id);
      if (activeRoleId === el.dataset.id) activeRoleId = roles[0]?.id || null;
      if (editingRoleId === el.dataset.id) {
        editingRoleId = null;
        document.getElementById('addRoleForm').style.display = 'none';
        document.getElementById('saveRoleBtn').textContent = 'Save Role';
      }
      chrome.storage.local.set({ roles, activeRoleId });
      renderRoles(); updateRoleBar();
    });
  });
}

// --- JD Upload ---

function setJdStatus(msg) {
  const el = document.getElementById('jdStatus');
  const err = document.getElementById('jdError');
  if (err) err.style.display = 'none';
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showJdError(msg) {
  const el = document.getElementById('jdError');
  const status = document.getElementById('jdStatus');
  if (status) status.style.display = 'none';
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function setupJdDropzone() {
  const dropzone = document.getElementById('jdDropzone');
  const input = document.getElementById('jdFileInput');
  if (!dropzone || !input) return;

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

  ['dragenter', 'dragover'].forEach(evt => {
    dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    dropzone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', e => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleJdUpload(file);
  });
  input.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) handleJdUpload(file);
    input.value = '';
  });
}

async function handleJdUpload(file) {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showJdError('Add your API key in Settings first.'); return; }

  const name = file.name || '';
  const ext = name.split('.').pop().toLowerCase();
  if (ext !== 'pdf') { showJdError('PDF only. Please upload a PDF version of the JD.'); return; }

  setJdStatus('Reading file...');
  document.getElementById('jdFileName').textContent = name;
  document.getElementById('jdFileName').style.display = 'block';

  try {
    const pdfBase64 = await fileToBase64(file);

    setJdStatus('Extracting role details...');

    const prompt = `You are an expert recruiter. Extract structured information from the job description below.

Return ONLY a raw JSON object with NO markdown, NO backticks, NO extra text before or after:
{
  "role_name": "the job title from the JD",
  "icp_criteria": "bullet-point ICP criteria. Use dashes. Max 10 bullets covering: seniority, years experience, domain, must-have skills, company type.",
  "dimensions": [
    {"label": "short dimension name", "weight": 25, "description": "what evidence to look for in a candidate profile"},
    {"label": "short dimension name", "weight": 25, "description": "what evidence to look for"}
  ]
}

Dimension rules:
- 4 to 6 dimensions only
- Weights must sum to exactly 100
- Labels must be 2-4 words
- Map directly to requirements stated in the JD`;

    const responseText = await callPdfAI(apiKey, prompt, pdfBase64, name, 0);

    if (!responseText || !responseText.trim()) throw new Error('Empty response from AI. Check your API key.');

    let clean = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch(parseErr) {
      throw new Error('AI returned unexpected format: ' + clean.substring(0, 200));
    }

    if (!parsed.role_name && !parsed.icp_criteria) throw new Error('AI response missing required fields.');

    if (parsed.role_name) document.getElementById('roleNameInput').value = parsed.role_name;
    if (parsed.icp_criteria) document.getElementById('roleIcpInput').value = parsed.icp_criteria;

    if (Array.isArray(parsed.dimensions) && parsed.dimensions.length > 0) {
      const total = parsed.dimensions.reduce((s, d) => s + (d.weight || 0), 0);
      pendingDimensions = parsed.dimensions.map(d => ({
        label: d.label || '',
        weight: total > 0 ? Math.round((d.weight / total) * 100) : Math.round(100 / parsed.dimensions.length),
        description: d.description || ''
      }));
      const diff = 100 - pendingDimensions.reduce((s, d) => s + d.weight, 0);
      if (pendingDimensions.length > 0) pendingDimensions[0].weight += diff;
      renderDimensionsEditor();
      document.getElementById('dimensionsEditor').style.display = 'block';
      document.getElementById('generateDimsBtn').textContent = '\u26a1 Regenerate Dimensions';
    }

    setJdStatus('Role details extracted \u2713');
    setTimeout(() => { document.getElementById('jdStatus').style.display = 'none'; }, 3000);

  } catch(e) {
    showJdError('Error: ' + (e.message || 'Unknown error.'));
    console.error('JD upload error:', e);
  }
}

async function generateDimensions() {
  const icp = document.getElementById('roleIcpInput').value.trim();
  if (!icp) { showStatus('Paste your ICP criteria first.'); return; }
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showStatus('Add your API key in Settings first.'); return; }

  const selectedCompanyTypes = Array.from(document.querySelectorAll('#companyTypeOptions input:checked')).map(el => el.value);
  const companyTypeContext = selectedCompanyTypes.length
    ? `\nTARGET COMPANY TYPE: ${selectedCompanyTypes.join(', ')} — dimensions should reflect skills and experience relevant to candidates from or targeting this type of company.`
    : '';

  const btn = document.getElementById('generateDimsBtn');
  btn.disabled = true; btn.textContent = 'Generating...';

  const prompt = `You are an expert recruiter. Given this role ICP, extract 4-6 meaningful scoring dimensions that can be used to evaluate candidates.

ICP:
${icp}${companyTypeContext}

Rules:
- Each dimension must map directly to something in the ICP or company type context above
- If a target company type is specified, include at least one dimension that reflects relevant experience at that type of company (e.g. PLG → product-led growth motion, B2B → enterprise sales experience)
- Weights must sum to exactly 100
- Higher weight = more critical to the role
- Keep labels short (2-4 words)
- Description should explain what evidence to look for in a profile

Return ONLY a raw JSON array, no markdown, no code fences:
[
  {"label": "dimension name", "weight": 25, "description": "what to look for"},
  {"label": "dimension name", "weight": 25, "description": "what to look for"}
]`;

  try {
    const text = await callAI(apiKey, prompt, 0, MODEL_WRITE);
    const clean = text.replace(/\`\`\`json|\`\`\`/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid response');
    // Normalise weights to sum to 100
    const total = parsed.reduce((s, d) => s + (d.weight || 0), 0);
    pendingDimensions = parsed.map(d => ({
      label: d.label || '',
      weight: Math.round((d.weight / total) * 100),
      description: d.description || ''
    }));
    // Fix rounding so weights total exactly 100
    const diff = 100 - pendingDimensions.reduce((s, d) => s + d.weight, 0);
    if (pendingDimensions.length > 0) pendingDimensions[0].weight += diff;
    renderDimensionsEditor();
    document.getElementById('dimensionsEditor').style.display = 'block';
  } catch(e) {
    showStatus('Could not generate dimensions. Try again.');
  }
  btn.disabled = false; btn.textContent = '⚡ Regenerate Dimensions';
}

function renderDimensionsEditor() {
  const list = document.getElementById('dimensionsList');
  list.innerHTML = pendingDimensions.map((d, i) => `
    <div class="dim-editor-row">
      <div>
        <div class="dim-editor-label">Dimension ${i + 1}</div>
        <input class="dim-editor-name" data-i="${i}" data-field="label" value="${escapeHtml(d.label)}" placeholder="Dimension name" />
        <textarea class="dim-editor-desc" data-i="${i}" data-field="description" placeholder="What to look for...">${escapeHtml(d.description)}</textarea>
      </div>
      <div class="dim-weight-wrap">
        <input class="dim-weight-input" type="number" min="0" max="100" data-i="${i}" data-field="weight" value="${d.weight}" />
        <span class="dim-weight-label">weight %</span>
      </div>
    </div>`).join('');

  list.querySelectorAll('input[data-field], textarea[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const i = parseInt(el.dataset.i);
      const field = el.dataset.field;
      pendingDimensions[i][field] = field === 'weight' ? parseInt(el.value) || 0 : el.value;
      updateWeightTotal();
    });
  });
  updateWeightTotal();
}

function updateWeightTotal() {
  const total = pendingDimensions.reduce((s, d) => s + (d.weight || 0), 0);
  const el = document.getElementById('weightTotal');
  el.textContent = `Total: ${total}%`;
  el.className = total === 100 ? 'weight-ok' : 'weight-err';
}

function saveRole() {
  const name = document.getElementById('roleNameInput').value.trim();
  const icp = document.getElementById('roleIcpInput').value.trim();
  const customPrompt = document.getElementById('rolePromptInput').value.trim();
  const compellingPitch = document.getElementById('roleCompellingInput').value.trim();
  const competitors = document.getElementById('roleCompetitorsInput').value.trim();
  const companyTypes = Array.from(document.querySelectorAll('#companyTypeOptions input:checked')).map(el => el.value);
  if (!name || !icp) { showStatus('Fill in role name and ICP criteria.'); return; }

  // Validate dimensions if defined — auto-fix small rounding errors
  if (pendingDimensions.length > 0) {
    const total = pendingDimensions.reduce((s, d) => s + (d.weight || 0), 0);
    const diff = 100 - total;
    if (Math.abs(diff) <= 2) {
      pendingDimensions[0].weight += diff; // auto-fix rounding
    } else if (total !== 100) {
      showStatus('Dimension weights total ' + total + '% — must equal 100%. Adjust weights and try again.');
      return;
    }
  }

  const dimensions = pendingDimensions.length > 0 ? [...pendingDimensions] : null;

  if (editingRoleId) {
    roles = roles.map(r => r.id === editingRoleId ? { ...r, name, icp, customPrompt, compellingPitch, competitors, companyTypes, dimensions } : r);
    editingRoleId = null;
    document.getElementById('saveRoleBtn').textContent = 'Save Role';
  } else {
    const newRole = { id: Date.now().toString(), name, icp, customPrompt, compellingPitch, competitors, companyTypes, dimensions };
    roles.push(newRole);
    if (!activeRoleId) activeRoleId = newRole.id;
  }

  chrome.storage.local.set({ roles, activeRoleId }, () => {
    renderRoles(); updateRoleBar();
    document.getElementById('addRoleForm').style.display = 'none';
    document.getElementById('roleNameInput').value = '';
    document.getElementById('roleIcpInput').value = '';
    document.getElementById('rolePromptInput').value = '';
    document.getElementById('roleCompellingInput').value = '';
    document.getElementById('roleCompetitorsInput').value = '';
    document.getElementById('dimensionsEditor').style.display = 'none';
    document.getElementById('dimensionsList').innerHTML = '';
    pendingDimensions = [];
    showStatus('Role saved.');
  });
}

function saveSettings() {
  var apiKey = document.getElementById('apiKeyInput').value.trim();
  aiProvider = document.getElementById('providerSelect').value;
  toneSample = document.getElementById('toneSampleInput').value.trim();
  recruiterRoleTitle = document.getElementById('recruiterRoleTitleInput').value.trim();
  recruiterCompanyName = document.getElementById('recruiterCompanyNameInput').value.trim();
  chrome.storage.local.set({ apiKey, aiProvider, roles, activeRoleId, toneSample, recruiterRoleTitle, recruiterCompanyName }, function() { showStatus('Settings saved.'); });
}

function updateRoleBar() {
  const role = roles.find(r => r.id === activeRoleId);
  const bar = document.getElementById('roleBar');
  if (role) {
    bar.textContent = `Scoring against: ${role.name}`;
    bar.className = 'role-bar';
  } else {
    bar.textContent = 'No active role — go to Settings';
    bar.className = 'role-bar warning';
  }
}

// --- Helpers ---
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tabName));
  const metaEl = document.getElementById('candidateMeta');
  if (metaEl && !currentCandidate.name) {
    metaEl.textContent = tabName === 'github'
      ? 'Open a GitHub profile to begin'
      : 'Open a LinkedIn profile to begin';
  }
}
function showError(msg) { const el = document.getElementById('scanError'); el.textContent = msg; el.style.display = 'block'; }
function hideError() { document.getElementById('scanError').style.display = 'none'; }
function showStatus(msg) { const el = document.getElementById('statusMsg'); el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 2500); }
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Mode toggle ---

function ensureInmailGreeting(body) {
  var firstName = (currentCandidate.name || 'there').split(' ')[0];
  var greeting = 'Hi ' + firstName + ',';
  var cleanBody = (body || '').trim();
  cleanBody = cleanBody.replace(/^(Hi|Hello|Hey)[^\n]*,\s*/i, '');
  var candidateName = (currentCandidate.name || '').trim().toLowerCase();
  if (candidateName) {
    var bodyLower = cleanBody.toLowerCase();
    if (bodyLower.startsWith(candidateName + ',')) {
      cleanBody = cleanBody.slice(candidateName.length + 1).trimStart();
    } else if (bodyLower.startsWith(candidateName)) {
      cleanBody = cleanBody.slice(candidateName.length).trimStart();
    }
  }
  cleanBody = cleanBody.replace(/^\s+/, '');
  return cleanBody ? (greeting + '\n\n' + cleanBody) : greeting;
}

// Wire quick feedback chips — done after DOM ready
function wireOutreachFeedbackChips() {
  document.querySelectorAll('.feedback-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      document.querySelectorAll('.feedback-chip').forEach(function(c) { c.classList.remove('active'); });
      chip.classList.add('active');
      var feedbackInput = document.getElementById('outreachFeedbackInput');
      if (feedbackInput) feedbackInput.value = chip.dataset.feedback;
    });
  });
}

async function reviseOutreach() {
  var feedbackInput = document.getElementById('outreachFeedbackInput');
  var feedback = feedbackInput ? feedbackInput.value.trim() : '';
  if (!feedback) return;

  var apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('Add your API key in Settings first.'); return; }

  var currentBody = document.getElementById('outreachBody').value.trim();
  var currentSubject = document.getElementById('outreachSubject') ? document.getElementById('outreachSubject').value.trim() : '';
  var format = document.getElementById('outreachFormat').value;

  if (!currentBody) return;

  var btn = document.getElementById('outreachFeedbackBtn');
  btn.disabled = true; btn.textContent = 'Revising...';

  var currentDraft = format === 'inmail' && currentSubject
    ? 'Subject: ' + currentSubject + '\n\n' + currentBody
    : currentBody;

  var revisionToneInstruction = toneSample
    ? 'The recruiter\'s tone sample is:\n"' + toneSample + '"\nMaintain this voice and style throughout the revision.'
    : 'Maintain a direct, personal, human tone throughout.';

  var prompt = 'You are refining a recruiter outreach message based on feedback. Apply the feedback precisely without changing anything else.'
    + '\n\nCURRENT DRAFT:\n' + currentDraft
    + '\n\nFEEDBACK TO APPLY:\n' + feedback
    + '\n\nTONE:\n' + revisionToneInstruction
    + '\n\nRULES:\n1. Apply the feedback precisely — do not change anything else.\n2. Keep all specific candidate details and employer references.\n3. Do not invent new details not in the original.\n4. Never reference tenure length or years of experience — say "your time at" or "your role at" instead.\n5. Never introduce banned phrases: I came across your profile, I was impressed, exciting opportunity, I think you would be a great fit, I wanted to reach out, Hope you are well, I hope this finds you well, at my company, caught my eye, stood out to me, exactly what I am looking for, your background resonated.\n6. Maintain same format (' + format + ').'
    + '\n\nSELF-CHECK before returning: read the revised message as if you received it cold. Does it sound like a real person wrote it? If any sentence sounds generated or templated, rewrite it. If any word adds no meaning, remove it.'
    + (format === 'inmail' ? '\n\nReturn ONLY a raw JSON object: {"subject": "...", "body": "..."}' : '\n\nReturn ONLY the revised message text — no explanation, no labels.');

  try {
    var text = await callAI(apiKey, prompt, 0.2, MODEL_WRITE);
    if (format === 'inmail') {
      var clean = text.replace(/\x60\x60\x60json|\x60\x60\x60/g, '').trim();
      var parsed = JSON.parse(clean);
      document.getElementById('outreachSubject').value = parsed.subject || currentSubject;
      document.getElementById('outreachBody').value = ensureInmailGreeting(parsed.body || currentBody);
    } else {
      document.getElementById('outreachBody').value = text.trim();
    }
    updateOutreachCharCount();
    // Clear feedback
    feedbackInput.value = '';
    document.querySelectorAll('.feedback-chip').forEach(function(c) { c.classList.remove('active'); });
  } catch(e) {
    showError('Revision failed: ' + e.message);
  }

  btn.disabled = false; btn.textContent = 'Revise ↩';
}

function updateOutreachCharCount() {
  var format = document.getElementById('outreachFormat').value;
  var body = document.getElementById('outreachBody').value;
  var len = body.length;
  var limit = format === 'connection' ? OUTREACH_LIMITS.connection : OUTREACH_LIMITS.inmail_body;
  var target = format === 'connection' ? OUTREACH_TARGETS.connection : OUTREACH_TARGETS.inmail_body;
  var countEl = document.getElementById('outreachCharCount');
  var limitEl = document.getElementById('outreachCharLimit');
  if (countEl) { countEl.textContent = len + ' chars'; countEl.className = 'outreach-char-count' + (len > limit ? ' over' : ''); }
  if (limitEl) limitEl.textContent = 'target ~' + target + ' · max ' + limit;
}

function updateOutreachCard() {
  var card = document.getElementById('outreachCard');
  if (!card) return;
  if (candidateScore) {
    card.style.display = 'block';
    var empty = document.getElementById('outreachEmpty');
    var content = document.getElementById('outreachContent');
    var genBtn = document.getElementById('generateOutreachBtn');
    if (empty) empty.style.display = 'block';
    if (content) content.style.display = 'none';
    if (genBtn) genBtn.textContent = 'Generate';
    var subjectWrap = document.getElementById('outreachSubjectWrap');
    if (subjectWrap) subjectWrap.style.display = 'none';
  } else {
    card.style.display = 'none';
  }
}

async function generateOutreach() {
  if (!candidateScore) {
    showError('Score the candidate first — outreach quality is significantly better when anchored to scorecard evidence.');
    return;
  }
  var apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showError('Add your API key in Settings first.'); return; }
  var activeRole = roles.find(function(r) { return r.id === activeRoleId; });
  if (!activeRole) { showError('No active role selected.'); return; }

  var format = document.getElementById('outreachFormat').value;
  var btn = document.getElementById('generateOutreachBtn');

  if (!recruiterRoleTitle || !recruiterCompanyName) {
    var missing = [];
    if (!recruiterRoleTitle) missing.push('your role title');
    if (!recruiterCompanyName) missing.push('your company name');
    showError('Add ' + missing.join(' and ') + ' in Settings before generating outreach.');
    return;
  }

  btn.disabled = true; btn.textContent = 'Generating...';

  var toneInstruction = toneSample
    ? 'TONE SAMPLE MODE — the recruiter has provided an example message. Mirror their voice, sentence length, formality and personality throughout. The tone sample governs HOW you write — not the structure, not what you include, not the opening formula. The hard rules and structure instructions below still apply without exception.\n\nTone sample:\n"' + toneSample + '"\n\nNote: the greeting (Hi [Name],) is added automatically — start the body from the first sentence after the greeting, mirroring the voice of the tone sample from that point.'
    : 'DEFAULT MODE — no tone sample provided.\n\nWHAT YOU ARE WRITING\nA LinkedIn outreach message from a recruiter to a specific candidate. The reader is a professional who receives many messages like this. They will decide in 5 seconds whether to keep reading. Your job is to make those 5 seconds count.\n\nWHAT MAKES A GOOD RECRUITER MESSAGE\nA good message does three things and nothing else:\n1. Shows the recruiter read the candidate profile — one specific, accurate observation\n2. Tells the candidate why this opportunity is worth their attention — one or two concrete specifics\n3. Asks for a low-commitment response\nEverything else is noise. Remove it.\n\nVOICE AND TONE\nWrite the way a confident, professional recruiter speaks directly to one person. Not formally. Not casually. Directly. Every word should feel chosen, not generated. If you read a sentence back and it sounds like it came from a template, it does. Rewrite it.\n\nWHAT THE MESSAGE MUST NEVER DO — hard failures:\n\nAccuracy failures:\n- Never state anything not explicitly written in the anchor or candidate profile. No inference. No assumption.\n- Never quote the profile or scorecard verbatim — restate in plain conversational language\n- Never calculate or reference tenure, years of experience, or any time period — say "your role at" or "your time at"\n- Never describe what the candidate employer does, its products, or its customers — name the company and the candidate role only\n\nVoice failures:\n- Never narrate the recruiter own reaction, opinion, or judgement (caught my eye, exactly what I look for, your background really resonated, I was impressed)\n- Never explain why the candidate background is relevant — show it through the observation, do not state it\n- Never use corporate vocabulary: leverage, utilize, synergy, passionate, driven, disruptive, impactful, dynamic\n- Never use filler phrases that add no information: I wanted to reach out, Hope you are well, I came across your profile, exciting opportunity, I think you would be a great fit\n\nQuality failures:\n- Never list technologies, acronyms, or skills in sequence\n- Never include a sentence that could appear in any message to any candidate — if it is not specific to this person, remove it\n- Never pad to hit a length target — a shorter message that says something real beats a longer one that does not\n\nQUALITY CHECK — mandatory before returning:\nRead the complete message as if you are the candidate receiving it cold. Ask:\n1. Does sentence 1 reference something specific and accurate about me — not my employer description, not a technology list, not a guess?\n2. Does the opportunity section tell me something concrete and specific about this role — not generic claims?\n3. Does every sentence sound like a person wrote it?\n4. Is there anything I could remove without losing meaning?\n5. Is there anything in here that is not explicitly supported by my profile?\nIf any answer is no — rewrite that part. Only return the message when all five pass.';

  // Nudge user to add tone sample if missing
  var hasToneSample = !!toneSample;

  var role = activeRole.name;
  var senderRole = recruiterRoleTitle || '';
  var senderCompany = recruiterCompanyName || '';

  // ── ANCHOR SELECTION ──────────────────────────────────────────────────────
  // Select the single most ICP-relevant employer and evidence from the scorecard.
  // Only this goes to the outreach model — nothing else about the candidate.
  var anchorCompany = candidateScore.anchorCompany || '';
  var candidateJobTitle = candidateScore.headline || '';

  // Use anchorJobTitle from scorecard — set by scoring model which has full profile context
  var anchorJobTitle = candidateScore.anchorJobTitle || candidateJobTitle || '';

  var sortedDims = (candidateScore.dimensions || []).slice().sort(function(a, b) {
    return (b.score || 0) - (a.score || 0);
  });

  // Get the single best anchor note — highest scoring dimension that mentions anchor company
  var anchorNote = '';
  if (anchorCompany) {
    for (var i = 0; i < sortedDims.length; i++) {
      if (sortedDims[i].note && sortedDims[i].note.toLowerCase().includes(anchorCompany.toLowerCase())) {
        anchorNote = sortedDims[i].note;
        break;
      }
    }
  }
  // Fallback to top dimension note
  if (!anchorNote) {
    var topDim = sortedDims.find(function(d) { return d.note && d.note.trim(); });
    if (topDim) anchorNote = topDim.note;
  }
  // Final fallback to top strength
  if (!anchorNote && (candidateScore.strengths || []).length > 0) {
    anchorNote = candidateScore.strengths[0];
  }

  var firstName = (currentCandidate.name || '').split(' ')[0] || '';
  var formatInstruction;
  if (format === 'connection') {
    formatInstruction = 'Write a LinkedIn CONNECTION REQUEST NOTE from a single recruiter. Use "I", never "we".'
      + '\n\nFOLLOW THIS TEMPLATE EXACTLY — do not deviate:'
      + '\n"[First name], I noticed your experience at [Company] — reaching out about a [Role title] opportunity at [Hiring Company]. Open to connecting?"'
      + '\n\nThat is the entire message. Nothing else.'
      + '\n\nRULES:'
      + '\n- Start with the candidate first name followed by a comma'
      + '\n- Use the company name from the ANCHOR only — no job title description, no commentary, no self-narration'
      + '\n- Never say "made me think", "is relevant to", "aligns with" or any phrase explaining why you are reaching out'
      + '\n- End with "Open to connecting?" or similar confident low-friction CTA'
      + '\n- Never reference tenure or years of experience'
      + '\n- Target 150-200 characters (hard max 280).'
      + '\n- No subject line. No sign-off.';
  } else {
    formatInstruction = 'Write a LinkedIn INMAIL. Use "I", never "we" or "our team". The structure below is fixed and applies regardless of tone sample.'
      + '\nSUBJECT LINE — follow this formula exactly, do not deviate:'
      + '\nFormat: "[Role title] — [One company signal]"'
      + '\nRules:'
      + '\n- Role title: use the ROLE BEING HIRED FOR field exactly'
      + '\n- Company signal: use ONE of the following in strict order of preference: (1) hiring company name if provided, (2) company stage e.g. Series D or post-IPO, (3) a single descriptor e.g. fast-growing or London-based'
      + '\n- 4-7 words maximum including the dash'
      + '\n- No question marks, no exclamation marks'
      + '\n- NEVER reference the candidate\'s current or previous employers'
      + '\n- No generic phrases: Exciting opportunity / Quick question / Following up / I wanted to reach out'
      + '\n- Do not add anything outside the formula'
      + '\n\nWRITING STYLE: Write as a human recruiter sending a direct, genuine message — not a system generating a template. If a tone sample is provided in the tone instructions, mirror that voice. If not, write in a direct, warm, conversational tone with short sentences and no corporate language.'
      + '\n\nHARD WRITING RULES — no exceptions:'
      + '\n1. Never quote the candidate\'s profile or scorecard verbatim. Restate in plain conversational language — never copy phrases word for word.'
      + '\n2. Never reference tenure length, years of experience, or any time calculation. Say "your time at [Company]" or "your role at [Company]" — never "your 5 years at" or "your 4+ years".'
      + '\n3. GOVERNING PRINCIPLE: Every sentence must carry information about the candidate or the opportunity. No sentence may exist solely to express the recruiter\'s reaction or approval. Test: if removing a sentence loses no useful information, remove it.'
      + '\n4. Never list technologies or acronyms in sequence. Pick one specific detail and state it plainly.'
      + '\n5. Do NOT start with the candidate first name — the greeting already has it.'
      + '\n\nBODY STRUCTURE — return the body WITHOUT the greeting line. The greeting is added automatically.'
      + '\n\n[ONE paragraph — 3-4 sentences total]'
      + '\n  Sentence 1 — MANDATORY. Use this exact structure:'
      + '\n  "I noticed your experience at [ANCHOR COMPANY] — reaching out about a [ROLE TITLE] at [HIRING COMPANY]."'
      + '\n  Use the company name from the ANCHOR. Do not add job title descriptions, do not add bridge phrases like "which made me think" or "that experience is relevant". The dash is the only connector.'
      + '\n  Sentences 2-3: Specific role details — what they would own, what makes it worth their attention. Use WHAT MAKES THIS ROLE COMPELLING if provided. Draw from the ICP for specifics. Concrete only — not a job description.'
      + '\n  Do not introduce any employer or achievement not in the anchor.'
      + '\n\n[BLANK LINE]'
      + '\nCTA — one short sentence. Confident and low-friction. e.g. "Worth a quick call?" or "Open to a quick chat?" — never "Could we chat briefly to learn more?" or anything that sounds like you are asking permission or hedging.'
      + '\n\nFORMATTING RULES:'
      + '\n- Two blocks only: one paragraph then CTA. Separated by a blank line.'
      + '\n- No bullet points, no numbered lists, no bold, no headers'
      + '\n- Short sentences. Scannable in under 10 seconds on mobile.'
      + '\n- Target 500-800 characters. Hard max 1300. Do not pad — if it lands well at 500, stop.'
      + '\n\nSELF-CHECK — apply before returning the message:'
      + '\n- Read it back as if you received it cold. Does it sound like a real person wrote it, or does it sound generated?'
      + '\n- If any sentence would make you think "this is a template", rewrite it.'
      + '\n- If any word could be removed without losing meaning, remove it.'
      + '\n- If it passes both tests, return it. If not, rewrite until it does.'
      + '\n\nBANNED — never use any of these:'
      + '\n  Any sentence expressing recruiter reaction or approval (caught my eye, stood out, exactly what I look for, impressed, resonated)'
      + '\n  Generic opener phrases (I came across your profile, I wanted to reach out, Hope you are well, I hope this finds you well)'
      + '\n  Vague value claims (exciting opportunity, unique opportunity, make a big impact, shape the future, leveraging your expertise, solving complex problems)'
      + '\n  Corporate filler (utilize, leverage, synergy, passionate, driven, disruptive — unless directly quoting the role title)'
      + '\nReturn a JSON object: {"subject": "...", "body": "..."}. The body field must NOT include the greeting line — start the body with the first sentence of the message.'
  }

  var prompt = 'You are writing a LinkedIn outreach message for a recruiter. Write in first person ("I"). You are one person, not a company or a system.'
    + '\n\nYOU HAVE EXACTLY FOUR INPUTS. Use only these — nothing else:'
    + '\n\n1. CANDIDATE: ' + currentCandidate.name + ', ' + anchorJobTitle + ' at ' + (anchorCompany || 'see profile')
    + '\n2. ROLE: ' + role + (senderCompany ? ' at ' + senderCompany : '')
    + (activeRole.compellingPitch ? '\n3. WHAT MAKES THIS ROLE COMPELLING (use this as the foundation for the opportunity section):\n' + activeRole.compellingPitch : '\n3. WHAT MAKES THIS ROLE COMPELLING: not provided — keep the opportunity section brief and factual')
    + '\n4. ANCHOR (the most ICP-relevant evidence from the scorecard — base the opening observation on this):\n' + anchorNote
    + '\n\nDo not use any other information. Do not reference the ICP, the full profile, dimension notes, or anything outside these four inputs.'
    + '\n\nTONE AND QUALITY INSTRUCTIONS:\n' + toneInstruction
    + '\n\nFORMAT INSTRUCTIONS:\n' + formatInstruction
    + '\n\n' + (format === 'inmail' ? 'Return ONLY a raw JSON object — no markdown, no code fences: {"subject": "...", "body": ""}. Body must NOT include the greeting line.' : 'Return ONLY the message text — no explanation, no labels, no quotes.');

  try {
    var text = await callAI(apiKey, prompt, 0.2, MODEL_WRITE);
    if (format === 'inmail') {
      var clean = text.replace(/\x60\x60\x60json|\x60\x60\x60/g, '').trim();
      var parsed = JSON.parse(clean);
      document.getElementById('outreachSubject').value = parsed.subject || '';
      document.getElementById('outreachBody').value = ensureInmailGreeting(parsed.body || '');
      document.getElementById('outreachSubjectWrap').style.display = 'block';
      document.getElementById('copyOutreachAllBtn').style.display = 'inline-flex';
      document.getElementById('copyOutreachBtn').style.display = 'none';
    } else {
      document.getElementById('outreachBody').value = text.trim();
      document.getElementById('outreachSubjectWrap').style.display = 'none';
      document.getElementById('copyOutreachAllBtn').style.display = 'none';
      document.getElementById('copyOutreachBtn').style.display = 'inline-flex';
    }
    document.getElementById('outreachContent').style.display = 'block';
    document.getElementById('outreachEmpty').style.display = 'none';
    updateOutreachCharCount();

    // Show tone sample nudge every time if no tone sample is saved
    var existingNudge = document.getElementById('toneSampleNudge');
    if (existingNudge) existingNudge.remove();
    if (!hasToneSample) {
      var nudge = document.createElement('div');
      nudge.id = 'toneSampleNudge';
      nudge.style.cssText = 'margin-top:8px;padding:7px 10px;background:#fffbeb;border:1px solid rgba(217,119,6,0.25);border-radius:6px;font-size:11px;color:#92400e;line-height:1.5;';
      nudge.innerHTML = '&#9888; No tone sample set — messages will use a default style. <a href="#" id="nudgeSettingsLink" style="color:#b45309;font-weight:600;text-decoration:underline;">Add one in Settings</a> to match your personal voice.';
      document.getElementById('outreachContent').parentNode.insertBefore(nudge, document.getElementById('outreachContent').nextSibling);
      var nudgeLink = document.getElementById('nudgeSettingsLink');
      if (nudgeLink) nudgeLink.addEventListener('click', function(e) { e.preventDefault(); switchTab('settings'); });
    }

    document.getElementById('copyOutreachBtn').onclick = function() {
      var t = document.getElementById('outreachBody').value;
      navigator.clipboard.writeText(t).then(function() {
        var b = document.getElementById('copyOutreachBtn');
        b.textContent = '✓ Copied'; b.classList.add('copied');
        setTimeout(function() { b.innerHTML = '&#128203; Copy'; b.classList.remove('copied'); }, 2000);
      });
    };
    document.getElementById('copyOutreachAllBtn').onclick = function() {
      var subject = document.getElementById('outreachSubject').value;
      var body = document.getElementById('outreachBody').value;
      var full = subject ? 'Subject: ' + subject + '\n\n' + body : body;
      navigator.clipboard.writeText(full).then(function() {
        var b = document.getElementById('copyOutreachAllBtn');
        b.textContent = '✓ Copied'; b.classList.add('copied');
        setTimeout(function() { b.innerHTML = '&#128203; Copy All'; b.classList.remove('copied'); }, 2000);
      });
    };
  } catch(e) {
    showError('Outreach generation failed: ' + e.message);
  }
  btn.disabled = false; btn.textContent = 'Regenerate';
}


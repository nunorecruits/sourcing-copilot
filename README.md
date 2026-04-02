# Sourcing Copilot — Chrome Extension

**AI-assisted profile scoring, shortlist building, company analysis, and outreach. All inside your browser.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-teal)](https://chromewebstore.google.com/detail/ffgaljblcpgcamndlegkbbbebnhkjini)
![Version](https://img.shields.io/badge/version-3.0.0-blue)

---

## What it does

Sourcing Copilot is a Chrome side panel extension for recruiters. Open any LinkedIn profile, click Score Full Profile, and get a structured candidate assessment in seconds — scored against your own ICP criteria with weighted dimensions, strengths, gaps, red flags and a recommendation.

**Core features:**

- **ICP scoring** — define role-specific dimensions with custom weights. Every score is explained with evidence directly from the profile.
- **LinkedIn PDF scoring** — upload a LinkedIn profile PDF for a complete assessment, including full work history with no character truncation.
- **Outreach drafting** — generate personalised connection requests and InMails anchored to the most ICP-relevant evidence from the scorecard. Mirrors your tone sample.
- **Company analysis** — scan employers from a profile and analyse each one for ICP fit, size, stage and industry.
- **Candidate shortlist** — save and compare scored candidates by role. Export to CSV.
- **Worth Exploring** — contextual signals flagged separately from confirmed evidence, so you know what to probe in a screening call.
- **Works with Gemini and OpenAI** — bring your own API key.

---

## Quick start

### 1. Install from Chrome Web Store
[Install Sourcing Copilot](https://chromewebstore.google.com/detail/ffgaljblcpgcamndlegkbbbebnhkjini)

Or load unpacked from source — see [Development setup](#development-setup) below.

### 2. Get an API key

**Gemini (recommended — free tier available):**
1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in and click **Create API key**
3. Copy the key (starts with `AIza...`)

**OpenAI (paid):**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new secret key

### 3. Configure your first role
1. Open any LinkedIn profile
2. Click the **SC** icon in your Chrome toolbar to open the side panel
3. Go to **Settings**
4. Paste your API key
5. Add your **Recruiter Details** (role title + hiring company name — required for outreach)
6. Click **+ New Role** and define your ICP:
   - **Name**: e.g. `Enterprise AE – Acme`
   - **ICP criteria**: paste your job description or describe what good looks like for this role
   - **What makes this role compelling**: 2-3 sentences in your own words — used to make outreach paragraph 2 specific and human
   - **Dimensions**: add weighted scoring dimensions (e.g. SaaS Experience 30%, Outbound Motion 25%)
7. Click **Save**

### 4. Score a profile
1. Open any LinkedIn profile
2. Click **Score Full Profile** (Option 1) for a quick assessment from the live page
3. Or download the LinkedIn PDF and drag it into the **Option 2** drop zone for a complete assessment
4. Results appear in the **Results** tab with score, tier, dimensions, strengths, gaps, red flags, worth exploring, and recommendation

---

## Scoring options

| Option | How it works | Best for |
|---|---|---|
| **Live LinkedIn scan** | Reads visible profile content from the page | Quick assessment, most candidates |
| **LinkedIn PDF upload** | Reads from the downloaded PDF export — full text, no truncation | Candidates with extensive experience or where full history matters |

To download a LinkedIn PDF: open the profile → **More** → **Save to PDF**

---

## Evidence levels

The scorecard separates evidence into three clear categories:

- **Strengths** — confirmed evidence only. Things the candidate has explicitly stated about themselves.
- **Gaps** — ICP requirements not evidenced in the profile.
- **Worth Exploring** — contextual signals from the candidate's employer background that suggest possible relevance but are not confirmed. Flagged as questions to probe in a screening call, never scored as confirmed evidence.

---

## Outreach generation

After scoring, go to the **Results** tab and scroll to **Draft Outreach**. Select Connection Request or InMail, then click **Generate**.

The message is anchored to the most ICP-relevant evidence identified by the scorecard — not a generic template. It uses your recruiter name, hiring company, tone sample, and role compelling pitch from Settings.

- **Connection request:** target 150–200 characters, max 280
- **InMail:** target 800–900 characters, max 1,300

**Tips for better outreach:**
- Add a **tone sample** in Settings — paste a short, direct message you've sent before. The extension mirrors your style.
- Fill in **What makes this role compelling** per role — 2-3 specific sentences about the opportunity. This is the foundation for paragraph 2.

---

## Shortlist and compare

Scored candidates are automatically saved to the **Shortlist** tab, grouped by role. You can:

- Compare candidates ranked by score
- Expand each candidate to see dimensions, strengths, gaps, worth exploring, and notes
- Click **Draft Outreach** directly from the shortlist
- Export any role's shortlist as a CSV

---

## Development setup

To load from source:

```bash
git clone https://github.com/nunorecruits/sourcing-copilot.git
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the cloned folder
5. The SC icon will appear in your Chrome toolbar

No build step required — pure HTML, CSS and vanilla JS.

---

## Privacy

- All profile data is processed locally in your browser
- Profile text is sent to your chosen AI provider (Gemini or OpenAI) using your own API key
- No data is sent to any Sourcing Copilot servers
- No data is stored beyond your browser's local storage
- Full privacy policy: https://github.com/nunorecruits/sourcing-copilot/blob/main/privacy-policy.md

---

## Changelog

### v3.0.0
- Ask tab removed
- Evidence principle introduced — scoring now separates confirmed evidence, contextual signals, and inference. No conflation of employer industry coverage with candidate expertise
- New "Worth Exploring" field — contextual signals from employer background flagged separately, never scored as confirmed evidence
- Two-tier anchor selection for outreach — scoring model identifies the most ICP-relevant employer considering both experience fit and company type. Company analysis results used when available
- Outreach prompt rewritten — governing principle applied to every sentence: must carry information about the candidate or opportunity, not the recruiter's reaction
- "What makes this role compelling?" field added per role in Settings — recruiter's own words used as the foundation for outreach paragraph 2
- Subject line formula fixed — follows [Role title] — [Company signal] format, never references candidate's current employer
- Dual model split — Gemini 2.5 Flash Lite for scoring (deterministic, strict rule-following), Gemini 2.5 Flash for outreach (reasoning, writing quality)
- Scoring consistency improved — temperature 0 now reliably deterministic with Flash Lite
- ICP text cap removed in outreach prompt — full job description reaches the model
- LinkedIn Recruiter support — name extraction and profile content capture on linkedin.com/talent/profile/ URLs
- PDF scoring processes full profile text with no character truncation
- Live LinkedIn scan profile text limit raised to 18,000 characters
- InMail character limit raised to 1,300 (target 800–900)
- Tone sample nudge shown after every outreach generation if no tone sample is saved
- Banned phrase list replaced with principle-based rule covering all variations
- Manifest short description updated

### v2.9.5
- InMail character limit increased to 1,100 (target 700–900)
- Improved outreach structure: clear paragraph format, expanded banned phrases list
- Scoring prompt: promotion/nested roles calibration rule restored
- Model constant centralised (Gemini 2.5 Flash)
- Version consistency fixes

### v2.9.2
- LinkedIn PDF upload scoring
- Recommended badge on PDF option
- Separate Gemini/OpenAI API key links in Settings
- URL normalisation fix for chrome-extension://invalid prefix

### v2.7.0
- Full UI redesign — light theme, Plus Jakarta Sans, teal accent
- Weighted ICP dimensions with custom scoring
- Outreach quality improvements — tone mirroring, banned phrases, first name only
- Candidate shortlist with CSV export
- Company analysis with ICP fit reasoning

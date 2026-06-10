# Sourcing Copilot — Chrome Extension

**AI-assisted profile scoring, GitHub technical analysis, shortlist building, and outreach. All inside your browser.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-teal)](https://chromewebstore.google.com/detail/ffgaljblcpgcamndlegkbbbebnhkjini)
![Version](https://img.shields.io/badge/version-3.0.3-blue)

---

## What it does

Sourcing Copilot is a Chrome side panel extension for recruiters. Open any LinkedIn or GitHub profile and get a structured candidate assessment in seconds — scored against your own ICP criteria with weighted dimensions, strengths, gaps, red flags, and a recommendation.

**Core features:**

- **ICP scoring** — define role-specific dimensions with custom weights. Every score is explained with evidence directly from the profile.
- **LinkedIn PDF scoring** — upload a LinkedIn profile PDF for a complete assessment, including full work history with no character truncation.
- **GitHub Technical Analysis** — scan any GitHub profile for language breakdown (by byte count across all public repos), notable projects, technical summary, outreach hook, and a Suitability Fit Signal against your active role.
- **JD upload** — upload a job description PDF to automatically extract role name, ICP criteria, and weighted dimensions in one pass.
- **Outreach drafting** — generate personalised connection requests and InMails anchored to the most ICP-relevant evidence from the scorecard. Mirrors your tone sample.
- **Company analysis** — scan employers from a profile and analyse each one for ICP fit, size, stage, and industry.
- **Candidate shortlist** — save and compare scored candidates by role. Filter by source (LinkedIn / GitHub). Export to CSV.
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

**Option A — Manual setup:**
1. Open the side panel → **Settings**
2. Paste your API key
3. Add your **Recruiter Details** (role title + hiring company name)
4. Click **+ New Role** and define your ICP:
   - **Name**: e.g. `Enterprise AE – Acme`
   - **ICP criteria**: paste your job description or describe what good looks like
   - **What makes this role compelling**: 2-3 sentences — used in outreach
   - **Direct competitors**: comma-separated list
   - **Dimensions**: add weighted scoring dimensions
5. Click **Save**

**Option B — JD upload (recommended):**
1. Click **+ New Role**
2. Drop a JD PDF onto the upload area above the ICP field
3. Role name, ICP criteria, and dimensions are extracted and pre-filled automatically
4. Review, adjust if needed, and click **Save**

### 4. Score a LinkedIn profile
1. Open any LinkedIn profile
2. Click **Score Full Profile** for a quick assessment from the live page
3. Or download the LinkedIn PDF and drag it into the **Option 2** drop zone
4. Results appear in the **Results** tab

### 5. Analyse a GitHub profile
1. Open any GitHub user profile (e.g. `github.com/username`)
2. Click the **GitHub** tab in the side panel
3. First time: complete the one-time token setup (see below)
4. Click **⌥ Scan GitHub Profile**
5. Results include: language breakdown, notable projects, technical summary, outreach hook, and Suitability Fit Signal (if an active role is set)

---

## GitHub setup — Personal Access Token

GitHub limits unauthenticated API requests to 60/hour (~2-3 profiles). A free Personal Access Token raises this to 5,000/hour (~230 profiles).

**Setup (one time, ~2 minutes):**
1. Open the **GitHub** tab in the side panel
2. Follow the 3-step setup card that appears
3. Click **Open GitHub Token Page ↗**
4. Click **Generate new token (classic)** — leave every scope box **unticked**, then click **Generate token**
5. Copy the token shown on screen **(it only appears once)** and paste it into the extension
6. Click **Save & Continue**

Your token is stored locally in your browser only. It is never sent anywhere except GitHub's API.

---

## Scoring options

| Option | How it works | Best for |
|---|---|---|
| **Live LinkedIn scan** | Reads visible profile content from the page | Quick assessment, most candidates |
| **LinkedIn PDF upload** | Reads from the downloaded PDF export — full text, no truncation | Candidates with extensive experience |
| **GitHub scan** | Reads public repos, language data, and profile via GitHub API | Technical validation, engineering candidates |

---

## GitHub Technical Analysis

The GitHub tab produces a **Technical Profile card** with:

- **Contact & Location** — email (if public), location, company, website, Twitter
- **Languages** — bar chart of top 7 languages by byte count across all non-forked repos
- **Notable Projects** — top 5 repos by stars, with descriptions and last updated date
- **Technical Summary** — AI-generated read on what they build and what domains they work in
- **Outreach Hook** — one sentence referencing a specific repo by name
- **Suitability Fit Signal** — tier (Strong / Partial / Weak) + 3 bullets of GitHub evidence against your active role. Includes a caveat: based on public data only, technical signals only.

Each section has a **Copy** button. **Copy All** produces a single formatted block ready to paste into a notes field or ATS.

**Important:** GitHub profiles only surface public activity. Senior engineers often have their best work in private or company repos. Use GitHub data as a technical validation signal alongside LinkedIn, not a replacement for it.

---

## Evidence levels

- **Strengths** — confirmed evidence only. Things the candidate has explicitly stated.
- **Gaps** — ICP requirements not evidenced in the profile.
- **Worth Exploring** — contextual signals from employer background that suggest possible relevance but are not confirmed. Flagged as questions to probe, never scored as confirmed evidence.

---

## Outreach generation

After scoring, go to the **Results** tab and scroll to **Draft Outreach**. Select Connection Request or InMail, then click **Generate**.

- **Connection request:** target 150–200 characters, max 280
- **InMail:** target 500–800 characters, max 1,300

**Tips:**
- Add a **tone sample** in Settings — paste a short, direct message you've sent before
- Fill in **What makes this role compelling** per role — 2-3 specific sentences about the opportunity

---

## Shortlist and compare

Scored candidates (LinkedIn and GitHub) are saved to the **Shortlist** tab, grouped by role. You can:

- Filter by source: **All / LinkedIn / GitHub**
- Compare candidates ranked by score
- Expand each candidate to see dimensions, strengths, gaps, and notes
- Export any role's shortlist as a CSV

---

## Development setup

```bash
git clone https://github.com/nunorecruits/sourcing-copilot.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the cloned folder

No build step required — pure HTML, CSS, and vanilla JS.

---

## Privacy

- All profile data is processed locally in your browser
- Profile text is sent to your chosen AI provider (Gemini or OpenAI) using your own API key
- GitHub API requests are made directly from your browser using your own token
- No data is sent to any Sourcing Copilot servers
- No data is stored beyond your browser's local storage
- Full privacy policy: https://github.com/nunorecruits/sourcing-copilot/blob/main/privacy-policy.md

---

## Changelog

### v3.0.3
- **Anthropic Claude Haiku 4.5** — added as a third AI provider option alongside Gemini and OpenAI
- **Save API Key button** — dedicated button below the API key input with confirmation feedback
- **Recruiter details confirmation** — status messages turn green once recruiter details are saved

### v3.0.2
- **GitHub Technical Analysis** — new GitHub tab with full profile scan: language breakdown by byte count, notable projects, technical summary, outreach hook, and Suitability Fit Signal against active role
- **GitHub token setup** — one-time PAT setup flow built into the GitHub tab. Raises API limit from 60 to 5,000 req/hour
- **JD upload** — drop a JD PDF onto the role form to auto-extract role name, ICP criteria, and weighted dimensions
- **Source filters** — filter pills in History and Shortlist to show All / LinkedIn / GitHub entries
- **GitHub history** — GitHub scans saved to History and Shortlist with profile URL linked
- **Suitability Fit Signal** — technical fit tier and evidence bullets generated against active role from GitHub data
- Copy buttons on all GitHub sections plus Copy All

### v3.0.1
- Scoring model switched to Gemini 2.5 Flash with thinking disabled
- Assessment hallucination fix — five-rule evidence framework
- Worth Exploring improved
- Competitor verification rules
- Outreach prompt simplified
- Job title extraction fix
- OpenAI JSON parsing fix

### v3.0.0
- Ask tab removed
- Evidence principle introduced
- Worth Exploring field added
- Two-tier anchor selection for outreach
- Dual model split introduced
- LinkedIn Recruiter support added
- PDF scoring full text, no truncation

### v2.9.5
- InMail character limit increased to 1,100
- Scoring prompt calibration fixes

### v2.9.2
- LinkedIn PDF upload scoring
- URL normalisation fix

### v2.7.0
- Full UI redesign
- Weighted ICP dimensions
- Candidate shortlist with CSV export
- Company analysis

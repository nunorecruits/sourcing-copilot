# Sourcing Copilot

**AI-powered candidate sourcing copilot for recruiters — built directly into LinkedIn.**

Score LinkedIn profiles against your Ideal Candidate Profile, draft personalised outreach, and manage candidate shortlists — all from a Chrome side panel without leaving the page.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-teal?style=flat&logo=googlechrome)](https://chromewebstore.google.com/detail/ffgaljblcpgcamndlegkbbbebnhkjini)
![Version](https://img.shields.io/badge/version-2.9.5-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)

---

## What it does

**Score profiles against your ICP**
Define role criteria and weighted dimensions once. Every LinkedIn profile you open gets scored 0–100 with tier classification (Strong / Potential / Weak), dimension-by-dimension breakdown, strengths, gaps and red flags.

**Upload a LinkedIn PDF for complete accuracy**
LinkedIn truncates long profiles on screen. Export any profile as a PDF and drop it into the extension for a complete assessment — full work history, education, languages and certifications all captured.

**Draft personalised outreach**
Generate a LinkedIn connection request or InMail grounded in the candidate's actual background. Anchors to a specific employer or achievement. Supports tone matching via your own example message.

**Ask anything about the candidate**
After scoring, ask follow-up questions in the Ask tab — the AI has full context from the scorecard, profile text and ICP.

**Scan and analyse companies**
Extract employer names from any profile and run an ICP-fit analysis on each — industry, size, stage, and relevance to your role.

**Build shortlists and export**
Save candidates to role-specific shortlists, compare scores, and export to CSV for reporting or ATS upload.

---

## Getting started

1. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/ffgaljblcpgcamndlegkbbbebnhkjini)
2. Open Settings and add your API key (Gemini or OpenAI)
3. Create a role with your ICP criteria and weighted dimensions
4. Add your name and company
5. Open any LinkedIn profile — Sourcing Copilot auto-detects it and is ready to score

**Supported AI providers:**
- Google Gemini (free tier available — get a key at [aistudio.google.com](https://aistudio.google.com/app/apikey))
- OpenAI GPT-4o mini (requires paid account — get a key at [platform.openai.com](https://platform.openai.com/api-keys))

---

## Installation from source

1. Clone this repo
2. Go to `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo folder

---

## Project structure

```
sourcing-copilot/
├── manifest.json        # Extension manifest (v3)
├── background.js        # Service worker — tab detection, script injection relay
├── content.js           # LinkedIn page extraction
├── sidepanel.html       # Side panel UI
├── sidepanel.js         # All application logic
├── icon16/48/128.png    # Extension icons
└── README.md
```

---

## Privacy

Sourcing Copilot does not collect or transmit any data to the developer. Profile text is sent directly from your browser to your chosen AI provider (Gemini or OpenAI) using your own API key. Nothing passes through our servers.

Full privacy policy: [link to your hosted privacy policy]

---

## Version history

| Version | Notes |
|---|---|
| 2.9.5 | InMail character limit increased to 1,100. Promotion/nested role scoring rule restored. Ask tab context expanded. pdfUtils.js removed. Model reference consolidated. |
| 2.9.2 | PDF upload scoring via LinkedIn PDF export. URL normalisation fix. Gemini 2.5 Flash model. |
| 2.1.0 | Initial Chrome Store release (as ProfileFitCheck) |

---

## Tech stack

- Chrome Extension Manifest V3
- Vanilla JS — no build step, no bundler
- Google Gemini API / OpenAI API
- Chrome Storage API for local persistence

---

## Feedback

Found a bug or have a feature request? Open an issue or use the thumbs down button in the extension to send feedback directly.

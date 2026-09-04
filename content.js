// content.js - Sourcing Copilot
(function() {
  'use strict';

  if (window.__sourcingCopilotLoaded) return;
  window.__sourcingCopilotLoaded = true;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getCandidateName() {
    const selectors = [
      // Standard LinkedIn public profile
      'h1.text-heading-xlarge',
      'h1[class*="inline"]',
      // LinkedIn Recruiter — name sits in these containers
      '.profile-info-card__name-container h1',
      '.profile-info-card__name-container span',
      '[data-anonymize="person-name"]',
      '.artdeco-entity-lockup__title',
      '[class*="profile-topcard"] h1',
      '[class*="profile-topcard"] [class*="name"]',
      '[class*="talent-profile"] h1',
      '[class*="talent-profile"] [class*="name"]',
      // Generic h1 last resort
      'h1'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          // Strip verified badge / suffix text e.g. "· You", "· 1st"
          const name = (el.textContent || '').replace(/\s*·.*$/, '').replace(/\s+/g, ' ').trim();
          if (name && name.length > 1 && name.length < 80) return name;
        }
      } catch(e) {}
    }
    // Title fallback — works for both standard and Recruiter tab titles
    const titleMatch = document.title.match(/^([^|·\-]+)/);
    if (titleMatch) {
      const t = titleMatch[1].trim();
      if (t && t.length > 1 && t.length < 80
          && !t.toLowerCase().includes('linkedin')
          && !t.toLowerCase().includes('recruiter')
          && !t.toLowerCase().includes('talent')) {
        return t;
      }
    }
    return '';
  }

  async function scrollPage() {
    try {
      const totalHeight = document.body.scrollHeight;
      for (let pos = 0; pos < totalHeight + 600; pos += 600) {
        window.scrollTo(0, pos);
        await sleep(120);
      }
      window.scrollTo(0, 0);
      await sleep(400);
    } catch(e) {}
  }

  function extractSection(doc, labelKeywords) {
    try {
      const sections = doc.querySelectorAll('section');
      for (const section of sections) {
        const label = (section.getAttribute('aria-label') || '').toLowerCase();
        if (labelKeywords.some(kw => label.includes(kw))) {
          const t = section.innerText.trim();
          if (t.length > 30) return t;
        }
      }
      const headings = doc.querySelectorAll('h2, h3');
      for (const heading of headings) {
        const text = heading.textContent.trim().toLowerCase();
        if (labelKeywords.some(kw => text.includes(kw))) {
          let el = heading.parentElement;
          for (let i = 0; i < 8; i++) {
            if (!el) break;
            if (el.tagName === 'SECTION') return el.innerText.trim();
            if (el.tagName === 'DIV') {
              const t = el.innerText ? el.innerText.trim() : '';
              if (t.length > 50 && t.length < 12000) return t;
            }
            el = el.parentElement;
          }
        }
      }
    } catch(e) {}
    return '';
  }

  // Fetch with timeout — returns '' on failure
  async function safeFetch(url, timeoutMs = 8000) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        credentials: 'include',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) return '';
      return await res.text();
    } catch(e) {
      return '';
    }
  }

  async function extractProfileText() {
    const url = window.location.href;
    const parts = [];

    // ── LINKEDIN RECRUITER PROFILE PATH ───────────────────────────
    if (url.includes('/talent/profile/')) {
      await scrollPage();

      const name = getCandidateName();
      if (name) parts.push('NAME: ' + name);

      // Recruiter renders everything in a single scrollable main container
      // Try to extract labelled sections first, fall back to full main text
      const sectionMap = [
        { label: 'ABOUT',          keywords: ['about', 'summary'] },
        { label: 'EXPERIENCE',     keywords: ['experience'] },
        { label: 'EDUCATION',      keywords: ['education'] },
        { label: 'SKILLS',         keywords: ['skill'] },
        { label: 'CERTIFICATIONS', keywords: ['licens', 'certif'] },
        { label: 'LANGUAGES',      keywords: ['language'] },
      ];

      let anySectionFound = false;
      for (const { label, keywords } of sectionMap) {
        const text = extractSection(document, keywords);
        if (text) { parts.push('\n--- ' + label + ' ---\n' + text); anySectionFound = true; }
      }

      // Recruiter often renders as a single card rather than sections —
      // if section extraction fails, grab the full main container text
      if (!anySectionFound) {
        const mainEl = document.querySelector('main')
          || document.querySelector('[class*="profile"]')
          || document.body;
        const rawText = mainEl ? mainEl.innerText.trim() : '';
        if (rawText) parts.push('\n' + rawText);
      }

      const extracted = parts.join('\n');
      return extracted.length > 0 ? extracted : (document.querySelector('main') || document.body).innerText.trim();
    }

    // ── DETAILS PAGE PATH ──────────────────────────────────────────
    if (url.includes('/details/experience')) {
      await scrollPage();

      // Get full rendered experience from current page
      const mainEl = document.querySelector('main')
        || document.querySelector('[class*="scaffold-layout__main"]')
        || document.body;
      const expText = mainEl ? mainEl.innerText.trim() : '';

      const name = getCandidateName();
      if (name) parts.push('NAME: ' + name);

      // Try to fetch main profile for other sections
      const profileUrl = url.replace(/\/details\/.*/, '/');
      const html = await safeFetch(profileUrl, 6000);

      if (html && html.length > 1000) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        ['script','style','nav','header','footer'].forEach(tag => {
          try { doc.querySelectorAll(tag).forEach(el => el.remove()); } catch(e) {}
        });

        const about    = extractSection(doc, ['about']);
        const edu      = extractSection(doc, ['education']);
        const skills   = extractSection(doc, ['skill']);
        const certs    = extractSection(doc, ['licens', 'certif']);
        const langs    = extractSection(doc, ['language']);

        if (about)  parts.push('\n--- ABOUT ---\n' + about);
        if (expText) parts.push('\n--- EXPERIENCE ---\n' + expText.substring(0, 10000));
        if (edu)    parts.push('\n--- EDUCATION ---\n' + edu);
        if (skills) parts.push('\n--- SKILLS ---\n' + skills);
        if (certs)  parts.push('\n--- CERTIFICATIONS ---\n' + certs);
        if (langs)  parts.push('\n--- LANGUAGES ---\n' + langs);
      } else {
        // Fetch failed — just return the experience we have
        if (expText) parts.push('\n--- EXPERIENCE ---\n' + expText.substring(0, 10000));
      }

      return parts.join('\n');
    }

    // ── MAIN PROFILE PAGE PATH ─────────────────────────────────────
    await scrollPage();

    const name = getCandidateName();
    if (name) parts.push('NAME: ' + name);

    for (const sel of ['.text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium']) {
      const el = document.querySelector(sel);
      if (el) {
        const ht = el.textContent.trim();
        if (ht && ht !== name && ht.length > 5) { parts.push('HEADLINE: ' + ht); break; }
      }
    }
    for (const sel of ['.text-body-small.inline.t-black--light.break-words']) {
      const el = document.querySelector(sel);
      if (el) { parts.push('LOCATION: ' + el.textContent.trim()); break; }
    }

    const sectionMap = [
      { label: 'ABOUT',          keywords: ['about'] },
      { label: 'EXPERIENCE',     keywords: ['experience'] },
      { label: 'EDUCATION',      keywords: ['education'] },
      { label: 'CERTIFICATIONS', keywords: ['licens', 'certif'] },
      { label: 'LANGUAGES',      keywords: ['language'] },
      { label: 'SKILLS',         keywords: ['skill'] },
      { label: 'VOLUNTEER',      keywords: ['volunteer'] },
      { label: 'AWARDS',         keywords: ['award', 'honor', 'honour'] },
    ];

    for (const { label, keywords } of sectionMap) {
      const text = extractSection(document, keywords);
      if (text) parts.push('\n--- ' + label + ' ---\n' + text);
    }

    const extracted = parts.join('\n');
    if (extracted.length < 300) {
      const main = document.querySelector('main') || document.body;
      return main ? main.innerText.trim() : '';
    }
    return extracted;
  }

  function extractEmployersFromDOM() {
    const employers = {};

    // Only look for company links inside elements that LinkedIn uses for experience entries
    // These selectors target the experience section specifically
    const experienceSelectors = [
      // Standard profile experience section
      'section[data-section="experience"]',
      'section#experience-section',
      // Aria-labelled sections
      'section[aria-label*="experience" i]',
      'section[aria-label*="Experience" i]',
      // pvs-list pattern used in newer LinkedIn UI
      '.pvs-list__container',
    ];

    let experienceContainer = null;
    for (const sel of experienceSelectors) {
      const el = document.querySelector(sel);
      if (el) { experienceContainer = el; break; }
    }

    // If we can't find a reliable experience container, return empty
    // -- fall through to text-based extraction
    if (!experienceContainer) return employers;

    // Only extract company links from within the experience container
    const companyAnchors = experienceContainer.querySelectorAll('a[href*="/company/"]');

    companyAnchors.forEach(a => {
      const href = a.href || '';
      const companySlug = href.match(/linkedin\.com\/company\/([^/?#]+)/)?.[1];
      if (!companySlug) return;

      const name = (
        a.getAttribute('aria-label') ||
        a.querySelector('span[aria-hidden="true"]')?.textContent ||
        a.textContent
      ).trim().replace(/\s+/g, ' ');

      if (name && name.length > 1 && name.length < 100) {
        employers[name] = `https://www.linkedin.com/company/${companySlug}/`;
      }
    });

    return employers;
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractCompanies') {
      // Only handle on LinkedIn -- GitHub has its own listener
      if (!window.location.hostname.includes('linkedin.com')) return false;
      const pageTitle = document.title;
      const url = window.location.href;
      const candidateName = getCandidateName();
      const isLinkedIn = window.location.hostname.includes('linkedin.com');

      // Extract employers from DOM immediately -- this is more reliable than model extraction
      const domEmployers = extractEmployersFromDOM();
      const domCompanyNames = Object.keys(domEmployers);

      // Wrap everything in try/catch with a hard timeout fallback
      const hardTimeout = setTimeout(() => {
        sendResponse({
          pageText: (document.querySelector('main') || document.body).innerText.trim().substring(0, 18000),
          pageTitle, candidateName, isLinkedIn, url,
          companyLinks: domEmployers,
          companies: domCompanyNames
        });
      }, 20000);

      extractProfileText()
        .then(pageText => {
          clearTimeout(hardTimeout);
          sendResponse({
            pageText: pageText.substring(0, 18000),
            pageTitle, candidateName, isLinkedIn, url,
            companyLinks: domEmployers,
            companies: domCompanyNames
          });
        })
        .catch(() => {
          clearTimeout(hardTimeout);
          const fallback = (document.querySelector('main') || document.body).innerText.trim();
          sendResponse({
            pageText: fallback.substring(0, 18000),
            pageTitle, candidateName, isLinkedIn, url,
            companyLinks: domEmployers,
            companies: domCompanyNames
          });
        });

      return true;
    }
    return true;
  });

})();

// ── GITHUB PROFILE EXTRACTION ─────────────────────────────────────────────────
(function() {
  if (!window.location.hostname.includes('github.com')) return;

  // Only run on user profile pages e.g. github.com/username (not repos, issues etc.)
  const path = window.location.pathname;
  const isUserProfile = /^\/[^/]+\/?$/.test(path);
  if (!isUserProfile) return;

  function extractGitHubProfile() {
    const parts = [];

    // Name
    const nameEl = document.querySelector('[itemprop="name"], .p-name');
    const name = nameEl ? nameEl.textContent.trim() : '';
    if (name) parts.push('NAME: ' + name);

    // Username
    const loginEl = document.querySelector('[itemprop="additionalName"], .p-nickname');
    const login = loginEl ? loginEl.textContent.trim() : window.location.pathname.replace('/', '').split('/')[0];
    if (login) parts.push('USERNAME: ' + login);

    // Bio
    const bioEl = document.querySelector('[data-bio-text], .p-note, .user-profile-bio');
    const bio = bioEl ? bioEl.textContent.trim() : '';
    if (bio) parts.push('BIO: ' + bio);

    // Company
    const companyEl = document.querySelector('[itemprop="worksFor"], .p-org');
    const company = companyEl ? companyEl.textContent.trim() : '';
    if (company) parts.push('COMPANY: ' + company);

    // Location
    const locationEl = document.querySelector('[itemprop="homeLocation"], .p-label');
    const location = locationEl ? locationEl.textContent.trim() : '';
    if (location) parts.push('LOCATION: ' + location);

    // Website / social links
    const websiteEl = document.querySelector('[itemprop="url"] a, .Link--primary[rel="nofollow me"]');
    if (websiteEl) parts.push('WEBSITE: ' + websiteEl.textContent.trim());

    // Followers / Following
    const followersEl = document.querySelector('a[href$="?tab=followers"] .text-bold');
    const followingEl = document.querySelector('a[href$="?tab=following"] .text-bold');
    if (followersEl) parts.push('FOLLOWERS: ' + followersEl.textContent.trim());
    if (followingEl) parts.push('FOLLOWING: ' + followingEl.textContent.trim());

    // Pinned repositories
    const pinnedItems = document.querySelectorAll('.pinned-item-list-item');
    if (pinnedItems.length > 0) {
      parts.push('\n--- PINNED REPOSITORIES ---');
      pinnedItems.forEach(item => {
        const repoName = item.querySelector('.repo') || item.querySelector('[class*="repo"]');
        const repoDesc = item.querySelector('p.pinned-item-desc, .pinned-item-list-item-content p');
        const repoLang = item.querySelector('[itemprop="programmingLanguage"]');
        const repoStars = item.querySelector('a[href*="stargazers"]');
        const repoForks = item.querySelector('a[href*="forks"]');

        let repoLine = '';
        if (repoName) repoLine += repoName.textContent.trim();
        if (repoDesc) repoLine += ' — ' + repoDesc.textContent.trim();
        if (repoLang) repoLine += ' [' + repoLang.textContent.trim() + ']';
        if (repoStars) repoLine += ' ★' + repoStars.textContent.trim();
        if (repoForks) repoLine += ' forks:' + repoForks.textContent.trim();
        if (repoLine) parts.push(repoLine);
      });
    }

    // Popular repositories (if no pinned)
    if (pinnedItems.length === 0) {
      const popularRepos = document.querySelectorAll('.source[itemprop="owns"]');
      if (popularRepos.length > 0) {
        parts.push('\n--- REPOSITORIES ---');
        Array.from(popularRepos).slice(0, 6).forEach(repo => {
          const rName = repo.querySelector('[itemprop="name codeRepository"]');
          const rDesc = repo.querySelector('[itemprop="description"]');
          const rLang = repo.querySelector('[itemprop="programmingLanguage"]');
          let line = '';
          if (rName) line += rName.textContent.trim();
          if (rDesc) line += ' — ' + rDesc.textContent.trim();
          if (rLang) line += ' [' + rLang.textContent.trim() + ']';
          if (line) parts.push(line);
        });
      }
    }

    // Organisations
    const orgs = document.querySelectorAll('a[data-hovercard-type="organization"]');
    if (orgs.length > 0) {
      const orgNames = Array.from(orgs).map(o => o.getAttribute('aria-label') || o.textContent.trim()).filter(Boolean);
      if (orgNames.length) parts.push('\n--- ORGANISATIONS ---\n' + orgNames.join(', '));
    }

    // Contribution summary (if visible)
    const contribEl = document.querySelector('.js-yearly-contributions h2, [class*="ContributionCalendar"] h2');
    if (contribEl) parts.push('\nCONTRIBUTIONS: ' + contribEl.textContent.trim().replace(/\s+/g, ' '));

    // README / profile readme (if rendered)
    const readmeEl = document.querySelector('.markdown-body');
    if (readmeEl) {
      const readmeText = readmeEl.innerText.trim().substring(0, 3000);
      if (readmeText) parts.push('\n--- PROFILE README ---\n' + readmeText);
    }

    return parts.join('\n');
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractCompanies') {
      const pageText = extractGitHubProfile();
      const nameEl = document.querySelector('[itemprop="name"], .p-name');
      const candidateName = nameEl ? nameEl.textContent.trim() : '';

      // Scrape email from DOM -- API often returns null even when email is visible on profile
      let domEmail = '';
      // Try itemprop first, then any mailto link in the profile sidebar
      const emailPropEl = document.querySelector('[itemprop="email"]');
      if (emailPropEl) {
        domEmail = emailPropEl.textContent.trim();
      } else {
        const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
        for (const link of mailtoLinks) {
          const addr = link.href.replace('mailto:', '').trim();
          // Exclude GitHub noreply addresses
          if (addr && !addr.includes('noreply.github.com')) {
            domEmail = addr;
            break;
          }
        }
      }

      sendResponse({
        pageText: pageText.substring(0, 18000),
        pageTitle: document.title,
        candidateName,
        isLinkedIn: false,
        isGitHub: true,
        domEmail,
        url: window.location.href,
        companyLinks: {},
        companies: []
      });
      return true;
    }
    return true;
  });
})();

// background.js - Sourcing Copilot service worker

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const isLinkedInProfile = tab.url?.includes('linkedin.com/in/') || tab.url?.includes('linkedin.com/talent/') || tab.url?.includes('linkedin.com/recruiter/');
  const isGitHubProfile = tab.url && /https:\/\/github\.com\/[^/]+\/?([?#].*)?$/.test(tab.url);
  if (changeInfo.status === 'complete' && (isLinkedInProfile || isGitHubProfile)) {
    chrome.runtime.sendMessage({ action: 'linkedinProfileLoaded', tabId, url: tab.url }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getPageData') {
    const tabId = msg.tabId;
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
      .then(() => {
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { action: 'extractCompanies' }, (resp) => {
            if (chrome.runtime.lastError) {
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              sendResponse(resp);
            }
          });
        }, 150);
      })
      .catch(() => {
        chrome.tabs.sendMessage(tabId, { action: 'extractCompanies' }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse(resp);
          }
        });
      });
    return true;
  }
});

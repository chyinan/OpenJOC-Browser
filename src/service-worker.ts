// pattern: Imperative Shell

// The MV3 service worker only opens the durable local player page. It does not
// own decoder, PCM queue, or realtime audio state.
chrome.action.onClicked.addListener((): void => {
  chrome.tabs.create({url: chrome.runtime.getURL('player.html')});
});

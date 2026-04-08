chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "deep-research:get-page-context") {
    return;
  }

  const heading = document.querySelector("h1")?.textContent?.trim() ?? null;

  sendResponse({
    title: document.title,
    heading,
    url: window.location.href
  });
});

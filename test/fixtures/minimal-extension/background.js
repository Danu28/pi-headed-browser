chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GET_STATE') {
    sendResponse({schema:'test', project:'minimal', pages:[{url:'background'}], actions:[], summary:{pageCount:1}});
    return true;
  }
  if (msg && msg.type === 'PING') { sendResponse({pong:true}); return true; }
});

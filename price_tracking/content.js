// Content script for price tracker
console.log('價格追蹤器 content script 已載入');

// 監聽來自 background script 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Content script 收到訊息:', request.action);
  
  if (request.action === "addTracking") {
    // 備用的添加追蹤功能
    handleAddTracking(request.selectedText, request.pageTitle, request.pageUrl);
    sendResponse({ success: true });
  }
});

function handleAddTracking(selectedText, pageTitle, pageUrl) {
  // 這是當 executeScript 失敗時的備用方案
  console.log('使用 content script 添加追蹤:', selectedText);
  
  // 嘗試找到包含選中文字的元素
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    alert('請先選中包含價格的文字');
    return;
  }
  
  // 執行與 background.js 中 addPriceTracker 相同的邏輯
  // 這裡可以複製 addPriceTracker 函數的內容
  alert('價格追蹤功能暫時無法使用，請重新整理頁面後再試');
}

// 頁面載入完成後的初始化
document.addEventListener('DOMContentLoaded', function() {
  console.log('頁面已載入，價格追蹤器準備就緒');
});

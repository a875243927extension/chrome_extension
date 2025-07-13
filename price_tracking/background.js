// 安裝和初始化
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: "addPriceTracker",
    title: "加入價格追蹤",
    contexts: ["selection"]
  });
  
  const settings = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1
  });
  
  if (settings.autoRefreshEnabled) {
    await setupAutoRefresh(settings.autoRefreshInterval);
  }
  
  checkPriceAlerts();
});

// 右鍵選單處理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "addPriceTracker") {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: addPriceTracker,
        args: [info.selectionText, tab.title, tab.url]
      });
    } catch (error) {
      console.error('腳本注入失敗:', error);
    }
  }
});

// 價格追蹤添加函數
function addPriceTracker(selectedText, pageTitle, pageUrl) {
  const selectedPrice = parsePrice(selectedText);
  if (selectedPrice <= 0) {
    alert('無法識別價格，請重新選擇');
    return;
  }
  
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    alert('請先選中包含價格的文字');
    return;
  }
  
  const range = selection.getRangeAt(0);
  const element = findBestPriceElement(range, selectedPrice);
  
  if (!element) {
    alert('找不到價格元素');
    return;
  }
  
  const selectorInfo = generateSelectors(element);
  const alertPrice = prompt(`檢測到價格: $${selectedPrice}\n\n設定目標價格（留空不設定）:`, '');
  const targetPrice = alertPrice && !isNaN(parseFloat(alertPrice)) ? parseFloat(alertPrice) : null;
  
  const trackItem = {
    id: Date.now().toString(),
    title: pageTitle,
    url: pageUrl,
    domain: new URL(pageUrl).hostname,
    xpath: selectorInfo.xpath,
    selector: selectorInfo.css,
    selectedText: selectedText,
    fullElementText: element.textContent.trim(),
    initialPrice: selectedPrice,
    currentPrice: selectedPrice,
    targetPrice: targetPrice,
    alertTriggered: false,
    lastUpdated: new Date().toISOString(),
    priceHistory: [{ 
      price: selectedPrice, 
      date: new Date().toISOString(),
      fullText: element.textContent.trim()
    }]
  };
  
  chrome.storage.local.get({ trackingItems: [] }, (result) => {
    const items = result.trackingItems;
    items.push(trackItem);
    chrome.storage.local.set({ trackingItems: items }, () => {
      if (chrome.runtime.lastError) {
        alert('儲存失敗: ' + chrome.runtime.lastError.message);
        return;
      }
      alert(`價格追蹤已加入！\n價格: $${selectedPrice}`);
    });
  });
  
  // 找到最佳價格元素
  function findBestPriceElement(range, targetPrice) {
    let container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement;
    }
    
    let current = container;
    let bestElement = null;
    let bestScore = -1;
    
    for (let i = 0; i < 5 && current; i++) {
      const text = current.textContent || '';
      const prices = extractPrices(text);
      
      if (prices.some(price => Math.abs(price - targetPrice) < 0.01)) {
        let score = 0;
        if (text.length < 50) score += 20;
        else if (text.length < 100) score += 15;
        else if (text.length < 200) score += 10;
        
        const tagName = current.tagName.toLowerCase();
        if (['span', 'strong', 'b'].includes(tagName)) score += 15;
        else if (['div', 'p'].includes(tagName)) score += 10;
        
        const className = (current.className || '').toLowerCase();
        if (/price|cost|amount|value/.test(className)) score += 10;
        
        score += (5 - i) * 2;
        
        if (score > bestScore) {
          bestScore = score;
          bestElement = current;
        }
      }
      current = current.parentElement;
    }
    
    return bestElement;
  }
  
  // 生成選擇器
  function generateSelectors(element) {
    const xpath = generateXPath(element);
    const css = generateCSSSelector(element);
    return { xpath, css };
  }
  
  // 生成相對XPath
  function generateXPath(element) {
    const parts = [];
    let current = element;
    let foundIdElement = false;
    
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id && !foundIdElement) {
        // 找到ID元素，作為錨點
        parts.unshift(`*[@id="${current.id}"]`);
        foundIdElement = true;
        break;
      } else {
        let part = current.tagName.toLowerCase();
        
        // 計算在父元素中的位置
        if (current.parentNode) {
          const siblings = Array.from(current.parentNode.children);
          const index = siblings.indexOf(current) + 1;
          
          // 只有當有多個子元素時才加索引
          if (siblings.length > 1) {
            part = `${part}[${index}]`;
          }
        }
        
        parts.unshift(part);
      }
      
      current = current.parentElement;
      
      // 避免路徑過長，最多向上查找10層
      if (parts.length >= 10) break;
    }
    
    return '//' + parts.join('/');
  }
  
  // 生成CSS選擇器
  function generateCSSSelector(element) {
    const parts = [];
    let current = element;
    
    while (current && current.parentElement && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      
      if (current.id) {
        parts.unshift(`#${CSS.escape(current.id)}`);
        break;
      }
      
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current) + 1;
      
      if (siblings.length > 1) {
        part += `:nth-child(${index})`;
      }
      
      parts.unshift(part);
      current = current.parentElement;
    }
    
    return parts.join(' > ');
  }
  
  // 提取價格
  function extractPrices(text) {
    const prices = [];
    const patterns = [
      /(?:NT\$?|USD?\$?|\$|￥|¥|€|£|₩)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
      /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:元|円|圓|块|塊)/gi,
      /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)\b/g,
      /\b([0-9]+\.[0-9]{1,2})\b/g,
      /\b([0-9]{3,})\b/g
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const number = parseFloat(match[1].replace(/,/g, ''));
        if (number > 0 && number < 10000000) {
          prices.push(number);
        }
      }
    }
    
    return [...new Set(prices)];
  }
  
  // 解析價格
  function parsePrice(text) {
    if (!text) return 0;
    const prices = extractPrices(text);
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];
    
    const scored = prices.map(price => {
      let score = 0;
      if (price >= 10 && price <= 100000) score += 10;
      if (price % 1 !== 0) score += 5;
      if (price < 1 || price > 1000000) score -= 10;
      return { price, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    return scored[0].price;
  }
}

// 訊息處理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updatePrice") {
    updateItemPrice(request.item).then(sendResponse);
    return true;
  }
  
  if (request.action === "refreshAllPrices") {
    refreshAllPrices().then(sendResponse);
    return true;
  }
  
  if (request.action === "getAutoRefreshStatus") {
    getAutoRefreshStatus().then(sendResponse);
    return true;
  }
  
  if (request.action === "setAutoRefresh") {
    setupAutoRefresh(request.enabled ? request.interval : 0)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// 更新單項價格 - 使用 scripting API
async function updateItemPrice(item) {
  try {
    // 創建一個新的標籤頁來解析價格
    const tab = await chrome.tabs.create({ 
      url: item.url, 
      active: false 
    });
    
    // 等待頁面載入完成
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('頁面載入超時'));
      }, 30000); // 30秒超時
      
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    
    // 在頁面中執行價格解析
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: extractPriceFromPage,
      args: [item]
    });
    
    // 關閉標籤頁
    await chrome.tabs.remove(tab.id);
    
    if (results && results[0] && results[0].result) {
      return results[0].result;
    } else {
      return { success: false, error: '無法解析價格' };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 在目標頁面中執行的價格提取函數
function extractPriceFromPage(item) {
  let element = null;
  let price = 0;
  
  // 嘗試XPath
  if (item.xpath) {
    try {
      const result = document.evaluate(
        item.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      
      if (result.singleNodeValue) {
        element = result.singleNodeValue;
        price = extractBestPrice(element.textContent, item.initialPrice);
      }
    } catch (e) {
      console.warn('XPath失敗:', e);
    }
  }
  
  // 嘗試CSS選擇器
  if ((!element || price <= 0) && item.selector) {
    try {
      const elements = document.querySelectorAll(item.selector);
      if (elements.length > 0) {
        element = elements[0];
        price = extractBestPrice(element.textContent, item.initialPrice);
      }
    } catch (e) {
      console.warn('CSS選擇器失敗:', e);
    }
  }
  
  // 智能搜索
  if (!element || price <= 0) {
    const searchResult = intelligentPriceSearch(item.initialPrice, item.fullElementText);
    if (searchResult) {
      element = searchResult.element;
      price = searchResult.price;
    }
  }
  
  if (price > 0) {
    return {
      success: true,
      price: price,
      fullText: element ? element.textContent.trim() : '',
      confidence: calculateConfidence(price, item.initialPrice)
    };
  } else {
    return {
      success: false,
      error: '找不到價格'
    };
  }
  
  // 智能價格搜索
  function intelligentPriceSearch(targetPrice, originalText) {
    const allElements = document.querySelectorAll('*');
    let bestMatch = null;
    let bestScore = 0;
    
    for (const element of allElements) {
      if (['script', 'style', 'noscript'].includes(element.tagName.toLowerCase())) continue;
      
      const text = element.textContent || '';
      if (text.length > 300 || text.length < 5) continue;
      
      const prices = extractAllPrices(text);
      for (const price of prices) {
        const priceDiff = Math.abs(price - targetPrice) / targetPrice;
        if (priceDiff < 2) { // 價格差異在200%以內
          const textSim = calculateSimilarity(text, originalText);
          const score = (1 - Math.min(priceDiff, 1)) * 0.7 + textSim * 0.3;
          
          if (score > bestScore && score > 0.3) { // 最低信心度門檻
            bestScore = score;
            bestMatch = { element, price };
          }
        }
      }
    }
    
    return bestMatch;
  }
  
  // 提取最佳價格
  function extractBestPrice(text, referencePrice) {
    const prices = extractAllPrices(text);
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];
    
    // 找到與參考價格最接近的價格
    let bestPrice = prices[0];
    let minDiff = Math.abs(prices[0] - referencePrice);
    
    for (const price of prices) {
      const diff = Math.abs(price - referencePrice);
      if (diff < minDiff) {
        minDiff = diff;
        bestPrice = price;
      }
    }
    
    return bestPrice;
  }
  
  // 提取所有價格
  function extractAllPrices(text) {
    const prices = [];
    const patterns = [
      /(?:NT\$?|USD?\$?|\$|￥|¥|€|£|₩)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
      /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:元|円|圓|块|塊)/gi,
      /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)\b/g,
      /\b([0-9]+\.[0-9]{1,2})\b/g,
      /\b([0-9]{3,})\b/g
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const number = parseFloat(match[1].replace(/,/g, ''));
        if (number > 0 && number < 10000000) {
          prices.push(number);
        }
      }
    }
    
    return [...new Set(prices)];
  }
  
  // 計算相似度
  function calculateSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    const clean1 = text1.toLowerCase().trim();
    const clean2 = text2.toLowerCase().trim();
    if (clean1 === clean2) return 1;
    if (clean1.includes(clean2) || clean2.includes(clean1)) return 0.8;
    
    const words1 = clean1.split(/\s+/);
    const words2 = clean2.split(/\s+/);
    const common = words1.filter(w => words2.includes(w));
    return common.length / Math.max(words1.length, words2.length);
  }
  
  // 計算信心度
  function calculateConfidence(newPrice, originalPrice) {
    const diff = Math.abs(newPrice - originalPrice) / originalPrice;
    return Math.max(0, 1 - diff);
  }
}

// 刷新所有價格
async function refreshAllPrices() {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    
    if (items.length === 0) {
      return { success: true, message: '沒有追蹤項目' };
    }
    
    let successCount = 0;
    let errorCount = 0;
    let alertCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      try {
        const updateResult = await updateItemPrice(item);
        
        if (updateResult.success) {
          const oldPrice = item.currentPrice;
          item.currentPrice = updateResult.price;
          item.lastUpdated = new Date().toISOString();
          item.fullElementText = updateResult.fullText;
          
          // 更新價格歷史
          item.priceHistory = item.priceHistory || [];
          item.priceHistory.push({
            price: updateResult.price,
            date: new Date().toISOString(),
            fullText: updateResult.fullText
          });
          
          // 保持歷史記錄在合理範圍內
          if (item.priceHistory.length > 50) {
            item.priceHistory = item.priceHistory.slice(-50);
          }
          
          // 檢查價格提醒
          if (item.targetPrice && updateResult.price <= item.targetPrice && !item.alertTriggered) {
            item.alertTriggered = true;
            alertCount++;
          } else if (item.targetPrice && updateResult.price > item.targetPrice) {
            item.alertTriggered = false;
          }
          
          successCount++;
        } else {
          console.error(`更新失敗 ${item.title}:`, updateResult.error);
          errorCount++;
        }
        
        // 延遲避免請求過頻
        if (i < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
      } catch (error) {
        console.error(`處理項目失敗 ${item.title}:`, error);
        errorCount++;
      }
    }
    
    // 儲存更新後的數據
    await chrome.storage.local.set({ trackingItems: items });
    await updateBadgeAndAlerts();
    
    return {
      success: true,
      successCount,
      errorCount,
      alertCount,
      message: `完成! 成功: ${successCount}, 失敗: ${errorCount}${alertCount > 0 ? `, 提醒: ${alertCount}` : ''}`
    };
    
  } catch (error) {
    console.error('刷新所有價格失敗:', error);
    return { success: false, error: error.message };
  }
}

// 檢查價格提醒
async function checkPriceAlerts() {
  await updateBadgeAndAlerts();
}

// 更新徽章和提醒
async function updateBadgeAndAlerts() {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    
    const alertItems = items.filter(item => 
      item.targetPrice && 
      item.currentPrice <= item.targetPrice && 
      item.alertTriggered
    );
    
    if (alertItems.length > 0) {
      await chrome.action.setBadgeText({ text: alertItems.length.toString() });
      await chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (error) {
    console.error('更新徽章失敗:', error);
  }
}

// 自動更新功能
async function getAutoRefreshStatus() {
  return await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1,
    lastAutoRefresh: null
  });
}

async function setupAutoRefresh(intervalHours) {
  // 清除現有的鬧鐘
  await chrome.alarms.clear('autoRefresh');
  
  // 儲存設置
  await chrome.storage.local.set({
    autoRefreshEnabled: intervalHours > 0,
    autoRefreshInterval: intervalHours
  });
  
  // 設置新的鬧鐘
  if (intervalHours > 0) {
    await chrome.alarms.create('autoRefresh', {
      delayInMinutes: intervalHours * 60,
      periodInMinutes: intervalHours * 60
    });
  }
}

// 鬧鐘處理
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoRefresh') {
    const settings = await chrome.storage.local.get({
      autoRefreshEnabled: false,
      trackingItems: []
    });
    
    if (settings.autoRefreshEnabled && settings.trackingItems.length > 0) {
      try {
        const result = await refreshAllPrices();
        
        // 記錄最後自動更新時間
        await chrome.storage.local.set({
          lastAutoRefresh: new Date().toISOString()
        });
        
        // 如果有價格提醒，發送通知
        if (result.success && result.alertCount > 0) {
          try {
            await chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icon48.png',
              title: '價格追蹤器 - 價格提醒',
              message: `有 ${result.alertCount} 個商品達到目標價格！`
            });
          } catch (e) {
            console.error('發送通知失敗:', e);
          }
        }
        
        console.log('自動更新完成:', result.message);
      } catch (error) {
        console.error('自動更新失敗:', error);
      }
    }
  }
});

// 擴展啟動時恢復設置
chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1
  });
  
  if (settings.autoRefreshEnabled) {
    await setupAutoRefresh(settings.autoRefreshInterval);
  }
  
  await checkPriceAlerts();
});

// 處理通知點擊
chrome.notifications.onClicked.addListener(async (notificationId) => {
  // 打開擴展的彈出視窗
  chrome.action.openPopup();
});

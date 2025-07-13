// 安裝和初始化
chrome.runtime.onInstalled.addListener(async () => {
  // 創建右鍵選單
  chrome.contextMenus.create({
    id: "addPriceTracker",
    title: "加入價格追蹤",
    contexts: ["selection"]
  });
  
  console.log('右鍵選單已創建');
  
  // 檢查並恢復自動更新設置
  const settings = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1
  });
  
  if (settings.autoRefreshEnabled) {
    await setupAutoRefresh(settings.autoRefreshInterval);
  }
});

// 處理右鍵選單點擊
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('右鍵選單被點擊:', info.menuItemId);
  
  if (info.menuItemId === "addPriceTracker") {
    try {
      // 注入並執行腳本
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: addPriceTracker,
        args: [info.selectionText, tab.title, tab.url]
      });
      
      console.log('腳本注入成功');
    } catch (error) {
      console.error('腳本注入失敗:', error);
      
      // 如果注入失敗，嘗試發送訊息給 content script
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: "addTracking",
          selectedText: info.selectionText,
          pageTitle: tab.title,
          pageUrl: tab.url
        });
      } catch (msgError) {
        console.error('發送訊息也失敗:', msgError);
      }
    }
  }
});

// 在頁面中執行的函數
function addPriceTracker(selectedText, pageTitle, pageUrl) {
  console.log('addPriceTracker 開始執行');
  console.log('選中文字:', selectedText);
  
  // 獲取選中元素的 selector
  const selection = window.getSelection();
  if (selection.rangeCount === 0) {
    alert('請先選中包含價格的文字');
    return;
  }
  
  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer.nodeType === Node.TEXT_NODE 
    ? range.commonAncestorContainer.parentElement 
    : range.commonAncestorContainer;
  
  console.log('找到元素:', element);
  
  // 生成多個選擇器
  const selectorInfo = generateSelector(element);
  console.log('生成的選擇器信息:', selectorInfo);
  
  // 抓取整個元素的文字內容進行價格分析
  const fullElementText = element.textContent || element.innerText || '';
  const extractedPrice = parsePrice(fullElementText);
  
  // 如果從完整文字中提取不到價格，則使用選中的文字
  const selectedPrice = parsePrice(selectedText);
  const finalPrice = extractedPrice > 0 ? extractedPrice : selectedPrice;
  
  console.log('解析的價格:', finalPrice);
  
  if (finalPrice <= 0) {
    alert('無法從選中的文字中識別價格，請確認選中的內容包含價格資訊');
    return;
  }
  
  // 創建追蹤項目，包含多個選擇器
  const trackItem = {
    id: Date.now().toString(),
    title: pageTitle,
    url: pageUrl,
    domain: new URL(pageUrl).hostname,
    selector: selectorInfo.primary,
    alternativeSelectors: selectorInfo.alternatives,
    allSelectors: selectorInfo.all,
    selectedText: selectedText,
    fullElementText: fullElementText.trim(),
    initialPrice: finalPrice,
    currentPrice: finalPrice,
    lastUpdated: new Date().toISOString(),
    priceHistory: [{ 
      price: finalPrice, 
      date: new Date().toISOString(),
      fullText: fullElementText.trim()
    }]
  };
  
  console.log('創建的追蹤項目:', trackItem);
  
  // 儲存到 Chrome storage
  chrome.storage.local.get({ trackingItems: [] }, (result) => {
    const items = result.trackingItems;
    items.push(trackItem);
    chrome.storage.local.set({ trackingItems: items }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存失敗:', chrome.runtime.lastError);
        alert('儲存失敗: ' + chrome.runtime.lastError.message);
        return;
      }
      
      // 顯示更詳細的確認訊息
      const message = `價格追蹤已加入！\n` +
                     `檢測到的價格: $${finalPrice}\n` +
                     `主選擇器: ${selectorInfo.primary}\n` +
                     `備用選擇器數量: ${selectorInfo.alternatives.length}`;
      alert(message);
      
      console.log('價格追蹤項目已成功儲存');
    });
  });
  
  // 改進的選擇器生成函數
  function generateSelector(element) {
    const selectors = [];
    
    // 方法1: ID選擇器（最穩定）
    if (element.id) {
      selectors.push(`#${element.id}`);
    }
    
    // 方法2: 基本標籤+類別
    let basicSelector = element.tagName.toLowerCase();
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ')
        .filter(c => c.trim() && !c.match(/^(active|selected|hover|focus|loading|animate|transition)/i))
        .slice(0, 3); // 只取前3個穩定的類別
      
      if (classes.length > 0) {
        selectors.push(basicSelector + '.' + classes.join('.'));
      }
    }
    selectors.push(basicSelector);
    
    // 方法3: 屬性選擇器
    const attributes = ['data-price', 'data-value', 'data-cost', 'data-amount', 'itemprop'];
    for (const attr of attributes) {
      if (element.hasAttribute(attr)) {
        selectors.push(`[${attr}="${element.getAttribute(attr)}"]`);
      }
    }
    
    // 方法4: 父子關係選擇器
    let parent = element.parentElement;
    if (parent) {
      let parentSelector = parent.tagName.toLowerCase();
      if (parent.id) {
        parentSelector += `#${parent.id}`;
      } else if (parent.className) {
        const parentClasses = parent.className.split(' ')
          .filter(c => c.trim() && !c.match(/^(active|selected|hover|focus)/i))
          .slice(0, 2);
        if (parentClasses.length > 0) {
          parentSelector += '.' + parentClasses.join('.');
        }
      }
      
      selectors.push(`${parentSelector} > ${basicSelector}`);
      selectors.push(`${parentSelector} ${basicSelector}`);
    }
    
    // 方法5: 位置選擇器
    const siblings = Array.from(element.parentElement?.children || []);
    const index = siblings.indexOf(element);
    if (index >= 0) {
      selectors.push(`${element.parentElement?.tagName.toLowerCase()} > :nth-child(${index + 1})`);
    }
    
    // 返回主選擇器和備用選擇器
    return {
      primary: selectors[0] || basicSelector,
      alternatives: selectors.slice(1),
      all: selectors
    };
  }
  
  // 更寬容的價格解析函數
  function parsePrice(text) {
    if (!text || typeof text !== 'string') return 0;
    
    // 清理文字，保留數字、逗號、小數點和常見符號
    const cleanText = text.replace(/\s+/g, ' ').trim();
    
    // 找出所有可能的數字（包含各種格式）
    const numberPatterns = [
      // 帶貨幣符號的數字: $1,234.56, NT$1,234, ￥1234 等
      /(?:NT\$?|USD?\$?|\$|￥|¥|€|£|₩|₪|₹|R\$?|₽|₦|₨|₱|₫|₡|₲|₴|₵|₸|₼|₾|₿|＄)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
      
      // 數字+元/円等單位: 1,234元, 1234円
      /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:元|円|圓|块|塊|원|₩)/gi,
      
      // 純數字（有逗號分隔）: 1,234.56
      /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)\b/g,
      
      // 純數字（無逗號，但有小數點）: 1234.56
      /\b([0-9]+\.[0-9]{1,2})\b/g,
      
      // 純整數（3位數以上，避免抓到年份等）
      /\b([0-9]{3,})\b/g
    ];
    
    let allCandidates = [];
    
    // 使用各種模式提取數字
    for (const pattern of numberPatterns) {
      let match;
      while ((match = pattern.exec(cleanText)) !== null) {
        const numberStr = match[1].replace(/,/g, '');
        const number = parseFloat(numberStr);
        
        if (number > 0 && number < 10000000) { // 合理的價格範圍
          allCandidates.push({
            value: number,
            original: match[0],
            position: match.index,
            hasSymbol: /[\$￥¥€£₩₪₹R₽₦₨₱₫₡₲₴₵₸₼₾₿＄元円圓块塊원]/.test(match[0])
          });
        }
      }
    }
    
    if (allCandidates.length === 0) return 0;
    
    // 去重複
    const uniqueCandidates = allCandidates.filter((candidate, index, arr) => 
      arr.findIndex(c => c.value === candidate.value) === index
    );
    
    // 如果只有一個候選，直接返回
    if (uniqueCandidates.length === 1) {
      return uniqueCandidates[0].value;
    }
    
    // 多個候選時的優先級排序
    const scoredCandidates = uniqueCandidates.map(candidate => {
      let score = 0;
      
      // 有貨幣符號的加分
      if (candidate.hasSymbol) score += 10;
      
      // 價格在合理範圍內的加分
      if (candidate.value >= 10 && candidate.value <= 100000) score += 5;
      
      // 有小數點的加分（更像價格）
      if (candidate.value % 1 !== 0) score += 3;
      
      // 位置靠前的稍微加分
      if (candidate.position < cleanText.length / 2) score += 1;
      
      // 避免明顯不是價格的數字
      if (candidate.value < 1) score -= 10;
      if (candidate.value > 1000000) score -= 5;
      
      // 避免年份（1900-2100）
      if (candidate.value >= 1900 && candidate.value <= 2100) score -= 3;
      
      return { ...candidate, score };
    });
    
    // 按分數排序，返回最高分的
    scoredCandidates.sort((a, b) => b.score - a.score);
    
    return scoredCandidates[0].value;
  }
}

// 處理來自 popup 和 content script 的訊息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('收到訊息:', request.action);
  
  if (request.action === "updatePrice") {
    updateItemPrice(request.item).then(sendResponse);
    return true;
  }
  
  if (request.action === "refreshAllPrices") {
    refreshAllPricesInBackground().then(sendResponse);
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

// 改進的價格更新函數
async function updateItemPrice(item) {
  try {
    console.log('開始更新價格，項目:', item.title);
    
    const response = await fetch(item.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.8,en-US;q=0.5,en;q=0.3',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 嘗試多個選擇器
    const selectorsToTry = [
      item.selector,
      ...(item.alternativeSelectors || []),
      ...(item.allSelectors || [])
    ].filter((selector, index, arr) => arr.indexOf(selector) === index); // 去重
    
    console.log('嘗試的選擇器:', selectorsToTry);
    
    let priceElement = null;
    let usedSelector = null;
    
    // 逐一嘗試選擇器
    for (const selector of selectorsToTry) {
      try {
        const elements = doc.querySelectorAll(selector);
        console.log(`選擇器 "${selector}" 找到 ${elements.length} 個元素`);
        
        if (elements.length > 0) {
          // 如果找到多個元素，選擇包含價格的那個
          for (const element of elements) {
            const text = element.textContent || element.innerText || '';
            const price = parsePrice(text);
            if (price > 0) {
              priceElement = element;
              usedSelector = selector;
              console.log(`使用選擇器 "${selector}" 找到價格元素，價格: ${price}`);
              break;
            }
          }
          if (priceElement) break;
        }
      } catch (selectorError) {
        console.warn(`選擇器 "${selector}" 執行失敗:`, selectorError);
        continue;
      }
    }
    
    // 如果所有選擇器都失敗，嘗試智能搜索
    if (!priceElement) {
      console.log('所有選擇器都失敗，嘗試智能搜索...');
      priceElement = findPriceElementByContent(doc, item.initialPrice, item.fullElementText);
      usedSelector = '智能搜索';
    }
    
    if (priceElement) {
      const fullText = priceElement.textContent || priceElement.innerText || '';
      const currentPrice = parsePrice(fullText);
      
      console.log(`找到價格元素，文字: "${fullText.substring(0, 100)}", 解析價格: ${currentPrice}`);
      
      if (currentPrice > 0) {
        return {
          success: true,
          price: currentPrice,
          fullText: fullText.trim(),
          extractedPrice: currentPrice,
          usedSelector: usedSelector
        };
      } else {
        return {
          success: false,
          error: `找到元素但無法解析價格。元素文字: "${fullText.substring(0, 100)}"`
        };
      }
    } else {
      return {
        success: false,
        error: `找不到價格元素。嘗試了 ${selectorsToTry.length} 個選擇器`,
        triedSelectors: selectorsToTry
      };
    }
  } catch (error) {
    console.error('更新價格失敗:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 智能搜索價格元素
function findPriceElementByContent(doc, originalPrice, originalText) {
  console.log('開始智能搜索，原始價格:', originalPrice, '原始文字:', originalText);
  
  // 常見的價格相關選擇器
  const priceSelectors = [
    '[class*="price"]',
    '[class*="cost"]',
    '[class*="amount"]',
    '[class*="value"]',
    '[id*="price"]',
    '[id*="cost"]',
    '[data-price]',
    '[data-cost]',
    '.price',
    '.cost',
    '.amount',
    '.value',
    'span[class*="price"]',
    'div[class*="price"]',
    'p[class*="price"]',
    'strong',
    'b',
    '.money',
    '.currency'
  ];
  
  // 嘗試價格相關選擇器
  for (const selector of priceSelectors) {
    try {
      const elements = doc.querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent || element.innerText || '';
        const price = parsePrice(text);
        
        // 如果找到的價格在原始價格的合理範圍內
        if (price > 0 && Math.abs(price - originalPrice) / originalPrice < 0.5) {
          console.log(`智能搜索找到匹配的價格元素: ${selector}, 價格: ${price}`);
          return element;
        }
      }
    } catch (error) {
      continue;
    }
  }
  
  // 如果還是找不到，嘗試文字相似度匹配
  const allElements = doc.querySelectorAll('*');
  let bestMatch = null;
  let bestScore = 0;
  
  for (const element of allElements) {
    const text = element.textContent || element.innerText || '';
    if (text.length > 200) continue; // 跳過太長的文字
    
    const price = parsePrice(text);
    if (price <= 0) continue;
    
    // 計算文字相似度
    const similarity = calculateTextSimilarity(text, originalText);
    const priceProximity = 1 - Math.abs(price - originalPrice) / Math.max(price, originalPrice);
    const score = similarity * 0.3 + priceProximity * 0.7;
    
    if (score > bestScore && score > 0.3) {
      bestScore = score;
      bestMatch = element;
    }
  }
  
  if (bestMatch) {
    console.log(`智能搜索找到最佳匹配，相似度: ${bestScore}`);
  }
  
  return bestMatch;
}

// 文字相似度計算
function calculateTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  const clean1 = text1.replace(/\s+/g, ' ').trim().toLowerCase();
  const clean2 = text2.replace(/\s+/g, ' ').trim().toLowerCase();
  
  if (clean1 === clean2) return 1;
  
  // 簡單的字符匹配
  const shorter = clean1.length < clean2.length ? clean1 : clean2;
  const longer = clean1.length < clean2.length ? clean2 : clean1;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }
  
  return matches / longer.length;
}

// 背景刷新所有價格
async function refreshAllPricesInBackground() {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    
    if (items.length === 0) {
      return { success: true, message: '沒有項目需要刷新' };
    }
    
    const updatedItems = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      try {
        const updateResult = await updateItemPrice(item);
        
        if (updateResult.success) {
          item.currentPrice = updateResult.price;
          item.lastUpdated = new Date().toISOString();
          item.fullElementText = updateResult.fullText;
          item.priceHistory = item.priceHistory || [];
          item.priceHistory.push({
            price: updateResult.price,
            date: new Date().toISOString(),
            fullText: updateResult.fullText
          });
          
          if (item.priceHistory.length > 50) {
            item.priceHistory = item.priceHistory.slice(-50);
          }
          
          successCount++;
        } else {
          errorCount++;
          console.log(`更新失敗 - ${item.title}: ${updateResult.error}`);
        }
        
        updatedItems.push(item);
        
        // 添加延遲避免請求過於頻繁
        if (i < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error('更新價格失敗:', error);
        updatedItems.push(item);
        errorCount++;
      }
    }
    
    // 儲存更新後的資料
    await chrome.storage.local.set({ trackingItems: updatedItems });
    
    return {
      success: true,
      successCount,
      errorCount,
      message: `完成! 成功: ${successCount}, 失敗: ${errorCount}`
    };
    
  } catch (error) {
    console.error('背景刷新失敗:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 自動更新相關功能
async function getAutoRefreshStatus() {
  const result = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1,
    lastAutoRefresh: null
  });
  
  return result;
}

// 設置自動更新鬧鐘
async function setupAutoRefresh(intervalHours) {
  // 清除現有鬧鐘
  await chrome.alarms.clear('autoRefresh');
  
  if (intervalHours > 0) {
    // 設置新鬧鐘
    await chrome.alarms.create('autoRefresh', {
      delayInMinutes: intervalHours * 60,
      periodInMinutes: intervalHours * 60
    });
    
    console.log(`自動更新已設置，間隔 ${intervalHours} 小時`);
  }
}

// 處理鬧鐘事件
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoRefresh') {
    console.log('執行自動價格更新...');
    
    const settings = await chrome.storage.local.get({
      autoRefreshEnabled: false,
      trackingItems: []
    });
    
    if (settings.autoRefreshEnabled && settings.trackingItems.length > 0) {
      try {
        const result = await refreshAllPricesInBackground();
        
        // 更新最後自動刷新時間
        await chrome.storage.local.set({
          lastAutoRefresh: new Date().toISOString()
        });
        
        console.log('自動更新完成:', result);
        
        // 可選：發送通知
        if (result.success && (result.successCount > 0 || result.errorCount > 0)) {
          chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon48.png',
            title: '價格追蹤器',
            message: `自動更新完成: 成功 ${result.successCount}, 失敗 ${result.errorCount}`
          });
        }
        
      } catch (error) {
        console.error('自動更新失敗:', error);
      }
    }
  }
});

// 擴充套件啟動時恢復自動更新設置
chrome.runtime.onStartup.addListener(async () => {
  const settings = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1
  });
  
  if (settings.autoRefreshEnabled) {
    await setupAutoRefresh(settings.autoRefreshInterval);
  }
});

// 全域價格解析函數
function parsePrice(text) {
  if (!text || typeof text !== 'string') return 0;
  
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  const numberPatterns = [
    /(?:NT\$?|USD?\$?|\$|￥|¥|€|£|₩|₪|₹|R\$?|₽|₦|₨|₱|₫|₡|₲|₴|₵|₸|₼|₾|₿|＄)\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:元|円|圓|块|塊|원|₩)/gi,
    /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)\b/g,
    /\b([0-9]+\.[0-9]{1,2})\b/g,
    /\b([0-9]{3,})\b/g
  ];
  
  let allCandidates = [];
  
  for (const pattern of numberPatterns) {
    let match;
    while ((match = pattern.exec(cleanText)) !== null) {
      const numberStr = match[1].replace(/,/g, '');
      const number = parseFloat(numberStr);
      
      if (number > 0 && number < 10000000) {
        allCandidates.push({
          value: number,
          original: match[0],
          position: match.index,
          hasSymbol: /[\$￥¥€£₩₪₹R₽₦₨₱₫₡₲₴₵₸₼₾₿＄元円圓块塊원]/.test(match[0])
        });
      }
    }
  }
  
  if (allCandidates.length === 0) return 0;
  
  const uniqueCandidates = allCandidates.filter((candidate, index, arr) => 
    arr.findIndex(c => c.value === candidate.value) === index
  );
  
  if (uniqueCandidates.length === 1) {
    return uniqueCandidates[0].value;
  }
  
  const scoredCandidates = uniqueCandidates.map(candidate => {
    let score = 0;
    
    if (candidate.hasSymbol) score += 10;
    if (candidate.value >= 10 && candidate.value <= 100000) score += 5;
    if (candidate.value % 1 !== 0) score += 3;
    if (candidate.position < cleanText.length / 2) score += 1;
    if (candidate.value < 1) score -= 10;
    if (candidate.value > 1000000) score -= 5;
    if (candidate.value >= 1900 && candidate.value <= 2100) score -= 3;
    
    return { ...candidate, score };
  });
  
  scoredCandidates.sort((a, b) => b.score - a.score);
  
  return scoredCandidates[0].value;
}
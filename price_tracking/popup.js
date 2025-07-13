let autoRefreshInterval = null;

document.addEventListener('DOMContentLoaded', function() {
  loadTrackingItems();
  loadAutoRefreshSettings();
  
  // 綁定事件監聽器
  document.getElementById('refreshAll').addEventListener('click', refreshAllPrices);
  document.getElementById('autoRefreshBtn').addEventListener('click', toggleAutoRefreshPanel);
  document.getElementById('clearAll').addEventListener('click', clearAllTracking);
  document.getElementById('exportData').addEventListener('click', exportData);
  document.getElementById('importData').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importData);
  
  // 自動更新面板事件
  document.getElementById('closePanel').addEventListener('click', hideAutoRefreshPanel);
  document.getElementById('saveAutoRefresh').addEventListener('click', saveAutoRefreshSettings);
  document.getElementById('cancelAutoRefresh').addEventListener('click', hideAutoRefreshPanel);
  document.getElementById('enableAutoRefresh').addEventListener('change', toggleAutoRefreshInputs);
});

// 載入追蹤項目
function loadTrackingItems() {
  chrome.storage.local.get({ trackingItems: [] }, (result) => {
    const items = result.trackingItems;
    displayTrackingItems(items);
    updateStats(items.length);
  });
}

// 顯示追蹤項目
function displayTrackingItems(items) {
  const listContainer = document.getElementById('trackingList');
  const emptyState = document.getElementById('emptyState');
  
  if (items.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  
  emptyState.style.display = 'none';
  
  // 清空現有內容
  Array.from(listContainer.children).forEach(child => {
    if (child.id !== 'emptyState') {
      child.remove();
    }
  });
  
  // 添加每個追蹤項目
  items.forEach(item => {
    const itemElement = createTrackingItemElement(item);
    listContainer.appendChild(itemElement);
  });
}

// 創建追蹤項目元素
function createTrackingItemElement(item) {
  const div = document.createElement('div');
  div.className = 'tracking-item';
  div.dataset.itemId = item.id;
  
  const priceDiff = item.currentPrice - item.initialPrice;
  const priceChangeClass = priceDiff > 0 ? 'price-up' : (priceDiff < 0 ? 'price-down' : 'price-same');
  const priceChangeText = priceDiff === 0 ? '無變化' : 
    (priceDiff > 0 ? `+$${priceDiff.toFixed(2)}` : `-$${Math.abs(priceDiff).toFixed(2)}`);
  
  // 只顯示完整元素文字
  const displayText = item.fullElementText ? 
    (item.fullElementText.length > 150 ? 
      item.fullElementText.substring(0, 150) + '...' : 
      item.fullElementText) : 
    item.selectedText;
  
  div.innerHTML = `
    <div class="item-header">
      <div class="item-title">${escapeHtml(item.title)}</div>
      <div class="item-actions">
        <button class="refresh-btn" data-action="refresh" data-item-id="${item.id}" title="刷新價格">🔄</button>
        <button class="visit-btn" data-action="visit" data-url="${encodeURIComponent(item.url)}" title="前往商品頁">🔗</button>
        <button class="delete-btn" data-action="delete" data-item-id="${item.id}" title="刪除追蹤">❌</button>
      </div>
    </div>
    
    <div class="item-url">
      <a href="${item.url}" target="_blank">${item.domain}</a>
    </div>
    
    <div class="element-text" title="${escapeHtml(item.fullElementText || item.selectedText)}">
      <small>${escapeHtml(displayText)}</small>
    </div>
    
    <div class="price-info">
      <div class="price-item">
        <span class="price-label">現價</span>
        <div class="price-value current-price">$${item.currentPrice.toFixed(2)}</div>
      </div>
      <div class="price-item">
        <span class="price-label">初始價</span>
        <div class="price-value initial-price">$${item.initialPrice.toFixed(2)}</div>
      </div>
      <div class="price-item">
        <span class="price-label">變化</span>
        <div class="price-value price-change ${priceChangeClass}">${priceChangeText}</div>
      </div>
    </div>
    
    <div class="last-updated">
      最後更新: ${formatDate(item.lastUpdated)}
    </div>
  `;
  
  // 添加事件監聽器
  const refreshBtn = div.querySelector('[data-action="refresh"]');
  const visitBtn = div.querySelector('[data-action="visit"]');
  const deleteBtn = div.querySelector('[data-action="delete"]');
  
  refreshBtn.addEventListener('click', () => refreshSinglePrice(item.id));
  visitBtn.addEventListener('click', () => visitPage(item.url));
  deleteBtn.addEventListener('click', () => deleteItem(item.id));
  
  return div;
}

// 刷新所有價格
async function refreshAllPrices() {
  const refreshBtn = document.getElementById('refreshAll');
  const refreshStatus = document.getElementById('refreshStatus');
  
  refreshBtn.disabled = true;
  refreshBtn.textContent = '⏳';
  refreshStatus.textContent = '刷新中...';
  
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    
    if (items.length === 0) {
      refreshStatus.textContent = '沒有項目需要刷新';
      return;
    }
    
    const updatedItems = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      refreshStatus.textContent = `刷新中... (${i + 1}/${items.length})`;
      
      try {
        // 直接在這裡執行價格更新邏輯
        const response = await fetch(item.url);
        const html = await response.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const priceElement = doc.querySelector(item.selector);
        if (priceElement) {
          const fullText = priceElement.textContent || priceElement.innerText || '';
          const currentPrice = parsePrice(fullText);
          
          if (currentPrice > 0) {
            item.currentPrice = currentPrice;
            item.lastUpdated = new Date().toISOString();
            item.fullElementText = fullText.trim();
            item.priceHistory = item.priceHistory || [];
            item.priceHistory.push({
              price: currentPrice,
              date: new Date().toISOString(),
              fullText: fullText.trim()
            });
            
            if (item.priceHistory.length > 50) {
              item.priceHistory = item.priceHistory.slice(-50);
            }
            
            successCount++;
          } else {
            errorCount++;
          }
        } else {
          errorCount++;
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
    
    // 重新顯示
    displayTrackingItems(updatedItems);
    
    // 顯示結果
    refreshStatus.textContent = `完成! 成功: ${successCount}, 失敗: ${errorCount}`;
    setTimeout(() => {
      refreshStatus.textContent = '';
    }, 3000);
    
  } catch (error) {
    console.error('刷新價格時發生錯誤:', error);
    refreshStatus.textContent = '刷新失敗';
    setTimeout(() => {
      refreshStatus.textContent = '';
    }, 3000);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄';
  }
}

// 刷新單個價格
async function refreshSinglePrice(itemId) {
  const itemElement = document.querySelector(`[data-item-id="${itemId}"]`);
  if (!itemElement) return;
  
  itemElement.classList.add('loading');
  
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    const itemIndex = items.findIndex(item => item.id === itemId);
    
    if (itemIndex === -1) return;
    
    const item = items[itemIndex];
    
    // 直接執行價格更新
    const response = await fetch(item.url);
    const html = await response.text();
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const priceElement = doc.querySelector(item.selector);
    if (priceElement) {
      const fullText = priceElement.textContent || priceElement.innerText || '';
      const currentPrice = parsePrice(fullText);
      
      if (currentPrice > 0) {
        item.currentPrice = currentPrice;
        item.lastUpdated = new Date().toISOString();
        item.fullElementText = fullText.trim();
        item.priceHistory = item.priceHistory || [];
        item.priceHistory.push({
          price: currentPrice,
          date: new Date().toISOString(),
          fullText: fullText.trim()
        });
        
        if (item.priceHistory.length > 50) {
          item.priceHistory = item.priceHistory.slice(-50);
        }
        
        items[itemIndex] = item;
        await chrome.storage.local.set({ trackingItems: items });
        
        // 重新創建該項目的元素
        const newElement = createTrackingItemElement(item);
        itemElement.parentNode.replaceChild(newElement, itemElement);
        
        showToast(`${item.title} 價格已更新: $${currentPrice.toFixed(2)}`);
      } else {
        showToast('無法解析價格', 'error');
      }
    } else {
      showToast('找不到價格元素', 'error');
    }
    
  } catch (error) {
    console.error('刷新單個價格失敗:', error);
    showToast('刷新失敗: ' + error.message, 'error');
  } finally {
    itemElement.classList.remove('loading');
  }
}

// 刪除項目
async function deleteItem(itemId) {
  if (!confirm('確定要刪除這個追蹤項目嗎？')) return;
  
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems.filter(item => item.id !== itemId);
    
    await chrome.storage.local.set({ trackingItems: items });
    
    // 立即重新載入和顯示
    displayTrackingItems(items);
    updateStats(items.length);
    
    showToast('項目已刪除');
  } catch (error) {
    console.error('刪除項目失敗:', error);
    showToast('刪除失敗', 'error');
  }
}

// 前往商品頁
function visitPage(url) {
  chrome.tabs.create({ url: url });
}

// 清空所有追蹤
async function clearAllTracking() {
  if (!confirm('確定要清空所有追蹤項目嗎？此操作無法復原！')) return;
  
  try {
    await chrome.storage.local.set({ trackingItems: [] });
    displayTrackingItems([]);
    updateStats(0);
    showToast('所有追蹤項目已清空');
  } catch (error) {
    console.error('清空失敗:', error);
    showToast('清空失敗', 'error');
  }
}

// 自動更新相關函數
function toggleAutoRefreshPanel() {
  const panel = document.getElementById('autoRefreshPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function hideAutoRefreshPanel() {
  document.getElementById('autoRefreshPanel').style.display = 'none';
}

function toggleAutoRefreshInputs() {
  const enabled = document.getElementById('enableAutoRefresh').checked;
  document.getElementById('refreshInterval').disabled = !enabled;
}

async function loadAutoRefreshSettings() {
  const result = await chrome.storage.local.get({
    autoRefreshEnabled: false,
    autoRefreshInterval: 1
  });
  
  document.getElementById('enableAutoRefresh').checked = result.autoRefreshEnabled;
  document.getElementById('refreshInterval').value = result.autoRefreshInterval;
  toggleAutoRefreshInputs();
  
  if (result.autoRefreshEnabled) {
    startAutoRefresh(result.autoRefreshInterval);
    updateAutoRefreshStatus(result.autoRefreshInterval);
  }
}

async function saveAutoRefreshSettings() {
  const enabled = document.getElementById('enableAutoRefresh').checked;
  const interval = parseFloat(document.getElementById('refreshInterval').value);
  
  if (interval < 0.1 || interval > 24) {
    showToast('間隔時間必須在 0.1 到 24 小時之間', 'error');
    return;
  }
  
  await chrome.storage.local.set({
    autoRefreshEnabled: enabled,
    autoRefreshInterval: interval
  });
  
  if (enabled) {
    startAutoRefresh(interval);
    updateAutoRefreshStatus(interval);
    showToast(`自動更新已啟用，間隔 ${interval} 小時`);
  } else {
    stopAutoRefresh();
    updateAutoRefreshStatus(0);
    showToast('自動更新已停用');
  }
  
  hideAutoRefreshPanel();
}

function startAutoRefresh(intervalHours) {
  stopAutoRefresh();
  autoRefreshInterval = setInterval(() => {
    refreshAllPrices();
  }, intervalHours * 60 * 60 * 1000);
}

function stopAutoRefresh() {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

function updateAutoRefreshStatus(intervalHours) {
  const statusElement = document.getElementById('autoRefreshStatus');
  if (intervalHours > 0) {
    statusElement.textContent = `自動更新已啟用 (每 ${intervalHours} 小時)`;
  } else {
    statusElement.textContent = '自動更新已停用';
  }
}

// 匯出資料
async function exportData() {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const data = {
      version: "1.0",
      exportDate: new Date().toISOString(),
      trackingItems: result.trackingItems
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-tracker-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('資料已匯出');
  } catch (error) {
    console.error('匯出失敗:', error);
    showToast('匯出失敗', 'error');
  }
}

// 匯入資料
async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.trackingItems || !Array.isArray(data.trackingItems)) {
      throw new Error('無效的資料格式');
    }
    
    // 驗證資料結構
    for (const item of data.trackingItems) {
      if (!item.id || !item.url || !item.selector || typeof item.initialPrice !== 'number') {
        throw new Error('資料格式不完整');
      }
    }
    
    const itemCount = data.trackingItems.length;
    if (confirm(`即將匯入 ${itemCount} 個追蹤項目，是否繼續？這將覆蓋現有資料。`)) {
      await chrome.storage.local.set({ trackingItems: data.trackingItems });
      displayTrackingItems(data.trackingItems);
      updateStats(data.trackingItems.length);
      showToast(`成功匯入 ${itemCount} 個項目`);
    }
    
  } catch (error) {
    console.error('匯入失敗:', error);
    showToast('匯入失敗：' + error.message, 'error');
  }
  
  // 清空文件輸入
  event.target.value = '';
}

// 更新統計資訊
function updateStats(count) {
  document.getElementById('itemCount').textContent = `${count} 個追蹤項目`;
}

// 價格解析函數
function parsePrice(text) {
  if (!text) return 0;
  
  // 移除所有空白字符
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // 各種價格模式
  const patterns = [
    // 標準貨幣格式：$123.45, NT$123, USD 123.45
    /(?:[$¥€£₹₩¢]|NT\$|USD|EUR|GBP|JPY|CNY|TWD)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    // 數字後跟貨幣：123.45 USD, 123元
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:USD|EUR|GBP|JPY|CNY|TWD|元|dollar|dollars)/i,
    // 純數字（帶小數點）
    /([0-9,]+\.[0-9]{1,2})/,
    // 純整數（較大的數字，可能是價格）
    /([0-9,]{3,})/,
    // 任何數字
    /([0-9,]+(?:\.[0-9]+)?)/
  ];
  
  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match) {
      const numberStr = match[1].replace(/,/g, '');
      const number = parseFloat(numberStr);
      
      // 基本驗證：價格應該是正數且合理範圍
      if (number > 0 && number < 1000000) {
        return number;
      }
    }
  }
  
  return 0;
}

// 顯示提示訊息
function showToast(message, type = 'success') {
  // 移除現有的 toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // 3秒後自動移除
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }
  }, 3000);
}

// 工具函數
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  if (!dateString) return '未知';
  
  try {
    const date = new Date(dateString);
    return date.toLocaleString('zh-TW', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return '日期錯誤';
  }
}

// 鍵盤快捷鍵
document.addEventListener('keydown', function(event) {
  // Ctrl+R 或 Cmd+R: 刷新所有價格
  if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
    event.preventDefault();
    refreshAllPrices();
  }
  
  // Ctrl+E 或 Cmd+E: 匯出資料
  if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
    event.preventDefault();
    exportData();
  }
  
  // Ctrl+I 或 Cmd+I: 匯入資料
  if ((event.ctrlKey || event.metaKey) && event.key === 'i') {
    event.preventDefault();
    document.getElementById('importFile').click();
  }
  
  // Ctrl+A 或 Cmd+A: 自動更新設定
  if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
    event.preventDefault();
    toggleAutoRefreshPanel();
  }
});

// 在擴充套件關閉時清理
window.addEventListener('beforeunload', () => {
  stopAutoRefresh();
});

// 頁面可見性變化時的處理
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    // 當頁面變為可見時，重新載入資料
    loadTrackingItems();
    loadAutoRefreshSettings();
  }
});


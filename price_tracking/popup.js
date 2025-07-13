document.addEventListener('DOMContentLoaded', async function() {
  const itemsList = document.getElementById('itemsList');
  const refreshAllBtn = document.getElementById('refreshAll');
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const intervalSelect = document.getElementById('intervalSelect');
  const autoRefreshStatus = document.getElementById('autoRefreshStatus');
  const alertsSection = document.getElementById('alertsSection');
  const alertsList = document.getElementById('alertsList');
  
  // 載入並顯示追蹤項目
  await loadTrackingItems();
  
  // 載入自動更新設置
  await loadAutoRefreshSettings();
  
  // 檢查並顯示價格提醒
  await checkAndDisplayAlerts();
  
  // 刷新所有價格按鈕
  refreshAllBtn.addEventListener('click', async function() {
    this.disabled = true;
    this.textContent = '更新中...';
    
    try {
      const response = await chrome.runtime.sendMessage({ action: "refreshAllPrices" });
      
      if (response.success) {
        showMessage(`更新完成！${response.message}`, 'success');
        await loadTrackingItems();
        await checkAndDisplayAlerts();
      } else {
        showMessage('更新失敗: ' + response.error, 'error');
      }
    } catch (error) {
      showMessage('更新失敗: ' + error.message, 'error');
    }
    
    this.disabled = false;
    this.textContent = '刷新所有價格';
  });
  
  // 自動更新開關
  autoRefreshToggle.addEventListener('change', async function() {
    const enabled = this.checked;
    const interval = parseFloat(intervalSelect.value);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: "setAutoRefresh",
        enabled: enabled,
        interval: interval
      });
      
      if (response.success) {
        await chrome.storage.local.set({
          autoRefreshEnabled: enabled,
          autoRefreshInterval: interval
        });
        
        await loadAutoRefreshSettings();
        showMessage(enabled ? `自動更新已啟用，間隔 ${interval} 小時` : '自動更新已停用', 'success');
      } else {
        showMessage('設置失敗: ' + response.error, 'error');
        this.checked = !enabled; // 恢復原狀態
      }
    } catch (error) {
      showMessage('設置失敗: ' + error.message, 'error');
      this.checked = !enabled; // 恢復原狀態
    }
  });
  
  // 間隔選擇變更
  intervalSelect.addEventListener('change', async function() {
    if (autoRefreshToggle.checked) {
      const interval = parseFloat(this.value);
      
      try {
        const response = await chrome.runtime.sendMessage({
          action: "setAutoRefresh",
          enabled: true,
          interval: interval
        });
        
        if (response.success) {
          await chrome.storage.local.set({ autoRefreshInterval: interval });
          await loadAutoRefreshSettings();
          showMessage(`自動更新間隔已更改為 ${interval} 小時`, 'success');
        }
      } catch (error) {
        showMessage('設置失敗: ' + error.message, 'error');
      }
    }
  });
  
  async function loadTrackingItems() {
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems;
      
      itemsList.innerHTML = '';
      
      if (items.length === 0) {
        itemsList.innerHTML = '<div class="empty-state">尚無追蹤項目<br>請在網頁上選取價格文字後右鍵選擇「加入價格追蹤」</div>';
        return;
      }
      
      items.forEach(item => {
        const itemElement = createItemElement(item);
        itemsList.appendChild(itemElement);
      });
      
    } catch (error) {
      console.error('載入追蹤項目失敗:', error);
      showMessage('載入失敗: ' + error.message, 'error');
    }
  }
  
  function createItemElement(item) {
    const div = document.createElement('div');
    div.className = 'item';
    
    // 計算價格變化
    const priceChange = item.currentPrice - item.initialPrice;
    const priceChangePercent = ((priceChange / item.initialPrice) * 100).toFixed(1);
    const priceChangeClass = priceChange > 0 ? 'price-up' : priceChange < 0 ? 'price-down' : 'price-same';
    
    // 檢查是否有價格提醒
    const hasAlert = item.targetPrice && item.currentPrice <= item.targetPrice && item.alertTriggered;
    
    div.innerHTML = `
      <div class="item-header ${hasAlert ? 'alert-triggered' : ''}">
        <div class="item-title">
          <a href="${item.url}" target="_blank" title="${item.title}">
            ${item.title.length > 50 ? item.title.substring(0, 50) + '...' : item.title}
          </a>
          ${hasAlert ? '<span class="alert-badge">🔔</span>' : ''}
        </div>
        <div class="item-domain">${item.domain}</div>
      </div>
      
      <div class="price-info">
        <div class="current-price">
          目前價格: <span class="price">$${item.currentPrice}</span>
        </div>
        <div class="price-change ${priceChangeClass}">
          ${priceChange >= 0 ? '+' : ''}$${priceChange.toFixed(2)} (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent}%)
        </div>
        ${item.targetPrice ? `<div class="target-price">目標價格: <span class="price">$${item.targetPrice}</span></div>` : ''}
      </div>
      
      <div class="item-details">
        <div class="detail-row">
          <span>初始價格:</span>
          <span>$${item.initialPrice}</span>
        </div>
        <div class="detail-row">
          <span>最後更新:</span>
          <span>${formatDate(item.lastUpdated)}</span>
        </div>
      </div>
      
      <div class="item-actions">
        <button class="btn btn-small update-btn" data-id="${item.id}">更新價格</button>
        <button class="btn btn-small btn-secondary edit-target-btn" data-id="${item.id}">設定提醒</button>
        <button class="btn btn-small btn-danger delete-btn" data-id="${item.id}">刪除</button>
      </div>
    `;
    
    // 添加事件監聽器
    const updateBtn = div.querySelector('.update-btn');
    const editTargetBtn = div.querySelector('.edit-target-btn');
    const deleteBtn = div.querySelector('.delete-btn');
    
    updateBtn.addEventListener('click', () => updateSingleItem(item.id));
    editTargetBtn.addEventListener('click', () => editTargetPrice(item.id));
    deleteBtn.addEventListener('click', () => deleteItem(item.id));
    
    return div;
  }
  
  async function updateSingleItem(itemId) {
    const updateBtn = document.querySelector(`[data-id="${itemId}"].update-btn`);
    updateBtn.disabled = true;
    updateBtn.textContent = '更新中...';
    
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems;
      const item = items.find(i => i.id === itemId);
      
      if (!item) {
        showMessage('找不到項目', 'error');
        return;
      }
      
      const response = await chrome.runtime.sendMessage({
        action: "updatePrice",
        item: item
      });
      
      if (response.success) {
        // 更新項目資料
        item.currentPrice = response.price;
        item.lastUpdated = new Date().toISOString();
        item.fullElementText = response.fullText;
        item.priceHistory = item.priceHistory || [];
        item.priceHistory.push({
          price: response.price,
          date: new Date().toISOString(),
          fullText: response.fullText
        });
        
        // 檢查價格提醒
        if (item.targetPrice && response.price <= item.targetPrice && !item.alertTriggered) {
          item.alertTriggered = true;
          showMessage(`價格提醒！${item.title} 已達到目標價格 $${item.targetPrice}`, 'success');
        } else if (item.targetPrice && response.price > item.targetPrice) {
          item.alertTriggered = false;
        }
        
        // 保存更新
        await chrome.storage.local.set({ trackingItems: items });
        
        // 重新載入顯示
        await loadTrackingItems();
        await checkAndDisplayAlerts();
        
        showMessage(`價格更新成功！新價格: $${response.price}`, 'success');
      } else {
        showMessage('更新失敗: ' + response.error, 'error');
      }
    } catch (error) {
      showMessage('更新失敗: ' + error.message, 'error');
    }
    
    updateBtn.disabled = false;
    updateBtn.textContent = '更新價格';
  }
  
  async function editTargetPrice(itemId) {
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems;
      const item = items.find(i => i.id === itemId);
      
      if (!item) {
        showMessage('找不到項目', 'error');
        return;
      }
      
      const currentTarget = item.targetPrice || '';
      const newTarget = prompt(
        `設定價格提醒\n\n商品: ${item.title}\n當前價格: $${item.currentPrice}\n\n請輸入目標價格（當價格低於此值時會通知）：\n留空則取消提醒`,
        currentTarget
      );
      
      if (newTarget === null) return; // 用戶取消
      
      if (newTarget === '') {
        // 取消提醒
        item.targetPrice = null;
        item.alertTriggered = false;
        showMessage('價格提醒已取消', 'success');
      } else {
        const targetPrice = parseFloat(newTarget);
        if (isNaN(targetPrice) || targetPrice <= 0) {
          showMessage('請輸入有效的價格', 'error');
          return;
        }
        
        item.targetPrice = targetPrice;
        item.alertTriggered = item.currentPrice <= targetPrice;
        showMessage(`價格提醒已設定為 $${targetPrice}`, 'success');
      }
      
      await chrome.storage.local.set({ trackingItems: items });
      await loadTrackingItems();
      await checkAndDisplayAlerts();
      
    } catch (error) {
      showMessage('設定失敗: ' + error.message, 'error');
    }
  }
  
  async function deleteItem(itemId) {
    if (!confirm('確定要刪除這個追蹤項目嗎？')) {
      return;
    }
    
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems.filter(item => item.id !== itemId);
      
      await chrome.storage.local.set({ trackingItems: items });
      await loadTrackingItems();
      await checkAndDisplayAlerts();
      
      showMessage('項目已刪除', 'success');
    } catch (error) {
      showMessage('刪除失敗: ' + error.message, 'error');
    }
  }
  
  async function loadAutoRefreshSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ action: "getAutoRefreshStatus" });
      
      autoRefreshToggle.checked = response.autoRefreshEnabled;
      intervalSelect.value = response.autoRefreshInterval;
      
      if (response.autoRefreshEnabled) {
        autoRefreshStatus.textContent = `自動更新已啟用，間隔 ${response.autoRefreshInterval} 小時`;
        if (response.lastAutoRefresh) {
          autoRefreshStatus.textContent += `，上次更新: ${formatDate(response.lastAutoRefresh)}`;
        }
      } else {
        autoRefreshStatus.textContent = '自動更新已停用';
      }
    } catch (error) {
      console.error('載入自動更新設置失敗:', error);
    }
  }
  
  async function checkAndDisplayAlerts() {
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems;
      
      const alertItems = items.filter(item => 
        item.targetPrice && item.currentPrice <= item.targetPrice && item.alertTriggered
      );
      
      if (alertItems.length > 0) {
        alertsSection.style.display = 'block';
        alertsList.innerHTML = '';
        
        alertItems.forEach(item => {
          const alertDiv = document.createElement('div');
          alertDiv.className = 'alert-item';
          alertDiv.innerHTML = `
            <div class="alert-title">${item.title}</div>
            <div class="alert-prices">
              目標價格: $${item.targetPrice} | 當前價格: $${item.currentPrice}
            </div>
            <button class="btn btn-small dismiss-alert-btn" data-id="${item.id}">關閉提醒</button>
          `;
          
          const dismissBtn = alertDiv.querySelector('.dismiss-alert-btn');
          dismissBtn.addEventListener('click', () => dismissAlert(item.id));
          
          alertsList.appendChild(alertDiv);
        });
      } else {
        alertsSection.style.display = 'none';
      }
    } catch (error) {
      console.error('檢查提醒失敗:', error);
    }
  }
  
  async function dismissAlert(itemId) {
    try {
      const result = await chrome.storage.local.get({ trackingItems: [] });
      const items = result.trackingItems;
      const item = items.find(i => i.id === itemId);
      
      if (item) {
        item.alertTriggered = false;
        await chrome.storage.local.set({ trackingItems: items });
        await loadTrackingItems();
        await checkAndDisplayAlerts();
        showMessage('提醒已關閉', 'success');
      }
    } catch (error) {
      showMessage('操作失敗: ' + error.message, 'error');
    }
  }
  
  function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return '剛剛';
    if (diffMins < 60) return `${diffMins} 分鐘前`;
    if (diffHours < 24) return `${diffHours} 小時前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  function showMessage(message, type = 'info') {
    // 移除現有的訊息
    const existingMessage = document.querySelector('.message');
    if (existingMessage) {
      existingMessage.remove();
    }
    
    // 創建新訊息
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    messageDiv.textContent = message;
    
    // 插入到頁面頂部
    document.body.insertBefore(messageDiv, document.body.firstChild);
    
    // 3秒後自動移除
    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, 3000);
  }
});

// 監聽頁面可見性變化，當popup重新打開時檢查提醒
document.addEventListener('visibilitychange', async function() {
  if (!document.hidden) {
    // 頁面變為可見時，重新檢查提醒
    const alertsSection = document.getElementById('alertsSection');
    if (alertsSection) {
      await checkAndDisplayAlerts();
    }
  }
});

async function checkAndDisplayAlerts() {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    
    const alertItems = items.filter(item => 
      item.targetPrice && item.currentPrice <= item.targetPrice && item.alertTriggered
    );
    
    const alertsSection = document.getElementById('alertsSection');
    const alertsList = document.getElementById('alertsList');
    
    if (alertItems.length > 0) {
      alertsSection.style.display = 'block';
      alertsList.innerHTML = '';
      
      alertItems.forEach(item => {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert-item';
        alertDiv.innerHTML = `
          <div class="alert-title">${item.title}</div>
          <div class="alert-prices">
            目標價格: $${item.targetPrice} | 當前價格: $${item.currentPrice}
          </div>
          <button class="btn btn-small dismiss-alert-btn" data-id="${item.id}">關閉提醒</button>
        `;
        
        const dismissBtn = alertDiv.querySelector('.dismiss-alert-btn');
        dismissBtn.addEventListener('click', () => dismissAlert(item.id));
        
        alertsList.appendChild(alertDiv);
      });
    } else {
      alertsSection.style.display = 'none';
    }
  } catch (error) {
    console.error('檢查提醒失敗:', error);
  }
}

async function dismissAlert(itemId) {
  try {
    const result = await chrome.storage.local.get({ trackingItems: [] });
    const items = result.trackingItems;
    const item = items.find(i => i.id === itemId);
    
    if (item) {
      item.alertTriggered = false;
      await chrome.storage.local.set({ trackingItems: items });
      // 重新載入顯示
      const loadTrackingItems = window.loadTrackingItems || (() => {
        // 重新載入追蹤項目的邏輯
        window.location.reload();
      });
      
      await loadTrackingItems();
      await checkAndDisplayAlerts();
      
      // 顯示成功訊息
      const showMessage = window.showMessage || ((message, type) => {
        console.log(`${type}: ${message}`);
      });
      showMessage('提醒已關閉', 'success');
    }
  } catch (error) {
    const showMessage = window.showMessage || ((message, type) => {
      console.log(`${type}: ${message}`);
    });
    showMessage('操作失敗: ' + error.message, 'error');
  }
}


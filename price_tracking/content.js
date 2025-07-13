// 監聽來自 background 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPrice") {
    const element = document.querySelector(request.selector);
    if (element) {
      // 抓取整個元素的文字內容
      const fullText = element.textContent || element.innerText || '';
      const price = parsePrice(fullText);
      
      sendResponse({ 
        success: true, 
        price: price, 
        fullText: fullText.trim(),
        extractedPrice: price
      });
    } else {
      sendResponse({ success: false, error: "找不到元素" });
    }
  }
});

// 更寬容的價格解析函數
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

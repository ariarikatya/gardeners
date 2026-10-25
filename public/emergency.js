(function() {
  function showFatalError(msg) {
    if (document.getElementById('fatal-error-fallback')) return;
    var div = document.createElement('div');
    div.id = 'fatal-error-fallback';
    div.style.cssText = 'position:fixed;inset:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;z-index:999999;';
    div.innerHTML = '<div style="background:white;padding:28px 20px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:380px;width:100%;text-align:center;border:1px solid #e2e8f0;">' +
      '<h2 style="color:#065f46;margin:0 0 8px;font-size:18px;">📡 Что-то пошло не так</h2>' +
      '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">Страница не отображается (' + (msg || 'Ошибка гидратации/кэша') + '). Очистите кэш или обновите страницу.</p>' +
      '<button onclick="window.location.reload()" style="background:#059669;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:14px;margin-bottom:8px;">Обновить страницу</button>' +
      '<button onclick="caches.keys().then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k);}));}).then(function(){localStorage.clear();sessionStorage.clear();window.location.href=\'/login\';});" style="background:#e2e8f0;color:#1e293b;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:13px;">Очистить кэш</button>' +
      '</div>';
    if (document.body) document.body.appendChild(div);
  }

  window.addEventListener('error', function(e) {
    if (e && e.message && (e.message.indexOf('Hydration') !== -1 || e.message.indexOf('Minified React error') !== -1 || e.message.indexOf('SyntaxError') !== -1)) {
      showFatalError('сбой синтаксиса/гидратации');
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    if (document.body && (!document.body.children || document.body.children.length === 0 || document.body.innerText.trim() === '')) {
      showFatalError('ошибка сети');
    }
  });

  setTimeout(function() {
    if (typeof document !== 'undefined' && document.body) {
      var text = (document.body.innerText || '').trim();
      var hasChildren = document.body.children && document.body.children.length > 0;
      var hasFatal = document.getElementById('fatal-error-fallback');
      if ((!hasChildren || text.length === 0) && !hasFatal) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
        showFatalError('пустая страница');
        try {
          fetch('/api/client-error', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'Blank screen detected by 3s watchdog',
              pathname: window.location.pathname,
              userAgent: navigator.userAgent
            })
          }).catch(function() {});
        } catch (e) {}
      }
    }
  }, 3000);
})();

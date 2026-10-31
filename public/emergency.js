(function() {
  function handleChunkError() {
    if (typeof window === 'undefined') return false;
    try {
      if (!sessionStorage.getItem('chunk_reload_done')) {
        sessionStorage.setItem('chunk_reload_done', '1');
        window.location.reload();
        return true;
      }
    } catch (e) {}
    return false;
  }

  function showFatalError(msg) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (document.getElementById('fatal-error-fallback')) return;
    var div = document.createElement('div');
    div.id = 'fatal-error-fallback';
    div.style.cssText = 'position:fixed;inset:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;z-index:999999;';
    div.innerHTML = '<div style="background:white;padding:28px 20px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:380px;width:100%;text-align:center;border:1px solid #e2e8f0;">' +
      '<h2 style="color:#065f46;margin:0 0 8px;font-size:18px;">📡 Что-то пошло не так</h2>' +
      '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">Страница не отображается (' + (msg || 'Ошибка гидратации/кэша') + '). Очистите кэш или обновите страницу.</p>' +
      '<button onclick="window.location.reload()" style="background:#059669;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:14px;margin-bottom:8px;">Обновить страницу</button>' +
      '<button onclick="caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k.indexOf(\'anemon-agro-\')===0;}).map(function(k){return caches.delete(k);}));}).then(function(){try{localStorage.removeItem(\'auth_token\');localStorage.removeItem(\'offline_session\');localStorage.removeItem(\'offline_session_ts\');}catch(e){}try{sessionStorage.clear();}catch(e){}window.location.href=\'/login\';});" style="background:#e2e8f0;color:#1e293b;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:13px;margin-bottom:8px;">Очистить кэш</button>' +
      '<button onclick="if(confirm(\'Вы уверены, что хотите выполнить полную очистку кэша?\')){caches.keys().then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k);}));}).then(function(){try{var p=localStorage.getItem(\'auth_phone\');var r=localStorage.getItem(\'auth_role\');var id=localStorage.getItem(\'gardener_identity\');var m=localStorage.getItem(\'phone_roles_map\');localStorage.clear();if(p)localStorage.setItem(\'auth_phone\',p);if(r)localStorage.setItem(\'auth_role\',r);if(id)localStorage.setItem(\'gardener_identity\',id);if(m)localStorage.setItem(\'phone_roles_map\',m);}catch(e){}try{sessionStorage.clear();}catch(e){}window.location.href=\'/login\';});}" style="background:#f1f5f9;color:#64748b;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:12px;margin-bottom:8px;">Полная очистка</button>' +
      '<button onclick="try{var id=localStorage.getItem(\'gardener_identity\')||\'не указан\';var phone=localStorage.getItem(\'auth_phone\')||\'не указан\';alert(\'Сохранённый профиль: \'+phone+\'\\nIdentity: \'+id);}catch(e){alert(\'Ошибка чтения локальных данных\');}" style="background:#e0f2fe;color:#0369a1;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:12px;">Показать сохранённые офлайн-данные</button>' +
      '</div>';
    if (document.body) document.body.appendChild(div);
  }

  window.addEventListener('error', function(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (e && (
      (e.message && (e.message.indexOf('ChunkLoadError') !== -1 || e.message.indexOf('Loading chunk') !== -1)) ||
      (e.name && e.name.indexOf('ChunkLoadError') !== -1)
    )) {
      if (handleChunkError()) return;
    }
    if (e && (
      (e.message && (e.message.indexOf('Hydration') !== -1 || e.message.indexOf('Minified React error') !== -1 || e.message.indexOf('SyntaxError') !== -1 || e.message.indexOf('ChunkLoadError') !== -1 || e.message.indexOf('Loading chunk') !== -1)) ||
      (e.name && e.name.indexOf('ChunkLoadError') !== -1)
    )) {
      showFatalError('сбой синтаксиса/гидратации');
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (e && e.reason && (
      (e.reason.name && e.reason.name.indexOf('ChunkLoadError') !== -1) ||
      (e.reason.message && (e.reason.message.indexOf('Loading chunk') !== -1 || e.reason.message.indexOf('ChunkLoadError') !== -1))
    )) {
      if (handleChunkError()) return;
      showFatalError('ошибка загрузки чанка');
      return;
    }
    if (document.body && (!document.body.children || document.body.children.length === 0 || document.body.innerText.trim() === '')) {
      showFatalError('ошибка сети');
    }
  });

  setTimeout(function() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (typeof document !== 'undefined' && document.body) {
      var text = (document.body.innerText || '').trim();
      var hasChildren = document.body.children && document.body.children.length > 0;
      var hasFatal = document.getElementById('fatal-error-fallback');
      if ((!hasChildren || text.length === 0) && !hasFatal) {
        showFatalError('пустая страница');
      } else {
        try { sessionStorage.removeItem('chunk_reload_done'); } catch(e) {}
      }
    }
  }, 3000);
})();

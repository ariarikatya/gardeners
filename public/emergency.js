(function() {
  if (typeof window !== 'undefined' && window.location && window.location.pathname.indexOf('/login') === 0) {
    return;
  }

  function getVersionKey() {
    var v = 'default';
    try {
      if (typeof window !== 'undefined' && window.CLIENT_VERSION) {
        v = String(window.CLIENT_VERSION).trim();
      } else {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || '';
          var idx = src.indexOf('emergency.js?v=');
          if (idx !== -1) {
            v = decodeURIComponent(src.substring(idx + 15).split('&')[0]).trim();
            break;
          }
        }
      }
    } catch (e) {}
    return v || 'default';
  }

  var ver = getVersionKey();

  // Clean legacy keys from older versions
  try {
    if (typeof localStorage !== 'undefined') {
      var keys = Object.keys(localStorage);
      for (var k = 0; k < keys.length; k++) {
        var keyName = keys[k];
        if (
          (keyName.indexOf('fatal_overlay_shown_count_') === 0 && keyName !== 'fatal_overlay_shown_count_' + ver) ||
          (keyName.indexOf('chunk_reload_done_') === 0 && keyName !== 'chunk_reload_done_' + ver)
        ) {
          localStorage.removeItem(keyName);
        }
      }
    }
  } catch (e) {}

  function isOfflineApp() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('offline_session') === '1') {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function isPageRendered() {
    if (typeof document === 'undefined' || !document.body) return false;
    var root = document.querySelector('#root') || document.querySelector('main') || document.body;
    var hasContent = Boolean(
      (document.body.children && document.body.children.length > 0) &&
      (document.body.innerText || '').trim().length > 0
    );
    if (root && root !== document.body) {
      hasContent = hasContent || (root.children && root.children.length > 0);
    }
    return hasContent;
  }

  function canShowOverlay() {
    if (typeof window !== 'undefined' && window.location && window.location.pathname.indexOf('/login') === 0) {
      return false;
    }
    if (isOfflineApp()) return false;
    if (document.readyState !== 'complete') return false;
    if (isPageRendered()) return false;
    if (document.getElementById('fatal-error-fallback')) return false;

    try {
      var count = parseInt(localStorage.getItem('fatal_overlay_shown_count_' + ver) || '0', 10);
      if (count >= 1) return false;
    } catch (e) {
      return false;
    }

    return true;
  }

  function handleChunkError() {
    if (typeof window === 'undefined') return false;
    try {
      var key = 'chunk_reload_done_' + ver;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, '1');
        window.location.reload();
        return true;
      }
    } catch (e) {}
    return false;
  }

  function showFatalError(msg) {
    if (!canShowOverlay()) return;

    // Prioritize one silent reload of the current URL
    if (handleChunkError()) return;

    try {
      var count = parseInt(localStorage.getItem('fatal_overlay_shown_count_' + ver) || '0', 10);
      localStorage.setItem('fatal_overlay_shown_count_' + ver, String(count + 1));
    } catch (e) {}

    var div = document.createElement('div');
    div.id = 'fatal-error-fallback';
    div.style.cssText = 'position:fixed;inset:0;background:#f8fafc;display:flex;align-items:center;justify-content:center;padding:20px;font-family:sans-serif;z-index:999999;';
    div.innerHTML = '<div style="background:white;padding:28px 20px;border-radius:16px;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:380px;width:100%;text-align:center;border:1px solid #e2e8f0;">' +
      '<h2 style="color:#065f46;margin:0 0 8px;font-size:18px;">📡 Что-то пошло не так</h2>' +
      '<p style="color:#64748b;font-size:13px;margin:0 0 16px;">Страница не отображается (' + (msg || 'Ошибка гидратации/кэша') + '). Очистите кэш или обновите страницу.</p>' +
      '<button onclick="window.location.reload()" style="background:#059669;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:14px;margin-bottom:8px;">Обновить страницу</button>' +
      '<button onclick="caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k.indexOf(\'anemon-agro-\')===0;}).map(function(k){return caches.delete(k);}));}).then(function(){try{localStorage.removeItem(\'auth_token\');localStorage.removeItem(\'offline_session\');localStorage.removeItem(\'offline_session_ts\');}catch(e){}try{sessionStorage.clear();}catch(e){}window.location.href=\'/login\';});" style="background:#e2e8f0;color:#1e293b;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:13px;margin-bottom:8px;">Очистить кэш</button>' +
      '<button onclick="caches.keys().then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k);}));}).then(function(){try{var m=localStorage.getItem(\'phone_roles_map\');localStorage.clear();if(m)localStorage.setItem(\'phone_roles_map\',m);}catch(e){}try{sessionStorage.clear();}catch(e){}window.location.href=\'/login\';});" style="background:#f1f5f9;color:#64748b;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-weight:bold;width:100%;font-size:12px;">Полная очистка</button>' +
      '</div>';
    if (document.body) document.body.appendChild(div);
  }

  window.addEventListener('error', function(e) {
    if (isOfflineApp()) return;

    var isSameOrigin = false;
    try {
      if (e && e.filename && typeof window !== 'undefined' && window.location) {
        isSameOrigin = e.filename.indexOf(window.location.origin) === 0;
      }
    } catch (err) {}

    var msg = (e && (e.message || (e.error && e.error.message))) || '';
    var isTargetError = /SyntaxError|ChunkLoadError|Loading( CSS)? chunk|Hydration/i.test(msg);

    if (isSameOrigin && isTargetError) {
      setTimeout(function() {
        if (!canShowOverlay()) {
          console.warn('[emergency] Ignored non-fatal JS error:', msg);
          return;
        }
        showFatalError('сбой синтаксиса/гидратации');
      }, 8000);
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    if (isOfflineApp()) return;
    if (e && e.reason && (
      (e.reason.name && e.reason.name.indexOf('ChunkLoadError') !== -1) ||
      (e.reason.message && /ChunkLoadError|Loading( CSS)? chunk/i.test(e.reason.message))
    )) {
      if (handleChunkError()) return;
      showFatalError('ошибка загрузки чанка');
    }
  });

  setTimeout(function() {
    if (isOfflineApp()) return;
    if (typeof document !== 'undefined' && document.body) {
      if (isPageRendered()) {
        try { localStorage.removeItem('chunk_reload_done_' + ver); } catch(e) {}
      } else if (canShowOverlay()) {
        showFatalError('пустая страница');
      }
    }
  }, 8000);
})();

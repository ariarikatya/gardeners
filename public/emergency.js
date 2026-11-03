(function() {
  if (typeof window !== 'undefined' && window.location && window.location.pathname.indexOf('/login') === 0) {
    return;
  }

  function getVersionKey() {
    var v = 'default';
    try {
      if (typeof window !== 'undefined' && window.CLIENT_VERSION) {
        v = window.CLIENT_VERSION;
      } else {
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
          var src = scripts[i].src || '';
          var idx = src.indexOf('emergency.js?v=');
          if (idx !== -1) {
            v = src.substring(idx + 15).split('&')[0];
            break;
          }
        }
      }
    } catch (e) {}
    return v;
  }

  var ver = getVersionKey();

  function isOfflineApp() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('offline_session') === '1') {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function getFatalCount() {
    try {
      return parseInt(localStorage.getItem('fatal_overlay_shown_count_' + ver) || '0', 10);
    } catch (e) {
      return 0;
    }
  }

  function incFatalCount() {
    try {
      var c = getFatalCount();
      localStorage.setItem('fatal_overlay_shown_count_' + ver, String(c + 1));
    } catch (e) {}
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

  function showFatalError(msg) {
    if (isOfflineApp()) return;
    if (getFatalCount() >= 1) return;
    if (document.getElementById('fatal-error-fallback')) return;

    // Check actual DOM state at call time: never show fatal error if content is rendered
    if (isPageRendered()) return;

    // Before ever showing the overlay, allow ONE automatic reload of the current url
    if (handleChunkError()) return;

    incFatalCount();

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
    if (getFatalCount() >= 1) return;

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
        if (isOfflineApp()) return;
        var isReady = document.readyState === 'complete';
        if (isReady && !isPageRendered()) {
          showFatalError('сбой синтаксиса/гидратации');
        } else {
          console.warn('[emergency] Ignored non-fatal JS error:', msg);
        }
      }, 5000);
    }
  });

  window.addEventListener('unhandledrejection', function(e) {
    if (isOfflineApp()) return;
    if (getFatalCount() >= 1) return;
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
    if (getFatalCount() >= 1) return;
    if (typeof document !== 'undefined' && document.body) {
      var isReady = document.readyState === 'complete';
      var hasFatal = document.getElementById('fatal-error-fallback');
      if (isPageRendered()) {
        try { localStorage.removeItem('chunk_reload_done_' + ver); } catch(e) {}
      } else if (isReady && !hasFatal) {
        showFatalError('пустая страница');
      }
    }
  }, 5000);
})();

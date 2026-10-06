import { openOfflineDB } from './offlineStore';

export function compressImageToBlob(file, maxWidth = 1280, quality = 0.7) {
  return new Promise((resolve) => {
    if (!file || !(file instanceof Blob)) return resolve(file);
    if (typeof window === 'undefined' || !window.FileReader) return resolve(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', quality);
        } catch (err) {
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export async function enqueueAction({ actionType, url, method = 'PUT', payload = {}, photos = [] }) {
  const id = 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const idempotencyKey = 'idemp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const item = {
    id,
    idempotencyKey,
    actionType, // 'ORDER_PUT' | 'EXPENSE_POST' | 'AUCTION_CLAIM' | 'PROFILE_PUT'
    url,
    method,
    payload,
    photos, // Array of { field, blob, fileName }
    timestamp: Date.now(),
    status: 'pending', // 'pending' | 'syncing' | 'failed' | 'conflict'
    errorMsg: null,
  };

  try {
    const db = await openOfflineDB();
    if (!db) return item;
    return new Promise((resolve) => {
      const tx = db.transaction('action_queue', 'readwrite');
      const store = tx.objectStore('action_queue');
      store.put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => resolve(item);
    });
  } catch (e) {
    console.error('enqueueAction error:', e);
    return item;
  }
}

export async function getQueue() {
  try {
    const db = await openOfflineDB();
    if (!db) return [];
    return new Promise((resolve) => {
      const tx = db.transaction('action_queue', 'readonly');
      const store = tx.objectStore('action_queue');
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.error('getQueue error:', e);
    return [];
  }
}

export async function removeFromQueue(id) {
  try {
    const db = await openOfflineDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction('action_queue', 'readwrite');
      const store = tx.objectStore('action_queue');
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.error('removeFromQueue error:', e);
    return false;
  }
}

export async function updateQueueItem(id, updates) {
  try {
    const db = await openOfflineDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction('action_queue', 'readwrite');
      const store = tx.objectStore('action_queue');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const current = getReq.result;
        if (!current) return resolve(false);
        const updated = { ...current, ...updates };
        store.put(updated);
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.error('updateQueueItem error:', e);
    return false;
  }
}

async function uploadPhotoBlob(photoObj) {
  const { blob, field, fileName = 'photo.jpg' } = photoObj;
  const formData = new FormData();
  formData.append('image', blob, fileName);
  formData.append('type', field === 'receipt' ? 'receipt' : 'order');

  const res = await fetch('/api/gardener/upload', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Ошибка загрузки фото');
  }
  return data.url;
}

export async function syncQueue(onItemSynced, onItemFailed) {
  const queue = await getQueue();
  if (!queue.length) return { syncedCount: 0, hasErrors: false };

  let syncedCount = 0;
  let hasErrors = false;

  for (const item of queue) {
    if (item.status === 'conflict') {
      // Пропускаем конфликтные до действия пользователя
      continue;
    }

    await updateQueueItem(item.id, { status: 'syncing' });

    try {
      const payload = { ...item.payload };

      // 1. Загрузка фото, если есть сохранённые фото-блобы
      if (item.photos && item.photos.length > 0) {
        for (const photoObj of item.photos) {
          if (photoObj.url) continue; // уже загружено в предыдущей попытке

          const uploadedUrl = await uploadPhotoBlob(photoObj);
          photoObj.url = uploadedUrl;

          // Подставляем URL в payload
          if (photoObj.field === 'receiptUrl') {
            payload.receiptUrl = uploadedUrl;
          } else if (photoObj.field === 'photoBefore') {
            payload.photoBefore = Array.isArray(payload.photoBefore) ? [...payload.photoBefore, uploadedUrl] : [uploadedUrl];
          } else if (photoObj.field === 'photoAfter') {
            payload.photoAfter = Array.isArray(payload.photoAfter) ? [...payload.photoAfter, uploadedUrl] : [uploadedUrl];
          } else if (photoObj.field === 'photoAct') {
            payload.photoAct = Array.isArray(payload.photoAct) ? [...payload.photoAct, uploadedUrl] : [uploadedUrl];
          }
        }

        // Сохраняем обновленный payload и загруженные photoObj в очереди
        await updateQueueItem(item.id, { payload, photos: item.photos });
      }

      // 2. Отправка основного запроса с идемпотентным ключом
      const res = await fetch(item.url, {
        method: item.method || 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': item.idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      let resData = {};
      try {
        resData = await res.json();
      } catch (e) {
        resData = {};
      }

      if (res.ok) {
        await removeFromQueue(item.id);
        syncedCount++;
        if (typeof onItemSynced === 'function') {
          onItemSynced(item, resData);
        }
      } else if (res.status >= 400 && res.status < 500) {
        const errorMsg = resData.error || `Ошибка сервера (${res.status})`;
        await updateQueueItem(item.id, { status: 'conflict', errorMsg });
        hasErrors = true;
        if (typeof onItemFailed === 'function') {
          onItemFailed(item, errorMsg);
        }
      } else {
        // 5xx или прочие ошибки
        await updateQueueItem(item.id, { status: 'failed', errorMsg: resData.error || 'Ошибка сервера' });
        hasErrors = true;
        break; // Прерываем цикл до восстановления
      }
    } catch (err) {
      console.error('Queue sync item error:', err);
      await updateQueueItem(item.id, { status: 'failed', errorMsg: err.message || 'Ошибка сети' });
      hasErrors = true;
      break; // Прерываем цикл при сетевой ошибке
    }
  }

  return { syncedCount, hasErrors };
}

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

function getMethodWeight(method) {
  const m = String(method || '').toUpperCase();
  if (m === 'POST') return 1;
  if (m === 'PUT') return 2;
  if (m === 'DELETE') return 3;
  return 4;
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
        items.sort((a, b) => {
          const wA = getMethodWeight(a.method);
          const wB = getMethodWeight(b.method);
          if (wA !== wB) return wA - wB;
          return (a.timestamp || 0) - (b.timestamp || 0);
        });
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    console.error('getQueue error:', e);
    return [];
  }
}

export async function getQueueStats(scopeFilter = null) {
  const queue = await getQueue();
  const filtered = scopeFilter
    ? queue.filter(i => Array.isArray(scopeFilter) ? (scopeFilter.includes(i.scope) || !i.scope) : (i.scope === scopeFilter || !i.scope))
    : queue;

  const total = filtered.length;
  const pending = filtered.filter(i => i.status === 'pending').length;
  const syncing = filtered.filter(i => i.status === 'syncing').length;
  const conflict = filtered.filter(i => i.status === 'conflict').length;
  const failed = filtered.filter(i => i.status === 'failed').length;
  const conflictItems = filtered.filter(i => i.status === 'conflict');

  return { total, pending, syncing, conflict, failed, conflictItems, items: filtered };
}

export async function retryConflicts(scopeFilter = null) {
  const stats = await getQueueStats(scopeFilter);
  for (const item of stats.conflictItems) {
    await updateQueueItem(item.id, { status: 'pending', errorMsg: null });
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

/**
 * Enqueues an offline action with smart squashing/collapsing rules and role scope.
 * Scope ('gardener' | 'admin' | 'leader') isolates action execution per context.
 */
export async function enqueueAction({ actionType, url, method = 'PUT', payload = {}, photos = [], scope = 'gardener' }) {
  const id = 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  const idempotencyKey = 'idemp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const newItem = {
    id,
    idempotencyKey,
    actionType,
    url,
    method,
    payload,
    photos,
    scope,
    timestamp: Date.now(),
    status: 'pending',
    errorMsg: null,
  };

  try {
    const queue = await getQueue();

    const targetObjId = payload.id || payload.orderId || (url.includes('?id=') ? url.split('?id=')[1] : null);
    const isTempId = targetObjId && String(targetObjId).startsWith('tmp_');

    // Rule 1: DELETE on temp ID -> remove any pending POST/PUT for this temp ID, do NOT queue DELETE
    if (method === 'DELETE' && isTempId) {
      for (const item of queue) {
        const itemObjId = item.payload.id || item.payload.orderId || (item.url.includes('?id=') ? item.url.split('?id=')[1] : null);
        if (itemObjId === targetObjId) {
          await removeFromQueue(item.id);
        }
      }
      return null;
    }

    // Rule 2: DELETE on real ID -> remove any pending PUT/POST for this real ID, queue DELETE
    if (method === 'DELETE' && targetObjId && !isTempId) {
      for (const item of queue) {
        const itemObjId = item.payload.id || item.payload.orderId || (item.url.includes('?id=') ? item.url.split('?id=')[1] : null);
        if (itemObjId === targetObjId && (item.method === 'PUT' || item.method === 'POST')) {
          await removeFromQueue(item.id);
        }
      }
    }

    // Rule 3: PUT on temp or real ID -> merge with existing pending POST/PUT for same target ID
    if (method === 'PUT' && targetObjId) {
      const existingPending = queue.find((item) => {
        const itemObjId = item.payload.id || item.payload.orderId || (item.url.includes('?id=') ? item.url.split('?id=')[1] : null);
        return itemObjId === targetObjId && (item.method === 'POST' || item.method === 'PUT') && item.status !== 'conflict';
      });

      if (existingPending) {
        const mergedPayload = { ...existingPending.payload, ...payload };
        const mergedPhotos = photos && photos.length ? [...(existingPending.photos || []), ...photos] : (existingPending.photos || []);
        await updateQueueItem(existingPending.id, { payload: mergedPayload, photos: mergedPhotos, timestamp: Date.now() });
        return { ...existingPending, payload: mergedPayload, photos: mergedPhotos };
      }
    }

    // Save as new item in queue
    const db = await openOfflineDB();
    if (!db) return newItem;
    return new Promise((resolve) => {
      const tx = db.transaction('action_queue', 'readwrite');
      const store = tx.objectStore('action_queue');
      store.put(newItem);
      tx.oncomplete = () => resolve(newItem);
      tx.onerror = () => resolve(newItem);
    });
  } catch (e) {
    console.error('enqueueAction error:', e);
    return newItem;
  }
}

async function uploadPhotoBlob(photoObj) {
  const { blob, field, fileName = 'photo.jpg' } = photoObj;
  const formData = new FormData();
  formData.append('image', blob, fileName);
  formData.append('type', field === 'receipt' ? 'receipt' : 'order');

  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch('/api/gardener/upload', {
    method: 'POST',
    headers,
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Ошибка загрузки фото');
  }
  return data.url;
}

/**
 * Synchronizes queue items.
 * @param {Function} onItemSynced Callback for success
 * @param {Function} onItemFailed Callback for errors
 * @param {string|Array<string>} scopeFilter Optional scope filter ('gardener', 'admin', 'leader')
 */
export async function syncQueue(onItemSynced, onItemFailed, scopeFilter = null) {
  const fullQueue = await getQueue();
  if (!fullQueue.length) return { syncedCount: 0, hasErrors: false };

  // Filter items matching scopeFilter if provided (Scope isolation prevents sending gardener actions with admin session and vice versa)
  const queue = fullQueue.filter(item => {
    if (!scopeFilter) return true;
    if (Array.isArray(scopeFilter)) return scopeFilter.includes(item.scope) || !item.scope;
    return item.scope === scopeFilter || !item.scope;
  });

  if (!queue.length) return { syncedCount: 0, hasErrors: false };

  let syncedCount = 0;
  let hasErrors = false;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.status === 'conflict') {
      continue;
    }

    await updateQueueItem(item.id, { status: 'syncing' });

    try {
      const payload = { ...item.payload };

      if (item.photos && item.photos.length > 0) {
        for (const photoObj of item.photos) {
          if (photoObj.url) continue;

          const uploadedUrl = await uploadPhotoBlob(photoObj);
          photoObj.url = uploadedUrl;

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

        await updateQueueItem(item.id, { payload, photos: item.photos });
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      const headers = {
        'Content-Type': 'application/json',
        'Idempotency-Key': item.idempotencyKey,
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(item.url, {
        method: item.method || 'PUT',
        headers,
        body: item.method === 'DELETE' && !item.url.includes('?') ? JSON.stringify(payload) : JSON.stringify(payload),
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

        // Temp ID resolution across multi-entity responses
        const tempId = payload.id;
        const realId = resData.order?.id || resData.gardener?.id || resData.service?.id || resData.dayOff?.id || resData.lead?.id || resData.operation?.id || resData.id;

        if (tempId && typeof tempId === 'string' && tempId.startsWith('tmp_') && realId && tempId !== realId) {
          const remainingQueue = await getQueue();
          for (const remItem of remainingQueue) {
            let itemChanged = false;
            let newUrl = remItem.url;
            let newPayload = { ...remItem.payload };

            if (newUrl.includes(tempId)) {
              newUrl = newUrl.replace(tempId, realId);
              itemChanged = true;
            }
            if (newPayload.id === tempId) {
              newPayload.id = realId;
              itemChanged = true;
            }
            if (newPayload.orderId === tempId) {
              newPayload.orderId = realId;
              itemChanged = true;
            }
            if (newPayload.gardenerId === tempId) {
              newPayload.gardenerId = realId;
              itemChanged = true;
            }
            if (newPayload.serviceId === tempId) {
              newPayload.serviceId = realId;
              itemChanged = true;
            }
            if (newPayload.createdOrderId === tempId) {
              newPayload.createdOrderId = realId;
              itemChanged = true;
            }

            if (itemChanged) {
              await updateQueueItem(remItem.id, { url: newUrl, payload: newPayload });
            }
          }
        }

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
        await updateQueueItem(item.id, { status: 'failed', errorMsg: resData.error || 'Ошибка сервера' });
        hasErrors = true;
        break;
      }
    } catch (err) {
      console.error('Queue sync item error:', err);
      await updateQueueItem(item.id, { status: 'failed', errorMsg: err.message || 'Ошибка сети' });
      hasErrors = true;
      break;
    }
  }

  return { syncedCount, hasErrors };
}

'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PushButton from '@/components/PushButton';
import apiFetch from '@/lib/apiFetch';
import { clientNotify } from '@/lib/clientNotify';
import { saveCache, getCache, activateOfflineSession, resolveOfflineRoleFromCaches, isOfflineSessionValid } from '@/lib/offlineStore';
import { enqueueAction, getQueue, syncQueue, getQueueStats, retryConflicts, removeFromQueue } from '@/lib/offlineQueue';

const emptyOrderForm = {
  clientName: '', clientPhone: '', address: '', district: '', description: '',
  priceContract: 0, priceFact: 0, employeeSalary: 0, companyShare: 0,
  status: 'Новый заказ', comment: '', refusalReason: '', date: '', gardenerId: '', serviceId: '', serviceIds: [], isCash: true, orderMedia: []
};

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const SEARCH_HORIZON_DAYS = 60;
const DEFAULT_DISTRICTS = [
  'Шумейка', 'Генеральское', 'Малая Тополевка', 'Усть-Курдюм', 'Зоналка',
  'Юбилейный', 'Кумысная поляна', 'Центр', 'Поливановка', 'Ленинский район',
  'Трещиха', 'Маркс', 'Заводской район', 'Дальняя', 'Волжский район',
  'Октябрьский район', 'Фрунзенский район', 'Кировский район', 'Солнечный',
  'Соколовая гора', 'Елшанка', 'Саратов', 'Энгельс', 'Другое'
];

function toDateKey(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function parseOrderMedia(media) {
  if (!media) return [];
  if (Array.isArray(media)) return media;
  if (typeof media === 'string') {
    try {
      const parsed = JSON.parse(media);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function DistrictCombobox({ value, onChange, allDistricts = [], defaultDistricts = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  const combinedDistricts = Array.from(new Set([...allDistricts, ...defaultDistricts]));

  const filteredDistricts = combinedDistricts.filter(d =>
    !value || d.toLowerCase().includes(String(value).toLowerCase().trim())
  );

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative mt-1">
      <div className="relative flex items-center">
        <input
          type="text"
          value={value || ''}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-8 bg-white"
          placeholder="Выбор или ввод района..."
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-2 text-slate-400 hover:text-slate-600 p-1 text-xs"
        >
          ▼
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto z-50 divide-y divide-slate-100">
          {filteredDistricts.length > 0 ? (
            filteredDistricts.map((d) => (
              <button
                key={d}
                type="button"
                className={`w-full text-left px-3 py-2.5 text-sm min-h-[44px] flex items-center hover:bg-emerald-50 hover:text-emerald-900 transition-colors ${value === d ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-700'}`}
                onClick={() => {
                  onChange(d);
                  setIsOpen(false);
                }}
              >
                {d}
              </button>
            ))
          ) : (
            <div className="px-3 py-2.5 text-xs text-slate-400 italic">
              {value ? `Произвольный район: «${value}»` : 'Начните ввод...'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function calculateOrthodoxEaster(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 16) % 30;
  const e = (2 * a + 4 * b - d + 6) % 7;
  const f = (d + e + 114) % 31;
  const day = f + 1;
  const month = Math.floor((d + e + 114) / 31) + 1;
  return new Date(year, month - 1, day);
}

function isRussianHoliday(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  const holidayKeys = new Set();

  for (let i = 1; i <= 8; i++) holidayKeys.add(`${year}-01-${String(i).padStart(2, '0')}`);
  holidayKeys.add(`${year}-02-23`);
  holidayKeys.add(`${year}-03-08`);
  holidayKeys.add(`${year}-04-01`);
  holidayKeys.add(`${year}-05-01`);
  holidayKeys.add(`${year}-05-09`);
  holidayKeys.add(`${year}-06-12`);
  holidayKeys.add(`${year}-11-04`);

  const orthodoxEaster = calculateOrthodoxEaster(year);
  const easterMonday = new Date(orthodoxEaster);
  easterMonday.setDate(orthodoxEaster.getDate() + 1);
  holidayKeys.add(toDateKey(orthodoxEaster));
  holidayKeys.add(toDateKey(easterMonday));
  holidayKeys.add(toDateKey(new Date(year, 0, 7)));

  const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return holidayKeys.has(key) || d.getDay() === 0 || d.getDay() === 6;
}

function getOrderServiceIds(order) {
  if (Array.isArray(order.serviceIds)) return order.serviceIds;
  if (typeof order.serviceIds === 'string' && order.serviceIds.trim()) {
    try { return JSON.parse(order.serviceIds); } catch (e) { return order.serviceId ? [order.serviceId] : []; }
  }
  return order.serviceId ? [order.serviceId] : [];
}

function MultiSelectFilter({ label, items, selectedIds, onChange, placeholderAll }) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleItem = (id) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(x => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const clearAll = () => onChange([]);
  const selectAll = () => onChange(items.map(i => i.id));

  return (
    <div className="relative min-w-[200px]">
      <label className="block text-xs font-semibold text-slate-500 mb-1">
        {label} {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
      </label>

      {/* Выбранные чипсы */}
      <div className="flex flex-wrap gap-1 mb-1 max-w-[300px]">
        {selectedIds.length === 0 ? (
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{placeholderAll}</span>
        ) : (
          selectedIds.map(id => {
            const item = items.find(i => i.id === id);
            return (
              <span key={id} className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">
                {item ? item.name : id}
                <button
                  type="button"
                  onClick={() => toggleItem(id)}
                  className="text-emerald-600 hover:text-emerald-900 font-bold ml-0.5"
                >
                  ✕
                </button>
              </span>
            );
          })
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-700 flex items-center justify-between w-full shadow-sm hover:bg-slate-50"
      >
        <span className="truncate">{selectedIds.length === 0 ? placeholderAll : `Выбрано: ${selectedIds.length}`}</span>
        <span className="ml-1 text-[10px] text-slate-400">▼</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-2 max-h-60 overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1 mb-1 text-[11px]">
              <button type="button" onClick={selectAll} className="text-emerald-600 hover:underline font-semibold">Выбрать все</button>
              <button type="button" onClick={clearAll} className="text-slate-400 hover:underline">Очистить</button>
            </div>
            <div className="space-y-1">
              {items.map(item => {
                const isChecked = selectedIds.includes(item.id);
                return (
                  <label key={item.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleItem(item.id)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="truncate text-slate-700">{item.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ColumnToggleDropdown({ gardeners, hiddenIds, onToggle, onShowAll }) {
  const [isOpen, setIsOpen] = useState(false);
  const hiddenCount = hiddenIds.length;

  return (
    <div className="relative">
      <label className="block text-xs font-semibold text-slate-500 mb-1">Столбцы</label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-700 flex items-center gap-1 shadow-sm hover:bg-slate-50"
      >
        <span>👁 Столбцы</span>
        {hiddenCount > 0 && (
          <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            -{hiddenCount}
          </span>
        )}
        <span className="text-[10px] text-slate-400 ml-1">▼</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 w-64 bg-white border border-slate-200 rounded-xl shadow-lg p-2 max-h-60 overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-1 mb-1 text-[11px]">
              <span className="font-semibold text-slate-600">Видимость мастеров</span>
              {hiddenCount > 0 && (
                <button type="button" onClick={onShowAll} className="text-emerald-600 hover:underline font-semibold">
                  Показать все
                </button>
              )}
            </div>
            <div className="space-y-1">
              {gardeners.map(g => {
                const isVisible = !hiddenIds.includes(g.id);
                return (
                  <label key={g.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 rounded cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      onChange={() => onToggle(g.id)}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className={`truncate ${isVisible ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{g.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 mt-2 border-t pt-1 italic">
              Подсказка: Двойной клик по заголовку столбца скрывает мастера.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('calendar');
  const [auctionOrders, setAuctionOrders] = useState([]);
  const [gardeners, setGardeners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dayOffs, setDayOffs] = useState([]);
  const [blockedDays, setBlockedDays] = useState([]);
  const [services, setServices] = useState([]);
  const [webLeads, setWebLeads] = useState([]);
  const [hasAdminVk, setHasAdminVk] = useState(false);
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [lastLeadsUpdated, setLastLeadsUpdated] = useState(null);
  const [newLeadIds, setNewLeadIds] = useState(new Set());
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Оффлайн состояние и очередь
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const pendingCountRef = useRef(0);
  const [conflictItems, setConflictItems] = useState([]);
  const [showConflictModal, setShowConflictModal] = useState(false);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const syncInFlightRef = useRef(false);

  // Состояния для форм заказа
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState({ date: null, gardenerId: null });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [formData, setFormData] = useState(emptyOrderForm);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaProgress, setMediaProgress] = useState(0);
  const mediaFileRef = useRef(null);
  const mediaCameraRef = useRef(null);
  const [convertingLeadId, setConvertingLeadId] = useState(null);
  const [exportPeriod, setExportPeriod] = useState('all');
  const [exportCustomStart, setExportCustomStart] = useState('');
  const [exportCustomEnd, setExportCustomEnd] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [startFromToday, setStartFromToday] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [tableScale, setTableScale] = useState(1);

  // Добавление / редактирование садовника
  const [newGardener, setNewGardener] = useState({ name: '', phone: '', serviceIds: [] });
  const [editingGardener, setEditingGardener] = useState(null);

  // Модал для массовой привязки VK
  const [showVkBulkModal, setShowVkBulkModal] = useState(false);
  const [vkBulkText, setVkBulkText] = useState('');
  const [vkBulkResult, setVkBulkResult] = useState(null);

  // Добавление услуги в каталог
  const [newServiceName, setNewServiceName] = useState('');

  // Фильтры календаря
  const [filterGardenerIds, setFilterGardenerIds] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterServiceIds, setFilterServiceIds] = useState([]);
  const [filterDistrict, setFilterDistrict] = useState('');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [searchQuery, setSearchQuery] = useState('');

  // Поиск ближайшего окна под запрос клиента
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [searchWeekdays, setSearchWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [searchGardenerIds, setSearchGardenerIds] = useState([]);
  const [searchServiceIds, setSearchServiceIds] = useState([]);
  const [longPressInfo, setLongPressInfo] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);

  // Скрытые столбцы с сохранением в localStorage
  const [hiddenGardenerIds, setHiddenGardenerIds] = useState([]);


  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleMessage = (event) => {
      if (event.data && event.data.type === 'OPEN_WEBLEADS_TAB') {
        setActiveTab('webleads');
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        document.title = 'Anemon Agro — Панель Диспетчера';
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('admin_hidden_gardener_ids');
      if (saved) setHiddenGardenerIds(JSON.parse(saved));
    } catch (e) {}
  }, []);

  const toggleHideGardener = (id) => {
    setHiddenGardenerIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem('admin_hidden_gardener_ids', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  const showAllColumns = () => {
    setHiddenGardenerIds([]);
    try { localStorage.setItem('admin_hidden_gardener_ids', JSON.stringify([])); } catch (e) {}
  };

  // Генерация дат для сетки календаря
  const dates = [];
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const now = new Date();

  let startDay = 1;
  if (startFromToday && now.getFullYear() === year && now.getMonth() === month) {
    startDay = now.getDate();
  }

  for (let day = startDay; day <= daysInMonth; day++) {
    dates.push(new Date(year, month, day, 12, 0, 0, 0));
  }

  const handlePrevYear = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear() - 1, prev.getMonth(), 1));
    setStartFromToday(false);
  };

  const handlePrevMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    setStartFromToday(false);
  };

  const handleNextMonth = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    setStartFromToday(false);
  };

  const handleNextYear = () => {
    setCurrentMonth(prev => new Date(prev.getFullYear() + 1, prev.getMonth(), 1));
    setStartFromToday(false);
  };

  const handleToday = () => {
    const today = new Date();
    const isCurrentMonth = currentMonth.getFullYear() === today.getFullYear() && currentMonth.getMonth() === today.getMonth();

    if (!isCurrentMonth) {
      setCurrentMonth(today);
      setStartFromToday(true);
    } else {
      setStartFromToday(prev => !prev);
    }
  };

  const maxAllowedMonth = new Date(now.getFullYear(), now.getMonth() + 12, 1);
  const nextMonthCandidate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  const isNextDisabled = nextMonthCandidate > maxAllowedMonth;
  const nextYearCandidate = new Date(currentMonth.getFullYear() + 1, currentMonth.getMonth(), 1);
  const isNextYearDisabled = nextYearCandidate > maxAllowedMonth;

  // Более длинный горизонт для поиска окна (данные уже загружены целиком, доп. запросов не нужно)
  const searchDates = [];
  for (let i = 0; i < SEARCH_HORIZON_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    searchDates.push(d);
  }

  const refreshQueueCount = async () => {
    try {
      const stats = await getQueueStats('admin');
      const count = stats.pending + stats.syncing;
      setPendingQueueCount(count);
      pendingCountRef.current = count;
      setConflictItems(stats.conflictItems);
      return stats;
    } catch (e) {
      return { total: 0, pending: 0, conflict: 0, conflictItems: [] };
    }
  };

  const ensureFreshUsersList = async () => {
    if (typeof window === 'undefined' || !navigator.onLine) return;
    try {
      const res = await apiFetch('/api/public/offline-users');
      if (res.ok) {
        const data = await res.json();
        saveCache('public_offline_users', data).catch(() => {});
      }
    } catch (e) {}
  };

  const logClientError = (message, err, pathname = '/admin') => {
    try {
      apiFetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message + (err?.message ? `: ${err.message}` : ''),
          stack: err?.stack || '',
          pathname: pathname || (typeof window !== 'undefined' ? window.location.pathname : ''),
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      }).catch(() => {});
    } catch (e) {}
  };

  const handleSyncQueue = async () => {
    if (isSyncingQueue || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    setIsSyncingQueue(true);
    try {
      const { syncedCount, hasErrors } = await syncQueue(
        null,
        (failedItem, errorMsg) => {
          logClientError(`[QueueSyncError Admin] Action ${failedItem.actionType} failed`, { message: errorMsg }, '/admin');
        },
        'admin'
      );
      await refreshQueueCount();
      if (syncedCount > 0 && !hasErrors) {
        await fetchData();
      }
    } catch (e) {
      console.error('Failed to sync queue:', e);
      logClientError('[QueueSyncFatalError Admin] Sync queue exception', e, '/admin');
    } finally {
      setIsSyncingQueue(false);
    }
  };

  const handleRetryConflicts = async () => {
    await retryConflicts('admin');
    await handleSyncQueue();
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initRoleCheck = async () => {
      const authPhone = localStorage.getItem('auth_phone');
      let role = localStorage.getItem('auth_role');
      if (!role) {
        role = await resolveOfflineRoleFromCaches(authPhone);
      }

      if (role) {
        activateOfflineSession(role, authPhone);
      }

      if (!role) {
        if (navigator.onLine && !isOfflineSessionValid()) window.location.assign('/login');
        return;
      }
      if (role !== 'ADMIN') {
        if (role === 'LEADER' || role === 'GARDENER') {
          window.location.assign(role === 'LEADER' ? '/leader' : '/gardener');
        } else if (navigator.onLine && !isOfflineSessionValid()) {
          window.location.assign('/login');
        }
        return;
      }
    };

    initRoleCheck();

    const offlineSess = localStorage.getItem('offline_session') === '1';
    const role = localStorage.getItem('auth_role');

    if (offlineSess) {
      localStorage.setItem('offline_session_ts', String(Date.now()));
      if ('serviceWorker' in navigator) {
        const postWithReply = (targetSw, msg) => {
          return new Promise((resolve) => {
            if (!targetSw) return resolve();
            if (typeof MessageChannel === 'undefined') {
              try { targetSw.postMessage(msg); } catch (e) {}
              return resolve();
            }
            const channel = new MessageChannel();
            const timer = setTimeout(() => {
              try {
                const retryChannel = new MessageChannel();
                const retryTimer = setTimeout(() => resolve(), 1000);
                retryChannel.port1.onmessage = () => { clearTimeout(retryTimer); resolve(); };
                targetSw.postMessage(msg, [retryChannel.port2]);
              } catch (e) { resolve(); }
            }, 2500);
            channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
            try { targetSw.postMessage(msg, [channel.port2]); } catch (e) { resolve(); }
          });
        };

        (async () => {
          try {
            const reg = await navigator.serviceWorker.ready;
            const targetSw = reg.active || navigator.serviceWorker.controller;
            if (targetSw) {
              await postWithReply(targetSw, { type: 'OFFLINE_SESSION', active: true, role, ts: Date.now() });
              await postWithReply(targetSw, { type: 'OFFLINE_ROLE', role });
            }
          } catch (e) {}
        })();
      }
    }

    refreshQueueCount();

    if ('serviceWorker' in navigator && navigator.onLine) {
      navigator.serviceWorker.ready.then((reg) => {
        const targetSw = reg.active || navigator.serviceWorker.controller;
        if (targetSw) {
          try { targetSw.postMessage({ type: 'PRECACHE_ROLES' }); } catch (e) {}
        }
      }).catch(() => {});
    }

    const handleOnline = () => {
      setIsOffline(false);
      handleSyncQueue();
    };

    const handleOfflineStatus = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOfflineStatus);

    const interval = setInterval(() => {
      if (navigator.onLine) {
        handleSyncQueue();
      }
    }, 30000);

    ensureFreshUsersList();

    const handleBeforeUnload = (e) => {
      if (e && e.persisted) return;
      if (typeof window !== 'undefined') {
        const manualLogout = sessionStorage.getItem('manual_logout') === '1';
        if (!manualLogout) {
          localStorage.setItem('offline_session', '1');
          localStorage.setItem('offline_session_ts', String(Date.now()));
          const role = localStorage.getItem('auth_role') || 'ADMIN';
          const phone = localStorage.getItem('auth_phone');
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            try {
              navigator.serviceWorker.controller.postMessage({
                type: 'OFFLINE_SESSION',
                active: true,
                role,
                phone,
                ts: Date.now()
              });
            } catch (err) {}
          }
        }
      }
      if (pendingCountRef.current > 0) {
        if (e) {
          e.preventDefault();
          e.returnValue = 'Есть неотправленные изменения! Они отправятся при следующем подключении.';
          return e.returnValue;
        }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOfflineStatus);
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
    };
  }, [pendingQueueCount]);

  const loadWebLeads = async (silent = false) => {
    try {
      const resW = await apiFetch('/api/admin/webleads');
      if (resW.ok) {
        const dataW = await resW.json();
        const incomingLeads = dataW.webLeads || [];
        saveCache('admin_webLeads', incomingLeads);

        setWebLeads(prevLeads => {
          if (prevLeads.length > 0) {
            const existingIds = new Set(prevLeads.map(l => l.id));
            const newlyDiscoveredObj = incomingLeads.filter(l => !existingIds.has(l.id));
            const newlyDiscovered = newlyDiscoveredObj.map(l => l.id);
            if (newlyDiscovered.length > 0) {
              setNewLeadIds(prev => new Set([...prev, ...newlyDiscovered]));
              setTimeout(() => {
                setNewLeadIds(prev => {
                  const next = new Set(prev);
                  newlyDiscovered.forEach(id => next.delete(id));
                  return next;
                });
              }, 6000);

              const latestLead = newlyDiscoveredObj[0];
              if (latestLead) {
                const bodyStr = [
                  `Имя: ${latestLead.name || 'Не указано'}`,
                  `Тел: ${latestLead.phone || ''}`,
                  latestLead.serviceName ? `Услуга: ${latestLead.serviceName}` : null,
                  latestLead.district ? `Район: ${latestLead.district}` : null,
                ].filter(Boolean).join(', ');

                clientNotify('🌐 Новая заявка с сайта', bodyStr, latestLead.id, '/admin');
                if (document.hidden) {
                  document.title = `(${newlyDiscovered.length}) Anemon Agro — Панель Диспетчера`;
                }
              }
            }
          }
          return incomingLeads;
        });

        setHasAdminVk(Boolean(dataW.hasAdminVk));
        setLastLeadsUpdated(new Date().toLocaleTimeString('ru-RU'));
      }
    } catch (e) {
      console.error('Failed to load webLeads:', e);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentMonth, startFromToday]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      checkSheetUrl();
    }
  }, []);

  useEffect(() => {
    const triggerAutoSync = async () => {
      if (typeof navigator === 'undefined' || !navigator.onLine) return;
      if (syncInFlightRef.current) return;
      const role = localStorage.getItem('auth_role');
      if (role !== 'ADMIN' && role !== 'LEADER') return;

      const lastSync = localStorage.getItem('last_sheets_sync_ts');
      const now = Date.now();
      if (!lastSync || (now - Number(lastSync) > 60 * 60 * 1000)) {
        syncInFlightRef.current = true;
        try {
          const res = await apiFetch('/api/admin/sync-sheets', { method: 'POST' });
          if (res.ok) {
            localStorage.setItem('last_sheets_sync_ts', String(now));
          }
        } catch (e) {
        } finally {
          syncInFlightRef.current = false;
        }
      }
    };
    triggerAutoSync();
    const intervalId = setInterval(triggerAutoSync, 10 * 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      loadWebLeads(true);
    }, 15000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadWebLeads(true);
      }
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const isOfflineSessionGuard = () => {
    if (typeof window === 'undefined') return false;
    return !navigator.onLine;
  };

  const fetchData = async () => {
    setLoading(true);
    setMonthLoading(true);

    if (isOfflineSessionGuard()) {
      setIsOffline(true);
      const authPhone = typeof window !== 'undefined' ? localStorage.getItem('auth_phone') : null;
      let storedRole = typeof window !== 'undefined' ? localStorage.getItem('auth_role') : null;
      if (!storedRole) {
        storedRole = await resolveOfflineRoleFromCaches(authPhone);
        if (storedRole) {
          activateOfflineSession(storedRole, authPhone);
        }
      }
      if (!storedRole) {
        if (navigator.onLine) window.location.assign('/login');
        setLoading(false);
        setMonthLoading(false);
        return;
      }
      if (storedRole !== 'ADMIN') {
        if (storedRole === 'LEADER' || storedRole === 'GARDENER') {
          window.location.assign(storedRole === 'LEADER' ? '/leader' : '/gardener');
        } else if (navigator.onLine) {
          window.location.assign('/login');
        }
        return;
      }

      const cachedOrders = (await getCache('admin_orders'))?.data || [];
      const cachedGardeners = (await getCache('admin_gardeners'))?.data || [];
      const cachedServices = (await getCache('admin_services'))?.data || [];
      const cachedDayOffs = (await getCache('admin_dayOffs'))?.data || [];
      const cachedBlockedDays = (await getCache('admin_blockedDays'))?.data || [];
      const cachedWebLeads = (await getCache('admin_webLeads'))?.data || [];
      const cachedMe = (await getCache('admin_me'))?.data || null;

      setGardeners(cachedGardeners);
      setOrders(cachedOrders.filter(o => o.status !== 'Аукцион'));
      setAuctionOrders(cachedOrders.filter(o => o.status === 'Аукцион' || o.wasAuction));
      setDayOffs(cachedDayOffs);
      setBlockedDays(cachedBlockedDays);
      setServices(cachedServices);
      setWebLeads(cachedWebLeads);
      if (cachedMe) setCurrentUser(cachedMe);

      setLoading(false);
      setMonthLoading(false);
      await refreshQueueCount();
      return;
    }

    try {
      const year = currentMonth.getFullYear();
      const month = currentMonth.getMonth();
      const now = new Date();

      let startOfMonth;
      if (startFromToday && now.getFullYear() === year && now.getMonth() === month) {
        startOfMonth = new Date(year, month, now.getDate(), 0, 0, 0, 0);
      } else {
        startOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
      }
      const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

      const [resG, resO, resD, resB, resS, resMe] = await Promise.all([
        apiFetch('/api/admin/gardeners'),
        apiFetch(`/api/admin/orders?start=${encodeURIComponent(startOfMonth.toISOString())}&end=${encodeURIComponent(endOfMonth.toISOString())}`),
        apiFetch(`/api/admin/dayoff?start=${encodeURIComponent(startOfMonth.toISOString())}&end=${encodeURIComponent(endOfMonth.toISOString())}`),
        apiFetch(`/api/admin/blockday?start=${encodeURIComponent(startOfMonth.toISOString())}&end=${encodeURIComponent(endOfMonth.toISOString())}`),
        apiFetch('/api/admin/services'),
        apiFetch('/api/auth/me')
      ]);

      if (!resG.ok || !resO.ok) {
        throw new Error('Server returned error or offline 503');
      }

      if (resMe.ok) {
        const meData = await resMe.json();
        setCurrentUser(meData.user || null);
        saveCache('admin_me', meData.user || null);
      }
      const dataG = await resG.json();
      const dataO = await resO.json();
      const dataD = resD.ok ? await resD.json() : {};
      const dataB = resB.ok ? await resB.json() : {};
      const dataS = resS.ok ? await resS.json() : {};
      const allOrd = dataO.orders || [];

      setGardeners(dataG.gardeners || []);
      setOrders(allOrd.filter(o => o.status !== 'Аукцион'));
      setAuctionOrders(allOrd.filter(o => o.status === 'Аукцион' || o.wasAuction));
      setDayOffs(dataD.dayOffs || []);
      setBlockedDays(dataB.blockedDays || []);
      setServices(dataS.services || []);

      saveCache('admin_orders', allOrd);
      saveCache('admin_gardeners', dataG.gardeners || []);
      saveCache('admin_services', dataS.services || []);
      saveCache('admin_dayOffs', dataD.dayOffs || []);
      saveCache('admin_blockedDays', dataB.blockedDays || []);

      setIsOffline(false);
      await loadWebLeads(true);
    } catch (e) {
      console.warn('Network error during fetchData, using cached offline data:', e);
      setIsOffline(true);

      const cachedOrders = (await getCache('admin_orders'))?.data || [];
      const cachedGardeners = (await getCache('admin_gardeners'))?.data || [];
      const cachedServices = (await getCache('admin_services'))?.data || [];
      const cachedDayOffs = (await getCache('admin_dayOffs'))?.data || [];
      const cachedBlockedDays = (await getCache('admin_blockedDays'))?.data || [];
      const cachedWebLeads = (await getCache('admin_webLeads'))?.data || [];
      const cachedMe = (await getCache('admin_me'))?.data || null;

      setGardeners(cachedGardeners);
      setOrders(cachedOrders.filter(o => o.status !== 'Аукцион'));
      setAuctionOrders(cachedOrders.filter(o => o.status === 'Аукцион' || o.wasAuction));
      setDayOffs(cachedDayOffs);
      setBlockedDays(cachedBlockedDays);
      setServices(cachedServices);
      setWebLeads(cachedWebLeads);
      if (cachedMe) setCurrentUser(cachedMe);
    } finally {
      setLoading(false);
      setMonthLoading(false);
      await refreshQueueCount();
    }
  };

  const handleLogout = async () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('logout_confirmed', '1');
        sessionStorage.setItem('manual_logout', '1');
        localStorage.removeItem('auth_role');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('offline_session');
        localStorage.removeItem('offline_session_ts');
        localStorage.removeItem('auth_session_cached');

        if ('serviceWorker' in navigator) {
          const postWithReply = (targetSw, msg, timeoutMs = 500) => {
            return new Promise((resolve) => {
              if (!targetSw) return resolve();
              if (typeof MessageChannel === 'undefined') {
                try { targetSw.postMessage(msg); } catch (e) {}
                return resolve();
              }
              const channel = new MessageChannel();
              const timer = setTimeout(() => resolve(), timeoutMs);
              channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
              try { targetSw.postMessage(msg, [channel.port2]); } catch (e) { clearTimeout(timer); resolve(); }
            });
          };

          try {
            const reg = await navigator.serviceWorker.ready;
            const targetSw = reg.active || navigator.serviceWorker.controller;
            if (targetSw) {
              await postWithReply(targetSw, { type: 'OFFLINE_SESSION', active: false, role: null });
              await postWithReply(targetSw, { type: 'OFFLINE_ROLE', role: null });
              await Promise.race([
                postWithReply(targetSw, { type: 'ENSURE_LOGIN_CACHED' }, 3000),
                new Promise((resolve) => setTimeout(resolve, 3000)),
              ]);
            }
          } catch (e) {}
        }

        if ('PushManager' in window && 'serviceWorker' in navigator) {
          navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => {
            if (sub && navigator.onLine) {
              apiFetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: sub.endpoint }),
              }).catch(() => {});
            }
          }).catch(() => {});
        }
      } catch (e) {}

      if (navigator.onLine) {
        try {
          await Promise.race([
            apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 2000)),
          ]).catch(() => {});
        } catch (e) {}
        window.location.replace('/login');
      } else {
        window.location.assign('/login');
      }
    } else {
      router.push('/login');
    }
  };

  const [syncing, setSyncing] = useState(false);

  const checkSheetUrl = async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await apiFetch('/api/admin/sheet-url', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          localStorage.setItem('cached_sheet_url', data.url);
          return data.url;
        }
      }
    } catch (e) {}
    return localStorage.getItem('cached_sheet_url') || null;
  };

  const handleSyncSheets = async () => {
    if (syncing) return;
    const isOnlineState = typeof navigator !== 'undefined' && navigator.onLine;
    let sheetUrl = null;

    if (isOnlineState) {
      sheetUrl = await checkSheetUrl();
    } else {
      sheetUrl = localStorage.getItem('cached_sheet_url') || process.env.NEXT_PUBLIC_GOOGLE_SHEET_URL || null;
    }

    if (isOnlineState && sheetUrl) {
      setSyncing(true);
      syncInFlightRef.current = true;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const res = await apiFetch('/api/admin/sync-sheets', {
          method: 'POST',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          localStorage.setItem('last_sheets_sync_ts', String(Date.now()));
        }
      } catch (e) {
        console.warn('Sync sheets failed or timed out:', e.message);
      } finally {
        setSyncing(false);
        syncInFlightRef.current = false;
        window.open(sheetUrl, '_blank');
      }
    } else if (sheetUrl) {
      window.open(sheetUrl, '_blank');
    } else {
      clientNotify('⚠️ Внимание', 'Нет соединения, откройте таблицу позже');
    }
  };

  const openNewOrderModal = (dateStr, gardenerId) => {
    setSelectedOrder(null);
    setConvertingLeadId(null);
    setSelectedSlot({ date: dateStr, gardenerId });
    setFormData({ ...emptyOrderForm, date: dateStr, gardenerId, serviceId: '' });
    setShowOrderModal(true);
  };

  const sendLeadToAuction = async (lead) => {
    const dateStr = lead.preferredDate ? lead.preferredDate.split('T')[0] : new Date().toISOString().split('T')[0];

    let matchedServiceId = lead.serviceId || '';
    if (!matchedServiceId && lead.serviceName && services.length > 0) {
      const found = services.find(s => (s.name || s.title || '').toLowerCase().trim() === lead.serviceName.toLowerCase().trim());
      if (found) {
        matchedServiceId = found.id;
      }
    }

    const payload = {
      ...emptyOrderForm,
      clientName: lead.name,
      clientPhone: lead.phone,
      address: lead.address || '',
      district: lead.district || '',
      description: lead.comment || '',
      date: dateStr,
      serviceId: matchedServiceId,
      serviceIds: matchedServiceId ? JSON.stringify([matchedServiceId]) : null,
      status: 'Аукцион',
      gardenerId: null,
      wasAuction: true,
      fromLead: true
    };

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      const tmpId = 'tmp_auc_' + Date.now();
      const newOrder = { ...payload, id: tmpId };
      setAuctionOrders(prev => [newOrder, ...prev]);
      setWebLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'Обработана', assignedTo: 'Аукцион', createdOrderId: tmpId } : l));

      await enqueueAction({ actionType: 'ADMIN_ORDER_POST', url: '/api/admin/orders', method: 'POST', payload: { ...payload, id: tmpId }, scope: 'admin' });
      await enqueueAction({ actionType: 'ADMIN_WEBLEAD_PUT', url: '/api/admin/webleads', method: 'PUT', payload: { id: lead.id, status: 'Обработана', assignedTo: 'Аукцион', createdOrderId: tmpId }, scope: 'admin' });
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        await apiFetch('/api/admin/webleads', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: lead.id,
            status: 'Обработана',
            assignedTo: 'Аукцион',
            createdOrderId: data.order ? data.order.id : undefined
          })
        });
        fetchData();
        alert('Заявка успешно выставлена на аукцион!');
      } else {
        const data = await res.json();
        alert(data.error || 'Не удалось отправить заявку на аукцион');
      }
    } catch (err) {
      alert('Ошибка при отправке заявки на аукцион');
    }
  };

  const openLeadAsOrder = (lead) => {
    setConvertingLeadId(lead.id);

    const existingOrder = lead.createdOrderId ? orders.find(o => o.id === lead.createdOrderId) : null;
    if (existingOrder) {
      // Редактируем существующий заказ (PUT)
      setSelectedOrder(existingOrder);
      setFormData({
        clientName: existingOrder.clientName,
        clientPhone: existingOrder.clientPhone,
        address: existingOrder.address,
        district: existingOrder.district || '',
        description: existingOrder.description,
        priceContract: existingOrder.priceContract,
        priceFact: existingOrder.priceFact,
        employeeSalary: existingOrder.employeeSalary,
        companyShare: existingOrder.companyShare,
        status: existingOrder.status,
        comment: existingOrder.comment || '',
        refusalReason: existingOrder.refusalReason || '',
        date: existingOrder.date ? existingOrder.date.split('T')[0] : '',
        gardenerId: existingOrder.gardenerId || '',
        serviceId: existingOrder.serviceId || '',
        serviceIds: getOrderServiceIds(existingOrder),
        isCash: existingOrder.isCash !== undefined ? existingOrder.isCash : true,
        orderMedia: parseOrderMedia(existingOrder.orderMedia),
      });
      setShowOrderModal(true);
      return;
    }

    // Первое назначение — создаём новый заказ
    setSelectedOrder(null);
    const dateStr = lead.preferredDate ? lead.preferredDate.split('T')[0] : '';
    setSelectedSlot({ date: dateStr, gardenerId: '' });

    let matchedServiceId = lead.serviceId || '';
    if (!matchedServiceId && lead.serviceName && services.length > 0) {
      const found = services.find(s => s.name && s.name.toLowerCase().trim() === lead.serviceName.toLowerCase().trim());
      if (found) {
        matchedServiceId = found.id;
      }
    }

    setFormData({
      ...emptyOrderForm,
      clientName: lead.name,
      clientPhone: lead.phone,
      address: lead.address || '',
      district: lead.district || '',
      description: lead.comment || '',
      date: dateStr,
      serviceId: matchedServiceId,
      serviceIds: matchedServiceId ? [matchedServiceId] : []
    });
    setShowOrderModal(true);
  };

  const handleMarkLeadProcessed = async (id) => {
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setWebLeads(prev => prev.map(l => l.id === id ? { ...l, status: 'Обработана' } : l));
      await enqueueAction({ actionType: 'ADMIN_WEBLEAD_PUT', url: '/api/admin/webleads', method: 'PUT', payload: { id, status: 'Обработана' }, scope: 'admin' });
      await refreshQueueCount();
      return;
    }

    await apiFetch('/api/admin/webleads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'Обработана' })
    });
    fetchData();
  };

  const handleDeleteLead = async (id) => {
    if (!confirm('Удалить эту заявку?')) return;

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setWebLeads(prev => prev.filter(l => l.id !== id));
      await enqueueAction({ actionType: 'ADMIN_WEBLEAD_DELETE', url: '/api/admin/webleads', method: 'DELETE', payload: { id }, scope: 'admin' });
      await refreshQueueCount();
      return;
    }

    await apiFetch('/api/admin/webleads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    fetchData();
  };

  const handleMediaSelect = async (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    for (const file of files) {
      const isVideo = file.type.startsWith('video/') || !!file.name.match(/\.(mp4|webm|mov|mkv|avi|3gp|ogv)$/i);
      if (isVideo && file.size > 15 * 1024 * 1024) {
        clientNotify(`Видео «${file.name}» превышает лимит 15 МБ`, 'error');
        return;
      }
      if (!isVideo && file.size > 5 * 1024 * 1024) {
        clientNotify(`Фото «${file.name}» превышает лимит 5 МБ`, 'error');
        return;
      }
    }

    setUploadingMedia(true);
    setMediaProgress(0);

    try {
      const uploadedItems = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const isVideo = file.type.startsWith('video/') || !!file.name.match(/\.(mp4|webm|mov|mkv|avi|3gp|ogv)$/i);
        const fd = new FormData();
        fd.append('file', file);
        fd.append('type', 'order_media');

        const data = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/gardener/upload', true);
          if (xhr.upload) {
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const filePct = (e.loaded / e.total) * 100;
                const totalPct = Math.round(((i + filePct / 100) / files.length) * 100);
                setMediaProgress(totalPct);
              }
            };
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve({}); }
            } else {
              try {
                const errJson = JSON.parse(xhr.responseText);
                reject(new Error(errJson.error || `Ошибка загрузки (${xhr.status})`));
              } catch (e) {
                reject(new Error(`Ошибка загрузки (${xhr.status})`));
              }
            }
          };
          xhr.onerror = () => reject(new Error('Сетевая ошибка при загрузке'));
          xhr.send(fd);
        });

        if (data.url) {
          uploadedItems.push({
            url: data.url,
            type: isVideo ? 'video' : 'image',
            name: file.name
          });
        }
      }

      setFormData(prev => ({
        ...prev,
        orderMedia: [...(prev.orderMedia || []), ...uploadedItems]
      }));
      clientNotify('Медиафайлы успешно загружены', 'success');
    } catch (err) {
      console.error('Media upload error:', err);
      clientNotify(err.message || 'Ошибка при загрузке медиафайлов', 'error');
    } finally {
      setUploadingMedia(false);
      setMediaProgress(0);
      if (mediaFileRef.current) mediaFileRef.current.value = '';
      if (mediaCameraRef.current) mediaCameraRef.current.value = '';
    }
  };

  const openEditOrderModal = (order) => {
    setSelectedOrder(order);
    setFormData({
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      district: order.district || '',
      description: order.description,
      priceContract: order.priceContract,
      priceFact: order.priceFact,
      employeeSalary: order.employeeSalary,
      companyShare: order.companyShare,
      status: order.status,
      comment: order.comment || '',
      refusalReason: order.refusalReason || '',
      date: order.date ? order.date.split('T')[0] : '',
      gardenerId: order.gardenerId || '',
      serviceId: order.serviceId || '',
      serviceIds: getOrderServiceIds(order),
      isCash: order.isCash !== undefined ? order.isCash : true,
      orderMedia: parseOrderMedia(order.orderMedia),
    });
    setShowOrderModal(true);

    if (order && order.id) {
      apiFetch('/api/admin/orders?id=' + encodeURIComponent(order.id))
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.order) {
            const fresh = data.order;
            setSelectedOrder(prev => (prev && prev.id === fresh.id ? { ...prev, ...fresh } : prev));
            setFormData(prev => ({
              ...prev,
              orderMedia: parseOrderMedia(fresh.orderMedia)
            }));
          }
        })
        .catch(() => {});
    }
  };

  const handleSaveOrder = async (e, forceAuction = false) => {
    if (e) e.preventDefault();

    if (!forceAuction && (formData.status === 'Отказ' || formData.status === 'Отменен') && (!formData.refusalReason || !formData.refusalReason.trim())) {
      alert('Заполните причину отказа / отмены заказа!');
      return;
    }

    const endpoint = '/api/admin/orders';
    const method = selectedOrder ? 'PUT' : 'POST';

    const targetStatus = forceAuction ? 'Аукцион' : formData.status;
    const formDataCustom = {
      ...formData,
      status: targetStatus,
      gardenerId: forceAuction ? null : formData.gardenerId,
      wasAuction: forceAuction ? true : undefined
    };

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      if (!selectedOrder) {
        const tmpId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const newOrder = {
          ...formDataCustom,
          id: tmpId,
          date: formDataCustom.date ? new Date(formDataCustom.date).toISOString() : new Date().toISOString(),
          gardener: gardeners.find(g => g.id === formDataCustom.gardenerId) || null,
          service: services.find(s => s.id === formDataCustom.serviceId) || null,
        };

        if (targetStatus === 'Аукцион') {
          setAuctionOrders(prev => [newOrder, ...prev]);
        } else {
          setOrders(prev => [newOrder, ...prev]);
        }

        await enqueueAction({
          actionType: 'ADMIN_ORDER_POST',
          url: endpoint,
          method: 'POST',
          payload: { ...formDataCustom, id: tmpId, fromLead: !!convertingLeadId },
          scope: 'admin'
        });
      } else {
        const updatedOrder = {
          ...selectedOrder,
          ...formDataCustom,
          gardener: gardeners.find(g => g.id === formDataCustom.gardenerId) || selectedOrder.gardener,
          service: services.find(s => s.id === formDataCustom.serviceId) || selectedOrder.service,
        };

        if (targetStatus === 'Аукцион') {
          setOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
          setAuctionOrders(prev => [updatedOrder, ...prev.filter(o => o.id !== selectedOrder.id)]);
        } else {
          setAuctionOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
          setOrders(prev => [...prev.filter(o => o.id !== selectedOrder.id), updatedOrder]);
        }

        await enqueueAction({
          actionType: 'ADMIN_ORDER_PUT',
          url: endpoint,
          method: 'PUT',
          payload: { id: selectedOrder.id, ...formDataCustom },
          scope: 'admin'
        });
      }

      if (convertingLeadId) {
        const assignedGardener = gardeners.find(g => g.id === formData.gardenerId);
        const leadUpdate = {
          id: convertingLeadId,
          status: 'Обработана',
          assignedTo: assignedGardener ? assignedGardener.name : null
        };
        setWebLeads(prev => prev.map(l => l.id === convertingLeadId ? { ...l, ...leadUpdate } : l));
        await enqueueAction({
          actionType: 'ADMIN_WEBLEAD_PUT',
          url: '/api/admin/webleads',
          method: 'PUT',
          payload: leadUpdate,
          scope: 'admin'
        });
        setConvertingLeadId(null);
      }

      setShowOrderModal(false);
      await refreshQueueCount();
      return;
    }

    const payload = selectedOrder
      ? { id: selectedOrder.id, ...formDataCustom }
      : { ...formDataCustom, fromLead: !!convertingLeadId };

    try {
      const res = await apiFetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if (convertingLeadId) {
          const assignedGardener = gardeners.find(g => g.id === formData.gardenerId);
          const leadUpdate = {
            id: convertingLeadId,
            status: 'Обработана',
            assignedTo: assignedGardener ? assignedGardener.name : null
          };
          if (!selectedOrder && data.order) {
            leadUpdate.createdOrderId = data.order.id;
          }
          await apiFetch('/api/admin/webleads', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(leadUpdate)
          });
          setConvertingLeadId(null);
        }
        setShowOrderModal(false);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      alert('Ошибка при сохранении заказа');
    }
  };

  const handleDeleteOrder = async () => {
    if (!selectedOrder) return;
    if (!confirm('Удалить этот заказ? Это действие нельзя отменить.')) return;

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOfflineMode) {
      setOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
      setAuctionOrders(prev => prev.filter(o => o.id !== selectedOrder.id));
      await enqueueAction({
        actionType: 'ADMIN_ORDER_DELETE',
        url: `/api/admin/orders?id=${selectedOrder.id}`,
        method: 'DELETE',
        payload: { id: selectedOrder.id },
        scope: 'admin'
      });
      setShowOrderModal(false);
      await refreshQueueCount();
      return;
    }

    console.log('🖱️ [FRONTEND] Вызываю удаление заказа ID:', selectedOrder.id);
    const res = await apiFetch(`/api/admin/orders?id=${selectedOrder.id}`, {
      method: 'DELETE',
    });
    const responseText = await res.text();
    console.log('🖱️ [FRONTEND] Ответ сервера:', res.status, responseText);

    if (res.ok) {
      setShowOrderModal(false);
      fetchData();
    } else {
      alert('Ошибка удаления: ' + responseText);
    }
  };

  const handleAddGardener = async (e) => {
    e.preventDefault();
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      const tmpId = 'tmp_g_' + Date.now();
      const newGardenerObj = {
        id: tmpId,
        name: newGardener.name,
        phone: newGardener.phone,
        services: services.filter(s => newGardener.serviceIds.includes(s.id))
      };
      setGardeners(prev => [...prev, newGardenerObj]);
      await enqueueAction({
        actionType: 'ADMIN_GARDENER_POST',
        url: '/api/admin/gardeners',
        method: 'POST',
        payload: { ...newGardener, id: tmpId },
        scope: 'admin'
      });
      setNewGardener({ name: '', phone: '', serviceIds: [] });
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/gardeners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newGardener)
      });
      if (res.ok) {
        setNewGardener({ name: '', phone: '', serviceIds: [] });
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      alert('Ошибка при добавлении садовника');
    }
  };

  const toggleNewGardenerService = (serviceId) => {
    setNewGardener(prev => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId]
    }));
  };

  const openEditGardener = (g) => {
    let slots = [];
    if (g.timeSlots) {
      if (Array.isArray(g.timeSlots)) slots = g.timeSlots;
      else if (typeof g.timeSlots === 'string') {
        try { slots = JSON.parse(g.timeSlots); } catch (e) { slots = []; }
      }
    }
    setEditingGardener({
      id: g.id,
      name: g.name,
      phone: g.phone,
      serviceIds: (g.services || []).map(s => s.id),
      vkId: g.vkId || '',
      jobTitle: g.jobTitle || 'садовник',
      timeSlots: slots,
      isRegular: Boolean(g.isRegular),
      annualContract: Boolean(g.annualContract),
      partnerId: g.partnerId || ''
    });
  };

  const toggleEditGardenerService = (serviceId) => {
    setEditingGardener(prev => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId]
    }));
  };

  const handleUpdateGardener = async (e) => {
    e.preventDefault();
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setGardeners(prev => prev.map(g => g.id === editingGardener.id ? {
        ...g,
        ...editingGardener,
        services: services.filter(s => editingGardener.serviceIds.includes(s.id))
      } : g));
      await enqueueAction({
        actionType: 'ADMIN_GARDENER_PUT',
        url: '/api/admin/gardeners',
        method: 'PUT',
        payload: editingGardener,
        scope: 'admin'
      });
      setEditingGardener(null);
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/gardeners', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingGardener)
      });
      if (res.ok) {
        setEditingGardener(null);
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      alert('Ошибка при обновлении садовника');
    }
  };

  const handleDeleteGardener = async (id) => {
    if (!confirm('Удалить этого садовника и его личный кабинет?')) return;

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setGardeners(prev => prev.filter(g => g.id !== id));
      await enqueueAction({
        actionType: 'ADMIN_GARDENER_DELETE',
        url: '/api/admin/gardeners',
        method: 'DELETE',
        payload: { id },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    const res = await apiFetch('/api/admin/gardeners', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  const handleRestoreRefusalOrder = async (orderId) => {
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'Новый заказ', refusalReason: null } : o));
      await enqueueAction({
        actionType: 'ADMIN_ORDER_PUT',
        url: '/api/admin/orders',
        method: 'PUT',
        payload: { id: orderId, status: 'Новый заказ', refusalReason: null },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, status: 'Новый заказ', refusalReason: null })
      });
      if (res.ok) {
        fetchData();
      } else {
        alert((await res.json()).error || 'Не удалось вернуть заказ в работу');
      }
    } catch (err) {
      alert('Ошибка сети');
    }
  };

  const handleMoveToRefusal = async () => {
    const reason = prompt('Укажите причину отказа:', formData.refusalReason || 'Отказ');
    if (reason === null) return;
    const updatedForm = {
      ...formData,
      status: 'Отказ',
      refusalReason: reason.trim() || 'Без указания причины'
    };
    setFormData(updatedForm);

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      if (selectedOrder) {
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, ...updatedForm } : o));
        await enqueueAction({
          actionType: 'ADMIN_ORDER_PUT',
          url: '/api/admin/orders',
          method: 'PUT',
          payload: { id: selectedOrder.id, ...updatedForm },
          scope: 'admin'
        });
      } else {
        const tmpId = 'tmp_' + Date.now();
        const newOrder = { ...updatedForm, id: tmpId };
        setOrders(prev => [newOrder, ...prev]);
        await enqueueAction({
          actionType: 'ADMIN_ORDER_POST',
          url: '/api/admin/orders',
          method: 'POST',
          payload: { ...updatedForm, id: tmpId },
          scope: 'admin'
        });
      }
      setShowOrderModal(false);
      await refreshQueueCount();
      return;
    }

    if (selectedOrder) {
      const res = await apiFetch('/api/admin/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedOrder.id, ...updatedForm })
      });
      if (res.ok) {
        setShowOrderModal(false);
        fetchData();
      } else {
        alert((await res.json()).error || 'Ошибка при переносе в отказы');
      }
    } else {
      const res = await apiFetch('/api/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedForm)
      });
      if (res.ok) {
        setShowOrderModal(false);
        fetchData();
      } else {
        alert((await res.json()).error || 'Ошибка при создании отказа');
      }
    }
  };

  const handleToggleBlockDay = async (dateStr, gardenerId) => {
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      const exists = blockedDays.some(b => b.gardenerId === gardenerId && b.date.startsWith(dateStr));
      if (exists) {
        setBlockedDays(prev => prev.filter(b => !(b.gardenerId === gardenerId && b.date.startsWith(dateStr))));
      } else {
        setBlockedDays(prev => [...prev, { id: 'tmp_block_' + Date.now(), gardenerId, date: dateStr }]);
      }
      await enqueueAction({
        actionType: 'ADMIN_BLOCKDAY_POST',
        url: '/api/admin/blockday',
        method: 'POST',
        payload: { date: dateStr, gardenerId },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/blockday', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateStr, gardenerId })
      });
      const data = await res.json();
      if (res.ok) {
        fetchData();
      } else {
        alert(data.error || 'Ошибка смены блокировки дня');
      }
    } catch (err) {
      alert('Не удалось изменить блокировку дня');
    }
  };

  // Массовая привязка vkId по списку phone,vkId (н-р: 79991234567,12345) или json entries
  const handleVkBulkBind = async () => {
    if (!vkBulkText || !vkBulkText.trim()) return alert('Вставьте список phone,vkId в поле');
    setVkBulkResult(null);

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      await enqueueAction({
        actionType: 'ADMIN_VK_BULK_POST',
        url: '/api/admin/gardeners/bulk-bind',
        method: 'POST',
        payload: { text: vkBulkText },
        scope: 'admin'
      });
      setShowVkBulkModal(false);
      setVkBulkText('');
      await refreshQueueCount();
      alert('Привязка VK добавлена в очередь и выполнится при появлении сети');
      return;
    }

    try {
      const res = await apiFetch('/api/admin/gardeners/bulk-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: vkBulkText })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Ошибка');
        return;
      }
      setVkBulkResult(data.results);
      fetchData();
    } catch (e) {
      alert('Ошибка: ' + e.message);
    }
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      const tmpId = 'tmp_svc_' + Date.now();
      const newSvc = { id: tmpId, name: newServiceName.trim() };
      setServices(prev => [...prev, newSvc]);
      await enqueueAction({
        actionType: 'ADMIN_SERVICE_POST',
        url: '/api/admin/services',
        method: 'POST',
        payload: { id: tmpId, name: newServiceName.trim() },
        scope: 'admin'
      });
      setNewServiceName('');
      await refreshQueueCount();
      return;
    }

    try {
      const res = await apiFetch('/api/admin/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newServiceName.trim() })
      });
      if (res.ok) {
        setNewServiceName('');
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch (err) {
      alert('Ошибка при добавлении услуги');
    }
  };

  const handleDeleteService = async (id) => {
    if (!confirm('Удалить эту услугу из списка? У заказов с этой услугой она просто станет пустой.')) return;

    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setServices(prev => prev.filter(s => s.id !== id));
      await enqueueAction({
        actionType: 'ADMIN_SERVICE_DELETE',
        url: '/api/admin/services',
        method: 'DELETE',
        payload: { id },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    const res = await apiFetch('/api/admin/services', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  const handleMarkDayOff = async (dateStr, gardenerId) => {
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      const tmpId = 'tmp_dayoff_' + Date.now();
      setDayOffs(prev => [...prev, { id: tmpId, date: dateStr, gardenerId }]);
      await enqueueAction({
        actionType: 'ADMIN_DAYOFF_POST',
        url: '/api/admin/dayoff',
        method: 'POST',
        payload: { id: tmpId, date: dateStr, gardenerId },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    const res = await apiFetch('/api/admin/dayoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: dateStr, gardenerId })
    });
    if (res.ok) {
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error);
    }
  };

  const handleRemoveDayOff = async (id) => {
    const isOfflineMode = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOfflineMode) {
      setDayOffs(prev => prev.filter(d => d.id !== id));
      await enqueueAction({
        actionType: 'ADMIN_DAYOFF_DELETE',
        url: '/api/admin/dayoff',
        method: 'DELETE',
        payload: { id },
        scope: 'admin'
      });
      await refreshQueueCount();
      return;
    }

    const res = await apiFetch('/api/admin/dayoff', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  const toggleWeekday = (idx) => {
    setSelectedWeekdays(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const toggleSearchWeekday = (idx) => {
    setSearchWeekdays(prev =>
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const clearLongPressInfo = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    setLongPressInfo(null);
  };

  const handleLongPressSlot = (slot, dateStr) => {
    if (!slot || !slot.gardener || !slot.existingOrder) return;
    const details = [
      slot.existingOrder.address ? `Адрес: ${slot.existingOrder.address}` : null,
      slot.existingOrder.description ? `Описание: ${slot.existingOrder.description}` : null,
      slot.existingOrder.clientName ? `Клиент: ${slot.existingOrder.clientName}` : null,
      slot.existingOrder.status ? `Статус: ${slot.existingOrder.status}` : null,
    ].filter(Boolean);

    setLongPressInfo({
      dateStr,
      gardenerName: slot.gardener.name,
      details: details.length ? details : ['Заказов нет в этом окне'],
    });
  };

  let visibleGardeners = gardeners || [];
  const hasGardenerFilter = Array.isArray(filterGardenerIds) && filterGardenerIds.length > 0;
  const hasServiceFilter = Array.isArray(filterServiceIds) && filterServiceIds.length > 0;

  if (hasGardenerFilter || hasServiceFilter) {
    visibleGardeners = (gardeners || []).filter(g => {
      const matchGardener = hasGardenerFilter && filterGardenerIds.includes(g.id);
      const matchService = hasServiceFilter && (g.services || []).some(s => filterServiceIds.includes(s.id));
      return matchGardener || matchService;
    });
  }

  if (filterDistrict) {
    const normalizedDistrict = filterDistrict.trim().toLocaleLowerCase('ru-RU');
    visibleGardeners = visibleGardeners.filter(g => (orders || []).some(order =>
      order.gardenerId === g.id && (order.district || '').trim().toLocaleLowerCase('ru-RU') === normalizedDistrict
    ));
  }

  const matchesSearch = (order) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const fields = [
      order.clientName,
      order.clientPhone,
      order.address,
      order.district,
      order.description,
      order.comment,
      order.refusalReason,
    ];
    const phoneDigitsQ = q.replace(/\D/g, '');
    const phoneDigits = String(order.clientPhone || '').replace(/\D/g, '');
    return fields.some(f => String(f || '').toLowerCase().includes(q)) ||
           (!!phoneDigitsQ && phoneDigits.includes(phoneDigitsQ));
  };

  const filteredOrders = (orders || []).filter(o => {
    if (!matchesSearch(o)) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;

    if (hasGardenerFilter || hasServiceFilter) {
      const matchGardener = hasGardenerFilter && filterGardenerIds.includes(o.gardenerId);
      const orderServiceIds = getOrderServiceIds(o);
      const matchService = hasServiceFilter && orderServiceIds.some(sid => filterServiceIds.includes(sid));
      if (!matchGardener && !matchService) return false;
    }

    if (filterDistrict) {
      const normDist = filterDistrict.trim().toLocaleLowerCase('ru-RU');
      const orderDist = (o.district || '').trim().toLocaleLowerCase('ru-RU');
      if (!orderDist.includes(normDist)) return false;
    }
    return true;
  });

  const displayGardeners = visibleGardeners.filter(g => !(hiddenGardenerIds || []).includes(g.id));

  const isFilterActive = hasGardenerFilter || hasServiceFilter || filterStatus !== 'all' || !!filterDistrict.trim() || !!searchQuery.trim();
  const isEmptyFilterResult = displayGardeners.length === 0 || (isFilterActive && filteredOrders.length === 0);

  // Предпочтительный список районов — подсчитываем наиболее частые значения из заказов
  // Для поиска по полю "примерно где" - показываем все локации сверху
  const districtOptions = (() => {
    const counts = {};
    orders.forEach(o => { if (o.district) counts[o.district] = (counts[o.district] || 0) + 1; });
    const list = [...new Set([...DEFAULT_DISTRICTS, ...Object.keys(counts)])].sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a.localeCompare(b, 'ru'));
    return list;
  })();

  // Все уникальные локации для быстрого поиска
  const allDistricts = districtOptions;

  const visibleDates = dates.filter(d => selectedWeekdays.includes(d.getDay()));

  // Поиск ближайшего подходящего окна: группируем по дате, чтобы при большом
  // количестве садовников список не превращался в десятки строк на одну дату
  let searchGroups = [];
  if (showQuickSearch) {
    let candidateGardeners = searchGardenerIds.length === 0 ? gardeners : gardeners.filter(g => searchGardenerIds.includes(g.id));
    if (searchServiceIds.length > 0) {
      candidateGardeners = candidateGardeners.filter(g => (g.services || []).some(s => searchServiceIds.includes(s.id)));
    }
    for (const date of searchDates) {
      if (!searchWeekdays.includes(date.getDay())) continue;
      const dateStr = date.toISOString().split('T')[0];
      const slots = [];

      for (const g of candidateGardeners) {
        const dayOff = dayOffs.find(d => d.gardenerId === g.id && d.date.startsWith(dateStr));
        if (dayOff) continue;

        const dayOrdersActive = orders.filter(o => o.gardenerId === g.id && o.date.startsWith(dateStr) && o.status === 'Новый заказ');

        if (dayOrdersActive.length === 0) {
          slots.push({ gardener: g, type: 'free' });
        } else if (dayOrdersActive.length === 1) {
          slots.push({ gardener: g, type: 'partial', existingOrder: dayOrdersActive[0] });
        }
        // 2 и более активных заказов — день считаем занятым, не предлагаем
      }

      if (slots.length > 0) {
        slots.sort((a, b) => (a.type === b.type ? 0 : a.type === 'free' ? -1 : 1));
        searchGroups.push({ date: dateStr, dayLabel: WEEKDAY_LABELS[date.getDay()], slots });
      }
      if (searchGroups.length >= 10) break;
    }
  }

  const getExportUrl = (period) => {
    if (period === 'all') return '/api/admin/export';
    if (period === 'custom' && exportCustomStart && exportCustomEnd) {
      return `/api/admin/export?start=${exportCustomStart}&end=${exportCustomEnd}`;
    }
    const now = new Date();
    let start;
    if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const startStr = start.toISOString().split('T')[0];
    const endStr = now.toISOString().split('T')[0];
    return `/api/admin/export?start=${startStr}&end=${endStr}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* Шапка */}
      <header className="bg-emerald-900 text-white py-3 px-3 sm:px-6 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base sm:text-xl font-bold flex items-center gap-2">
          🌲 <span className="hidden sm:inline">Анемон Агро — </span>Панель Диспетчера
        </h1>
        <button onClick={handleLogout} className="bg-emerald-500 hover:bg-emerald-400 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg whitespace-nowrap text-xs sm:text-sm">
          Выйти
        </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
          <a
            href="/admin/amo-connect"
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all"
          >
            🔌 amoCRM
          </a>
          <PushButton className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap" />
          <button
            onClick={async () => {
              try {
                const res = await apiFetch('/api/sync-amo');
                const data = await res.json();
                alert(`Синхронизировано: ${data.updated ?? 0} заказов`);
                window.location.reload();
              } catch (e) {
                alert('Ошибка при синхронизации с amoCRM');
              }
            }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all whitespace-nowrap"
          >
            🔄 Синхронизация
          </button>
          {currentUser?.role === 'LEADER' && (
            <Link
              href="/admin/users"
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all"
            >
              👥 Пользователи
            </Link>
          )}
          <div className="flex items-center gap-1 bg-emerald-800/50 rounded-lg px-2 py-1">
            <span className="text-xs font-medium text-emerald-100">📊 Экспорт в Excel:</span>
            <select
              value={exportPeriod}
              onChange={e => {
                const val = e.target.value;
                setExportPeriod(val);
                if (val !== 'custom') {
                  window.location.href = getExportUrl(val);
                }
              }}
              className="bg-emerald-600 text-white text-xs sm:text-sm rounded-lg px-2 py-1.5 border border-emerald-500 font-semibold cursor-pointer"
            >
              <option value="all">За всё время</option>
              <option value="month">Этот месяц</option>
              <option value="year">Этот год</option>
              <option value="custom">Свой диапазон</option>
            </select>
            {exportPeriod === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={exportCustomStart} onChange={e => setExportCustomStart(e.target.value)} className="text-xs rounded-lg px-2 py-1 border border-emerald-600" />
                <span className="text-emerald-200">—</span>
                <input type="date" value={exportCustomEnd} onChange={e => setExportCustomEnd(e.target.value)} className="text-xs rounded-lg px-2 py-1 border border-emerald-600" />
                <a
                  href={getExportUrl('custom')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs font-bold"
                >
                  Скачать
                </a>
              </div>
            )}
          </div>
          <button
            onClick={handleSyncSheets}
            disabled={syncing}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? '...' : <>🔄 <span className="hidden sm:inline">Google </span>Таблицы</>}
          </button>

          {/* Масштаб таблицы */}
          <div className="flex items-center gap-1">
            <button onClick={() => setTableScale(s => Math.max(0.6, +(s - 0.1).toFixed(1)))} className="text-xs bg-emerald-600 text-white border rounded px-2">-</button>
            <div className="text-xs px-2 text-white">Масштаб {Math.round(tableScale * 100)}%</div>
            <button onClick={() => setTableScale(s => Math.min(1.5, +(s + 0.1).toFixed(1)))} className="text-xs bg-emerald-600 text-white border rounded px-2">+</button>
          </div>

        </div>
      </header>

      {/* Меню вкладок */}
      <div className="bg-white border-b border-slate-200 flex overflow-x-auto px-3 sm:px-6 py-2 gap-2 sm:gap-4 text-sm sm:text-base">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'calendar' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          📅 Календарь
        </button>
        <button
          onClick={() => setActiveTab('gardeners')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'gardeners' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          🧑‍🌾 Садовники
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'services' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          🌿 Услуги
        </button>
        <button
          onClick={() => setActiveTab('auction')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium relative whitespace-nowrap ${activeTab === 'auction' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          🔔 Аукцион
          {auctionOrders.filter(o => o.status === 'Аукцион').length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-xs bg-amber-500 text-white rounded-full">
              {auctionOrders.filter(o => o.status === 'Аукцион').length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('webleads')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium relative whitespace-nowrap ${activeTab === 'webleads' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          🌐 Заявки
          {webLeads.filter(l => l.status === 'Новая').length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {webLeads.filter(l => l.status === 'Новая').length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('refusals')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium relative whitespace-nowrap ${activeTab === 'refusals' ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}
        >
          ❌ Отказы
          {orders.filter(o => o.status === 'Отказ').length > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {orders.filter(o => o.status === 'Отказ').length}
            </span>
          )}
        </button>
      </div>

      {/* Баннер оффлайн-режима */}
      {(isOffline || pendingQueueCount > 0 || conflictItems.length > 0) && (
        <div className="bg-amber-500 text-white px-4 py-2.5 text-xs font-semibold shadow-sm space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span>⚡ {isOffline ? 'Оффлайн-режим — показаны сохранённые данные' : 'Соединение восстановлено'}</span>
              {pendingQueueCount > 0 && (
                <span className="bg-amber-700/80 px-2 py-0.5 rounded-full text-[11px]">
                  В очереди изменений: {pendingQueueCount}
                </span>
              )}
            </div>
            {pendingQueueCount > 0 && (
              <button
                onClick={handleSyncQueue}
                disabled={isSyncingQueue}
                className="bg-white text-amber-900 hover:bg-amber-100 px-3 py-1 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
              >
                {isSyncingQueue ? 'Синхронизация...' : '🔄 Синхронизировать сейчас'}
              </button>
            )}
          </div>

          {/* Блок конфликтов */}
          {conflictItems.length > 0 && (
            <div className="bg-rose-900/90 border border-rose-300/40 rounded-xl p-3 text-white space-y-2">
              <div className="flex items-center justify-between font-bold">
                <span className="text-rose-100">⚠️ {conflictItems.length} изменений не приняты сервером (конфликт)</span>
                <button
                  onClick={handleRetryConflicts}
                  className="bg-white text-rose-900 hover:bg-rose-100 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
                >
                  🔄 Повторить конфликтные
                </button>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {conflictItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 bg-rose-950/60 p-2 rounded-lg text-[11px]">
                    <div className="truncate flex-1">
                      <span className="font-bold text-rose-200">{item.actionType}</span>: {JSON.stringify(item.payload).slice(0, 70)}
                      {item.errorMsg && <span className="text-rose-300 ml-2 italic">({item.errorMsg})</span>}
                    </div>
                    <button
                      onClick={async () => {
                        await removeFromQueue(item.id);
                        await refreshQueueCount();
                      }}
                      className="bg-rose-800 hover:bg-rose-700 px-2 py-0.5 rounded text-[10px] whitespace-nowrap"
                    >
                      Отменить
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-slate-500">Загрузка данных...</div>
      ) : (
        <main className="p-3 sm:p-6">
          {activeTab === 'calendar' && (
            <>
              {/* Блок навигации по месяцам */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2 sm:p-2.5 mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handlePrevYear}
                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs border border-slate-200"
                    title="-1 год"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={handlePrevMonth}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs border border-slate-200"
                    title="Предыдущий месяц"
                  >
                    ←
                  </button>

                  <div className="flex items-center gap-1 font-extrabold text-slate-800 text-xs sm:text-sm px-1">
                    <select
                      value={currentMonth.getMonth()}
                      onChange={e => {
                        const m = parseInt(e.target.value, 10);
                        setCurrentMonth(new Date(currentMonth.getFullYear(), m, 1));
                        setStartFromToday(false);
                      }}
                      className="bg-transparent font-extrabold text-slate-800 cursor-pointer outline-none hover:text-emerald-700 text-xs sm:text-sm py-0.5"
                    >
                      {[
                        'ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ',
                        'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'
                      ].map((mName, idx) => (
                        <option key={idx} value={idx}>{mName}</option>
                      ))}
                    </select>
                    <select
                      value={currentMonth.getFullYear()}
                      onChange={e => {
                        const y = parseInt(e.target.value, 10);
                        setCurrentMonth(new Date(y, currentMonth.getMonth(), 1));
                        setStartFromToday(false);
                      }}
                      className="bg-transparent font-extrabold text-slate-800 cursor-pointer outline-none hover:text-emerald-700 text-xs sm:text-sm py-0.5"
                    >
                      {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleNextMonth}
                    disabled={isNextDisabled}
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-bold rounded-lg text-xs border border-slate-200"
                    title={isNextDisabled ? 'Максимум 12 месяцев вперед' : 'Следующий месяц'}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={handleNextYear}
                    disabled={isNextYearDisabled}
                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 font-bold rounded-lg text-xs border border-slate-200"
                    title={isNextYearDisabled ? 'Максимум 12 месяцев вперед' : '+1 год'}
                  >
                    »
                  </button>

                  <button
                    type="button"
                    onClick={handleToday}
                    className={`ml-1 px-3 py-1 font-bold rounded-lg text-xs border transition-all ${
                      startFromToday && currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth()
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}
                    title={startFromToday ? 'Кликните, чтобы показать с начала месяца' : 'Кликните, чтобы показать с сегодня'}
                  >
                    {startFromToday && currentMonth.getFullYear() === now.getFullYear() && currentMonth.getMonth() === now.getMonth()
                      ? '✓ С сегодня'
                      : 'Сегодня (с 1-го)'}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold px-2 py-0.5 rounded-full">
                    Заказов: {orders.length}
                  </span>
                  {monthLoading && (
                    <span className="text-xs text-slate-400 animate-pulse font-medium">
                      Загрузка...
                    </span>
                  )}
                </div>
              </div>

              {/* Поиск ближайшего окна под запрос клиента */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2.5 mb-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowQuickSearch(v => !v)}
                  className="text-emerald-700 font-medium text-sm flex items-center gap-1"
                >
                  🔍 {showQuickSearch ? 'Скрыть поиск окна' : 'Найти окно для клиента (ближайшее свободное / можно вклинить)'}
                </button>

                {showQuickSearch && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <div className="flex flex-wrap gap-6 items-end mb-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Желаемые дни недели клиента</label>
                        <div className="flex gap-1">
                          {WEEKDAY_LABELS.map((label, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => toggleSearchWeekday(idx)}
                              className={`w-9 h-9 rounded-lg text-xs font-medium border transition-all ${
                                searchWeekdays.includes(idx)
                                  ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                                  : 'bg-slate-50 border-slate-200 text-slate-400'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <MultiSelectFilter
                        label="Мастера"
                        items={gardeners}
                        selectedIds={searchGardenerIds}
                        onChange={setSearchGardenerIds}
                        placeholderAll="Все мастера"
                      />
                      <MultiSelectFilter
                        label="Услуги"
                        items={services}
                        selectedIds={searchServiceIds}
                        onChange={setSearchServiceIds}
                        placeholderAll="Все услуги"
                      />
                    </div>

                    {searchGroups.length === 0 ? (
                      <p className="text-sm text-slate-400">Подходящих окон не нашлось в ближайшие {SEARCH_HORIZON_DAYS} дней.</p>
                    ) : (
                      <div className="space-y-2">
                        {searchGroups.map((group) => (
                          <div key={group.date} className="p-2.5 rounded-lg border border-slate-100">
                            <div className="text-sm font-semibold text-slate-700 mb-1.5">{group.date} ({group.dayLabel})</div>
                            <div className="flex flex-wrap gap-1.5">
                              {group.slots.map((s) => (
                                <div key={s.gardener.id} className="relative">
                                  <button
                                    type="button"
                                    onClick={() => openNewOrderModal(group.date, s.gardener.id)}
                                    onMouseDown={() => {
                                      if (s.type === 'partial' && s.existingOrder) {
                                        const timer = setTimeout(() => handleLongPressSlot(s, group.date), 500);
                                        setLongPressTimer(timer);
                                      }
                                    }}
                                    onMouseUp={() => {
                                      if (longPressTimer) clearTimeout(longPressTimer);
                                    }}
                                    onMouseLeave={() => {
                                      if (longPressTimer) clearTimeout(longPressTimer);
                                    }}
                                    onTouchStart={() => {
                                      if (s.type === 'partial' && s.existingOrder) {
                                        const timer = setTimeout(() => handleLongPressSlot(s, group.date), 500);
                                        setLongPressTimer(timer);
                                      }
                                    }}
                                    onTouchEnd={() => {
                                      if (longPressTimer) clearTimeout(longPressTimer);
                                    }}
                                    title={s.type === 'partial' && s.existingOrder ? `Уже стоит: ${s.existingOrder.clientName} — ${s.existingOrder.description}` : ''}
                                    className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                                      s.type === 'free'
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                        : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                                    }`}
                                  >
                                    {s.gardener.name} {s.type === 'partial' ? '(можно вклинить)' : ''}
                                  </button>
                                  {longPressInfo && longPressInfo.dateStr === group.date && longPressInfo.gardenerName === s.gardener.name && (
                                    <div className="absolute left-0 top-full mt-2 z-20 w-72 bg-slate-900 text-white text-[11px] rounded-xl shadow-xl p-3">
                                      <div className="font-semibold mb-1">{longPressInfo.gardenerName}</div>
                                      {longPressInfo.details.map((d, i) => (
                                        <div key={i} className="mb-1 text-slate-200">{d}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="text-xs text-slate-400 pt-2">
                          Жёлтым — уже есть один заказ в этот день, наведите на кнопку, чтобы посмотреть что именно, и оцените, войдёт ли новый.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Фильтры отображения календаря */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-2.5 mb-2 flex flex-wrap gap-4 items-end text-xs">
                <div className="relative min-w-[220px] flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">🔍 Поиск по заказам</label>
                  <div className="relative">
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Имя, телефон, адрес, описание…"
                      className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white text-slate-800 w-full focus:outline-none focus:ring-1 focus:ring-emerald-500 pr-7"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm leading-none p-0.5"
                        title="Очистить"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <MultiSelectFilter
                  label="Мастер (садовник)"
                  items={gardeners}
                  selectedIds={filterGardenerIds}
                  onChange={setFilterGardenerIds}
                  placeholderAll="Все садовники"
                />
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Статус заказа</label>
                  <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                  >
                    <option value="all">Любой</option>
                    <option value="Новый заказ">Новый заказ</option>
                    <option value="Перенос">Перенос (ждёт решения)</option>
                    <option value="Отказ">Отказ</option>
                    <option value="Выполнен">Выполнен</option>
                    <option value="Отменен">Отменен</option>
                  </select>
                </div>
                <MultiSelectFilter
                  label="Услуга (специализация)"
                  items={services}
                  selectedIds={filterServiceIds}
                  onChange={setFilterServiceIds}
                  placeholderAll="Все услуги"
                />
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Примерно где (район)</label>
                  <select value={filterDistrict} onChange={e => setFilterDistrict(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
                    <option value="">Все районы</option>
                    {allDistricts.map(district => <option key={district} value={district}>{district}</option>)}
                  </select>
                </div>
                <ColumnToggleDropdown
                  gardeners={visibleGardeners}
                  hiddenIds={hiddenGardenerIds}
                  onToggle={toggleHideGardener}
                  onShowAll={showAllColumns}
                />
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Дни недели</label>
                  <div className="flex gap-1">
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleWeekday(idx)}
                        className={`w-9 h-9 rounded-lg text-xs font-medium border transition-all ${
                          selectedWeekdays.includes(idx)
                            ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
                            : 'bg-slate-50 border-slate-200 text-slate-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-dashed border-emerald-300 inline-block"></span>Свободно</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-500 inline-block"></span>Можно вклинить</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block"></span>Занят</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600 inline-block"></span>Выполнен</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block"></span>Перенос</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500 inline-block"></span>Отказ</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 inline-block"></span>Отменён</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300 border border-slate-400 inline-block"></span>Выходной</span>
                </div>
              </div>

              {isEmptyFilterResult ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500 font-medium">
                  <div className="text-4xl mb-3">🔍</div>
                  <div className="text-base font-semibold text-slate-700 mb-1">По выбранным фильтрам ничего не найдено</div>
                  <p className="text-xs text-slate-400">Попробуйте изменить параметры фильтрации или сбросить их</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-auto max-h-[78vh] relative">
                  <table style={{ zoom: tableScale }} className="w-full border-collapse text-[12px] relative">
                    <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="px-1.5 py-1 text-left text-[12px] font-semibold text-slate-600 border-r border-slate-200 sticky top-0 left-0 z-30 bg-slate-100 shadow-sm align-top">
                          <span>Дата</span>
                        </th>
                        {(() => {
                          const visibleDateKeys = new Set(visibleDates.map(d => toDateKey(d)));

                          return displayGardeners.map(g => {
                            const gardenerTotalFact = orders.reduce((sum, o) => {
                              if (
                                o.gardenerId === g.id &&
                                o.status === 'Выполнен' &&
                                Number(o.priceFact) > 0 &&
                                o.date &&
                                visibleDateKeys.has(toDateKey(o.date))
                              ) {
                                return sum + Math.round(Number(o.priceFact));
                              }
                              return sum;
                            }, 0);

                            return (
                              <th
                                key={g.id}
                                onDoubleClick={() => toggleHideGardener(g.id)}
                                title="Двойной клик — скрыть столбец"
                                className="px-1.5 py-1 text-[12px] font-semibold text-slate-600 border-r border-slate-200 min-w-[140px] sticky top-0 z-20 bg-slate-100 shadow-sm align-top cursor-pointer hover:bg-slate-200/60 transition-colors select-none"
                              >
                                <div className="flex flex-col items-center gap-0.5">
                                  <span>{g.name}</span>
                                  {gardenerTotalFact > 0 && (
                                    <span className="text-[10px] text-slate-500 font-semibold bg-slate-200/70 px-1.5 py-0.5 rounded whitespace-nowrap" title={`Итог по выполненным за отображаемый период: ${gardenerTotalFact}`}>
                                      Σ {gardenerTotalFact}
                                    </span>
                                  )}
                                  {g.jobTitle && <span className="text-[10px] text-slate-500 font-normal bg-slate-200/60 px-1.5 py-0.5 rounded">{g.jobTitle}</span>}
                                  <div className="flex flex-wrap items-center justify-center gap-1 mt-0.5">
                                    {g.isRegular && <span className="text-[9px] bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded font-semibold" title="Постоянник">★ постоянник</span>}
                                    {g.annualContract && <span className="text-[9px] bg-amber-100 text-amber-800 px-1 py-0.5 rounded font-semibold" title="Годовой контракт">📜 годовой</span>}
                                  </div>
                                </div>
                              </th>
                            );
                          });
                        })()}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDates.map(date => {
                        const dateStr = date.toISOString().split('T')[0];
                        const dayLabel = WEEKDAY_LABELS[date.getDay()];
                        const holiday = isRussianHoliday(date);

                        return (
                          <tr key={dateStr} className={`border-b border-slate-200 hover:bg-slate-50 ${holiday ? 'bg-red-50/40' : ''}`}>
                            <td className={`px-1.5 py-1 font-medium border-r border-slate-200 align-top sticky left-0 z-10 bg-slate-50 shadow-sm text-[12px] ${holiday ? 'text-red-700 bg-red-50' : 'text-slate-700 bg-slate-50'}`}>
                              <span className="flex flex-col gap-0.5">
                                <span>{new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ({dayLabel})</span>
                                {holiday && <span className="text-[9px] leading-tight text-red-700">Выходной</span>}
                              </span>
                            </td>
                            {displayGardeners.map(g => {
                              const dayOrdersAll = orders.filter(o => o.gardenerId === g.id && o.date.startsWith(dateStr) && o.status !== 'Перенесен');
                              const dayOrders = filteredOrders.filter(o => o.gardenerId === g.id && o.date.startsWith(dateStr) && o.status !== 'Перенесен');
                              const dayOff = dayOffs.find(d => d.gardenerId === g.id && d.date.startsWith(dateStr));
                              const isBlockedDay = blockedDays.some(b => b.gardenerId === g.id && b.date.startsWith(dateStr));
                              const activeCount = dayOrdersAll.filter(o => o.status === 'Новый заказ').length;

                              return (
                                <td key={g.id} className={`p-1 border-r border-slate-200 text-center text-[12px] align-top ${isBlockedDay ? 'bg-rose-100/80 border-rose-200' : ''}`}>
                                  {isBlockedDay && dayOrdersAll.length === 0 ? (
                                    <div className="p-1.5 rounded bg-rose-200/90 text-rose-900 font-bold flex flex-col items-center gap-1 text-[11px] border border-rose-300 shadow-sm">
                                      <span>🛑 СТОП</span>
                                      <button
                                        onClick={() => handleToggleBlockDay(dateStr, g.id)}
                                        className="py-0.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-semibold transition-all shadow-xs"
                                      >
                                        Открыть
                                      </button>
                                    </div>
                                  ) : dayOff && dayOrdersAll.length === 0 ? (
                                    <div className="p-1 rounded bg-slate-300 text-slate-700 font-medium flex flex-col items-center gap-0.5 text-[11px]">
                                      🚫 Выходной
                                      <button onClick={() => handleRemoveDayOff(dayOff.id)} className="text-[10px] underline hover:text-slate-900">
                                        Убрать
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="space-y-0.5">
                                      {isBlockedDay && (
                                        <div className="p-1 rounded bg-rose-200 text-rose-900 font-bold text-[10px] mb-1 flex items-center justify-between px-1.5">
                                          <span>🛑 СТОП</span>
                                          <button onClick={() => handleToggleBlockDay(dateStr, g.id)} className="text-[9px] underline font-semibold text-emerald-800">Открыть</button>
                                        </div>
                                      )}
                                      {dayOrders.map(order => {
                                        const isDone = order.status === 'Выполнен';
                                        const factNumber = Math.round(Number(order.priceFact));
                                        const hasValidFact = Number.isFinite(factNumber) && factNumber > 0;

                                        return (
                                          <div
                                            key={order.id}
                                            onClick={() => { setConvertingLeadId(null); openEditOrderModal(order); }}
                                            className={`p-1.5 rounded text-white font-medium cursor-pointer transition-all text-left text-[11px] ${
                                              order.status === 'Выполнен' ? 'bg-green-600 hover:bg-green-700' :
                                              order.status === 'Отменен' ? 'bg-slate-300 hover:bg-slate-400 line-through' :
                                              order.status === 'Перенос' ? 'bg-blue-500 hover:bg-blue-600' :
                                              order.status === 'Отказ' ? 'bg-rose-500 hover:bg-rose-600' :
                                              activeCount >= 2 ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'
                                            }`}
                                          >
                                            {isDone && hasValidFact && (
                                              <div className="mb-1">
                                                <span
                                                  className="inline-block bg-green-700/60 rounded px-1 text-sm font-bold leading-none text-white"
                                                  title={`Факт: ${factNumber} ₽`}
                                                >
                                                  {String(factNumber)}
                                                </span>
                                              </div>
                                            )}
                                            <div className="flex items-center justify-between gap-1 mb-0.5">
                                              <span className="truncate">{order.clientName}</span>
                                              {!order.amoDealId && (
                                                <span className="text-[10px] shrink-0" title="Нет ID amoCRM">❌</span>
                                              )}
                                            </div>
                                            <div className="text-[10px] opacity-90">{order.district ? `${order.district} • ` : ''}<a href={`https://yandex.ru/maps/?text=${encodeURIComponent(order.district ? `${order.district}, ${order.address}` : order.address)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="underline">{order.address}</a></div>
                                            <div className="text-[10px] opacity-90">{order.description}</div>
                                            {order.status === 'Перенос' && <div className="text-[9px] opacity-90">⤴ запрошен перенос</div>}
                                            {order.status === 'Отказ' && <div className="text-[9px] opacity-90">✕ отказ мастера</div>}
                                          </div>
                                        );
                                      })}
                                      {!isBlockedDay && (
                                        <div className="flex gap-1">
                                          <button
                                            onClick={() => openNewOrderModal(dateStr, g.id)}
                                            className="flex-1 py-1 px-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[11px] font-medium border border-dashed border-emerald-300 transition-all"
                                          >
                                            {dayOrders.length === 0 ? 'Свободно' : '+ Ещё'}
                                          </button>
                                          <button
                                            onClick={() => handleToggleBlockDay(dateStr, g.id)}
                                            className="py-1 px-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-[11px] font-medium border border-dashed border-rose-300 transition-all"
                                            title="Поставить СТОП на этот день"
                                          >
                                            Стоп
                                          </button>
                                          {dayOrdersAll.length === 0 && (
                                            <button
                                              onClick={() => handleMarkDayOff(dateStr, g.id)}
                                              className="py-1 px-1 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded text-[11px] font-medium border border-dashed border-slate-300 transition-all"
                                            >
                                              Вых.
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {activeTab === 'gardeners' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Список */}
              <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-slate-700">Наши садовники ({gardeners.length})</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowVkBulkModal(true)} className="text-xs bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg">Массовая привязка VK</button>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {gardeners.map(g => (
                    <div key={g.id} className="py-3 flex justify-between items-center">
                      {editingGardener && editingGardener.id === g.id ? (
                        <form onSubmit={handleUpdateGardener} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Имя садовника</label>
                              <input
                                type="text" required
                                value={editingGardener.name}
                                onChange={e => setEditingGardener({ ...editingGardener, name: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Телефон</label>
                              <input
                                type="text" required
                                value={editingGardener.phone}
                                onChange={e => setEditingGardener({ ...editingGardener, phone: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Умеет делать (услуги)</label>
                            <div className="flex flex-wrap gap-2">
                              {services.map(s => (
                                <label key={s.id} className={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer select-none transition-all ${editingGardener.serviceIds.includes(s.id) ? 'bg-emerald-100 border-emerald-300 text-emerald-800 font-semibold' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                                  <input type="checkbox" className="absolute -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none" checked={editingGardener.serviceIds.includes(s.id)} onChange={() => toggleEditGardenerService(s.id)} />
                                  {s.name}
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Должность</label>
                              <select
                                value={editingGardener.jobTitle || 'садовник'}
                                onChange={e => setEditingGardener({ ...editingGardener, jobTitle: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                              >
                                <option value="мастер по обрезке">мастер по обрезке</option>
                                <option value="садовник">садовник</option>
                                <option value="автополивщик">автополивщик</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-slate-500 mb-1">Напарник</label>
                              <select
                                value={editingGardener.partnerId || ''}
                                onChange={e => setEditingGardener({ ...editingGardener, partnerId: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                              >
                                <option value="">Без напарника</option>
                                {gardeners.filter(other => other.id !== editingGardener.id).map(other => (
                                  <option key={other.id} value={other.id}>{other.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Временные интервалы работы</label>
                            <div className="flex gap-4">
                              {['Утро', 'Обед', 'Вечер'].map(slot => {
                                const checked = (editingGardener.timeSlots || []).includes(slot);
                                return (
                                  <label key={slot} className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={e => {
                                        const current = editingGardener.timeSlots || [];
                                        const next = e.target.checked ? [...current, slot] : current.filter(s => s !== slot);
                                        setEditingGardener({ ...editingGardener, timeSlots: next });
                                      }}
                                      className="rounded text-emerald-600 focus:ring-emerald-500"
                                    />
                                    {slot}
                                  </label>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-6 items-center">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(editingGardener.isRegular)}
                                onChange={e => setEditingGardener({ ...editingGardener, isRegular: e.target.checked })}
                                className="rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              Постоянник
                            </label>
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(editingGardener.annualContract)}
                                onChange={e => setEditingGardener({ ...editingGardener, annualContract: e.target.checked })}
                                className="rounded text-emerald-600 focus:ring-emerald-500"
                              />
                              Годовой контракт
                            </label>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1">VK id</label>
                            <input
                              type="text"
                              value={editingGardener.vkId ?? ''}
                              onChange={e => setEditingGardener({...editingGardener, vkId: e.target.value})}
                              className="w-full sm:w-64 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                              placeholder="peer id или user id"
                            />
                          </div>

                          <div className="flex gap-2 pt-2 border-t border-slate-200 justify-end">
                            <button type="button" onClick={() => setEditingGardener(null)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-100 text-sm">
                              Отмена
                            </button>
                            <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium text-sm">
                              Сохранить
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div>
                            <div className="font-semibold text-slate-800">{g.name}</div>
                            <div className="text-slate-500 text-sm">Телефон: {g.phone}</div>
                            {g.services && g.services.length > 0 && (
                              <div className="text-xs text-emerald-700 mt-1">{g.services.map(s => s.name).join(', ')}</div>
                            )}
                            {g.vkId && (
                              <div className="text-xs text-slate-400 mt-1">VK: {g.vkId}</div>
                            )}
                          </div>
                          <div className="flex gap-1 items-center">
                            <button
                              onClick={() => openEditGardener(g)}
                              className="text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                            >
                              Редактировать
                            </button>
                            <button
                              onClick={async () => {
                                const vk = prompt('Введите vkId (peer id или user id) для садовника ' + g.name + ':', g.vkId || '');
                                if (vk !== null) {
                                  const payload = {
                                    id: g.id,
                                    name: g.name,
                                    phone: g.phone,
                                    serviceIds: (g.services || []).map(s => s.id),
                                    vkId: vk.trim() || null
                                  };
                                  if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                    setGardeners(prev => prev.map(item => item.id === g.id ? { ...item, vkId: payload.vkId } : item));
                                    await enqueueAction({
                                      actionType: 'ADMIN_GARDENER_VK_PUT',
                                      url: '/api/admin/gardeners',
                                      method: 'PUT',
                                      payload,
                                      scope: 'admin'
                                    });
                                    await refreshQueueCount();
                                  } else {
                                    const res = await apiFetch('/api/admin/gardeners', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(payload)
                                    });
                                    if (res.ok) {
                                      fetchData();
                                    } else {
                                      const d = await res.json();
                                      alert(d.error || 'Ошибка');
                                    }
                                  }
                                }
                              }}
                              className="text-sky-600 hover:bg-sky-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                            >
                              VK
                            </button>
                            <button
                              onClick={() => handleDeleteGardener(g.id)}
                              className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                            >
                              Удалить
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Добавление нового */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-fit">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Добавить нового</h3>
                <form onSubmit={handleAddGardener} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600">ФИО Садовника</label>
                    <input
                      type="text" required
                      value={newGardener.name}
                      onChange={e => setNewGardener({...newGardener, name: e.target.value})}
                      className="mt-1 block w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600">Телефон для авторизации</label>
                    <input
                      type="text" required placeholder="79991234567"
                      value={newGardener.phone}
                      onChange={e => setNewGardener({...newGardener, phone: e.target.value})}
                      className="mt-1 block w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Умеет делать</label>
                    <div className="flex flex-wrap gap-2">
                      {services.length === 0 && <span className="text-xs text-slate-400">Сначала добавьте услуги во вкладке «Услуги»</span>}
                      {services.map(s => (
                        <label key={s.id} className={`text-xs px-2 py-1 rounded-lg border cursor-pointer ${newGardener.serviceIds.includes(s.id) ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                          <input type="checkbox" className="absolute -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none" checked={newGardener.serviceIds.includes(s.id)} onChange={() => toggleNewGardenerService(s.id)} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700">
                    Добавить садовника
                  </button>
                </form>
              </div>
            </div>
          )}


          {activeTab === 'services' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Каталог услуг ({services.length})</h3>
                <div className="divide-y divide-slate-100">
                  {services.map(s => (
                    <div key={s.id} className="py-3 flex justify-between items-center">
                      <div className="font-medium text-slate-800">{s.name}</div>
                      <button
                        onClick={() => handleDeleteService(s.id)}
                        className="text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                      >
                        Удалить
                      </button>
                    </div>
                  ))}
                  {services.length === 0 && <p className="text-sm text-slate-400 py-3">Пока ни одной услуги не добавлено.</p>}
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 h-fit">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Добавить услугу</h3>
                <form onSubmit={handleAddService} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-600">Название услуги</label>
                    <input
                      type="text" required placeholder="Например: Обрезка деревьев"
                      value={newServiceName}
                      onChange={e => setNewServiceName(e.target.value)}
                      className="mt-1 block w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button type="submit" className="w-full bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700">
                    Добавить
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'refusals' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-lg font-bold text-slate-700">Раздел «Отказы» ({orders.filter(o => o.status === 'Отказ').length})</h3>
              </div>
              {(() => {
                const refusedOrders = orders.filter(o => o.status === 'Отказ');
                return refusedOrders.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3">Отказов нет.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                          <th className="p-3">Дата</th>
                          <th className="p-3">Клиент</th>
                          <th className="p-3">Садовник</th>
                          <th className="p-3">Причина отказа</th>
                          <th className="p-3">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {refusedOrders.map(order => {
                          const gardener = gardeners.find(g => g.id === order.gardenerId) || order.gardener;
                          return (
                            <tr key={order.id} className="hover:bg-slate-50">
                              <td className="p-3 whitespace-nowrap font-medium text-slate-700">
                                {new Date(order.date).toLocaleDateString('ru-RU')}
                              </td>
                              <td className="p-3">
                                <div className="font-semibold text-slate-800">{order.clientName}</div>
                                <div className="text-slate-500">{order.clientPhone}</div>
                                <div className="text-slate-500 text-[11px]"><a href={`https://yandex.ru/maps/?text=${encodeURIComponent(order.district ? `${order.district}, ${order.address}` : order.address)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">{order.district ? `${order.district} • ${order.address}` : order.address}</a></div>
                              </td>
                              <td className="p-3 font-medium text-emerald-800">
                                {gardener ? gardener.name : 'Не назначен'}
                              </td>
                              <td className="p-3 font-medium text-rose-700">
                                {order.refusalReason || 'Причина не указана'}
                              </td>
                              <td className="p-3">
                                <div className="flex flex-wrap gap-1.5 items-center">
                                  <button
                                    onClick={() => handleRestoreRefusalOrder(order.id)}
                                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap"
                                  >
                                    🔄 Вернуть в работу
                                  </button>
                                  <button
                                    onClick={() => openEditOrderModal(order)}
                                    className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg whitespace-nowrap"
                                  >
                                    Переназначить
                                  </button>
                                  <button
                                    onClick={() => { setSelectedOrder(order); handleDeleteOrder(); }}
                                    className="text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-2 py-1.5 rounded-lg font-medium whitespace-nowrap"
                                  >
                                    🗑 Удалить
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>
          )}

          {activeTab === 'auction' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span>🔔</span> Активные заказы на аукционе
                </h3>
                {auctionOrders.filter(o => o.status === 'Аукцион').length === 0 ? (
                  <div className="text-sm text-slate-400 py-4">Активных аукционов пока нет</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {auctionOrders.filter(o => o.status === 'Аукцион').map(order => (
                      <div key={order.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-200 text-amber-900">Аукцион</span>
                            <span className="text-xs text-slate-500">📅 {order.date ? order.date.split('T')[0] : ''}</span>
                          </div>
                          <div className="text-sm font-bold text-slate-800">{order.clientName}</div>
                          <div className="text-xs text-slate-600 mt-1">📍 {order.district ? `${order.district}, ` : ''}{order.address}</div>
                          <div className="text-xs text-slate-600 mt-1">🌿 {order.service?.name || 'Услуги не указаны'}</div>
                          {order.description && <div className="text-xs text-slate-500 mt-2 bg-white p-2 rounded border border-slate-100">{order.description}</div>}
                          {order.priceContract > 0 && <div className="text-xs font-semibold text-emerald-700 mt-2">Сумма: {order.priceContract} ₽</div>}
                        </div>
                        <div className="mt-4 pt-3 border-t border-amber-200/60 flex justify-end">
                          <button onClick={() => openEditOrderModal(order)} className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700">Редактировать</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <span>✅</span> Завершённые аукционы
                </h3>
                {auctionOrders.filter(o => o.status !== 'Аукцион').length === 0 ? (
                  <div className="text-sm text-slate-400 py-4">История завершённых аукционов пуста</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="p-2.5 font-semibold text-slate-600">Дата</th>
                          <th className="p-2.5 font-semibold text-slate-600">Клиент / Адрес</th>
                          <th className="p-2.5 font-semibold text-slate-600">Кто забрал</th>
                          <th className="p-2.5 font-semibold text-slate-600">Когда забрал</th>
                          <th className="p-2.5 font-semibold text-slate-600">Текущий статус</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {auctionOrders.filter(o => o.status !== 'Аукцион').map(o => (
                          <tr key={o.id} className="hover:bg-slate-50">
                            <td className="p-2.5 text-slate-700">{o.date ? o.date.split('T')[0] : ''}</td>
                            <td className="p-2.5">
                              <div className="font-semibold text-slate-800">{o.clientName}</div>
                              <div className="text-[11px] text-slate-500">{o.address}</div>
                            </td>
                            <td className="p-2.5 font-semibold text-emerald-800">{o.gardener?.name || 'Неизвестно'}</td>
                            <td className="p-2.5 text-slate-500">{o.claimedAt ? new Date(o.claimedAt).toLocaleString('ru-RU') : '—'}</td>
                            <td className="p-2.5">
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">{o.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'webleads' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              {hasAdminVk ? (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <span>✅</span> VK-уведомления подключены ✓
                </div>
              ) : (
                <div className="mb-4 p-3.5 bg-sky-50 border border-sky-200 rounded-lg text-xs text-sky-900 flex items-center gap-2">
                  <span>🔔</span>
                  <div>
                    <b>Подключите VK-уведомления:</b> напишите свой номер телефона в сообщения группы ВКонтакте — и заявки будут приходить вам в ВК.
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-bold text-slate-700">Заявки с сайта</h3>
                  {lastLeadsUpdated && (
                    <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full font-medium">
                      Обновлено: {lastLeadsUpdated}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllLeads(v => !v)}
                  className="text-xs text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200"
                >
                  {showAllLeads ? 'Скрыть старые обработанные' : 'Показать все, включая старые обработанные'}
                </button>
              </div>
              {(() => {
                const todayStr = new Date().toISOString().split('T')[0];
                const visibleLeads = showAllLeads
                  ? webLeads
                  : webLeads.filter(l => l.status === 'Новая' || l.createdAt.split('T')[0] === todayStr);
                return visibleLeads.length === 0 ? (
                  <p className="text-sm text-slate-400 py-3">
                    {webLeads.length === 0 ? 'Пока нет заявок с виджета онлайн-записи.' : 'Новых заявок нет — старые обработанные скрыты.'}
                  </p>
                ) : (
                <div className="space-y-3">
                  {visibleLeads.map(lead => (
                    <div key={lead.id} className={`p-4 rounded-lg border transition-all duration-500 ${newLeadIds.has(lead.id) ? 'border-emerald-400 bg-emerald-100 ring-2 ring-emerald-300 shadow-md' : lead.status === 'Новая' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">{lead.name}</span>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${lead.status === 'Новая' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {lead.status}
                            </span>
                          </div>
                          <div className="text-sm text-slate-600 mt-1">
                            📞 {lead.phone}
                            {lead.address && <> · 📍 {lead.address}</>}
                          </div>
                          {lead.serviceName && <div className="text-xs text-emerald-700 mt-1">🌿 {lead.serviceName}</div>}
                          {lead.preferredDate && <div className="text-xs text-slate-500 mt-1">Желаемая дата: {lead.preferredDate.split('T')[0]}</div>}
                          {(lead.preferredGardenerName || lead.preferredInventory) && (
                            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                              {lead.preferredGardenerName && <div>👤 <b>Предпочтение по садовнику:</b> {lead.preferredGardenerName}</div>}
                              {lead.preferredInventory && <div>🧰 <b>Предпочтение по инвентарю:</b> {lead.preferredInventory}</div>}
                              <div className="flex gap-2 pt-1">
                                <button
                                  onClick={async () => {
                                    if (lead.preferredGardenerId) {
                                      openLeadAsOrder({ ...lead, gardenerId: lead.preferredGardenerId });
                                    } else {
                                      openLeadAsOrder(lead);
                                    }
                                  }}
                                  className="text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-2 py-1 rounded"
                                >
                                  ✓ Подтвердить
                                </button>
                                <button
                                  onClick={async () => {
                                    const payload = { id: lead.id, preferredGardenerId: null, preferredGardenerName: null, preferredInventory: null };
                                    if (typeof navigator !== 'undefined' && !navigator.onLine) {
                                      setWebLeads(prev => prev.map(l => l.id === lead.id ? { ...l, preferredGardenerId: null, preferredGardenerName: null, preferredInventory: null } : l));
                                      await enqueueAction({
                                        actionType: 'ADMIN_WEBLEAD_PUT',
                                        url: '/api/admin/webleads',
                                        method: 'PUT',
                                        payload,
                                        scope: 'admin'
                                      });
                                      await refreshQueueCount();
                                    } else {
                                      await apiFetch('/api/admin/webleads', {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(payload)
                                      });
                                      fetchData();
                                    }
                                  }}
                                  className="text-[11px] bg-rose-600 hover:bg-rose-700 text-white font-medium px-2 py-1 rounded"
                                >
                                  ✕ Отклонить
                                </button>
                              </div>
                            </div>
                          )}
                          {lead.comment && <div className="text-xs text-slate-500 mt-1 bg-white p-2 rounded border border-slate-100">{lead.comment}</div>}
                          {lead.assignedTo && <div className="text-xs font-semibold text-emerald-800 mt-1">👤 Назначен садовник: {lead.assignedTo}</div>}
                          <div className="text-[11px] text-slate-400 mt-1">{new Date(lead.createdAt).toLocaleString('ru-RU')}</div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openLeadAsOrder(lead)}
                            className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg"
                          >
                            {lead.assignedTo ? 'Переназначить' : 'Назначить'}
                          </button>
                          <button
                            onClick={() => sendLeadToAuction(lead)}
                            className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg"
                          >
                            На аукцион
                          </button>
                          {lead.status === 'Новая' && (
                            <button
                              onClick={() => handleMarkLeadProcessed(lead.id)}
                              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg"
                            >
                              Отметить обработанной
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteLead(lead.id)}
                            className="text-xs text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                );
              })()}
            </div>
          )}
        </main>
      )}

      {/* Модальное окно заказа */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl">
            <h3 className="text-xl font-bold text-slate-800 mb-4">
              {selectedOrder ? 'Редактировать / переместить заказ' : `Новая запись на ${selectedSlot.date}`}
            </h3>
            {(() => {
              if (!selectedOrder || !formData.date || !formData.gardenerId) return null;
              const isBlocked = blockedDays.some(b => b.gardenerId === formData.gardenerId && (b.date.startsWith(formData.date) || toDateKey(b.date) === formData.date));
              if (!isBlocked) return null;
              return (
                <div className="mb-4 text-xs font-semibold text-slate-600 bg-slate-100 p-2.5 rounded-lg border border-slate-200 flex items-center gap-2">
                  <span>🛑</span>
                  <span>день закрыт — можно только править, нельзя переносить других</span>
                </div>
              );
            })()}
            {selectedOrder && selectedOrder.status === 'Перенос' && selectedOrder.transferRequestedDate && (
              <div className="mb-4 text-sm text-blue-800 bg-blue-50 p-3 rounded-lg border border-blue-100">
                🗓 Садовник запросил перенос на <b>{new Date(selectedOrder.transferRequestedDate).toLocaleDateString('ru-RU')}</b>. Смените дату/садовника ниже и статус на «Новый заказ», либо назначьте другого свободного садовника.
              </div>
            )}
            {selectedOrder && selectedOrder.status === 'Отказ' && selectedOrder.refusalReason && (
              <div className="mb-4 text-sm text-rose-800 bg-rose-50 p-3 rounded-lg border border-rose-100">
                ✕ Садовник отказался: «{selectedOrder.refusalReason}». Назначьте другого садовника и смените статус на «Новый заказ».
              </div>
            )}
            {selectedOrder && selectedOrder.completionComment && (
              <div className="mb-4 text-xs text-emerald-900 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200">
                💬 <b>Комментарий садовника:</b> {selectedOrder.completionComment}
              </div>
            )}
            {selectedOrder && selectedOrder.status === 'Выполнен' && (selectedOrder.photoBefore || selectedOrder.photoAfter || selectedOrder.photoAct) && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 mb-2">Фотоотчёт садовника:</div>
                <div className="flex gap-2">
                  {(() => {
                    const before = selectedOrder.photoBefore && String(selectedOrder.photoBefore).trim();
                    try {
                      const arr = before && before.startsWith('[') ? JSON.parse(before) : before ? [before] : [];
                      return arr.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={u} alt={`До ${i+1}`} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                          <span className="text-[10px] text-slate-400">До</span>
                        </a>
                      ));
                    } catch (e) { return null; }
                  })()}

                  {(() => {
                    const after = selectedOrder.photoAfter && String(selectedOrder.photoAfter).trim();
                    try {
                      const arr = after && after.startsWith('[') ? JSON.parse(after) : after ? [after] : [];
                      return arr.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block">
                          <img src={u} alt={`После ${i+1}`} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                          <span className="text-[10px] text-slate-400">После</span>
                        </a>
                      ));
                    } catch (e) { return null; }
                  })()}

                  {(() => {
                    const act = selectedOrder.photoAct && String(selectedOrder.photoAct).trim();
                    try {
                      const arr = act && act.startsWith('[') ? JSON.parse(act) : act ? [act] : [];
                      return arr.map((u, i) => <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block"><img src={u} alt={`Акт ${i + 1}`} className="w-16 h-16 object-cover rounded-lg border border-slate-200" /><span className="text-[10px] text-slate-400">Акт</span></a>);
                    } catch (e) { return null; }
                  })()}
                </div>
              </div>
            )}
            {selectedOrder && selectedOrder.orderMedia && (() => {
              const mediaList = parseOrderMedia(selectedOrder.orderMedia);
              if (mediaList.length === 0) return null;
              return (
                <div className="mb-4">
                  <div className="text-xs font-semibold text-slate-500 mb-2">📁 Материалы от диспетчера ({mediaList.length}):</div>
                  <div className="flex flex-wrap gap-2">
                    {mediaList.map((item, idx) => {
                      const isVideo = item.type === 'video' || (item.url && item.url.match(/\.(mp4|webm|mov|mkv|avi|3gp)($|\?)/i));
                      if (isVideo) {
                        return (
                          <a
                            key={idx}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 text-white text-xs font-medium rounded-lg hover:bg-slate-700 transition-colors"
                          >
                            <span className="text-sm">▶️</span>
                            <span className="truncate max-w-[120px]">{item.name || `Видео ${idx + 1}`}</span>
                          </a>
                        );
                      }
                      return (
                        <a
                          key={idx}
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={item.url}
                            alt={item.name || `Медиа ${idx + 1}`}
                            className="w-16 h-16 object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
            <form onSubmit={handleSaveOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Дата</label>
                  <input type="date" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border bg-white appearance-none leading-tight focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Садовник</label>
                  <select
                    value={formData.gardenerId}
                    onChange={e => {
                      const gId = e.target.value;
                      const gardener = gardeners.find(g => g.id === gId);
                      let salary = formData.employeeSalary;
                      let share = formData.companyShare;
                      if (gardener && formData.priceFact > 0) {
                        const gPercent = gardener.writeoffPercent && Number(gardener.writeoffPercent) > 0 ? Number(gardener.writeoffPercent) : 64.5;
                        const ratio = gPercent > 1 ? gPercent / 100 : gPercent;
                        const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
                        salary = round2(formData.priceFact * ratio);
                        share = round2(formData.priceFact - salary);
                      }
                      setFormData({ ...formData, gardenerId: gId, employeeSalary: salary, companyShare: share });
                    }}
                    className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Без садовника (для аукциона)</option>
                    {gardeners.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ФИО Клиента</label>
                  <input type="text" required value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Телефон Клиента</label>
                  <input type="text" required value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Район (примерно где)</label>
                  <DistrictCombobox
                    value={formData.district}
                    onChange={val => setFormData({ ...formData, district: val })}
                    allDistricts={allDistricts}
                    defaultDistricts={DEFAULT_DISTRICTS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Адрес</label>
                  <input type="text" required value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Услуга</label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {services.map(s => {
                      const checked = (formData.serviceIds || []).includes(s.id);
                      return <label key={s.id} className={`relative flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm cursor-pointer min-h-[44px] select-none transition-all ${checked ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        <input type="checkbox" className="absolute -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none" checked={checked} onChange={e => setFormData(prev => { const nextIds = e.target.checked ? [...new Set([...(prev.serviceIds || []), s.id])] : (prev.serviceIds || []).filter(id => id !== s.id); return { ...prev, serviceIds: nextIds, serviceId: nextIds[0] || '' }; })} />
                        {s.name}
                      </label>;
                    })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Описание работ (Что делать)</label>
                <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по договору</label>
                  <input type="number" value={formData.priceContract} onChange={e => setFormData({...formData, priceContract: parseFloat(e.target.value) || 0})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по факту</label>
                  <input type="number" value={formData.priceFact} onChange={e => setFormData({...formData, priceFact: parseFloat(e.target.value) || 0})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ЗП сотрудника</label>
                  <input type="number" value={formData.employeeSalary} onChange={e => setFormData({...formData, employeeSalary: parseFloat(e.target.value) || 0})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Доля фирмы</label>
                  <input type="number" value={formData.companyShare} onChange={e => setFormData({...formData, companyShare: parseFloat(e.target.value) || 0})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
              </div>
              <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer min-h-[44px]">
                  <input type="checkbox" checked={formData.isCash ?? true} onChange={e => setFormData({...formData, isCash: e.target.checked})} className="w-4 h-4" /> 
                  <span>Оплата: {formData.isCash ?? true ? 'Нал (садовник сдает % фирме)' : 'Безнал (фирма платит садовнику отдельно)'}</span>
                </label>
                <p className="text-xs text-slate-500 mt-1 ml-6">
                  {formData.isCash ?? true 
                    ? '💵 Наличные: сумма учитывается в графе "К сдаче"' 
                    : '💳 Безнал: сумма НЕ учитывается в "К сдаче", фирма оплачивает работу отдельно'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Статус заказа</label>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  <option value="Новый заказ">Новый заказ</option>
                  <option value="Перенос">Перенос</option>
                  <option value="Отказ">Отказ</option>
                  <option value="Перенос на весну">Перенос на весну</option>
                  <option value="Выполнен">Выполнен</option>
                  <option value="Отменен">Отменен</option>
                </select>
              </div>
              {(formData.status === 'Отказ' || formData.status === 'Отменен') && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Причина отказа / отмены <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    required
                    value={formData.refusalReason || ''}
                    onChange={e => setFormData({...formData, refusalReason: e.target.value})}
                    className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="Укажите причину отказа или отмены..."
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500">Комментарий</label>
                <input type="text" value={formData.comment} onChange={e => setFormData({...formData, comment: e.target.value})} className="mt-1 block w-full h-10 text-sm border border-slate-300 rounded-lg px-3 py-2 box-border focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">
                  Фото/видео (необязательно)
                </label>

                {formData.orderMedia && formData.orderMedia.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                    {formData.orderMedia.map((item, idx) => {
                      const isVideo = item.type === 'video' || (item.url && item.url.match(/\.(mp4|webm|mov|mkv|avi|3gp)($|\?)/i));
                      return (
                        <div key={idx} className="relative group">
                          {isVideo ? (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-800 text-white text-xs font-medium rounded-lg h-16 max-w-[140px] pr-6"
                            >
                              <span className="text-base">▶️</span>
                              <span className="truncate text-[11px]">{item.name || `Видео ${idx + 1}`}</span>
                            </a>
                          ) : (
                            <a href={item.url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={item.url}
                                alt={item.name || `Фото ${idx + 1}`}
                                className="w-16 h-16 object-cover rounded-lg border border-slate-300"
                              />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({
                                ...prev,
                                orderMedia: (prev.orderMedia || []).filter((_, i) => i !== idx)
                              }));
                            }}
                            className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow hover:bg-rose-700"
                            title="Удалить"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {uploadingMedia && (
                  <div className="mb-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-medium">
                    <div className="flex justify-between mb-1">
                      <span>Загрузка медиа...</span>
                      <span>{mediaProgress}%</span>
                    </div>
                    <div className="w-full bg-emerald-200 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-600 h-full transition-all duration-200"
                        style={{ width: `${mediaProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                <input
                  ref={mediaFileRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="absolute -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none"
                  onChange={(e) => handleMediaSelect(e.target.files)}
                />
                <input
                  ref={mediaCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="absolute -left-[9999px] -top-[9999px] w-px h-px opacity-0 pointer-events-none"
                  onChange={(e) => handleMediaSelect(e.target.files)}
                />

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={(e) => { e.preventDefault(); mediaFileRef.current?.click(); }}
                    className="flex-1 min-h-[44px] py-2 px-3 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    <span>📁 Выбрать файлы</span>
                    <span className="text-[10px] text-slate-400">(фото ≤5MB, видео ≤15MB)</span>
                  </button>
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={(e) => { e.preventDefault(); mediaCameraRef.current?.click(); }}
                    className="min-h-[44px] py-2 px-3 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    <span>📷 Камера</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-2 justify-between pt-4">
                <div>
                  {selectedOrder && (
                    <button type="button" onClick={handleDeleteOrder} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
                      Удалить заказ
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowOrderModal(false)} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600">
                    Отмена
                  </button>
                  <button type="button" onClick={handleMoveToRefusal} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-medium">
                    ✕ В отказы
                  </button>
                  <button type="button" onClick={() => handleSaveOrder(null, true)} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg">
                    На аукцион
                  </button>
                  <button
                    type="submit"
                    disabled={uploadingMedia}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium disabled:opacity-50"
                  >
                    {uploadingMedia ? `Загрузка (${mediaProgress}%)...` : 'Сохранить'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модал массовой привязки VK */}
      {showVkBulkModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl">
            <h3 className="text-xl font-bold text-slate-800 mb-3">Массовая привязка VK</h3>
            <p className="text-sm text-slate-600 mb-3">Вставьте строки в формате: <code>79991234567,12345</code> (номер, vkId) по одной на строку. Можно также отправлять JSON с полем entries.</p>
            <textarea value={vkBulkText} onChange={e => setVkBulkText(e.target.value)} className="w-full h-48 border rounded p-2 mb-3" placeholder="79991234567,12345\n79999876543,54321"></textarea>
            <div className="flex gap-2 mb-3">
              <button onClick={handleVkBulkBind} className="px-4 py-2 bg-emerald-600 text-white rounded-lg">Применить</button>
              <button onClick={() => { setShowVkBulkModal(false); setVkBulkText(''); setVkBulkResult(null); }} className="px-4 py-2 border rounded-lg">Закрыть</button>
            </div>
            {vkBulkResult && (
              <div className="mt-3 text-sm">
                <div className="font-semibold mb-2">Результаты:</div>
                <div className="grid gap-1 text-xs">
                  {vkBulkResult.map((r, i) => (
                    <div key={i} className={`p-2 rounded ${r.ok ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                      {r.ok ? `OK: ${r.id}` : `Ошибка: ${r.reason} ${r.item ? JSON.stringify(r.item) : ''}`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

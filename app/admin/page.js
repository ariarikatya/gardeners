'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const emptyOrderForm = {
  clientName: '', clientPhone: '', address: '', description: '',
  priceContract: 0, priceFact: 0, employeeSalary: 0, companyShare: 0,
  status: 'Новый заказ', comment: '', date: '', gardenerId: '', serviceId: ''
};

const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const SEARCH_HORIZON_DAYS = 60;

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('calendar');
  const [gardeners, setGardeners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dayOffs, setDayOffs] = useState([]);
  const [services, setServices] = useState([]);
  const [webLeads, setWebLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  // Состояния для форм заказа
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState({ date: null, gardenerId: null });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [formData, setFormData] = useState(emptyOrderForm);
  const [convertingLeadId, setConvertingLeadId] = useState(null);
  const [exportPeriod, setExportPeriod] = useState('all');

  // Добавление / редактирование садовника
  const [newGardener, setNewGardener] = useState({ name: '', phone: '', serviceIds: [] });
  const [editingGardener, setEditingGardener] = useState(null);

  // Добавление услуги в каталог
  const [newServiceName, setNewServiceName] = useState('');

  // Фильтры календаря
  const [filterGardenerId, setFilterGardenerId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterServiceId, setFilterServiceId] = useState('all');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);

  // Поиск ближайшего окна под запрос клиента
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [searchWeekdays, setSearchWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [searchGardenerId, setSearchGardenerId] = useState('all');
  const [searchServiceId, setSearchServiceId] = useState('all');

  // Генерация дат на 30 дней вперед (для сетки календаря)
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  // Более длинный горизонт для поиска окна (данные уже загружены целиком, доп. запросов не нужно)
  const searchDates = [];
  for (let i = 0; i < SEARCH_HORIZON_DAYS; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    searchDates.push(d);
  }

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resG, resO, resD, resS, resW] = await Promise.all([
        fetch('/api/admin/gardeners'),
        fetch('/api/admin/orders'),
        fetch('/api/admin/dayoff'),
        fetch('/api/admin/services'),
        fetch('/api/admin/webleads')
      ]);
      const dataG = await resG.json();
      const dataO = await resO.json();
      const dataD = await resD.json();
      const dataS = await resS.json();
      const dataW = await resW.json();
      setGardeners(dataG.gardeners || []);
      setOrders(dataO.orders || []);
      setDayOffs(dataD.dayOffs || []);
      setServices(dataS.services || []);
      setWebLeads(dataW.webLeads || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const [syncing, setSyncing] = useState(false);
  const handleSyncSheets = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/admin/sync-sheets', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`Синхронизировано с Google Таблицами: ${data.count} заказов`);
      } else {
        alert(data.error);
      }
    } catch (e) {
      alert('Не удалось синхронизировать');
    } finally {
      setSyncing(false);
    }
  };

  const openNewOrderModal = (dateStr, gardenerId) => {
    setSelectedOrder(null);
    setConvertingLeadId(null);
    setSelectedSlot({ date: dateStr, gardenerId });
    setFormData({ ...emptyOrderForm, date: dateStr, gardenerId, serviceId: '' });
    setShowOrderModal(true);
  };

  const openLeadAsOrder = (lead) => {
    setConvertingLeadId(lead.id);

    if (lead.createdOrderId) {
      const existingOrder = orders.find(o => o.id === lead.createdOrderId);
      if (existingOrder) {
        // Уже назначали раньше — редактируем ТОТ ЖЕ заказ, а не создаём новый
        setSelectedOrder(existingOrder);
        setFormData({
          clientName: existingOrder.clientName,
          clientPhone: existingOrder.clientPhone,
          address: existingOrder.address,
          description: existingOrder.description,
          priceContract: existingOrder.priceContract,
          priceFact: existingOrder.priceFact,
          employeeSalary: existingOrder.employeeSalary,
          companyShare: existingOrder.companyShare,
          status: existingOrder.status,
          comment: existingOrder.comment || '',
          date: existingOrder.date.split('T')[0],
          gardenerId: existingOrder.gardenerId,
          serviceId: existingOrder.serviceId || ''
        });
        setShowOrderModal(true);
        return;
      }
    }

    // Первое назначение — создаём новый заказ
    setSelectedOrder(null);
    const dateStr = lead.preferredDate ? lead.preferredDate.split('T')[0] : '';
    setSelectedSlot({ date: dateStr, gardenerId: '' });
    setFormData({
      ...emptyOrderForm,
      clientName: lead.name,
      clientPhone: lead.phone,
      address: lead.address || '',
      description: lead.comment || '',
      date: dateStr,
      serviceId: lead.serviceId || ''
    });
    setShowOrderModal(true);
  };

  const handleMarkLeadProcessed = async (id) => {
    await fetch('/api/admin/webleads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'Обработана' })
    });
    fetchData();
  };

  const handleDeleteLead = async (id) => {
    if (!confirm('Удалить эту заявку?')) return;
    await fetch('/api/admin/webleads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    fetchData();
  };

  const openEditOrderModal = (order) => {
    setSelectedOrder(order);
    setFormData({
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      address: order.address,
      description: order.description,
      priceContract: order.priceContract,
      priceFact: order.priceFact,
      employeeSalary: order.employeeSalary,
      companyShare: order.companyShare,
      status: order.status,
      comment: order.comment || '',
      date: order.date.split('T')[0],
      gardenerId: order.gardenerId,
      serviceId: order.serviceId || ''
    });
    setShowOrderModal(true);
  };

  const handleSaveOrder = async (e) => {
    e.preventDefault();
    const endpoint = '/api/admin/orders';
    const method = selectedOrder ? 'PUT' : 'POST';
    const payload = selectedOrder
      ? { id: selectedOrder.id, ...formData }
      : { ...formData };

    const res = await fetch(endpoint, {
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
          // Первое назначение — запоминаем, какой заказ создан по этой заявке
          leadUpdate.createdOrderId = data.order.id;
        }
        await fetch('/api/admin/webleads', {
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
  };

  const handleDeleteOrder = async () => {
    if (!selectedOrder) return;
    if (!confirm('Удалить этот заказ? Это действие нельзя отменить.')) return;

    const res = await fetch('/api/admin/orders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selectedOrder.id })
    });

    if (res.ok) {
      setShowOrderModal(false);
      fetchData();
    } else {
      const data = await res.json();
      alert(data.error);
    }
  };

  const handleAddGardener = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/admin/gardeners', {
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
    setEditingGardener({ id: g.id, name: g.name, phone: g.phone, serviceIds: (g.services || []).map(s => s.id) });
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
    const res = await fetch('/api/admin/gardeners', {
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
  };

  const handleDeleteGardener = async (id) => {
    if (!confirm('Удалить этого садовника и его личный кабинет?')) return;
    const res = await fetch('/api/admin/gardeners', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  const handleAddService = async (e) => {
    e.preventDefault();
    if (!newServiceName.trim()) return;
    const res = await fetch('/api/admin/services', {
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
  };

  const handleDeleteService = async (id) => {
    if (!confirm('Удалить эту услугу из списка? У заказов с этой услугой она просто станет пустой.')) return;
    const res = await fetch('/api/admin/services', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (res.ok) fetchData();
  };

  const handleMarkDayOff = async (dateStr, gardenerId) => {
    const res = await fetch('/api/admin/dayoff', {
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
    const res = await fetch('/api/admin/dayoff', {
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

  let visibleGardeners = filterGardenerId === 'all'
    ? gardeners
    : gardeners.filter(g => g.id === filterGardenerId);
  if (filterServiceId !== 'all') {
    visibleGardeners = visibleGardeners.filter(g => (g.services || []).some(s => s.id === filterServiceId));
  }

  const visibleDates = dates.filter(d => selectedWeekdays.includes(d.getDay()));

  // Поиск ближайшего подходящего окна: группируем по дате, чтобы при большом
  // количестве садовников список не превращался в десятки строк на одну дату
  let searchGroups = [];
  if (showQuickSearch) {
    let candidateGardeners = searchGardenerId === 'all' ? gardeners : gardeners.filter(g => g.id === searchGardenerId);
    if (searchServiceId !== 'all') {
      candidateGardeners = candidateGardeners.filter(g => (g.services || []).some(s => s.id === searchServiceId));
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
      <header className="bg-emerald-900 text-white py-3 px-3 sm:px-6 flex flex-wrap gap-2 justify-between items-center shadow-md">
        <h1 className="text-base sm:text-xl font-bold flex items-center gap-2">
          🌲 <span className="hidden sm:inline">Анемон Агро — </span>Панель Диспетчера
        </h1>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs sm:text-sm">
          <select
            value={exportPeriod}
            onChange={e => setExportPeriod(e.target.value)}
            className="bg-emerald-700 text-white text-xs sm:text-sm rounded-lg px-2 py-1.5 sm:py-2 border-none"
          >
            <option value="all">За всё время</option>
            <option value="year">Этот год</option>
            <option value="month">Этот месяц</option>
          </select>
          <a
            href={getExportUrl(exportPeriod)}
            className="bg-emerald-700 hover:bg-emerald-600 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg whitespace-nowrap"
          >
            📊 <span className="hidden sm:inline">Экспорт в </span>Excel
          </a>
          <button
            onClick={handleSyncSheets}
            disabled={syncing}
            className="bg-emerald-700 hover:bg-emerald-600 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? '...' : <>🔄 <span className="hidden sm:inline">Google </span>Таблицы</>}
          </button>
          <button onClick={handleLogout} className="bg-emerald-700 hover:bg-emerald-600 px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg whitespace-nowrap">
            Выйти
          </button>
        </div>
      </header>

      {/* Меню вкладок */}
      <div className="bg-white border-b border-slate-200 flex overflow-x-auto px-3 sm:px-6 py-2 gap-2 sm:gap-4 text-sm sm:text-base">
        <button
          onClick={() => setActiveTab('calendar')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'calendar' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          📅 Календарь
        </button>
        <button
          onClick={() => setActiveTab('gardeners')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'gardeners' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          🧑‍🌾 Садовники
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium whitespace-nowrap ${activeTab === 'services' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          🌿 Услуги
        </button>
        <button
          onClick={() => setActiveTab('webleads')}
          className={`px-3 sm:px-4 py-2 rounded-lg font-medium relative whitespace-nowrap ${activeTab === 'webleads' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          🌐 Заявки
          {webLeads.filter(l => l.status === 'Новая').length > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {webLeads.filter(l => l.status === 'Новая').length}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-500">Загрузка данных...</div>
      ) : (
        <main className="p-3 sm:p-6">
          {activeTab === 'calendar' && (
            <>
              {/* Поиск ближайшего окна под запрос клиента */}
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
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
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Садовник</label>
                        <select
                          value={searchGardenerId}
                          onChange={e => setSearchGardenerId(e.target.value)}
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="all">Любой</option>
                          {gardeners.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Услуга</label>
                        <select
                          value={searchServiceId}
                          onChange={e => setSearchServiceId(e.target.value)}
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="all">Любая</option>
                          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
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
                                <button
                                  key={s.gardener.id}
                                  type="button"
                                  onClick={() => openNewOrderModal(group.date, s.gardener.id)}
                                  title={s.type === 'partial' && s.existingOrder ? `Уже стоит: ${s.existingOrder.clientName} — ${s.existingOrder.description}` : ''}
                                  className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
                                    s.type === 'free'
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                      : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                                  }`}
                                >
                                  {s.gardener.name} {s.type === 'partial' ? '(можно вклинить)' : ''}
                                </button>
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
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-wrap gap-6 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Садовник</label>
                  <select
                    value={filterGardenerId}
                    onChange={e => setFilterGardenerId(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="all">Все садовники</option>
                    {gardeners.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Статус заказа</label>
                  <select
                    value={filterStatus}
                    onChange={e => setFilterStatus(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="all">Любой</option>
                    <option value="Новый заказ">Новый заказ</option>
                    <option value="Перенос">Перенос (ждёт решения)</option>
                    <option value="Отказ">Отказ</option>
                    <option value="Выполнен">Выполнен</option>
                    <option value="Отменен">Отменен</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Услуга (специализация)</label>
                  <select
                    value={filterServiceId}
                    onChange={e => setFilterServiceId(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="all">Любая</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
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

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      <th className="p-3 text-left text-sm font-semibold text-slate-600 border-r border-slate-200">Дата</th>
                      {visibleGardeners.map(g => (
                        <th key={g.id} className="p-3 text-sm font-semibold text-slate-600 border-r border-slate-200 min-w-[180px]">
                          {g.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDates.map(date => {
                      const dateStr = date.toISOString().split('T')[0];
                      const dayLabel = WEEKDAY_LABELS[date.getDay()];

                      return (
                        <tr key={dateStr} className="border-b border-slate-200 hover:bg-slate-50">
                          <td className="p-3 font-medium text-slate-700 border-r border-slate-200 bg-slate-50 align-top">
                            {dateStr} ({dayLabel})
                          </td>
                          {visibleGardeners.map(g => {
                            const dayOrdersAll = orders.filter(o => o.gardenerId === g.id && o.date.startsWith(dateStr));
                            const dayOrders = filterStatus === 'all'
                              ? dayOrdersAll
                              : dayOrdersAll.filter(o => o.status === filterStatus);
                            const dayOff = dayOffs.find(d => d.gardenerId === g.id && d.date.startsWith(dateStr));
                            const activeCount = dayOrdersAll.filter(o => o.status === 'Новый заказ').length;

                            return (
                              <td key={g.id} className="p-2 border-r border-slate-200 text-center text-sm align-top">
                                {dayOff && dayOrdersAll.length === 0 ? (
                                  <div className="p-2 rounded-lg bg-slate-300 text-slate-700 font-medium flex flex-col items-center gap-1">
                                    🚫 Выходной
                                    <button onClick={() => handleRemoveDayOff(dayOff.id)} className="text-xs underline hover:text-slate-900">
                                      Убрать
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    {dayOrders.map(order => (
                                      <div
                                        key={order.id}
                                        onClick={() => { setConvertingLeadId(null); openEditOrderModal(order); }}
                                        className={`p-2 rounded-lg text-white font-medium cursor-pointer transition-all text-left ${
                                          order.status === 'Выполнен' ? 'bg-green-600 hover:bg-green-700' :
                                          order.status === 'Отменен' ? 'bg-slate-300 hover:bg-slate-400 line-through' :
                                          order.status === 'Перенос' ? 'bg-blue-500 hover:bg-blue-600' :
                                          order.status === 'Отказ' ? 'bg-rose-500 hover:bg-rose-600' :
                                          activeCount >= 2 ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'
                                        }`}
                                      >
                                        {order.clientName}
                                        <div className="text-xs opacity-90">{order.address}</div>
                                        {order.status === 'Перенос' && <div className="text-[10px] opacity-90">⤴ запрошен перенос</div>}
                                        {order.status === 'Отказ' && <div className="text-[10px] opacity-90">✕ отказ мастера</div>}
                                      </div>
                                    ))}
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => openNewOrderModal(dateStr, g.id)}
                                        className="flex-1 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium border border-dashed border-emerald-300 transition-all"
                                      >
                                        {dayOrders.length === 0 ? 'Свободно' : '+ Ещё'}
                                      </button>
                                      {dayOrdersAll.length === 0 && (
                                        <button
                                          onClick={() => handleMarkDayOff(dateStr, g.id)}
                                          className="flex-1 py-2 bg-slate-50 hover:bg-slate-100 text-slate-500 rounded-lg text-xs font-medium border border-dashed border-slate-300 transition-all"
                                        >
                                          Выходной
                                        </button>
                                      )}
                                    </div>
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
            </>
          )}

          {activeTab === 'gardeners' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Список */}
              <div className="col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-700 mb-4">Наши садовники ({gardeners.length})</h3>
                <div className="divide-y divide-slate-100">
                  {gardeners.map(g => (
                    <div key={g.id} className="py-3 flex justify-between items-center">
                      {editingGardener && editingGardener.id === g.id ? (
                        <form onSubmit={handleUpdateGardener} className="flex-1 flex items-center gap-2">
                          <input
                            type="text" required
                            value={editingGardener.name}
                            onChange={e => setEditingGardener({ ...editingGardener, name: e.target.value })}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                          />
                          <input
                            type="text" required
                            value={editingGardener.phone}
                            onChange={e => setEditingGardener({ ...editingGardener, phone: e.target.value })}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm"
                          />
                          <div className="flex flex-wrap gap-2">
                            {services.map(s => (
                              <label key={s.id} className={`text-xs px-2 py-1 rounded-lg border cursor-pointer ${editingGardener.serviceIds.includes(s.id) ? 'bg-emerald-100 border-emerald-300 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                                <input type="checkbox" className="hidden" checked={editingGardener.serviceIds.includes(s.id)} onChange={() => toggleEditGardenerService(s.id)} />
                                {s.name}
                              </label>
                            ))}
                          </div>
                          <button type="submit" className="text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg text-sm">Сохранить</button>
                          <button type="button" onClick={() => setEditingGardener(null)} className="text-slate-500 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-sm">Отмена</button>
                        </form>
                      ) : (
                        <>
                          <div>
                            <div className="font-semibold text-slate-800">{g.name}</div>
                            <div className="text-slate-500 text-sm">Телефон: {g.phone}</div>
                            {g.services && g.services.length > 0 && (
                              <div className="text-xs text-emerald-700 mt-1">{g.services.map(s => s.name).join(', ')}</div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEditGardener(g)}
                              className="text-emerald-700 hover:bg-emerald-50 px-3 py-1.5 rounded-lg text-sm transition-all"
                            >
                              Редактировать
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
                          <input type="checkbox" className="hidden" checked={newGardener.serviceIds.includes(s.id)} onChange={() => toggleNewGardenerService(s.id)} />
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

          {activeTab === 'webleads' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-lg font-bold text-slate-700 mb-4">Заявки с сайта ({webLeads.length})</h3>
              {webLeads.length === 0 ? (
                <p className="text-sm text-slate-400 py-3">Пока нет заявок с виджета онлайн-записи.</p>
              ) : (
                <div className="space-y-3">
                  {webLeads.map(lead => (
                    <div key={lead.id} className={`p-4 rounded-lg border ${lead.status === 'Новая' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-slate-50'}`}>
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
              )}
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
            {selectedOrder && selectedOrder.status === 'Выполнен' && (selectedOrder.photoBefore || selectedOrder.photoAfter || selectedOrder.photoAct) && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-slate-500 mb-2">Фотоотчёт садовника:</div>
                <div className="flex gap-2">
                  {selectedOrder.photoBefore && (
                    <a href={selectedOrder.photoBefore} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={selectedOrder.photoBefore} alt="До" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                      <span className="text-[10px] text-slate-400">До</span>
                    </a>
                  )}
                  {selectedOrder.photoAfter && (
                    <a href={selectedOrder.photoAfter} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={selectedOrder.photoAfter} alt="После" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                      <span className="text-[10px] text-slate-400">После</span>
                    </a>
                  )}
                  {selectedOrder.photoAct && (
                    <a href={selectedOrder.photoAct} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={selectedOrder.photoAct} alt="Акт" className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                      <span className="text-[10px] text-slate-400">Акт</span>
                    </a>
                  )}
                </div>
              </div>
            )}
            <form onSubmit={handleSaveOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Дата</label>
                  <input type="date" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Садовник</label>
                  <select required value={formData.gardenerId} onChange={e => setFormData({...formData, gardenerId: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
                    <option value="" disabled>Выберите садовника</option>
                    {gardeners.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ФИО Клиента</label>
                  <input type="text" required value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Телефон Клиента</label>
                  <input type="text" required value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Адрес</label>
                <input type="text" required value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Услуга</label>
                <select value={formData.serviceId} onChange={e => setFormData({...formData, serviceId: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
                  <option value="">Не указана</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Описание работ (Что делать)</label>
                <textarea required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по договору</label>
                  <input type="number" value={formData.priceContract} onChange={e => setFormData({...formData, priceContract: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Сумма по факту</label>
                  <input type="number" value={formData.priceFact} onChange={e => setFormData({...formData, priceFact: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">ЗП сотрудника</label>
                  <input type="number" value={formData.employeeSalary} onChange={e => setFormData({...formData, employeeSalary: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Доля фирмы</label>
                  <input type="number" value={formData.companyShare} onChange={e => setFormData({...formData, companyShare: parseFloat(e.target.value) || 0})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Статус заказа</label>
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
                  <option value="Новый заказ">Новый заказ</option>
                  <option value="Перенос">Перенос</option>
                  <option value="Отказ">Отказ</option>
                  <option value="Выполнен">Выполнен</option>
                  <option value="Отменен">Отменен</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Комментарий</label>
                <input type="text" value={formData.comment} onChange={e => setFormData({...formData, comment: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
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
                  <button type="submit" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">
                    Сохранить
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const emptyOrderForm = {
  clientName: '', clientPhone: '', address: '', district: '', description: '',
  priceContract: 0, priceFact: 0, employeeSalary: 0, companyShare: 0,
  status: 'Новый заказ', comment: '', refusalReason: '', date: '', gardenerId: '', serviceId: '', serviceIds: [], isCash: true
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

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('calendar');
  const [auctionOrders, setAuctionOrders] = useState([]);
  const [gardeners, setGardeners] = useState([]);
  const [orders, setOrders] = useState([]);
  const [dayOffs, setDayOffs] = useState([]);
  const [services, setServices] = useState([]);
  const [webLeads, setWebLeads] = useState([]);
  const [hasAdminVk, setHasAdminVk] = useState(false);
  const [showAllLeads, setShowAllLeads] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Состояния для форм заказа
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState({ date: null, gardenerId: null });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [formData, setFormData] = useState(emptyOrderForm);
  const [convertingLeadId, setConvertingLeadId] = useState(null);
  const [exportPeriod, setExportPeriod] = useState('all');
  const [exportCustomStart, setExportCustomStart] = useState('');
  const [exportCustomEnd, setExportCustomEnd] = useState('');
  const [calendarRange, setCalendarRange] = useState('today'); // 'today' | 'month' | 'year' | 'all'
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
  const [filterGardenerId, setFilterGardenerId] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterServiceId, setFilterServiceId] = useState('all');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);

  // Поиск ближайшего окна под запрос клиента
  const [showQuickSearch, setShowQuickSearch] = useState(false);
  const [searchWeekdays, setSearchWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [searchGardenerId, setSearchGardenerId] = useState('all');
  const [searchServiceId, setSearchServiceId] = useState('all');
  const [longPressInfo, setLongPressInfo] = useState(null);
  const [longPressTimer, setLongPressTimer] = useState(null);

  // Генерация дат для сетки календаря по выбранному диапазону
  const dates = [];
  const now = new Date();
  if (calendarRange === 'today') {
    for (let i = 0; i < 30; i++) {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      dates.push(date);
    }
  } else {
    const start = calendarRange === 'month'
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : calendarRange === 'year'
        ? new Date(now.getFullYear(), 0, 1)
        : orders.length > 0
          ? new Date(Math.min(...orders.map(order => new Date(order.date).getTime()), now.getTime()))
          : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = calendarRange === 'month'
      ? new Date(now.getFullYear(), now.getMonth() + 1, 0)
      : calendarRange === 'year'
        ? new Date(now.getFullYear(), 11, 31)
        : orders.length > 0
          ? new Date(Math.max(...orders.map(order => new Date(order.date).getTime()), now.getTime()))
          : now;
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      dates.push(new Date(cursor));
    }
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
      const [resG, resO, resD, resS, resW, resMe] = await Promise.all([
        fetch('/api/admin/gardeners'),
        fetch('/api/admin/orders'),
        fetch('/api/admin/dayoff'),
        fetch('/api/admin/services'),
        fetch('/api/admin/webleads'),
        fetch('/api/auth/me')
      ]);
      if (resMe.ok) {
        const meData = await resMe.json();
        setCurrentUser(meData.user || null);
      }
      const dataG = await resG.json();
      const dataO = await resO.json();
      const dataD = await resD.json();
      const dataS = await resS.json();
      const dataW = await resW.json();
      const allOrd = dataO.orders || [];
      setGardeners(dataG.gardeners || []);
      setOrders(allOrd.filter(o => o.status !== 'Аукцион'));
      setAuctionOrders(allOrd.filter(o => o.status === 'Аукцион' || o.wasAuction));
      setDayOffs(dataD.dayOffs || []);
      setServices(dataS.services || []);
      setWebLeads(dataW.webLeads || []);
      setHasAdminVk(Boolean(dataW.hasAdminVk));
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

  const sendLeadToAuction = async (lead) => {
    const dateStr = lead.preferredDate ? lead.preferredDate.split('T')[0] : new Date().toISOString().split('T')[0];

    let matchedServiceId = lead.serviceId || '';
    if (!matchedServiceId && lead.serviceName && services.length > 0) {
      const found = services.find(s => s.title.toLowerCase().trim() === lead.serviceName.toLowerCase().trim());
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

    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const data = await res.json();
      await fetch('/api/admin/webleads', {
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
      district: order.district || '',
      description: order.description,
      priceContract: order.priceContract,
      priceFact: order.priceFact,
      employeeSalary: order.employeeSalary,
      companyShare: order.companyShare,
      status: order.status,
      comment: order.comment || '',
      refusalReason: order.refusalReason || '',
      date: order.date.split('T')[0],
      gardenerId: order.gardenerId,
      serviceId: order.serviceId || '',
      serviceIds: getOrderServiceIds(order),
      isCash: order.isCash !== undefined ? order.isCash : true,
    });
    setShowOrderModal(true);
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

    const payload = selectedOrder
      ? { id: selectedOrder.id, ...formDataCustom }
      : { ...formDataCustom, fromLead: !!convertingLeadId };

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
    setEditingGardener({ id: g.id, name: g.name, phone: g.phone, serviceIds: (g.services || []).map(s => s.id), vkId: g.vkId || '' });
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

  // Массовая привязка vkId по списку phone,vkId (н-р: 79991234567,12345) или json entries
  const handleVkBulkBind = async () => {
    if (!vkBulkText || !vkBulkText.trim()) return alert('Вставьте список phone,vkId в поле');
    setVkBulkResult(null);
    try {
      const res = await fetch('/api/admin/gardeners/bulk-bind', {
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

  let visibleGardeners = filterGardenerId === 'all'
    ? gardeners
    : gardeners.filter(g => g.id === filterGardenerId);
  if (filterServiceId !== 'all') {
    visibleGardeners = visibleGardeners.filter(g => (g.services || []).some(s => s.id === filterServiceId));
  }
  if (filterDistrict) {
    const normalizedDistrict = filterDistrict.trim().toLocaleLowerCase('ru-RU');
    visibleGardeners = visibleGardeners.filter(g => orders.some(order =>
      order.gardenerId === g.id && (order.district || '').trim().toLocaleLowerCase('ru-RU') === normalizedDistrict
    ));
  }

  const filteredOrders = orders.filter(o => {
    if (filterGardenerId !== 'all' && o.gardenerId !== filterGardenerId) return false;
    if (filterStatus !== 'all' && o.status !== filterStatus) return false;
    if (filterServiceId !== 'all' && getOrderServiceIds(o).indexOf(filterServiceId) === -1) return false;
    if (filterDistrict) {
      const normDist = filterDistrict.trim().toLocaleLowerCase('ru-RU');
      const orderDist = (o.district || '').trim().toLocaleLowerCase('ru-RU');
      if (!orderDist.includes(normDist)) return false;
    }
    return true;
  });

  const isFilterActive = filterGardenerId !== 'all' || filterStatus !== 'all' || filterServiceId !== 'all' || !!filterDistrict.trim();
  const isEmptyFilterResult = visibleGardeners.length === 0 || (isFilterActive && filteredOrders.length === 0);

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
        <div className="flex items-center justify-between">
        <h1 className="text-base sm:text-xl font-bold flex items-center gap-2">
          🌲 <span className="hidden sm:inline">Анемон Агро — </span>Панель Диспетчера
        </h1>
        <button onClick={handleLogout} className="bg-emerald-500 hover:bg-emerald-400 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg whitespace-nowrap">
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
          {currentUser?.role === 'LEADER' && (
            <Link
              href="/admin/users"
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg px-2.5 py-1 transition-all"
            >
              👥 Пользователи
            </Link>
          )}
          <div className="flex items-center gap-1.5 bg-emerald-800/50 rounded-lg px-2 py-1">
            <span className="text-xs font-medium text-emerald-100">Скачать Excel:</span>
            <select
              value={exportPeriod}
              onChange={e => setExportPeriod(e.target.value)}
              className="bg-emerald-600 text-white text-xs sm:text-sm rounded-lg px-2 py-1.5 sm:py-2 border border-emerald-500"
            >
              <option value="all">За всё время</option>
              <option value="year">Этот год</option>
              <option value="month">Этот месяц</option>
              <option value="custom">Свой диапазон</option>
            </select>
            {exportPeriod === 'custom' && (
              <div className="flex items-center gap-1">
                <input type="date" value={exportCustomStart} onChange={e => setExportCustomStart(e.target.value)} className="text-xs rounded-lg px-2 py-1 border border-emerald-600" />
                <span className="text-emerald-200">—</span>
                <input type="date" value={exportCustomEnd} onChange={e => setExportCustomEnd(e.target.value)} className="text-xs rounded-lg px-2 py-1 border border-emerald-600" />
              </div>
            )}
          </div>
          <a
            href={getExportUrl(exportPeriod)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg whitespace-nowrap flex items-center gap-1"
            title={`Скачать Excel за выбранный период: ${exportPeriod === 'all' ? 'всё время' : exportPeriod === 'year' ? 'год' : exportPeriod === 'month' ? 'месяц' : `с ${exportCustomStart} по ${exportCustomEnd}`}`}
          >
            📊 <span className="hidden sm:inline">Экспорт в </span>Excel
          </a>
          <button
            onClick={handleSyncSheets}
            disabled={syncing}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 sm:px-4 py-1.5 sm:py-2 rounded-lg disabled:opacity-50 whitespace-nowrap"
          >
            {syncing ? '...' : <>🔄 <span className="hidden sm:inline">Google </span>Таблицы</>}
          </button>

          {/* Быстрые настройки отображения календаря */}
          <div className="flex items-center gap-2">
            <select value={calendarRange} onChange={e => setCalendarRange(e.target.value)} className="text-xs rounded-lg px-2 py-1 border border-emerald-500 bg-emerald-600 text-white">
              <option value="today">С сегодня</option>
              <option value="month">За месяц</option>
              <option value="year">За год</option>
              <option value="all">Все даты</option>
            </select>
            <div className="flex items-center gap-1">
              <button onClick={() => setTableScale(s => Math.max(0.6, +(s - 0.1).toFixed(1)))} className="text-xs bg-emerald-600 text-white border rounded px-2">-</button>
              <div className="text-xs px-2 text-white">Масштаб {Math.round(tableScale * 100)}%</div>
              <button onClick={() => setTableScale(s => Math.min(1.5, +(s + 0.1).toFixed(1)))} className="text-xs bg-emerald-600 text-white border rounded px-2">+</button>
            </div>
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
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Примерно где (район)</label>
                  <select value={filterDistrict} onChange={e => setFilterDistrict(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white text-slate-700">
                    <option value="">Все районы</option>
                    {allDistricts.map(district => <option key={district} value={district}>{district}</option>)}
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

              {isEmptyFilterResult ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center text-slate-500 font-medium">
                  <div className="text-4xl mb-3">🔍</div>
                  <div className="text-base font-semibold text-slate-700 mb-1">По выбранным фильтрам ничего не найдено</div>
                  <p className="text-xs text-slate-400">Попробуйте изменить параметры фильтрации или сбросить их</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-auto max-h-[75vh] relative">
                  <table style={{ zoom: tableScale }} className="w-full border-collapse text-xs relative">
                    <thead className="sticky top-0 z-20 bg-slate-100 shadow-sm">
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="p-2 text-left text-xs font-semibold text-slate-600 border-r border-slate-200 sticky top-0 left-0 z-30 bg-slate-100 shadow-sm">Дата</th>
                        {visibleGardeners.map(g => (
                          <th key={g.id} className="p-2 text-xs font-semibold text-slate-600 border-r border-slate-200 min-w-[160px] sticky top-0 z-20 bg-slate-100 shadow-sm">
                            {g.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDates.map(date => {
                        const dateStr = date.toISOString().split('T')[0];
                        const dayLabel = WEEKDAY_LABELS[date.getDay()];
                        const holiday = isRussianHoliday(date);

                        return (
                          <tr key={dateStr} className={`border-b border-slate-200 hover:bg-slate-50 ${holiday ? 'bg-red-50/40' : ''}`}>
                            <td className={`p-2 font-medium border-r border-slate-200 align-top sticky left-0 z-10 bg-slate-50 shadow-sm ${holiday ? 'text-red-700 bg-red-50' : 'text-slate-700 bg-slate-50'}`}>
                              <span className="flex flex-col gap-0.5">
                                <span>{new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ({dayLabel})</span>
                                {holiday && <span className="text-[9px] leading-tight text-red-700">Выходной</span>}
                              </span>
                            </td>
                            {visibleGardeners.map(g => {
                              const dayOrdersAll = orders.filter(o => o.gardenerId === g.id && o.date.startsWith(dateStr) && o.status !== 'Перенесен' && (!filterDistrict.trim() || (o.district || '').toLocaleLowerCase('ru').includes(filterDistrict.trim().toLocaleLowerCase('ru'))));
                              const dayOrders = filterStatus === 'all'
                                ? dayOrdersAll
                                : dayOrdersAll.filter(o => o.status === filterStatus);
                              const dayOff = dayOffs.find(d => d.gardenerId === g.id && d.date.startsWith(dateStr));
                              const activeCount = dayOrdersAll.filter(o => o.status === 'Новый заказ').length;

                              return (
                                <td key={g.id} className="p-1.5 border-r border-slate-200 text-center text-xs align-top">
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
                                          <div className="flex items-center justify-between gap-1 mb-0.5">
                                            <span>{order.clientName}</span>
                                            {order.amoDealId ? (
                                              <span className="text-[10px] bg-emerald-800 text-emerald-100 px-1.5 py-0.5 rounded font-normal whitespace-nowrap">✅ ID: {order.amoDealId}</span>
                                            ) : (
                                              <span className="text-[10px] bg-rose-800 text-rose-100 px-1.5 py-0.5 rounded font-normal whitespace-nowrap">❌ Нет ID</span>
                                            )}
                                          </div>
                                          <div className="text-xs opacity-90">{order.district ? `${order.district} • ` : ''}<a href={`https://yandex.ru/maps/?text=${encodeURIComponent(order.district ? `${order.district}, ${order.address}` : order.address)}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="underline">{order.address}</a></div>
                                          <div className="text-xs opacity-90">{order.description}</div>
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
                                  <input type="checkbox" className="hidden" checked={editingGardener.serviceIds.includes(s.id)} onChange={() => toggleEditGardenerService(s.id)} />
                                  {s.name}
                                </label>
                              ))}
                            </div>
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
                              onClick={() => {
                                const vk = prompt('Введите vkId (peer id или user id) для садовника ' + g.name + ':', g.vkId || '');
                                if (vk !== null) {
                                  fetch('/api/admin/gardeners', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: g.id, name: g.name, phone: g.phone, serviceIds: (g.services||[]).map(s=>s.id), vkId: vk.trim() || null }) }).then(res => {
                                    if (res.ok) fetchData(); else res.json().then(d=>alert(d.error||'Ошибка'));
                                  });
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
                                <button
                                  onClick={() => openEditOrderModal(order)}
                                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
                                >
                                  Переназначить / Редактировать
                                </button>
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
                <h3 className="text-lg font-bold text-slate-700">Заявки с сайта</h3>
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
                                    await fetch('/api/admin/webleads', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ id: lead.id, preferredGardenerId: null, preferredGardenerName: null, preferredInventory: null })
                                    });
                                    fetchData();
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
            <form onSubmit={handleSaveOrder} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Дата</label>
                  <input type="date" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Садовник</label>
                  <select value={formData.gardenerId} onChange={e => setFormData({...formData, gardenerId: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
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
                  <input type="text" required value={formData.clientName} onChange={e => setFormData({...formData, clientName: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Телефон Клиента</label>
                  <input type="text" required value={formData.clientPhone} onChange={e => setFormData({...formData, clientPhone: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Район (примерно где)</label>
                  <input 
                    type="text" 
                    list="district-list" 
                    value={formData.district} 
                    onChange={e => setFormData({...formData, district: e.target.value})} 
                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                    placeholder="Начните вводить район..."
                  />
                  <datalist id="district-list">
                    {/* Сначала популярные из заказов */}
                    {allDistricts.slice(0, 10).map(d => <option key={d} value={d} />)}
                    {/* Затем все остальные фиксированные варианты */}
                    <option value="Шумейка" />
                    <option value="Генеральское" />
                    <option value="Малая Тополевка" />
                    <option value="Усть курдюм" />
                    <option value="Зоналка" />
                    <option value="Юбилейный" />
                    <option value="Кумыска" />
                    <option value="Центр" />
                    <option value="Поливановка" />
                    <option value="Ленинский район" />
                    <option value="Трещиха" />
                    <option value="Маркс" />
                    <option value="Заводской район" />
                    <option value="Дальняк" />
                    <option value="Другое" />
                    {/* Остальные из истории заказов */}
                    {allDistricts.slice(10).map(d => <option key={d} value={d} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500">Адрес</label>
                  <input type="text" required value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500">Услуга</label>
                <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {services.map(s => {
                      const checked = (formData.serviceIds || []).includes(s.id);
                      return <label key={s.id} className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-sm cursor-pointer ${checked ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>
                        <input type="checkbox" checked={checked} onChange={e => setFormData(prev => { const nextIds = e.target.checked ? [...new Set([...(prev.serviceIds || []), s.id])] : (prev.serviceIds || []).filter(id => id !== s.id); return { ...prev, serviceIds: nextIds, serviceId: nextIds[0] || '' }; })} />
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
              <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <label className="flex items-center gap-2 text-sm font-medium">
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
                <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value})} className="mt-1 block w-full border border-slate-300 rounded-lg p-2">
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
                    className="mt-1 block w-full border border-slate-300 rounded-lg p-2"
                    placeholder="Укажите причину отказа или отмены..."
                  />
                </div>
              )}
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
                  <button type="button" onClick={() => handleSaveOrder(null, true)} className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg">
                    На аукцион
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

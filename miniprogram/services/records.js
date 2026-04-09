const {
  addDays,
  daysUntil,
  formatCurrency,
  formatDateTimeLabel,
  formatDueLabel,
  formatFullDate,
  formatChineseNumber,
  formatMonthLabel,
  formatMonthDay,
  getNextAnnualOccurrence,
  parseDateKey,
  toDateKey
} = require('../utils/date')
const {
  getDisplayNameByUserId,
  getPartnerDisplayName,
  getSelfDisplayName
} = require('../utils/member-display')
const { callCloudFunction, isPreviewMode } = require('./cloud')

const EXPENSE_CATEGORIES = [
  { key: 'dining', label: '餐饮' },
  { key: 'transport', label: '出行' },
  { key: 'daily', label: '日用' },
  { key: 'milestone', label: '备婚/大事' },
  { key: 'gift', label: '礼物' },
  { key: 'rent', label: '房租' }
]

const WORKOUT_TYPES = [
  { key: 'run', label: '跑步' },
  { key: 'strength', label: '力量' },
  { key: 'walk', label: '步行' },
  { key: 'yoga', label: '瑜伽' },
  { key: 'cycling', label: '骑行' },
  { key: 'other', label: '其他' }
]

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function getStorageKey(coupleId) {
  return `shared-life-records:${coupleId}`
}

function getEmptyStore() {
  return {
    viewerUserId: '',
    expenses: [],
    todos: [],
    anniversaries: [],
    workouts: [],
    activities: []
  }
}

function shouldUseLocalStore(globalData = {}) {
  return isPreviewMode(globalData)
}

function normalizeCloudStore(store = {}) {
  return {
    viewerUserId: store.viewerUserId || '',
    expenses: Array.isArray(store.expenses) ? store.expenses : [],
    todos: Array.isArray(store.todos) ? store.todos : [],
    anniversaries: Array.isArray(store.anniversaries) ? store.anniversaries : [],
    workouts: Array.isArray(store.workouts) ? store.workouts : [],
    activities: Array.isArray(store.activities) ? store.activities : []
  }
}

async function fetchCloudStore(globalData = {}) {
  if (!globalData.coupleInfo || !globalData.coupleInfo.id) {
    return getEmptyStore()
  }

  const result = await callCloudFunction('records', {
    action: 'listRecords'
  })

  if (!result.ok) {
    throw new Error(result.message || '记录加载失败')
  }

  return normalizeCloudStore(Object.assign({}, result.store || {}, {
    viewerUserId: result.viewerUserId || ''
  }))
}

function getCurrentUserId(globalData = {}, storeOverride = null) {
  return (storeOverride && storeOverride.viewerUserId) || globalData.userId || 'user_local'
}

function getPartnerUserId(globalData = {}) {
  if (globalData.partnerInfo && globalData.partnerInfo.userId) {
    return globalData.partnerInfo.userId
  }

  if (globalData.coupleInfo && globalData.coupleInfo.partnerUserId) {
    return globalData.coupleInfo.partnerUserId
  }

  return 'partner_demo'
}

function formatOwnerLabel(record, globalData, storeOverride = null) {
  if (record.ownerScope === 'shared') {
    return '共同'
  }

  return getDisplayNameByUserId(record.ownerUserId, globalData, {
    selfFallback: '我',
    partnerFallback: '伴侣'
  })
}

function formatActivityAmount(amountCents) {
  const amount = amountCents / 100
  return amountCents % 100 === 0 ? amount.toFixed(0) : amount.toFixed(2)
}

function formatAssigneeLabel(todo, globalData, storeOverride = null) {
  if (!todo.assigneeUserId) {
    return '共同'
  }

  return getDisplayNameByUserId(todo.assigneeUserId, globalData, {
    selfFallback: '我',
    partnerFallback: '伴侣'
  })
}

function formatAnniversaryDaysLabel(dateKey) {
  const days = daysUntil(dateKey)

  if (days > 0) {
    return `${days} 天后`
  }

  if (days === 0) {
    return '今天'
  }

  return `已过去 ${Math.abs(days)} 天`
}

function parseChineseNumber(text) {
  const values = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }

  if (!text) {
    return null
  }

  if (/^\d+$/.test(text)) {
    return Number(text)
  }

  if (text === '十') {
    return 10
  }

  if (text.indexOf('十') >= 0) {
    const [tensText, onesText] = text.split('十')
    const tens = tensText ? values[tensText] : 1
    const ones = onesText ? (values[onesText] || 0) : 0
    return tens * 10 + ones
  }

  return values[text] || null
}

function extractRelationshipYears(title) {
  const matched = (title || '').match(/([一二三四五六七八九十\d]+)周年/)
  return matched ? parseChineseNumber(matched[1]) : null
}

function normalizeRelationshipTitle(title) {
  const normalized = (title || '在一起')
    .replace(/\s+/g, '')
    .replace(/([一二三四五六七八九十\d]+周年|周年|纪念日)$/g, '')

  return normalized || '在一起'
}

function inferRelationshipAnchorDate(item) {
  if (item.type !== 'relationship') {
    return item.date
  }

  const years = extractRelationshipYears(item.title)

  if (!years) {
    return item.date
  }

  const targetDate = parseDateKey(item.date)
  return toDateKey(new Date(targetDate.getFullYear() - years, targetDate.getMonth(), targetDate.getDate()))
}

function formatRelationshipAnniversaryTitle(item, years) {
  const baseTitle = normalizeRelationshipTitle(item.title)

  if (years <= 0) {
    return baseTitle
  }

  const yearLabel = years === 2 ? '两' : formatChineseNumber(years)
  return `${baseTitle}${yearLabel}周年`
}

function buildAnniversaryDisplay(item, store, baseDate = new Date()) {
  const linkedTodo = store.todos.find((todo) => todo.id === item.linkedTodoId)
  const occurrence = getNextAnnualOccurrence(item.date, baseDate)
  const nextDateLabel = formatFullDate(occurrence.dateKey)

  return {
    id: item.id,
    type: item.type,
    baseTitle: item.title,
    date: item.date,
    note: item.note || '',
    title: item.type === 'relationship'
      ? formatRelationshipAnniversaryTitle(item, occurrence.years)
      : item.title,
    dateLabel: `下一次 ${nextDateLabel}`,
    daysLeftLabel: formatAnniversaryDaysLabel(occurrence.dateKey),
    nextDateKey: occurrence.dateKey,
    nextDateLabel,
    linkedTodoLabel: linkedTodo ? `准备项: ${linkedTodo.title}` : '还没准备项',
    sortTime: parseDateKey(occurrence.dateKey).getTime()
  }
}

function migrateStore(store) {
  const anniversaries = (store.anniversaries || []).map((item) => {
    if (item.type !== 'relationship') {
      return item
    }

    return Object.assign({}, item, {
      title: normalizeRelationshipTitle(item.title),
      date: inferRelationshipAnchorDate(item)
    })
  })

  const nextVersion = Math.max(store.version || 1, 2)
  const changed = nextVersion !== store.version || anniversaries.some((item, index) => {
    const previous = (store.anniversaries || [])[index]
    return !previous || previous.title !== item.title || previous.date !== item.date
  })

  if (!changed) {
    return store
  }

  return Object.assign({}, store, {
    anniversaries,
    version: nextVersion
  })
}

function buildSeedStore(globalData = {}) {
  const currentUserId = getCurrentUserId(globalData)
  const partnerUserId = getPartnerUserId(globalData)
  const now = new Date()
  const today = toDateKey(now)
  const yesterday = toDateKey(addDays(now, -1))
  const twoDaysAgo = toDateKey(addDays(now, -2))
  const threeDaysAgo = toDateKey(addDays(now, -3))
  const fourDaysAgo = toDateKey(addDays(now, -4))
  const fiveDaysAgo = toDateKey(addDays(now, -5))
  const eightDaysAgo = toDateKey(addDays(now, -8))
  const tenDaysAgo = toDateKey(addDays(now, -10))
  const twelveDaysAgo = toDateKey(addDays(now, -12))
  const twentyDaysAgo = toDateKey(addDays(now, -20))
  const monthStart = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1))

  const expenses = [
    {
      id: 'expense_seed_1',
      categoryKey: 'dining',
      categoryLabel: '餐饮',
      amountCents: 16800,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '火锅晚餐',
      occurredOn: today,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_2',
      categoryKey: 'transport',
      categoryLabel: '出行',
      amountCents: 4200,
      ownerScope: 'personal',
      ownerUserId: currentUserId,
      note: '地铁 + 打车',
      occurredOn: today,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 9 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 9 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_3',
      categoryKey: 'daily',
      categoryLabel: '日用',
      amountCents: 8900,
      ownerScope: 'personal',
      ownerUserId: partnerUserId,
      note: '补了一批家用品',
      occurredOn: yesterday,
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_4',
      categoryKey: 'dining',
      categoryLabel: '餐饮',
      amountCents: 23600,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '周中聚餐',
      occurredOn: threeDaysAgo,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_5',
      categoryKey: 'transport',
      categoryLabel: '出行',
      amountCents: 15300,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '周内通勤 + 出门',
      occurredOn: fourDaysAgo,
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_6',
      categoryKey: 'gift',
      categoryLabel: '礼物',
      amountCents: 7000,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '小惊喜',
      occurredOn: fiveDaysAgo,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_7',
      categoryKey: 'dining',
      categoryLabel: '餐饮',
      amountCents: 12800,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '上周末 brunch',
      occurredOn: eightDaysAgo,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_8',
      categoryKey: 'transport',
      categoryLabel: '出行',
      amountCents: 8600,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '上周出行',
      occurredOn: tenDaysAgo,
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_9',
      categoryKey: 'daily',
      categoryLabel: '日用',
      amountCents: 13200,
      ownerScope: 'personal',
      ownerUserId: currentUserId,
      note: '补货',
      occurredOn: twelveDaysAgo,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_10',
      categoryKey: 'rent',
      categoryLabel: '房租',
      amountCents: 200000,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '月初房租',
      occurredOn: monthStart,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'expense_seed_11',
      categoryKey: 'dining',
      categoryLabel: '餐饮',
      amountCents: 18600,
      ownerScope: 'shared',
      ownerUserId: null,
      note: '月中聚餐',
      occurredOn: twentyDaysAgo,
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]

  const todos = [
    {
      id: 'todo_seed_1',
      title: '订清明出行酒店',
      note: '',
      assigneeUserId: null,
      dueAt: today,
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'todo_seed_2',
      title: '续健身房会员',
      note: '',
      assigneeUserId: currentUserId,
      dueAt: toDateKey(addDays(now, 1)),
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'todo_seed_3',
      title: '纪念日晚餐名单确认',
      note: '',
      assigneeUserId: partnerUserId,
      dueAt: twoDaysAgo,
      status: 'completed',
      completedBy: partnerUserId,
      completedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'todo_seed_4',
      title: '整理三月发票',
      note: '',
      assigneeUserId: currentUserId,
      dueAt: twoDaysAgo,
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'todo_seed_5',
      title: '订纪念日晚餐',
      note: '',
      assigneeUserId: currentUserId,
      dueAt: toDateKey(addDays(now, 14)),
      status: 'open',
      completedBy: null,
      completedAt: null,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    }
  ]

  const anniversaryDate = addDays(now, 18)
  const customAnniversaryDate = addDays(now, 35)
  const workouts = [
    {
      id: 'workout_seed_1',
      typeKey: 'run',
      typeLabel: '跑步',
      durationMinutes: 42,
      occurredOn: today,
      note: '河边慢跑',
      userId: currentUserId,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'workout_seed_2',
      typeKey: 'strength',
      typeLabel: '力量',
      durationMinutes: 55,
      occurredOn: yesterday,
      note: '下肢训练',
      userId: partnerUserId,
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'workout_seed_3',
      typeKey: 'yoga',
      typeLabel: '瑜伽',
      durationMinutes: 30,
      occurredOn: threeDaysAgo,
      note: '',
      userId: currentUserId,
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString()
    }
  ]

  const anniversaries = [
    {
      id: 'anniversary_seed_1',
      title: '在一起',
      date: toDateKey(new Date(anniversaryDate.getFullYear() - 2, anniversaryDate.getMonth(), anniversaryDate.getDate())),
      type: 'relationship',
      linkedTodoId: 'todo_seed_5',
      note: '',
      createdBy: currentUserId,
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'anniversary_seed_2',
      title: '第一次一起看海',
      date: toDateKey(new Date(customAnniversaryDate.getFullYear() - 1, customAnniversaryDate.getMonth(), customAnniversaryDate.getDate())),
      type: 'custom',
      linkedTodoId: null,
      note: '',
      createdBy: partnerUserId,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    }
  ]

  const activities = [
    {
      id: 'activity_seed_1',
      type: 'expense_created',
      actorUserId: currentUserId,
      targetId: 'expense_seed_1',
      title: '共同支出 168 元',
      summary: '火锅晚餐',
      createdAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString()
    },
    {
      id: 'activity_seed_2',
      type: 'todo_completed',
      actorUserId: partnerUserId,
      targetId: 'todo_seed_3',
      title: '已完成待办',
      summary: '纪念日晚餐名单确认',
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'activity_seed_3',
      type: 'anniversary_created',
      actorUserId: partnerUserId,
      targetId: 'anniversary_seed_2',
      title: '新增纪念日',
      summary: '第一次一起看海',
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'activity_seed_4',
      type: 'report_generated',
      actorUserId: currentUserId,
      targetId: 'weekly_seed_prev',
      title: '周报生成完成',
      summary: '共同支出占 68%，外食是最高分类',
      createdAt: new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
    },
    {
      id: 'activity_seed_5',
      type: 'workout_created',
      actorUserId: currentUserId,
      targetId: 'workout_seed_1',
      title: '记录了一次运动',
      summary: '跑步 · 42 分钟',
      createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
    }
  ]

  return {
    version: 2,
    expenses,
    todos,
    anniversaries,
    workouts,
    activities,
    updatedAt: nowIso()
  }
}

function ensureCoupleStore(globalData = {}) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return {
      expenses: [],
      todos: [],
      anniversaries: [],
      activities: []
    }
  }

  const storageKey = getStorageKey(coupleId)
  let store = wx.getStorageSync(storageKey)

  if (!store || !store.version) {
    store = buildSeedStore(globalData)
    wx.setStorageSync(storageKey, store)
    return store
  }

  const migratedStore = migrateStore(store)

  if (migratedStore !== store) {
    store = migratedStore
    wx.setStorageSync(storageKey, store)
  }

  return store
}

function persistCoupleStore(globalData = {}, store) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return
  }

  wx.setStorageSync(getStorageKey(coupleId), Object.assign({}, store, {
    updatedAt: nowIso()
  }))
}

function getExpenses(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)
  const currentUserId = getCurrentUserId(globalData, store)

  return store.expenses
    .slice()
    .sort((left, right) => {
      const occurredDiff = parseDateKey(right.occurredOn).getTime() - parseDateKey(left.occurredOn).getTime()

      if (occurredDiff !== 0) {
        return occurredDiff
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
    .map((item) => ({
      id: item.id,
      category: item.categoryLabel,
      categoryKey: item.categoryKey,
      monthKey: item.occurredOn.slice(0, 7),
      monthLabel: formatMonthLabel(item.occurredOn),
      amountDisplay: formatCurrency(item.amountCents),
      amountCents: item.amountCents,
      ownerLabel: formatOwnerLabel(item, globalData, store),
      ownerScope: item.ownerScope,
      ownerUserId: item.ownerUserId,
      ownerKey: item.ownerScope === 'shared'
        ? 'shared'
        : (item.ownerUserId === currentUserId ? 'me' : 'partner'),
      dateLabel: formatMonthDay(item.occurredOn),
      occurredOn: item.occurredOn,
      createdAtLabel: formatDateTimeLabel(item.createdAt),
      note: item.note || ''
    }))
}

function getTodos(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)
  const currentUserId = getCurrentUserId(globalData, store)

  return store.todos
    .slice()
    .sort((left, right) => {
      if (left.status !== right.status) {
        return left.status === 'open' ? -1 : 1
      }

      const leftDue = left.dueAt ? parseDateKey(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      const rightDue = right.dueAt ? parseDateKey(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER
      return leftDue - rightDue
    })
    .map((item) => ({
      id: item.id,
      title: item.title,
      note: item.note || '',
      dueAt: item.dueAt || '',
      assigneeLabel: formatAssigneeLabel(item, globalData, store),
      assigneeKey: !item.assigneeUserId
        ? 'shared'
        : (item.assigneeUserId === currentUserId ? 'me' : 'partner'),
      dueLabel: formatDueLabel(item.dueAt, item.status),
      status: item.status
    }))
}

function getAnniversaries(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)

  return store.anniversaries
    .map((item) => buildAnniversaryDisplay(item, store))
    .sort((left, right) => left.sortTime - right.sortTime)
}

function getWorkouts(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)
  const currentUserId = getCurrentUserId(globalData, store)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')

  return (store.workouts || [])
    .slice()
    .sort((left, right) => {
      const occurredDiff = parseDateKey(right.occurredOn).getTime() - parseDateKey(left.occurredOn).getTime()

      if (occurredDiff !== 0) {
        return occurredDiff
      }

      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
    .map((item) => ({
      id: item.id,
      typeKey: item.typeKey,
      typeLabel: item.typeLabel,
      durationMinutes: item.durationMinutes,
      durationLabel: `${item.durationMinutes} 分钟`,
      userId: item.userId,
      userLabel: item.userId === currentUserId ? selfLabel : partnerLabel,
      userKey: item.userId === currentUserId ? 'me' : 'partner',
      monthKey: item.occurredOn.slice(0, 7),
      monthLabel: formatMonthLabel(item.occurredOn),
      occurredOn: item.occurredOn,
      dateLabel: formatMonthDay(item.occurredOn),
      createdAtLabel: formatDateTimeLabel(item.createdAt),
      note: item.note || ''
    }))
}

function buildActivitySummary(categoryLabel, note) {
  return `${categoryLabel || '账单'}${note ? ` · ${note}` : ''}`
}

function buildActivityPresentation(item, store, globalData, baseDate = new Date()) {
  const currentUserId = getCurrentUserId(globalData, store)

  if (item.type === 'expense_created') {
    const expense = (store.expenses || []).find((target) => target.id === item.targetId)
    const amountCents = expense ? expense.amountCents : item.amountCents
    const ownerScope = expense ? expense.ownerScope : item.ownerScope
    const ownerUserId = expense ? expense.ownerUserId : item.ownerUserId
    const categoryLabel = expense ? expense.categoryLabel : item.categoryLabel
    const note = expense ? expense.note : item.note

    if (typeof amountCents === 'number' && ownerScope) {
      const ownerLabel = ownerScope === 'shared'
        ? '共同'
        : getDisplayNameByUserId(ownerUserId, globalData, {
          selfFallback: '我',
          partnerFallback: '伴侣'
        })

      return {
        title: `${ownerLabel}支出 ${formatActivityAmount(amountCents)} 元`,
        summary: buildActivitySummary(categoryLabel, note)
      }
    }
  }

  if (item.type === 'todo_created' || item.type === 'todo_completed') {
    const todo = (store.todos || []).find((target) => target.id === item.targetId)

    return {
      title: item.type === 'todo_completed' ? '已完成待办' : '新增待办',
      summary: (todo && todo.title) || item.itemTitle || item.summary || ''
    }
  }

  if (item.type === 'anniversary_created') {
    const anniversary = (store.anniversaries || []).find((target) => target.id === item.targetId)

    return {
      title: '新增纪念日',
      summary: anniversary
        ? buildAnniversaryDisplay(anniversary, store, baseDate).title
        : (item.itemTitle || item.summary || '')
    }
  }

  if (item.type === 'workout_created') {
    const workout = (store.workouts || []).find((target) => target.id === item.targetId)
    const actorLabel = getDisplayNameByUserId((workout ? workout.userId : item.actorUserId), globalData, {
      selfFallback: '我',
      partnerFallback: '伴侣'
    })
    const title = workout ? `${actorLabel}完成一次${workout.typeLabel}` : `${actorLabel}记录了运动`

    return {
      title,
      summary: workout
        ? `${workout.durationMinutes} 分钟${workout.note ? ` · ${workout.note}` : ''}`
        : item.summary
    }
  }

  return {
    title: item.title,
    summary: item.summary
  }
}

function getRecentActivities(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)
  const threshold = addDays(new Date(), -30).getTime()

  return store.activities
    .slice()
    .filter((item) => new Date(item.createdAt).getTime() >= threshold)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 50)
    .map((item) => Object.assign({
      id: item.id,
      type: item.type,
      targetId: item.targetId || '',
      meta: formatDateTimeLabel(item.createdAt)
    }, buildActivityPresentation(item, store, globalData)))
}

function listRecordSections(globalData = {}, storeOverride = null) {
  const store = storeOverride || ensureCoupleStore(globalData)

  return {
    expenses: getExpenses(globalData, store),
    todos: getTodos(globalData, store),
    anniversaries: getAnniversaries(globalData, store),
    workouts: getWorkouts(globalData, store)
  }
}

function parseAmountInput(amountInput) {
  const amount = Number(String(amountInput).trim())

  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return Math.round(amount * 100)
}

function normalizeOwnerChoice(choice, globalData = {}) {
  if (choice === 'me') {
    return {
      ownerScope: 'personal',
      ownerUserId: getCurrentUserId(globalData)
    }
  }

  if (choice === 'partner') {
    return {
      ownerScope: 'personal',
      ownerUserId: getPartnerUserId(globalData)
    }
  }

  return {
    ownerScope: 'shared',
    ownerUserId: null
  }
}

function normalizeAssigneeChoice(choice, globalData = {}) {
  if (choice === 'me') {
    return getCurrentUserId(globalData)
  }

  if (choice === 'partner') {
    return getPartnerUserId(globalData)
  }

  return null
}

function validateTodoPayload(payload = {}) {
  const title = (payload.title || '').trim()
  const dueAt = (payload.dueAt || '').trim()

  if (!title) {
    return {
      ok: false,
      message: '待办标题不能为空'
    }
  }

  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    return {
      ok: false,
      message: '截止日期请按 YYYY-MM-DD 输入，或者留空'
    }
  }

  return {
    ok: true,
    title,
    dueAt
  }
}

function validateAnniversaryPayload(payload = {}) {
  const kind = payload.kind === 'relationship' ? 'relationship' : 'custom'
  const title = (payload.title || '').trim()
  const date = (payload.date || '').trim()

  if (kind === 'custom' && !title) {
    return {
      ok: false,
      message: '纪念日名称不能为空'
    }
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return {
      ok: false,
      message: '请按 YYYY-MM-DD 输入日期'
    }
  }

  return {
    ok: true,
    kind,
    title,
    date
  }
}

function validateWorkoutPayload(payload = {}) {
  const workoutType = WORKOUT_TYPES.find((item) => item.key === payload.typeKey) || WORKOUT_TYPES[0]
  const durationMinutes = Number(String(payload.durationMinutes || '').trim())
  const occurredOn = String(payload.occurredOn || '').trim()

  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return {
      ok: false,
      message: '请输入有效时长'
    }
  }

  if (!occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return {
      ok: false,
      message: '请选择运动日期'
    }
  }

  return {
    ok: true,
    typeKey: workoutType.key,
    typeLabel: workoutType.label,
    durationMinutes: Math.round(durationMinutes),
    occurredOn
  }
}

function appendActivity(store, activity) {
  store.activities.push(Object.assign({
    id: createId('activity'),
    createdAt: nowIso()
  }, activity))
}

function createExpense(globalData = {}, payload = {}) {
  const store = ensureCoupleStore(globalData)
  const amountCents = parseAmountInput(payload.amount)

  if (!amountCents) {
    return {
      ok: false,
      message: '请输入有效金额'
    }
  }

  const category = EXPENSE_CATEGORIES.find((item) => item.key === payload.categoryKey) || EXPENSE_CATEGORIES[0]
  const owner = normalizeOwnerChoice(payload.ownerChoice, globalData)
  const expense = {
    id: createId('expense'),
    categoryKey: category.key,
    categoryLabel: category.label,
    amountCents,
    ownerScope: owner.ownerScope,
    ownerUserId: owner.ownerUserId,
    note: payload.note || '',
    occurredOn: payload.occurredOn || toDateKey(new Date()),
    createdBy: getCurrentUserId(globalData),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  store.expenses.push(expense)
  appendActivity(store, {
    type: 'expense_created',
    actorUserId: getCurrentUserId(globalData),
    targetId: expense.id,
    title: '新增账单',
    summary: `${category.label}${expense.note ? ` · ${expense.note}` : ''}`,
    amountCents,
    ownerScope: expense.ownerScope,
    ownerUserId: expense.ownerUserId,
    categoryLabel: category.label,
    note: expense.note || '',
    itemTitle: `${formatActivityAmount(amountCents)} 元`
  })
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function createTodo(globalData = {}, payload = {}) {
  const validation = validateTodoPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const store = ensureCoupleStore(globalData)
  const assigneeUserId = normalizeAssigneeChoice(payload.assigneeChoice, globalData)

  const todo = {
    id: createId('todo'),
    title: validation.title,
    note: payload.note || '',
    assigneeUserId,
    dueAt: validation.dueAt,
    status: 'open',
    completedBy: null,
    completedAt: null,
    createdBy: getCurrentUserId(globalData),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  store.todos.push(todo)
  appendActivity(store, {
    type: 'todo_created',
    actorUserId: getCurrentUserId(globalData),
    targetId: todo.id,
    title: '新增待办',
    summary: validation.title,
    itemTitle: validation.title
  })
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function syncAnniversaryPrepTodo(store, anniversary, prepTodoTitle, globalData = {}) {
  const nextTitle = String(prepTodoTitle || '').trim()
  const linkedTodoIndex = anniversary.linkedTodoId
    ? store.todos.findIndex((item) => item.id === anniversary.linkedTodoId)
    : -1
  const linkedTodo = linkedTodoIndex >= 0 ? store.todos[linkedTodoIndex] : null

  if (!nextTitle) {
    if (linkedTodoIndex >= 0) {
      store.todos.splice(linkedTodoIndex, 1)
    }

    anniversary.linkedTodoId = null
    return
  }

  if (linkedTodo) {
    linkedTodo.title = nextTitle
    linkedTodo.updatedAt = nowIso()
    return
  }

  const prepTodo = {
    id: createId('todo'),
    title: nextTitle,
    note: '',
    assigneeUserId: null,
    dueAt: '',
    status: 'open',
    completedBy: null,
    completedAt: null,
    createdBy: getCurrentUserId(globalData),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  store.todos.push(prepTodo)
  anniversary.linkedTodoId = prepTodo.id
}

function createAnniversary(globalData = {}, payload = {}) {
  const validation = validateAnniversaryPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const store = ensureCoupleStore(globalData)
  const anniversary = {
    id: createId('anniversary'),
    title: validation.kind === 'relationship' ? normalizeRelationshipTitle(validation.title || '在一起') : validation.title,
    date: validation.date,
    type: validation.kind,
    linkedTodoId: null,
    note: payload.note || '',
    createdBy: getCurrentUserId(globalData),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  syncAnniversaryPrepTodo(store, anniversary, payload.prepTodoTitle, globalData)
  store.anniversaries.push(anniversary)
  appendActivity(store, {
    type: 'anniversary_created',
    actorUserId: getCurrentUserId(globalData),
    targetId: anniversary.id,
    title: '新增纪念日',
    summary: anniversary.type === 'relationship' ? formatRelationshipAnniversaryTitle(anniversary, getNextAnnualOccurrence(validation.date).years) : anniversary.title,
    itemTitle: anniversary.type === 'relationship' ? formatRelationshipAnniversaryTitle(anniversary, getNextAnnualOccurrence(validation.date).years) : anniversary.title
  })
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function updateExpense(globalData = {}, expenseId, payload = {}) {
  const store = ensureCoupleStore(globalData)
  const expense = store.expenses.find((item) => item.id === expenseId)
  const amountCents = parseAmountInput(payload.amount)

  if (!expense) {
    return {
      ok: false,
      message: '没有找到这笔账单'
    }
  }

  if (!amountCents) {
    return {
      ok: false,
      message: '请输入有效金额'
    }
  }

  const category = EXPENSE_CATEGORIES.find((item) => item.key === payload.categoryKey) || EXPENSE_CATEGORIES[0]
  const owner = normalizeOwnerChoice(payload.ownerChoice, globalData)

  expense.categoryKey = category.key
  expense.categoryLabel = category.label
  expense.amountCents = amountCents
  expense.ownerScope = owner.ownerScope
  expense.ownerUserId = owner.ownerUserId
  expense.note = payload.note || ''
  expense.occurredOn = payload.occurredOn || expense.occurredOn
  expense.updatedAt = nowIso()

  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function deleteExpense(globalData = {}, expenseId) {
  const store = ensureCoupleStore(globalData)
  const index = store.expenses.findIndex((item) => item.id === expenseId)

  if (index < 0) {
    return {
      ok: false,
      message: '没有找到这笔账单'
    }
  }

  store.expenses.splice(index, 1)
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function updateTodo(globalData = {}, todoId, payload = {}) {
  const store = ensureCoupleStore(globalData)
  const todo = store.todos.find((item) => item.id === todoId)
  const validation = validateTodoPayload(payload)

  if (!todo) {
    return {
      ok: false,
      message: '没有找到这条待办'
    }
  }

  if (!validation.ok) {
    return validation
  }

  todo.title = validation.title
  todo.note = payload.note || ''
  todo.assigneeUserId = normalizeAssigneeChoice(payload.assigneeChoice, globalData)
  todo.dueAt = validation.dueAt
  todo.updatedAt = nowIso()

  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function deleteTodo(globalData = {}, todoId) {
  const store = ensureCoupleStore(globalData)
  const index = store.todos.findIndex((item) => item.id === todoId)

  if (index < 0) {
    return {
      ok: false,
      message: '没有找到这条待办'
    }
  }

  store.todos.splice(index, 1)
  store.anniversaries.forEach((item) => {
    if (item.linkedTodoId === todoId) {
      item.linkedTodoId = null
      item.updatedAt = nowIso()
    }
  })
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function updateAnniversary(globalData = {}, anniversaryId, payload = {}) {
  const store = ensureCoupleStore(globalData)
  const anniversary = store.anniversaries.find((item) => item.id === anniversaryId)
  const validation = validateAnniversaryPayload(payload)

  if (!anniversary) {
    return {
      ok: false,
      message: '没有找到这个纪念日'
    }
  }

  if (!validation.ok) {
    return validation
  }

  anniversary.type = validation.kind
  anniversary.title = validation.kind === 'relationship'
    ? normalizeRelationshipTitle(validation.title || '在一起')
    : validation.title
  anniversary.date = validation.date
  anniversary.note = payload.note || ''
  anniversary.updatedAt = nowIso()
  syncAnniversaryPrepTodo(store, anniversary, payload.prepTodoTitle, globalData)

  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function deleteAnniversary(globalData = {}, anniversaryId) {
  const store = ensureCoupleStore(globalData)
  const index = store.anniversaries.findIndex((item) => item.id === anniversaryId)

  if (index < 0) {
    return {
      ok: false,
      message: '没有找到这个纪念日'
    }
  }

  store.anniversaries.splice(index, 1)
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function createWorkout(globalData = {}, payload = {}) {
  const validation = validateWorkoutPayload(payload)

  if (!validation.ok) {
    return validation
  }

  const store = ensureCoupleStore(globalData)
  const workout = {
    id: createId('workout'),
    typeKey: validation.typeKey,
    typeLabel: validation.typeLabel,
    durationMinutes: validation.durationMinutes,
    occurredOn: validation.occurredOn,
    note: payload.note || '',
    userId: getCurrentUserId(globalData),
    createdBy: getCurrentUserId(globalData),
    createdAt: nowIso(),
    updatedAt: nowIso()
  }

  store.workouts.push(workout)
  appendActivity(store, {
    type: 'workout_created',
    actorUserId: getCurrentUserId(globalData),
    targetId: workout.id,
    title: '记录了一次运动',
    summary: `${workout.typeLabel} · ${workout.durationMinutes} 分钟`,
    itemTitle: workout.typeLabel
  })
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function updateWorkout(globalData = {}, workoutId, payload = {}) {
  const store = ensureCoupleStore(globalData)
  const workout = (store.workouts || []).find((item) => item.id === workoutId)
  const validation = validateWorkoutPayload(payload)

  if (!workout) {
    return {
      ok: false,
      message: '没有找到这条运动记录'
    }
  }

  if (!validation.ok) {
    return validation
  }

  workout.typeKey = validation.typeKey
  workout.typeLabel = validation.typeLabel
  workout.durationMinutes = validation.durationMinutes
  workout.occurredOn = validation.occurredOn
  workout.note = payload.note || ''
  workout.updatedAt = nowIso()
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function deleteWorkout(globalData = {}, workoutId) {
  const store = ensureCoupleStore(globalData)
  const index = (store.workouts || []).findIndex((item) => item.id === workoutId)

  if (index < 0) {
    return {
      ok: false,
      message: '没有找到这条运动记录'
    }
  }

  store.workouts.splice(index, 1)
  persistCoupleStore(globalData, store)

  return {
    ok: true
  }
}

function toggleTodoStatus(globalData = {}, todoId) {
  const store = ensureCoupleStore(globalData)
  const todo = store.todos.find((item) => item.id === todoId)

  if (!todo) {
    return
  }

  if (todo.status === 'completed') {
    todo.status = 'open'
    todo.completedBy = null
    todo.completedAt = null
  } else {
    todo.status = 'completed'
    todo.completedBy = getCurrentUserId(globalData)
    todo.completedAt = nowIso()

    appendActivity(store, {
      type: 'todo_completed',
      actorUserId: getCurrentUserId(globalData),
      targetId: todo.id,
      title: '已完成待办',
      summary: todo.title,
      itemTitle: todo.title
    })
  }

  todo.updatedAt = nowIso()
  persistCoupleStore(globalData, store)
}

function getExpenseCategories() {
  return EXPENSE_CATEGORIES.slice()
}

function getRawStore(globalData = {}) {
  return ensureCoupleStore(globalData)
}

function getUpcomingAnniversaryFromStore(store, baseDate = new Date()) {
  return (store.anniversaries || [])
    .map((item) => buildAnniversaryDisplay(item, store, baseDate))
    .sort((left, right) => left.sortTime - right.sortTime)[0] || null
}

async function getRawStoreAsync(globalData = {}) {
  if (shouldUseLocalStore(globalData)) {
    return getRawStore(globalData)
  }

  return fetchCloudStore(globalData)
}

async function listRecordSectionsAsync(globalData = {}) {
  if (shouldUseLocalStore(globalData)) {
    return listRecordSections(globalData)
  }

  const store = await fetchCloudStore(globalData)
  return listRecordSections(globalData, store)
}

async function getRecentActivitiesAsync(globalData = {}) {
  if (shouldUseLocalStore(globalData)) {
    return getRecentActivities(globalData)
  }

  const store = await fetchCloudStore(globalData)
  return getRecentActivities(globalData, store)
}

async function mutateCloudRecords(action, payload = {}) {
  const result = await callCloudFunction('records', {
    action,
    payload
  })

  return result.ok ? { ok: true } : result
}

async function createExpenseRecord(globalData = {}, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return createExpense(globalData, payload)
  }

  return mutateCloudRecords('createExpense', payload)
}

async function updateExpenseRecord(globalData = {}, expenseId, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return updateExpense(globalData, expenseId, payload)
  }

  return mutateCloudRecords('updateExpense', Object.assign({ id: expenseId }, payload))
}

async function deleteExpenseRecord(globalData = {}, expenseId) {
  if (shouldUseLocalStore(globalData)) {
    return deleteExpense(globalData, expenseId)
  }

  return mutateCloudRecords('deleteExpense', {
    id: expenseId
  })
}

async function createTodoRecord(globalData = {}, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return createTodo(globalData, payload)
  }

  return mutateCloudRecords('createTodo', payload)
}

async function updateTodoRecord(globalData = {}, todoId, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return updateTodo(globalData, todoId, payload)
  }

  return mutateCloudRecords('updateTodo', Object.assign({ id: todoId }, payload))
}

async function deleteTodoRecord(globalData = {}, todoId) {
  if (shouldUseLocalStore(globalData)) {
    return deleteTodo(globalData, todoId)
  }

  return mutateCloudRecords('deleteTodo', {
    id: todoId
  })
}

async function toggleTodoStatusRecord(globalData = {}, todoId) {
  if (shouldUseLocalStore(globalData)) {
    toggleTodoStatus(globalData, todoId)
    return {
      ok: true
    }
  }

  return mutateCloudRecords('toggleTodo', {
    id: todoId
  })
}

async function createAnniversaryRecord(globalData = {}, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return createAnniversary(globalData, payload)
  }

  return mutateCloudRecords('createAnniversary', payload)
}

async function updateAnniversaryRecord(globalData = {}, anniversaryId, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return updateAnniversary(globalData, anniversaryId, payload)
  }

  return mutateCloudRecords('updateAnniversary', Object.assign({ id: anniversaryId }, payload))
}

async function deleteAnniversaryRecord(globalData = {}, anniversaryId) {
  if (shouldUseLocalStore(globalData)) {
    return deleteAnniversary(globalData, anniversaryId)
  }

  return mutateCloudRecords('deleteAnniversary', {
    id: anniversaryId
  })
}

async function createWorkoutRecord(globalData = {}, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return createWorkout(globalData, payload)
  }

  return mutateCloudRecords('createWorkout', payload)
}

async function updateWorkoutRecord(globalData = {}, workoutId, payload = {}) {
  if (shouldUseLocalStore(globalData)) {
    return updateWorkout(globalData, workoutId, payload)
  }

  return mutateCloudRecords('updateWorkout', Object.assign({ id: workoutId }, payload))
}

async function deleteWorkoutRecord(globalData = {}, workoutId) {
  if (shouldUseLocalStore(globalData)) {
    return deleteWorkout(globalData, workoutId)
  }

  return mutateCloudRecords('deleteWorkout', {
    id: workoutId
  })
}

module.exports = {
  createAnniversary: createAnniversaryRecord,
  createExpense: createExpenseRecord,
  createTodo: createTodoRecord,
  createWorkout: createWorkoutRecord,
  deleteAnniversary: deleteAnniversaryRecord,
  deleteExpense: deleteExpenseRecord,
  deleteTodo: deleteTodoRecord,
  deleteWorkout: deleteWorkoutRecord,
  getAnniversaries,
  getCurrentUserId,
  getExpenseCategories,
  getExpenses,
  getRawStore: getRawStoreAsync,
  getRawStoreLocal: getRawStore,
  getRecentActivities: getRecentActivitiesAsync,
  getRecentActivitiesLocal: getRecentActivities,
  getTodos,
  getWorkouts,
  getWorkoutTypes() {
    return WORKOUT_TYPES.slice()
  },
  getUpcomingAnniversaryFromStore,
  listRecordSections: listRecordSectionsAsync,
  listRecordSectionsLocal: listRecordSections,
  toggleTodoStatus: toggleTodoStatusRecord,
  updateAnniversary: updateAnniversaryRecord,
  updateExpense: updateExpenseRecord,
  updateTodo: updateTodoRecord,
  updateWorkout: updateWorkoutRecord
}

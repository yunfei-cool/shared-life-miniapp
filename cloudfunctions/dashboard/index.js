const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const ACTIVE_STATUSES = ['invited', 'paired']
const COLLECTIONS = {
  couples: 'couples',
  expenses: 'expenses',
  todos: 'todos',
  anniversaries: 'anniversaries',
  workouts: 'workouts',
  budgetSettings: 'budget_settings',
  activity: 'activity_feed',
  steps: 'step_snapshots'
}
const PROFILE_PLACEHOLDER_NAMES = ['未命名用户', '微信用户', '伴侣', '用户']

function startOfDay(date) {
  const next = new Date(date.getTime())
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = new Date(date.getTime())
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date, days) {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

function toDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseDateKey(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function startOfWeek(date) {
  const next = startOfDay(date)
  const day = next.getDay()
  const offset = day === 0 ? -6 : 1 - day
  return addDays(next, offset)
}

function endOfWeek(date) {
  return endOfDay(addDays(startOfWeek(date), 6))
}

function getPeriodBounds(periodType, baseDate = new Date()) {
  if (periodType === 'monthly') {
    const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
    const end = endOfDay(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0))
    return {
      start,
      end,
      startKey: toDateKey(start),
      endKey: toDateKey(end)
    }
  }

  const start = startOfWeek(baseDate)
  const end = endOfWeek(baseDate)

  return {
    start,
    end,
    startKey: toDateKey(start),
    endKey: toDateKey(end)
  }
}

function getPreviousPeriodBounds(periodType, baseDate = new Date()) {
  const current = getPeriodBounds(periodType, baseDate)

  if (periodType === 'monthly') {
    return getPeriodBounds('monthly', new Date(current.start.getFullYear(), current.start.getMonth() - 1, 1))
  }

  return getPeriodBounds('weekly', addDays(current.start, -1))
}

function isDateKeyInRange(dateKey, bounds) {
  const timestamp = startOfDay(parseDateKey(dateKey)).getTime()
  return timestamp >= startOfDay(bounds.start).getTime() && timestamp <= endOfDay(bounds.end).getTime()
}

function diffDays(fromDate, toDate) {
  const from = startOfDay(fromDate).getTime()
  const to = startOfDay(toDate).getTime()
  return Math.round((to - from) / 86400000)
}

function daysUntil(dateKey, baseDate = new Date()) {
  return diffDays(baseDate, parseDateKey(dateKey))
}

function formatMonthDay(value) {
  const date = typeof value === 'string' ? parseDateKey(value) : value
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

function formatFullDate(value) {
  const date = typeof value === 'string' ? parseDateKey(value) : value
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

function formatDateTimeLabel(value, baseDate = new Date()) {
  const date = new Date(value)
  const dayKey = toDateKey(date)
  const todayKey = toDateKey(baseDate)
  const yesterdayKey = toDateKey(addDays(baseDate, -1))
  const timeLabel = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (dayKey === todayKey) {
    return `今天 ${timeLabel}`
  }

  if (dayKey === yesterdayKey) {
    return `昨天 ${timeLabel}`
  }

  return `${formatMonthDay(date)} ${timeLabel}`
}

function formatCurrency(amountCents) {
  const amount = amountCents / 100
  const hasDecimals = amountCents % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function formatActivityAmount(amountCents) {
  const amount = amountCents / 100
  return amountCents % 100 === 0 ? amount.toFixed(0) : amount.toFixed(2)
}

function formatPercentChange(currentCents, previousCents) {
  if (!previousCents) {
    return '首个周期'
  }

  const delta = Math.round(((currentCents - previousCents) / previousCents) * 100)
  return `${delta > 0 ? '+' : ''}${delta}%`
}

function hasCompleteProfile(profile = {}) {
  const nickName = String(profile.nickName || '').trim()
  const avatarUrl = String(profile.avatarUrl || '').trim()

  return !!nickName && !!avatarUrl && !PROFILE_PLACEHOLDER_NAMES.includes(nickName)
}

function formatChineseNumber(value) {
  const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

  if (!Number.isFinite(value) || value <= 0) {
    return '零'
  }

  if (value < 10) {
    return digits[value]
  }

  if (value === 10) {
    return '十'
  }

  if (value < 20) {
    return `十${digits[value % 10]}`
  }

  if (value < 100) {
    const tens = Math.floor(value / 10)
    const ones = value % 10
    return `${digits[tens]}十${ones ? digits[ones] : ''}`
  }

  return `${value}`
}

function getNextAnnualOccurrence(dateKey, baseDate = new Date()) {
  const anchor = parseDateKey(dateKey)
  const month = anchor.getMonth()
  const day = anchor.getDate()

  function buildOccurrence(year) {
    const lastDay = new Date(year, month + 1, 0).getDate()
    return new Date(year, month, Math.min(day, lastDay))
  }

  let candidate = buildOccurrence(baseDate.getFullYear())

  if (startOfDay(candidate).getTime() < startOfDay(baseDate).getTime()) {
    candidate = buildOccurrence(baseDate.getFullYear() + 1)
  }

  return {
    dateKey: toDateKey(candidate),
    years: candidate.getFullYear() - anchor.getFullYear()
  }
}

function normalizeRelationshipTitle(title) {
  const normalized = String(title || '在一起')
    .replace(/\s+/g, '')
    .replace(/([一二三四五六七八九十\d]+周年|周年|纪念日)$/g, '')

  return normalized || '在一起'
}

function formatRelationshipAnniversaryTitle(item, years) {
  const baseTitle = normalizeRelationshipTitle(item.title)

  if (years <= 0) {
    return baseTitle
  }

  const yearLabel = years === 2 ? '两' : formatChineseNumber(years)
  return `${baseTitle}${yearLabel}周年`
}

async function listActiveCouplesByField(field, openid) {
  const result = await db.collection(COLLECTIONS.couples).where({
    [field]: openid,
    status: _.in(ACTIVE_STATUSES)
  }).get()

  return result.data || []
}

async function findActiveCouple(openid) {
  const [created, joined] = await Promise.all([
    listActiveCouplesByField('creatorUserId', openid),
    listActiveCouplesByField('partnerUserId', openid)
  ])

  return created
    .concat(joined)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
}

function requirePairedCouple(couple) {
  if (!couple || couple.status !== 'paired') {
    throw new Error('共享空间还没连接完成')
  }
}

function buildRangeCommand(startValue, endValue) {
  return _.gte(startValue).and(_.lte(endValue))
}

function uniqueIds(ids = []) {
  return Array.from(new Set((ids || []).filter(Boolean)))
}

function mergeById(lists = []) {
  const map = {}

  lists.forEach((items) => {
    ;(items || []).forEach((item) => {
      if (!item || !item.id) {
        return
      }

      map[item.id] = item
    })
  })

  return Object.keys(map).map((key) => map[key])
}

async function listAllByQuery(collectionName, query = {}, options = {}) {
  const collection = db.collection(collectionName)
  const items = []
  const batchSize = Math.max(1, Math.min(Number(options.batchSize || 100), 100))
  const maxItems = Number(options.maxItems || 0)
  let skip = 0

  while (true) {
    let request = collection.where(query)

    if (options.orderField) {
      request = request.orderBy(options.orderField, options.orderDirection || 'desc')
    }

    const result = await request.skip(skip).limit(batchSize).get()
    const chunk = result.data || []

    items.push(...chunk)

    if (maxItems > 0 && items.length >= maxItems) {
      return items.slice(0, maxItems)
    }

    if (chunk.length < batchSize) {
      break
    }

    skip += chunk.length
  }

  return items
}

async function listDocsByIds(collectionName, ids = []) {
  const unique = uniqueIds(ids)

  if (!unique.length) {
    return []
  }

  const chunkSize = 100
  const chunks = []

  for (let index = 0; index < unique.length; index += chunkSize) {
    chunks.push(unique.slice(index, index + chunkSize))
  }

  const groups = await Promise.all(chunks.map((chunk) => {
    return db.collection(collectionName).where({
      _id: _.in(chunk)
    }).limit(chunk.length).get()
  }))

  return groups.reduce((items, result) => items.concat(result.data || []), [])
}

async function existsByQuery(collectionName, query = {}) {
  const result = await db.collection(collectionName).where(query).limit(1).get()
  return !!((result.data || []).length)
}

async function countByQuery(collectionName, query = {}) {
  const result = await db.collection(collectionName).where(query).count()
  return Number(result.total || 0)
}

function collectActivityTargetIds(activities = []) {
  return activities.reduce((accumulator, item) => {
    if (!item || !item.targetId) {
      return accumulator
    }

    if (item.type === 'expense_created') {
      accumulator.expenseIds.push(item.targetId)
    } else if (item.type === 'todo_created' || item.type === 'todo_completed') {
      accumulator.todoIds.push(item.targetId)
    } else if (item.type === 'anniversary_created') {
      accumulator.anniversaryIds.push(item.targetId)
    } else if (item.type === 'workout_created') {
      accumulator.workoutIds.push(item.targetId)
    }

    return accumulator
  }, {
    expenseIds: [],
    todoIds: [],
    anniversaryIds: [],
    workoutIds: []
  })
}

function mapExpenseDoc(item) {
  return {
    id: item._id,
    categoryKey: item.categoryKey,
    categoryLabel: item.categoryLabel,
    amountCents: item.amountCents,
    ownerScope: item.ownerScope,
    ownerUserId: item.ownerUserId || null,
    note: item.note || '',
    occurredOn: item.occurredOn,
    createdAt: item.createdAt
  }
}

function mapTodoDoc(item) {
  return {
    id: item._id,
    title: item.title,
    note: item.note || '',
    assigneeUserId: item.assigneeUserId || null,
    dueAt: item.dueAt || '',
    status: item.status || 'open',
    completedAt: item.completedAt || null,
    createdAt: item.createdAt
  }
}

function mapAnniversaryDoc(item) {
  return {
    id: item._id,
    title: item.title,
    date: item.date,
    type: item.type,
    linkedTodoId: item.linkedTodoId || null,
    note: item.note || ''
  }
}

function mapWorkoutDoc(item) {
  return {
    id: item._id,
    typeKey: item.typeKey,
    typeLabel: item.typeLabel,
    durationMinutes: item.durationMinutes,
    occurredOn: item.occurredOn,
    note: item.note || '',
    userId: item.userId,
    createdAt: item.createdAt
  }
}

function mapActivityDoc(item) {
  return {
    id: item._id,
    type: item.type,
    actorUserId: item.actorUserId || null,
    targetId: item.targetId || '',
    title: item.title,
    summary: item.summary || '',
    amountCents: typeof item.amountCents === 'number' ? item.amountCents : null,
    ownerScope: item.ownerScope || '',
    ownerUserId: item.ownerUserId || null,
    categoryLabel: item.categoryLabel || '',
    note: item.note || '',
    itemTitle: item.itemTitle || '',
    createdAt: item.createdAt
  }
}

async function loadStore(coupleId, baseDate = new Date()) {
  const weeklyBounds = getPeriodBounds('weekly', baseDate)
  const previousWeeklyBounds = getPreviousPeriodBounds('weekly', baseDate)
  const monthlyBounds = getPeriodBounds('monthly', baseDate)
  const expenseStartKey = [previousWeeklyBounds.startKey, monthlyBounds.startKey].sort()[0]
  const expenseEndKey = [previousWeeklyBounds.endKey, monthlyBounds.endKey].sort().slice(-1)[0]
  const recentActivityThreshold = addDays(baseDate, -30).toISOString()

  const [
    expenseDocs,
    openTodoDocs,
    completedTodoCount,
    hasAssignedTodo,
    hasSharedExpense,
    anniversaryDocs,
    weeklyWorkoutDocs,
    recentActivityDocs
  ] = await Promise.all([
    listAllByQuery(COLLECTIONS.expenses, {
      coupleId,
      occurredOn: buildRangeCommand(expenseStartKey, expenseEndKey)
    }),
    listAllByQuery(COLLECTIONS.todos, {
      coupleId,
      status: 'open'
    }),
    countByQuery(COLLECTIONS.todos, {
      coupleId,
      status: 'completed'
    }),
    existsByQuery(COLLECTIONS.todos, {
      coupleId,
      assigneeUserId: _.neq(null)
    }),
    existsByQuery(COLLECTIONS.expenses, {
      coupleId,
      ownerScope: 'shared'
    }),
    listAllByQuery(COLLECTIONS.anniversaries, {
      coupleId
    }),
    listAllByQuery(COLLECTIONS.workouts, {
      coupleId,
      occurredOn: buildRangeCommand(weeklyBounds.startKey, weeklyBounds.endKey)
    }),
    listAllByQuery(COLLECTIONS.activity, {
      coupleId,
      createdAt: _.gte(recentActivityThreshold)
    }, {
      orderField: 'createdAt',
      orderDirection: 'desc',
      maxItems: 50
    })
  ])

  const activityTargetIds = collectActivityTargetIds(recentActivityDocs)
  const linkedTodoIds = anniversaryDocs.map((item) => item.linkedTodoId).filter(Boolean)
  const [activityExpenseDocs, extraTodoDocs, activityAnniversaryDocs, activityWorkoutDocs] = await Promise.all([
    listDocsByIds(COLLECTIONS.expenses, activityTargetIds.expenseIds),
    listDocsByIds(COLLECTIONS.todos, activityTargetIds.todoIds.concat(linkedTodoIds)),
    listDocsByIds(COLLECTIONS.anniversaries, activityTargetIds.anniversaryIds),
    listDocsByIds(COLLECTIONS.workouts, activityTargetIds.workoutIds)
  ])

  return {
    expenses: mergeById([
      expenseDocs.map(mapExpenseDoc),
      activityExpenseDocs.map(mapExpenseDoc)
    ]),
    todos: mergeById([
      openTodoDocs.map(mapTodoDoc),
      extraTodoDocs.map(mapTodoDoc)
    ]),
    anniversaries: mergeById([
      anniversaryDocs.map(mapAnniversaryDoc),
      activityAnniversaryDocs.map(mapAnniversaryDoc)
    ]),
    workouts: mergeById([
      weeklyWorkoutDocs.map(mapWorkoutDoc),
      activityWorkoutDocs.map(mapWorkoutDoc)
    ]),
    activities: recentActivityDocs.map(mapActivityDoc),
    meta: {
      openTodoCount: openTodoDocs.length,
      completedTodoCount,
      hasAssignedTodo,
      hasSharedExpense
    }
  }
}

async function findBudgetSettings(coupleId) {
  const result = await db.collection(COLLECTIONS.budgetSettings).where({
    coupleId
  }).limit(1).get()

  return (result.data || [])[0] || {}
}

async function hasRecentStepSync(coupleId, baseDate = new Date()) {
  const startKey = toDateKey(addDays(baseDate, -6))
  const result = await db.collection(COLLECTIONS.steps).where({
    coupleId,
    dateKey: _.gte(startKey)
  }).limit(1).get()

  return !!((result.data || []).length)
}

function buildBudgetUsers(couple, openid) {
  return [
    {
      userId: openid === couple.creatorUserId ? couple.creatorUserId : couple.partnerUserId,
      label: '我',
      roleKey: openid === couple.creatorUserId ? 'creator' : 'partner'
    },
    {
      userId: openid === couple.creatorUserId ? couple.partnerUserId : couple.creatorUserId,
      label: '伴侣',
      roleKey: openid === couple.creatorUserId ? 'partner' : 'creator'
    }
  ].filter((item) => item.userId)
}

function splitTotalBudget(totalBudgetCents, users) {
  if (!users.length) {
    return []
  }

  if (users.length === 1) {
    return [{
      userId: users[0].userId,
      budgetCents: totalBudgetCents
    }]
  }

  const baseBudget = Math.floor(totalBudgetCents / users.length)
  const budgets = users.map((item) => ({
    userId: item.userId,
    budgetCents: baseBudget
  }))
  const remainder = totalBudgetCents - budgets.reduce((total, item) => total + item.budgetCents, 0)

  budgets[budgets.length - 1].budgetCents += remainder
  return budgets
}

function normalizeBudgetSettings(doc = {}, couple, openid) {
  const users = buildBudgetUsers(couple, openid)
  const budgetMap = {}

  if (Array.isArray(doc.memberBudgets) && doc.memberBudgets.length) {
    doc.memberBudgets.forEach((item) => {
      if (!item || !item.userId) {
        return
      }

      budgetMap[item.userId] = Math.max(0, Number(item.budgetCents || 0))
    })
  } else if (Number(doc.monthlyBudgetCents || 0) > 0) {
    splitTotalBudget(Number(doc.monthlyBudgetCents || 0), users).forEach((item) => {
      budgetMap[item.userId] = item.budgetCents
    })
  }

  return {
    memberBudgets: users.map((item) => ({
      userId: item.userId,
      budgetCents: budgetMap[item.userId] || 0
    })),
    updatedAt: doc.updatedAt || new Date().toISOString()
  }
}

function buildBudgetSpendByMember(expenses, users) {
  const totals = {}
  const sortedUserIds = users.map((item) => item.userId).filter(Boolean).slice().sort()

  users.forEach((item) => {
    totals[item.userId] = 0
  })

  expenses.forEach((item) => {
    const amountCents = Number(item.amountCents || 0)

    if (amountCents <= 0) {
      return
    }

    if (item.ownerScope === 'shared') {
      if (!sortedUserIds.length) {
        return
      }

      if (sortedUserIds.length === 1) {
        totals[sortedUserIds[0]] = (totals[sortedUserIds[0]] || 0) + amountCents
        return
      }

      const firstShare = Math.floor(amountCents / 2)
      const secondShare = amountCents - firstShare
      totals[sortedUserIds[0]] = (totals[sortedUserIds[0]] || 0) + firstShare
      totals[sortedUserIds[1]] = (totals[sortedUserIds[1]] || 0) + secondShare
      return
    }

    if (item.ownerUserId && Object.prototype.hasOwnProperty.call(totals, item.ownerUserId)) {
      totals[item.ownerUserId] += amountCents
    }
  })

  return totals
}

function sumExpenses(expenses) {
  return expenses.reduce((total, item) => total + item.amountCents, 0)
}

function getTopCategoryLabel(expenses) {
  const totals = {}

  expenses.forEach((item) => {
    totals[item.categoryLabel] = (totals[item.categoryLabel] || 0) + item.amountCents
  })

  return Object.keys(totals)
    .map((name) => ({ name, value: totals[name] }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 2)
    .map((item) => item.name)
    .join('、')
}

function buildPercentBars(expenses) {
  const totals = {}
  const totalCents = sumExpenses(expenses)

  expenses.forEach((item) => {
    totals[item.categoryLabel] = (totals[item.categoryLabel] || 0) + item.amountCents
  })

  const items = Object.keys(totals)
    .map((name) => ({
      name,
      value: totals[name]
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)

  if (!items.length) {
    return [{
      name: '暂无记录',
      percentLabel: '0%',
      amountLabel: formatCurrency(0),
      width: 18
    }]
  }

  return items.map((item, index) => {
    const percent = totalCents ? Math.round((item.value / totalCents) * 100) : 0

    return {
      rank: index + 1,
      name: item.name,
      percentLabel: `${percent}%`,
      amountLabel: formatCurrency(item.value),
      width: Math.max(percent, 18)
    }
  })
}

function buildSpendTrend(expenses, bounds) {
  const totals = {}
  const todayKey = toDateKey(new Date())

  expenses.forEach((item) => {
    totals[item.occurredOn] = (totals[item.occurredOn] || 0) + item.amountCents
  })

  const days = []
  let cursor = new Date(bounds.start.getTime())

  while (cursor.getTime() <= bounds.end.getTime()) {
    const dateKey = toDateKey(cursor)
    days.push({
      dateKey,
      label: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
      amountCents: totals[dateKey] || 0
    })
    cursor = addDays(cursor, 1)
  }

  const maxAmount = Math.max(...days.map((item) => item.amountCents), 1)

  return days.map((item) => {
    const ratio = item.amountCents > 0 ? item.amountCents / maxAmount : 0
    const hasSpend = item.amountCents > 0
    const isToday = item.dateKey === todayKey

    return {
      label: item.label,
      amountLabel: formatCurrency(item.amountCents),
      barHeight: hasSpend ? Math.max(76, Math.round(Math.sqrt(ratio) * 138)) : 6,
      isActive: hasSpend,
      hasSpend,
      isToday,
      tone: hasSpend ? (isToday ? 'today' : 'active') : 'empty',
      toneClass: hasSpend ? 'has-spend' : 'no-spend',
      todayClass: isToday ? 'is-today' : ''
    }
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

function buildAnniversaryDisplay(item, store, baseDate = new Date()) {
  const linkedTodo = (store.todos || []).find((todo) => todo.id === item.linkedTodoId)
  const occurrence = getNextAnnualOccurrence(item.date, baseDate)
  const nextDateLabel = formatFullDate(occurrence.dateKey)

  return {
    id: item.id,
    type: item.type,
    title: item.type === 'relationship'
      ? formatRelationshipAnniversaryTitle(item, occurrence.years)
      : item.title,
    nextDateLabel,
    nextDateKey: occurrence.dateKey,
    daysLeftLabel: formatAnniversaryDaysLabel(occurrence.dateKey),
    linkedTodoLabel: linkedTodo ? `准备项: ${linkedTodo.title}` : '还没准备项',
    sortTime: parseDateKey(occurrence.dateKey).getTime()
  }
}

function getUpcomingAnniversary(store, baseDate = new Date()) {
  return (store.anniversaries || [])
    .map((item) => buildAnniversaryDisplay(item, store, baseDate))
    .sort((left, right) => left.sortTime - right.sortTime)[0] || null
}

function buildActivitySummary(categoryLabel, note) {
  return `${categoryLabel || '账单'}${note ? ` · ${note}` : ''}`
}

function buildActivityPresentation(item, store, openid, baseDate = new Date()) {
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
        : (ownerUserId === openid ? '我' : '伴侣')

      return {
        title: `${ownerLabel}支出 ${formatActivityAmount(amountCents)} 元`,
        summary: buildActivitySummary(categoryLabel, note)
      }
    }
  }

  if (item.type === 'todo_created' || item.type === 'todo_completed') {
    const todo = (store.todos || []).find((target) => target.id === item.targetId)
    const title = item.type === 'todo_completed' ? '已完成待办' : '新增待办'
    const summary = (todo && todo.title) || item.itemTitle || item.summary || ''

    return {
      title,
      summary
    }
  }

  if (item.type === 'anniversary_created') {
    const anniversary = (store.anniversaries || []).find((target) => target.id === item.targetId)
    const summary = anniversary
      ? buildAnniversaryDisplay(anniversary, store, baseDate).title
      : (item.itemTitle || item.summary || '')

    return {
      title: '新增纪念日',
      summary
    }
  }

  if (item.type === 'workout_created') {
    const workout = (store.workouts || []).find((target) => target.id === item.targetId)
    const actorLabel = (workout ? workout.userId : item.actorUserId) === openid ? '我' : '伴侣'

    return {
      title: workout ? `${actorLabel}完成一次${workout.typeLabel}` : `${actorLabel}记录了运动`,
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

function buildBudgetSummary(store, budgetSettings, couple, openid, baseDate = new Date()) {
  const monthlyBounds = getPeriodBounds('monthly', baseDate)
  const monthlyExpenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, monthlyBounds))
  const users = buildBudgetUsers(couple, openid)
  const normalized = normalizeBudgetSettings(budgetSettings || {}, couple, openid)
  const spentByMember = buildBudgetSpendByMember(monthlyExpenses, users)
  const memberSummaries = users.map((item) => {
    const budgetEntry = normalized.memberBudgets.find((target) => target.userId === item.userId) || {
      budgetCents: 0
    }
    const budgetCents = Number(budgetEntry.budgetCents || 0)
    const spentCents = Number(spentByMember[item.userId] || 0)
    const remainingCents = budgetCents - spentCents
    const progressPercent = budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0

    return {
      userId: item.userId,
      label: item.label,
      roleKey: item.roleKey,
      budgetCents,
      budgetDisplay: budgetCents ? formatCurrency(budgetCents) : '未设置',
      spentCents,
      spentDisplay: formatCurrency(spentCents),
      remainingCents,
      remainingDisplay: budgetCents
        ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
        : '先设置预算',
      progressPercent,
      progressWidth: budgetCents ? Math.max(10, Math.min(progressPercent, 100)) : (spentCents ? 24 : 10),
      statusTone: budgetCents && remainingCents < 0 ? 'over' : (budgetCents && progressPercent >= 85 ? 'near' : 'calm')
    }
  })

  const totalBudgetCents = memberSummaries.reduce((total, item) => total + item.budgetCents, 0)
  const spentCents = memberSummaries.reduce((total, item) => total + item.spentCents, 0)
  const remainingCents = totalBudgetCents - spentCents
  const focusMember = memberSummaries
    .slice()
    .sort((left, right) => {
      const leftScore = left.remainingCents < 0 ? 1000000 + Math.abs(left.remainingCents) : left.progressPercent
      const rightScore = right.remainingCents < 0 ? 1000000 + Math.abs(right.remainingCents) : right.progressPercent
      return rightScore - leftScore
    })[0] || null

  let focusText = '先设置预算'

  if (totalBudgetCents > 0) {
    if (!focusMember) {
      focusText = remainingCents >= 0 ? '本月还在预算内' : `本月已超支 ${formatCurrency(Math.abs(remainingCents))}`
    } else if (focusMember.remainingCents < 0) {
      focusText = `${focusMember.label}已超支 ${formatCurrency(Math.abs(focusMember.remainingCents))}`
    } else if (focusMember.progressPercent >= 85) {
      focusText = `${focusMember.label}最接近上限`
    } else if (memberSummaries.length >= 2) {
      focusText = `${memberSummaries[0].label}还剩 ${formatCurrency(Math.max(memberSummaries[0].remainingCents, 0))} · ${memberSummaries[1].label}还剩 ${formatCurrency(Math.max(memberSummaries[1].remainingCents, 0))}`
    } else {
      focusText = remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `已超支 ${formatCurrency(Math.abs(remainingCents))}`
    }
  }

  return {
    hasBudget: totalBudgetCents > 0,
    label: '本月预算',
    spentDisplay: formatCurrency(spentCents),
    totalDisplay: totalBudgetCents ? formatCurrency(totalBudgetCents) : '未设置',
    progressPercent: totalBudgetCents > 0 ? Math.round((spentCents / totalBudgetCents) * 100) : 0,
    progressWidth: totalBudgetCents > 0 ? Math.max(10, Math.min(Math.round((spentCents / totalBudgetCents) * 100), 100)) : (spentCents ? 28 : 12),
    balanceLabel: totalBudgetCents
      ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
      : '去设置预算',
    focusText,
    members: memberSummaries
  }
}

function buildWorkoutSummary(store, openid, baseDate = new Date()) {
  const weeklyBounds = getPeriodBounds('weekly', baseDate)
  const weeklyWorkouts = (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds))
  const myWorkouts = weeklyWorkouts.filter((item) => item.userId === openid)
  const partnerWorkouts = weeklyWorkouts.filter((item) => item.userId !== openid)
  const totalMinutes = weeklyWorkouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0)

  return {
    label: '本周运动',
    myCount: myWorkouts.length,
    partnerCount: partnerWorkouts.length,
    totalCount: weeklyWorkouts.length,
    totalDurationLabel: `${totalMinutes} 分钟`,
    detail: `我 ${myWorkouts.length} 次 · 伴侣 ${partnerWorkouts.length} 次`,
    focusText: weeklyWorkouts.length
      ? `这周一共动了 ${weeklyWorkouts.length} 次，累计 ${totalMinutes} 分钟`
      : '这周还没有运动记录'
  }
}

function buildBudgetPlanningPrompt(budgetCard = {}) {
  const progressPercent = Number(budgetCard.progressPercent || 0)

  if (!budgetCard.hasBudget || progressPercent < 85) {
    return {
      visible: false,
      title: '',
      detail: '',
      tone: 'calm'
    }
  }

  if (progressPercent >= 100) {
    return {
      visible: true,
      title: '本月共同预算已超出',
      detail: '接下来要花的钱先排进待办，再决定要不要买。',
      tone: 'over'
    }
  }

  return {
    visible: true,
    title: '本月共同预算已接近上限',
    detail: '接下来要花的钱先排进待办，避免临时加购。',
    tone: 'near'
  }
}

function buildActivationChecklist(couple, budgetCard, meta = {}, stepSyncReady) {
  const profileReady = hasCompleteProfile(couple.creatorProfile || {}) && hasCompleteProfile(couple.partnerProfile || {})
  const budgetMembers = Array.isArray(budgetCard.members) ? budgetCard.members : []
  const budgetReady = budgetMembers.length >= 2 && budgetMembers.every((item) => Number(item.budgetCents || 0) > 0)
  const firstSharedExpenseReady = !!meta.hasSharedExpense
  const firstAssignedTodoReady = !!meta.hasAssignedTodo
  const items = [
    {
      key: 'space',
      title: '连上共享空间',
      detail: profileReady ? '共享空间和资料都已就绪' : '空间已连接，还差完善资料',
      status: profileReady ? 'done' : 'pending',
      actionLabel: profileReady ? '去看看' : '去完善',
      target: 'profile',
      isOptional: false
    },
    {
      key: 'budget',
      title: '设置两个人的本月预算',
      detail: budgetReady ? '我和伴侣都已设置预算' : '先把我和伴侣的预算都设好',
      status: budgetReady ? 'done' : 'pending',
      actionLabel: '去预算',
      target: 'budget',
      isOptional: false
    },
    {
      key: 'shared_expense',
      title: '记下第一笔共同支出',
      detail: firstSharedExpenseReady ? '已经记下第一笔共同支出' : '先记一笔归属为共同的支出',
      status: firstSharedExpenseReady ? 'done' : 'pending',
      actionLabel: '去记账',
      target: 'expense',
      openEditor: true,
      createPrefill: {
        ownerChoice: 'shared'
      },
      isOptional: false
    },
    {
      key: 'assigned_todo',
      title: '分配第一个待办',
      detail: firstAssignedTodoReady ? '已经分配过待办' : '先把一条待办分给我或伴侣',
      status: firstAssignedTodoReady ? 'done' : 'pending',
      actionLabel: '去待办',
      target: 'todo',
      openEditor: true,
      createPrefill: {
        assigneeChoice: 'partner'
      },
      isOptional: false
    },
    {
      key: 'steps',
      title: '开启微信步数同步',
      detail: stepSyncReady ? '最近步数已同步' : '可选增强，不影响启动完成',
      status: stepSyncReady ? 'done' : 'pending',
      actionLabel: stepSyncReady ? '去运动' : '去开启',
      target: 'workout',
      isOptional: true
    }
  ]
  const requiredItems = items.filter((item) => !item.isOptional)
  const requiredCompletedCount = requiredItems.filter((item) => item.status === 'done').length

  return {
    requiredCompletedCount,
    requiredTotalCount: requiredItems.length,
    optionalCompletedCount: stepSyncReady ? 1 : 0,
    remainingRequiredCount: Math.max(requiredItems.length - requiredCompletedCount, 0),
    allRequiredCompleted: requiredCompletedCount >= requiredItems.length,
    items
  }
}

function buildRitualCard(activationChecklist, baseDate = new Date()) {
  if (!activationChecklist) {
    return null
  }

  if (!activationChecklist.allRequiredCompleted) {
    return {
      mode: 'setup',
      title: '把你们的共享生活启动起来',
      detail: '完成下面 4 步，首页和报告就会真正开始工作',
      progressLabel: `已完成 ${activationChecklist.requiredCompletedCount}/${activationChecklist.requiredTotalCount}`
    }
  }

  const isSunday = baseDate.getDay() === 0
  const isMonthEnd = toDateKey(baseDate) === getPeriodBounds('monthly', baseDate).endKey

  if (isSunday) {
    return {
      mode: 'review',
      title: '本周复盘已准备好',
      detail: '去看看这周的钱和事推进得怎么样',
      actionLabel: '看这周生活复盘',
      periodType: 'weekly'
    }
  }

  if (isMonthEnd) {
    return {
      mode: 'review',
      title: '本月复盘已准备好',
      detail: '去看看这个月的钱和生活节奏',
      actionLabel: '看本月生活复盘',
      periodType: 'monthly'
    }
  }

  return null
}

function buildRecentActivities(store, openid, baseDate = new Date()) {
  const threshold = addDays(baseDate, -30).getTime()

  return (store.activities || [])
    .filter((item) => new Date(item.createdAt).getTime() >= threshold)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 50)
    .map((item) => Object.assign({
      id: item.id,
      type: item.type,
      targetId: item.targetId || '',
      meta: formatDateTimeLabel(item.createdAt, baseDate)
    }, buildActivityPresentation(item, store, openid, baseDate)))
}

async function buildDashboardData(couple, store, openid, baseDate = new Date()) {
  const weeklyBounds = getPeriodBounds('weekly', baseDate)
  const previousWeeklyBounds = getPreviousPeriodBounds('weekly', baseDate)
  const weeklyExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds))
  const previousWeeklyExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, previousWeeklyBounds))
  const weeklyTotal = sumExpenses(weeklyExpenses)
  const previousWeeklyTotal = sumExpenses(previousWeeklyExpenses)
  const topCategory = getTopCategoryLabel(weeklyExpenses) || ''
  const openTodos = store.todos.filter((item) => item.status === 'open')
  const overdueTodos = openTodos.filter((item) => item.dueAt && daysUntil(item.dueAt, baseDate) < 0)
  const dueSoonTodos = openTodos.filter((item) => {
    if (!item.dueAt) {
      return false
    }

    const days = daysUntil(item.dueAt, baseDate)
    return days >= 0 && days <= 1
  })
  const nextAnniversary = getUpcomingAnniversary(store, baseDate)
  const [budgetSettings, stepSyncReady] = await Promise.all([
    findBudgetSettings(couple._id),
    hasRecentStepSync(couple._id, baseDate)
  ])
  const budgetCard = buildBudgetSummary(store, budgetSettings, couple, openid, baseDate)
  const planningPrompt = buildBudgetPlanningPrompt(budgetCard)
  const completedTodoCount = Number((store.meta && store.meta.completedTodoCount) || 0)
  const openTodoCount = Number((store.meta && store.meta.openTodoCount) || openTodos.length)
  const activationChecklist = buildActivationChecklist(couple, budgetCard, store.meta || {}, stepSyncReady)

  return {
    hero: {
      title: '本周支出',
      subtitle: ''
    },
    spendCard: {
      label: '本周支出',
      totalDisplay: formatCurrency(weeklyTotal),
      deltaDisplay: formatPercentChange(weeklyTotal, previousWeeklyTotal),
      detail: previousWeeklyTotal
        ? `比上周${weeklyTotal >= previousWeeklyTotal ? '多' : '少'} ${formatCurrency(Math.abs(weeklyTotal - previousWeeklyTotal))}`
        : '开始记录后，这里会自动对比',
      focusText: topCategory ? `这周主要花在 ${topCategory}` : '继续记录，这里会显示主要花费'
    },
    spendChart: {
      trend: buildSpendTrend(weeklyExpenses, weeklyBounds),
      categories: buildPercentBars(weeklyExpenses)
    },
    todoCard: {
      label: '待办进度',
      completedCount: completedTodoCount,
      openCount: openTodoCount,
      detail: `${overdueTodos.length} 个已超时，${dueSoonTodos.length} 个 24 小时内到期`,
      planningPrompt
    },
    budgetCard,
    anniversaryCard: nextAnniversary ? {
      label: '最近纪念日',
      title: nextAnniversary.title,
      dateLabel: nextAnniversary.nextDateLabel,
      daysLeftLabel: nextAnniversary.daysLeftLabel,
      prepTodo: nextAnniversary.linkedTodoLabel.replace('准备项: ', '')
    } : {
      label: '最近纪念日',
      title: '还没有纪念日',
      dateLabel: '去记录里添加',
      daysLeftLabel: '--',
      prepTodo: '先建立一个重要日子'
    },
    workoutCard: buildWorkoutSummary(store, openid, baseDate),
    activationChecklist,
    ritualCard: buildRitualCard(activationChecklist, baseDate),
    activityFeed: buildRecentActivities(store, openid, baseDate)
  }
}

async function getHomeDashboard(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const store = await loadStore(couple._id)

  return {
    ok: true,
    dashboard: await buildDashboardData(couple, store, openid)
  }
}

async function listRecentActivity(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const store = await loadStore(couple._id)

  return {
    ok: true,
    activityFeed: buildRecentActivities(store, openid)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getHomeDashboard'

  try {
    if (action === 'listRecentActivity') {
      return await listRecentActivity(OPENID)
    }

    return await getHomeDashboard(OPENID)
  } catch (error) {
    console.error('[dashboard] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '首页请求失败'
    }
  }
}

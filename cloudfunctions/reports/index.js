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
  snapshots: 'report_snapshots'
}

const CATEGORY_COLORS = ['#D97A3D', '#F0B387', '#8E6D5A', '#D8C9BD']
const OWNER_COLORS = ['#2B211C', '#9B7B67', '#D9B89F']

function nowIso() {
  return new Date().toISOString()
}

function cloneDate(date) {
  return new Date(date.getTime())
}

function startOfDay(date) {
  const next = cloneDate(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = cloneDate(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date, days) {
  const next = cloneDate(date)
  next.setDate(next.getDate() + days)
  return next
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
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

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0))
}

function getPeriodBounds(periodType, baseDate = new Date()) {
  if (periodType === 'monthly') {
    const start = startOfMonth(baseDate)
    const end = endOfMonth(baseDate)
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
    const previousMonthDate = new Date(current.start.getFullYear(), current.start.getMonth() - 1, 1)
    return getPeriodBounds('monthly', previousMonthDate)
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

function formatCurrency(amountCents) {
  const amount = amountCents / 100
  const hasDecimals = amountCents % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function formatPercentChange(currentCents, previousCents) {
  if (!previousCents) {
    return '首个周期'
  }

  const delta = Math.round(((currentCents - previousCents) / previousCents) * 100)
  return `${delta > 0 ? '+' : ''}${delta}%`
}

function formatPeriodLabel(periodType, bounds) {
  if (periodType === 'monthly') {
    return `${bounds.start.getFullYear()}年${bounds.start.getMonth() + 1}月`
  }

  return `${formatMonthDay(bounds.start)} - ${formatMonthDay(bounds.end)}`
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

async function findCoupleById(coupleId) {
  if (!coupleId) {
    return null
  }

  try {
    const result = await db.collection(COLLECTIONS.couples).doc(coupleId).get()
    return result.data || null
  } catch (error) {
    return null
  }
}

function requirePairedCouple(couple) {
  if (!couple || couple.status !== 'paired') {
    throw new Error('共享空间还没连接完成')
  }
}

async function getAllByCouple(collectionName, coupleId) {
  const collection = db.collection(collectionName)
  const items = []
  let skip = 0
  const limit = 100

  while (true) {
    const result = await collection.where({
      coupleId
    }).skip(skip).limit(limit).get()
    const chunk = result.data || []
    items.push(...chunk)

    if (chunk.length < limit) {
      break
    }

    skip += chunk.length
  }

  return items
}

async function loadStore(coupleId) {
  const [expenses, todos, anniversaries, workouts] = await Promise.all([
    getAllByCouple(COLLECTIONS.expenses, coupleId),
    getAllByCouple(COLLECTIONS.todos, coupleId),
    getAllByCouple(COLLECTIONS.anniversaries, coupleId),
    getAllByCouple(COLLECTIONS.workouts, coupleId)
  ])

  return {
    expenses: expenses.map((item) => ({
      id: item._id,
      categoryKey: item.categoryKey,
      categoryLabel: item.categoryLabel,
      amountCents: item.amountCents,
      ownerScope: item.ownerScope,
      ownerUserId: item.ownerUserId || null,
      note: item.note || '',
      occurredOn: item.occurredOn,
      createdAt: item.createdAt
    })),
    todos: todos.map((item) => ({
      id: item._id,
      title: item.title,
      note: item.note || '',
      assigneeUserId: item.assigneeUserId || null,
      dueAt: item.dueAt || '',
      status: item.status || 'open',
      completedAt: item.completedAt || null,
      createdAt: item.createdAt
    })),
    anniversaries: anniversaries.map((item) => ({
      id: item._id,
      title: item.title,
      date: item.date,
      type: item.type,
      linkedTodoId: item.linkedTodoId || null,
      note: item.note || ''
    })),
    workouts: workouts.map((item) => ({
      id: item._id,
      typeKey: item.typeKey,
      typeLabel: item.typeLabel,
      durationMinutes: item.durationMinutes,
      occurredOn: item.occurredOn,
      note: item.note || '',
      userId: item.userId,
      createdAt: item.createdAt
    }))
  }
}

async function findBudgetSettings(coupleId) {
  const result = await db.collection(COLLECTIONS.budgetSettings).where({
    coupleId
  }).limit(1).get()

  return (result.data || [])[0] || {}
}

function buildBudgetUsersBase(couple) {
  return [
    {
      userId: couple.creatorUserId,
      roleKey: 'creator'
    },
    {
      userId: couple.partnerUserId,
      roleKey: 'partner'
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

function normalizeBudgetSettings(doc = {}, couple) {
  const users = buildBudgetUsersBase(couple)
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
      roleKey: item.roleKey,
      budgetCents: budgetMap[item.userId] || 0
    })),
    updatedAt: doc.updatedAt || nowIso()
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

function buildPercentList(items, totalCents, palette) {
  if (!totalCents) {
    return items.map((item, index) => ({
      name: item.name,
      amountCents: item.value || 0,
      value: '0%',
      percent: 0,
      shareValue: 0,
      amountLabel: formatCurrency(item.value || 0),
      width: 18,
      flex: item.value ? Math.max(100 / items.length, 20) : 0,
      color: palette[index % palette.length]
    }))
  }

  return items.map((item, index) => {
    const shareValue = Number(((item.value / totalCents) * 100).toFixed(2))
    const percent = Math.round(shareValue)

    return {
      name: item.name,
      amountCents: item.value,
      value: `${percent}%`,
      percent,
      shareValue,
      amountLabel: formatCurrency(item.value),
      width: Math.max(percent, 18),
      flex: shareValue,
      color: palette[index % palette.length]
    }
  })
}

function buildDonutVisual(items, totalCents) {
  if (!totalCents) {
    return {
      style: 'background: conic-gradient(#eadfd6 0% 100%);'
    }
  }

  let cursor = 0
  const stops = items.map((item) => {
    const end = Math.min(100, cursor + item.shareValue)
    const stop = `${item.color} ${cursor.toFixed(2)}% ${end.toFixed(2)}%`
    cursor = end
    return stop
  })

  if (cursor < 100) {
    stops.push(`#eadfd6 ${cursor.toFixed(2)}% 100%`)
  }

  return {
    style: `background: conic-gradient(${stops.join(', ')});`
  }
}

function sumByDate(expenses) {
  return expenses.reduce((totals, item) => {
    totals[item.occurredOn] = (totals[item.occurredOn] || 0) + item.amountCents
    return totals
  }, {})
}

function sumRange(totalMap, startDate, endDate) {
  let total = 0
  let cursor = new Date(startDate.getTime())

  while (cursor.getTime() <= endDate.getTime()) {
    total += totalMap[toDateKey(cursor)] || 0
    cursor = addDays(cursor, 1)
  }

  return total
}

function buildTrendSeries(expenses, previousExpenses, periodType, bounds, previousBounds) {
  const currentTotals = sumByDate(expenses)
  const previousTotals = sumByDate(previousExpenses)
  const series = []

  if (periodType === 'monthly') {
    let currentCursor = new Date(bounds.start.getTime())
    let previousCursor = new Date(previousBounds.start.getTime())

    while (currentCursor.getTime() <= bounds.end.getTime()) {
      const currentEnd = new Date(Math.min(addDays(currentCursor, 6).getTime(), bounds.end.getTime()))
      const previousEnd = new Date(Math.min(addDays(previousCursor, 6).getTime(), previousBounds.end.getTime()))

      series.push({
        label: `${currentCursor.getDate()}-${currentEnd.getDate()}日`,
        currentValue: sumRange(currentTotals, currentCursor, currentEnd),
        previousValue: sumRange(previousTotals, previousCursor, previousEnd)
      })

      currentCursor = addDays(currentEnd, 1)
      previousCursor = addDays(previousEnd, 1)
    }
  } else {
    let currentCursor = new Date(bounds.start.getTime())
    let previousCursor = new Date(previousBounds.start.getTime())

    while (currentCursor.getTime() <= bounds.end.getTime()) {
      series.push({
        label: formatMonthDay(currentCursor),
        currentValue: currentTotals[toDateKey(currentCursor)] || 0,
        previousValue: previousTotals[toDateKey(previousCursor)] || 0
      })

      currentCursor = addDays(currentCursor, 1)
      previousCursor = addDays(previousCursor, 1)
    }
  }

  const maxValue = Math.max(1, ...series.map((item) => Math.max(item.currentValue, item.previousValue)))

  return series.map((item, index) => {
    const currentRatio = item.currentValue > 0 ? item.currentValue / maxValue : 0
    const previousRatio = item.previousValue > 0 ? item.previousValue / maxValue : 0

    return {
      label: item.label,
      currentCents: item.currentValue,
      previousCents: item.previousValue,
      currentDisplay: formatCurrency(item.currentValue),
      previousDisplay: formatCurrency(item.previousValue),
      currentLabel: formatCurrency(item.currentValue),
      previousLabel: formatCurrency(item.previousValue),
      currentHasValue: item.currentValue > 0,
      previousHasValue: item.previousValue > 0,
      currentBarHeight: item.currentValue > 0 ? Math.max(24, Math.round(Math.sqrt(currentRatio) * 132)) : 6,
      previousBarHeight: item.previousValue > 0 ? Math.max(24, Math.round(Math.sqrt(previousRatio) * 132)) : 6,
      hasValue: item.currentValue > 0 || item.previousValue > 0,
      isLatest: index === series.length - 1
    }
  })
}

function buildCategoryChanges(expenses, previousExpenses) {
  const currentTotals = {}
  const previousTotals = {}

  expenses.forEach((item) => {
    currentTotals[item.categoryLabel] = (currentTotals[item.categoryLabel] || 0) + item.amountCents
  })

  previousExpenses.forEach((item) => {
    previousTotals[item.categoryLabel] = (previousTotals[item.categoryLabel] || 0) + item.amountCents
  })

  const names = Object.keys(Object.assign({}, currentTotals, previousTotals))

  return names
    .map((name) => {
      const currentValue = currentTotals[name] || 0
      const previousValue = previousTotals[name] || 0
      const delta = currentValue - previousValue

      return {
        name,
        currentDisplay: formatCurrency(currentValue),
        previousDisplay: formatCurrency(previousValue),
        deltaValue: Math.abs(delta),
        deltaLabel: `${delta > 0 ? '+' : delta < 0 ? '-' : ''}${formatCurrency(Math.abs(delta))}`,
        tone: delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat'),
        detail: delta > 0
          ? `比上期多 ${formatCurrency(delta)}`
          : (delta < 0 ? `比上期少 ${formatCurrency(Math.abs(delta))}` : '和上期基本持平')
      }
    })
    .sort((left, right) => right.deltaValue - left.deltaValue)
    .slice(0, 3)
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
    nextDateKey: occurrence.dateKey,
    nextDateLabel,
    linkedTodoLabel: linkedTodo ? `准备项: ${linkedTodo.title}` : '还没准备项',
    sortTime: parseDateKey(occurrence.dateKey).getTime()
  }
}

function getUpcomingAnniversaryFromStore(store, baseDate = new Date()) {
  return (store.anniversaries || [])
    .map((item) => buildAnniversaryDisplay(item, store, baseDate))
    .sort((left, right) => left.sortTime - right.sortTime)[0] || null
}

function buildTodoSummary(store, bounds, baseDate = new Date()) {
  const todos = store.todos.filter((item) => {
    const createdKey = item.createdAt.slice(0, 10)
    return isDateKeyInRange(createdKey, bounds) || (item.dueAt && isDateKeyInRange(item.dueAt, bounds))
  })

  if (!todos.length) {
    return '本周期没有待办'
  }

  const completed = todos.filter((item) => item.status === 'completed').length
  const overdue = todos.filter((item) => item.status === 'open' && item.dueAt && daysUntil(item.dueAt, baseDate) < 0).length

  return `${completed} / ${todos.length} 完成${overdue ? `，${overdue} 个已超时` : ''}`
}

function buildAnniversarySummary(store, baseDate = new Date()) {
  const upcoming = getUpcomingAnniversaryFromStore(store, baseDate)

  if (!upcoming) {
    return '还没有纪念日'
  }

  const daysLeft = daysUntil(upcoming.nextDateKey, baseDate)
  const hasLinkedTodo = upcoming.linkedTodoLabel.indexOf('准备项:') === 0

  if (daysLeft <= 14 && !hasLinkedTodo) {
    return `${daysLeft} 天后是 ${upcoming.title}，还没准备项`
  }

  return `${daysLeft} 天后是 ${upcoming.title}${hasLinkedTodo ? '，已有关联准备项' : ''}`
}

function buildHeadline(totalCents, previousTotalCents, topCategory) {
  if (!totalCents) {
    return '这个周期还没有支出记录'
  }

  if (!previousTotalCents) {
    return `这是首个周期，当前支出重心在${topCategory || '共同生活'}`
  }

  const delta = Math.round(((totalCents - previousTotalCents) / previousTotalCents) * 100)

  if (delta >= 20) {
    return `${topCategory || '当前大头'}抬头了，这个周期花费明显变多`
  }

  if (delta <= -10) {
    return `这周期花费收住了，${topCategory || '主要支出'}仍是重点`
  }

  return `整体比较平稳，主要还是花在${topCategory || '共同生活'}`
}

function buildSummary(totalCents, previousTotalCents, topCategory) {
  if (!totalCents) {
    return '这个周期记录还不多，再记几笔就会自动总结。'
  }

  if (!previousTotalCents) {
    return `这是你们第一个可读周期，当前花费主要集中在${topCategory || '共同生活'}。`
  }

  const delta = totalCents - previousTotalCents

  if (delta > 0) {
    return `这个周期比上个周期多花了 ${formatCurrency(delta)}，主要变化来自${topCategory || '主要花费'}。`
  }

  if (delta < 0) {
    return `这个周期比上个周期少花了 ${formatCurrency(Math.abs(delta))}，最近已经开始收住。`
  }

  return '总额和上期接近，最近的生活节奏比较稳定。'
}

function buildSuggestions(topCategory, overdueTodos, anniversarySummary) {
  const suggestions = []

  if (topCategory === '餐饮') {
    suggestions.push('餐饮还是大头，可以先盯这一类，最容易看出变化。')
  } else if (topCategory) {
    suggestions.push(`最近先看一下 ${topCategory} 这一类，最可能影响总支出走势。`)
  }

  if (overdueTodos > 0) {
    suggestions.push('先把已经超时的待办清掉，不然首页会一直发出错误信号。')
  }

  if (anniversarySummary.indexOf('还没准备项') >= 0) {
    suggestions.push('最近纪念日临近了，最好马上补一个准备待办。')
  }

  if (!suggestions.length) {
    suggestions.push('先继续保持记录，后面的报告会更清楚。')
  }

  return suggestions.slice(0, 3)
}

function pickTopCategories(expenses) {
  const totals = {}

  expenses.forEach((item) => {
    totals[item.categoryLabel] = (totals[item.categoryLabel] || 0) + item.amountCents
  })

  return Object.keys(totals)
    .map((name) => ({ name, value: totals[name] }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
}

function buildOwnerBreakdownBase(expenses, couple) {
  const values = {
    shared: 0,
    creator: 0,
    partner: 0
  }

  expenses.forEach((item) => {
    if (item.ownerScope === 'shared') {
      values.shared += item.amountCents
      return
    }

    if (item.ownerUserId === couple.creatorUserId) {
      values.creator += item.amountCents
      return
    }

    values.partner += item.amountCents
  })

  return [
    { name: 'shared', value: values.shared },
    { name: 'creator', value: values.creator },
    { name: 'partner', value: values.partner }
  ]
}

function buildAlerts(totalCents, previousTotalCents, trendSeries, categoryChanges, overdueTodos, anniversarySummary) {
  const alerts = []

  if (previousTotalCents && totalCents > previousTotalCents * 1.3) {
    alerts.push({
      title: '总支出明显抬高',
      detail: `这期比上期多了 ${formatCurrency(totalCents - previousTotalCents)}`,
      tone: 'warm'
    })
  }

  const topTrend = trendSeries
    .slice()
    .sort((left, right) => right.currentCents - left.currentCents)[0]
  const average = trendSeries.length ? totalCents / trendSeries.length : 0

  if (topTrend && topTrend.currentCents > 0 && average > 0 && topTrend.currentCents >= average * 1.8) {
    alerts.push({
      title: '有一天花费偏高',
      detail: `${topTrend.label} 花了 ${topTrend.currentDisplay}，明显高于这个周期的日常水平`,
      tone: 'accent'
    })
  }

  const topChange = categoryChanges.find((item) => item.tone === 'up')

  if (topChange && topChange.deltaValue >= 5000) {
    alerts.push({
      title: `${topChange.name} 上升得最快`,
      detail: `${topChange.detail}，这一类变化最大`,
      tone: 'warm'
    })
  }

  if (overdueTodos > 0) {
    alerts.push({
      title: '待办有积压',
      detail: `${overdueTodos} 个待办已经超时`,
      tone: 'neutral'
    })
  }

  if (anniversarySummary.indexOf('还没准备项') >= 0) {
    alerts.push({
      title: '纪念日临近',
      detail: anniversarySummary,
      tone: 'accent'
    })
  }

  return alerts.slice(0, 3)
}

function buildBudgetPlanningAlert(budgetSummary = {}) {
  const progressPercent = Number(budgetSummary.progressPercent || 0)

  if (!budgetSummary.hasBudget || progressPercent < 85) {
    return null
  }

  if (progressPercent >= 100) {
    return {
      kind: 'budget_planning',
      title: '预算已超出',
      detail: '这个周期先把接下来的支出排进待办，避免继续失控。',
      tone: 'neutral'
    }
  }

  return {
    kind: 'budget_planning',
    title: '预算已接近上限',
    detail: '接下来要花的钱，先排进待办再决定。',
    tone: 'neutral'
  }
}

function buildBudgetSummary(store, budgetSettings, couple, periodType, baseDate = new Date()) {
  const monthlyBounds = getPeriodBounds('monthly', baseDate)
  const periodBounds = getPeriodBounds(periodType, baseDate)
  const users = buildBudgetUsersBase(couple)
  const normalized = normalizeBudgetSettings(budgetSettings || {}, couple)
  const monthlyExpenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, monthlyBounds))
  const periodExpenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, periodBounds))
  const spentByMember = buildBudgetSpendByMember(monthlyExpenses, users)
  const periodSpentByMember = buildBudgetSpendByMember(periodExpenses, users)
  const memberSummariesBase = users.map((item) => {
    const budgetEntry = normalized.memberBudgets.find((target) => target.userId === item.userId) || {
      budgetCents: 0
    }
    const budgetCents = Number(budgetEntry.budgetCents || 0)
    const spentCents = Number(spentByMember[item.userId] || 0)
    const remainingCents = budgetCents - spentCents
    const progressPercent = budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0

    return {
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
      statusTone: budgetCents && remainingCents < 0 ? 'over' : (budgetCents && progressPercent >= 85 ? 'near' : 'calm'),
      periodSpentCents: periodSpentByMember[item.userId] || 0,
      periodSpentDisplay: formatCurrency(periodSpentByMember[item.userId] || 0)
    }
  })
  const totalBudgetCents = memberSummariesBase.reduce((total, item) => total + item.budgetCents, 0)
  const spentCents = memberSummariesBase.reduce((total, item) => total + item.spentCents, 0)
  const periodSpentCents = memberSummariesBase.reduce((total, item) => total + item.periodSpentCents, 0)
  const remainingCents = totalBudgetCents - spentCents
  const focusMember = memberSummariesBase
    .slice()
    .sort((left, right) => {
      const leftScore = left.remainingCents < 0 ? 1000000 + Math.abs(left.remainingCents) : left.progressPercent
      const rightScore = right.remainingCents < 0 ? 1000000 + Math.abs(right.remainingCents) : right.progressPercent
      return rightScore - leftScore
    })[0] || null

  let focusText = '先去设置预算'

  if (totalBudgetCents > 0) {
    if (!focusMember) {
      focusText = remainingCents >= 0 ? '本月整体还在预算内' : `本月整体已超支 ${formatCurrency(Math.abs(remainingCents))}`
    } else if (focusMember.remainingCents < 0) {
      focusText = '有人已经超支了，先把本月节奏收一下'
    } else if (focusMember.progressPercent >= 85) {
      focusText = '有人已经接近预算上限'
    } else {
      focusText = remainingCents >= 0 ? `总共还剩 ${formatCurrency(remainingCents)}` : `总共超支 ${formatCurrency(Math.abs(remainingCents))}`
    }
  }

  return {
    hasBudget: totalBudgetCents > 0,
    totalBudgetCents,
    totalBudgetDisplay: totalBudgetCents ? formatCurrency(totalBudgetCents) : '未设置',
    spentCents,
    spentDisplay: formatCurrency(spentCents),
    remainingCents,
    remainingDisplay: totalBudgetCents
      ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
      : '去设置预算',
    progressPercent: totalBudgetCents > 0 ? Math.round((spentCents / totalBudgetCents) * 100) : 0,
    progressWidth: totalBudgetCents > 0 ? Math.max(10, Math.min(Math.round((spentCents / totalBudgetCents) * 100), 100)) : (spentCents ? 28 : 12),
    focusText,
    sharedRuleText: '共同支出会自动平摊到两个人',
    periodSpentCents,
    periodSpentDisplay: formatCurrency(periodSpentCents),
    periodSpentLabel: periodType === 'weekly' ? '本周新增' : '本月新增',
    memberSummariesBase
  }
}

function buildWorkoutSummary(store, couple, periodType, bounds) {
  const workouts = (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const totals = {
    creator: {
      count: 0,
      durationMinutes: 0
    },
    partner: {
      count: 0,
      durationMinutes: 0
    }
  }

  workouts.forEach((item) => {
    const roleKey = item.userId === couple.creatorUserId ? 'creator' : 'partner'
    totals[roleKey].count += 1
    totals[roleKey].durationMinutes += Number(item.durationMinutes || 0)
  })

  const totalCount = workouts.length
  const totalDurationMinutes = workouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0)
  const labelPrefix = periodType === 'weekly' ? '本周' : '本月'

  return {
    hasWorkouts: totalCount > 0,
    sectionTitle: '运动节奏',
    totalCount,
    totalCountDisplay: `${totalCount} 次`,
    totalDurationMinutes,
    totalDurationDisplay: `${totalDurationMinutes} 分钟`,
    focusText: totalCount
      ? `${labelPrefix}记录了 ${totalCount} 次运动，整体还在保持节奏`
      : `${labelPrefix}还没有运动记录，先把节奏慢慢找回来`,
    memberSummariesBase: ['creator', 'partner'].map((roleKey) => ({
      roleKey,
      count: totals[roleKey].count,
      countDisplay: `${totals[roleKey].count} 次`,
      durationMinutes: totals[roleKey].durationMinutes,
      durationDisplay: `${totals[roleKey].durationMinutes} 分钟`,
      detail: totals[roleKey].count
        ? `${totals[roleKey].count} 次 · ${totals[roleKey].durationMinutes} 分钟`
        : '还没有记录'
    }))
  }
}

function buildReportPayload(openid, couple, periodType, store, budgetSettings, baseDate = new Date()) {
  const bounds = getPeriodBounds(periodType, baseDate)
  const previousBounds = getPreviousPeriodBounds(periodType, baseDate)
  const expenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const previousExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, previousBounds))
  const totalCents = sumExpenses(expenses)
  const previousTotalCents = sumExpenses(previousExpenses)
  const categories = pickTopCategories(expenses)
  const ownerBreakdownBase = buildOwnerBreakdownBase(expenses, couple)
  const overdueTodos = store.todos.filter((item) => item.status === 'open' && item.dueAt && daysUntil(item.dueAt, baseDate) < 0).length
  const anniversarySummary = buildAnniversarySummary(store, baseDate)
  const topCategory = categories[0] ? categories[0].name : ''
  const categoryBreakdown = buildPercentList(
    categories.length ? categories : [{ name: '暂无支出', value: 0 }],
    totalCents,
    CATEGORY_COLORS
  )
  const ownerBreakdown = buildPercentList(ownerBreakdownBase, totalCents, OWNER_COLORS)
  const trendSeries = buildTrendSeries(expenses, previousExpenses, periodType, bounds, previousBounds)
  const categoryChanges = buildCategoryChanges(expenses, previousExpenses)
  const budgetSummary = buildBudgetSummary(store, budgetSettings, couple, periodType, baseDate)
  const planningAlert = buildBudgetPlanningAlert(budgetSummary)
  const alerts = buildAlerts(totalCents, previousTotalCents, trendSeries, categoryChanges, overdueTodos, anniversarySummary)
  if (planningAlert) {
    alerts.unshift(planningAlert)
  }
  const workoutSummary = buildWorkoutSummary(store, couple, periodType, bounds)

  return {
    statusTone: totalCents ? 'ready' : 'fallback',
    statusLabel: totalCents ? '已生成' : '还没有足够数据',
    periodLabel: formatPeriodLabel(periodType, bounds),
    headline: buildHeadline(totalCents, previousTotalCents, topCategory),
    totalDisplay: formatCurrency(totalCents),
    compareDisplay: formatPercentChange(totalCents, previousTotalCents),
    compareLabel: periodType === 'weekly' ? '本周 vs 上周' : '本月 vs 上月',
    categoryBreakdown,
    categoryVisual: buildDonutVisual(categoryBreakdown, totalCents),
    ownerBreakdownBase: ownerBreakdown,
    trendSeries,
    categoryChanges,
    alerts: alerts.slice(0, 3),
    budgetSummary,
    workoutSummary,
    todoSummary: buildTodoSummary(store, bounds, baseDate),
    anniversarySummary,
    aiSummary: buildSummary(totalCents, previousTotalCents, topCategory),
    suggestions: buildSuggestions(topCategory, overdueTodos, anniversarySummary)
  }
}

function buildSnapshotKey(coupleId, periodType, periodStart) {
  return `${coupleId}:${periodType}:${periodStart}`
}

async function findSnapshot(snapshotKey) {
  const result = await db.collection(COLLECTIONS.snapshots).where({
    snapshotKey
  }).limit(1).get()

  return (result.data || [])[0] || null
}

async function saveSnapshotDoc(existing, doc) {
  if (existing) {
    await db.collection(COLLECTIONS.snapshots).doc(existing._id).set({
      data: doc
    })
    const refreshed = await db.collection(COLLECTIONS.snapshots).doc(existing._id).get()
    return refreshed.data
  }

  const created = await db.collection(COLLECTIONS.snapshots).add({
    data: doc
  })
  const refreshed = await db.collection(COLLECTIONS.snapshots).doc(created._id).get()
  return refreshed.data
}

async function ensureSnapshot(couple, openid, periodType, store, baseDate = new Date()) {
  const bounds = getPeriodBounds(periodType, baseDate)
  const previousBounds = getPreviousPeriodBounds(periodType, baseDate)
  const snapshotKey = buildSnapshotKey(couple._id, periodType, bounds.startKey)
  const existing = await findSnapshot(snapshotKey)
  const periodClosed = endOfDay(bounds.end).getTime() < Date.now()

  if (existing && periodClosed && existing.status === 'ready_no_ai') {
    return existing
  }

  const generatedAt = nowIso()
  const budgetSettings = await findBudgetSettings(couple._id)
  const payload = buildReportPayload(openid, couple, periodType, store, budgetSettings, baseDate)
  const nextDoc = {
    snapshotKey,
    coupleId: couple._id,
    periodType,
    periodStart: bounds.startKey,
    periodEnd: bounds.endKey,
    comparePeriodStart: previousBounds.startKey,
    comparePeriodEnd: previousBounds.endKey,
    status: 'ready_no_ai',
    payload,
    generatedAt: existing && existing.generatedAt ? existing.generatedAt : generatedAt,
    updatedAt: generatedAt
  }

  return saveSnapshotDoc(existing, nextDoc)
}

function getHistoricalBaseDates(periodType, count, baseDate = new Date()) {
  const dates = []
  let cursor = addDays(getPeriodBounds(periodType, baseDate).start, -1)

  for (let index = 0; index < count; index += 1) {
    const bounds = getPeriodBounds(periodType, cursor)
    dates.push(bounds.start)
    cursor = addDays(bounds.start, -1)
  }

  return dates
}

async function ensureRecentHistoryBackfill(couple, openid, store) {
  const weeklyDates = getHistoricalBaseDates('weekly', 2)
  const monthlyDates = getHistoricalBaseDates('monthly', 2)
  const tasks = weeklyDates
    .map((date) => ensureSnapshot(couple, openid, 'weekly', store, date))
    .concat(monthlyDates.map((date) => ensureSnapshot(couple, openid, 'monthly', store, date)))

  await Promise.all(tasks)
}

function buildHistoryItem(snapshot) {
  const bounds = {
    start: parseDateKey(snapshot.periodStart),
    end: parseDateKey(snapshot.periodEnd)
  }

  return {
    id: snapshot._id,
    snapshotKey: snapshot.snapshotKey,
    periodLabel: formatPeriodLabel(snapshot.periodType, bounds),
    statusLabel: '已归档',
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
    generatedAt: snapshot.generatedAt
  }
}

function mapOwnerBreakdownForViewer(items, couple, openid) {
  return (items || []).map((item) => {
    if (item.name === 'shared') {
      return Object.assign({}, item, {
        name: '共同'
      })
    }

    if (item.name === 'creator') {
      return Object.assign({}, item, {
        name: couple.creatorUserId === openid ? '我' : '伴侣'
      })
    }

    return Object.assign({}, item, {
      name: couple.partnerUserId === openid ? '我' : '伴侣'
    })
  })
}

function labelRoleForViewer(roleKey, couple, openid) {
  if (roleKey === 'creator') {
    return couple.creatorUserId === openid ? '我' : '伴侣'
  }

  return couple.partnerUserId === openid ? '我' : '伴侣'
}

function applyViewerPerspective(snapshot, couple, openid, history) {
  const payload = Object.assign({}, snapshot.payload || {})
  const ownerBreakdown = mapOwnerBreakdownForViewer(payload.ownerBreakdownBase || [], couple, openid)
  const ownerTotalCents = ownerBreakdown.reduce((total, item) => total + (item.amountCents || 0), 0)

  if (payload.budgetSummary && Array.isArray(payload.budgetSummary.memberSummariesBase)) {
    payload.budgetSummary = Object.assign({}, payload.budgetSummary, {
      memberSummaries: payload.budgetSummary.memberSummariesBase.map((item) => Object.assign({}, item, {
        label: labelRoleForViewer(item.roleKey, couple, openid)
      }))
    })
    delete payload.budgetSummary.memberSummariesBase
  }

  if (payload.workoutSummary && Array.isArray(payload.workoutSummary.memberSummariesBase)) {
    payload.workoutSummary = Object.assign({}, payload.workoutSummary, {
      memberSummaries: payload.workoutSummary.memberSummariesBase.map((item) => Object.assign({}, item, {
        label: labelRoleForViewer(item.roleKey, couple, openid)
      }))
    })
    delete payload.workoutSummary.memberSummariesBase
  }

  delete payload.ownerBreakdownBase

  return Object.assign(payload, {
    ownerBreakdown,
    ownerVisual: buildDonutVisual(ownerBreakdown, ownerTotalCents),
    history
  })
}

async function listReadySnapshotsByType(coupleId, periodType) {
  const result = await db.collection(COLLECTIONS.snapshots).where({
    coupleId,
    periodType,
    status: 'ready_no_ai'
  }).get()

  return result.data || []
}

async function listHistoryByType(coupleId, periodType, currentStartKey) {
  const snapshots = await listReadySnapshotsByType(coupleId, periodType)

  return snapshots
    .filter((item) => item.periodStart !== currentStartKey)
    .sort((left, right) => new Date(right.periodStart).getTime() - new Date(left.periodStart).getTime())
    .slice(0, 12)
    .map(buildHistoryItem)
}

async function getSnapshotForPeriod(couple, openid, periodType, periodStart) {
  const store = await loadStore(couple._id)
  const baseDate = periodStart ? parseDateKey(periodStart) : new Date()
  const snapshot = await ensureSnapshot(couple, openid, periodType, store, baseDate)
  const history = await listHistoryByType(couple._id, periodType, snapshot.periodStart)

  return applyViewerPerspective(snapshot, couple, openid, history)
}

async function getCurrentReports(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const store = await loadStore(couple._id)
  await ensureRecentHistoryBackfill(couple, openid, store)
  const [weeklySnapshot, monthlySnapshot] = await Promise.all([
    ensureSnapshot(couple, openid, 'weekly', store),
    ensureSnapshot(couple, openid, 'monthly', store)
  ])
  const [weeklyHistory, monthlyHistory] = await Promise.all([
    listHistoryByType(couple._id, 'weekly', weeklySnapshot.periodStart),
    listHistoryByType(couple._id, 'monthly', monthlySnapshot.periodStart)
  ])

  return {
    ok: true,
    reports: {
      weekly: applyViewerPerspective(weeklySnapshot, couple, openid, weeklyHistory),
      monthly: applyViewerPerspective(monthlySnapshot, couple, openid, monthlyHistory)
    }
  }
}

async function listReportHistory(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const currentWeeklyBounds = getPeriodBounds('weekly')
  const currentMonthlyBounds = getPeriodBounds('monthly')
  const [weeklyHistory, monthlyHistory] = await Promise.all([
    listHistoryByType(couple._id, 'weekly', currentWeeklyBounds.startKey),
    listHistoryByType(couple._id, 'monthly', currentMonthlyBounds.startKey)
  ])

  return {
    ok: true,
    history: {
      weekly: weeklyHistory,
      monthly: monthlyHistory
    }
  }
}

async function getReportDetail(openid, payload = {}) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const periodType = payload.periodType === 'monthly' ? 'monthly' : 'weekly'
  const periodStart = String(payload.periodStart || '').trim()

  if (!periodStart || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
    return {
      ok: false,
      message: '报告周期参数不正确'
    }
  }

  return {
    ok: true,
    report: await getSnapshotForPeriod(couple, openid, periodType, periodStart)
  }
}

async function ensureSnapshotForCouple(payload = {}) {
  const couple = await findCoupleById(payload.coupleId)
  requirePairedCouple(couple)
  const periodType = payload.periodType === 'monthly' ? 'monthly' : 'weekly'
  const periodStart = String(payload.periodStart || '').trim()
  const store = await loadStore(couple._id)
  const baseDate = periodStart && /^\d{4}-\d{2}-\d{2}$/.test(periodStart)
    ? parseDateKey(periodStart)
    : new Date()
  const snapshot = await ensureSnapshot(couple, couple.creatorUserId || couple.partnerUserId || '', periodType, store, baseDate)

  return {
    ok: true,
    snapshot
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getCurrentReports'

  try {
    if (action === 'getReportDetail') {
      return await getReportDetail(OPENID, event.payload || {})
    }

    if (action === 'listReportHistory') {
      return await listReportHistory(OPENID)
    }

    if (action === 'ensureSnapshotForCouple') {
      if (OPENID) {
        const activeCouple = await findActiveCouple(OPENID)

        if (!activeCouple || activeCouple._id !== (event.payload && event.payload.coupleId)) {
          return {
            ok: false,
            message: '当前请求不允许生成这个快照'
          }
        }
      }

      return await ensureSnapshotForCouple(event.payload || {})
    }

    return await getCurrentReports(OPENID)
  } catch (error) {
    console.error('[reports] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '报告请求失败'
    }
  }
}

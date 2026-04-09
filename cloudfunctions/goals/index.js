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
  workouts: 'workouts',
  budgetSettings: 'budget_settings',
  goals: 'shared_goals',
  steps: 'step_snapshots'
}
const EXPENSE_CATEGORIES = [
  { key: 'dining', label: '餐饮' },
  { key: 'transport', label: '出行' },
  { key: 'daily', label: '日用' },
  { key: 'milestone', label: '备婚/大事' },
  { key: 'gift', label: '礼物' },
  { key: 'rent', label: '房租' }
]
const GOAL_GROUP_LABELS = {
  saving: '省钱',
  planning: '备婚/大额事项',
  momentum: '推进事情',
  milestone: '关键准备',
  rhythm: '生活节奏（可选）',
  competition: '轻竞赛（可选）'
}
const GOAL_GROUP_ORDER = ['saving', 'planning', 'momentum', 'milestone', 'rhythm', 'competition']

const MONTHLY_GOAL_TEMPLATES = [
  {
    key: 'save_buffer',
    slot: 'monthly_goal',
    groupKey: 'saving',
    mode: 'cooperative',
    label: '预算留白',
    description: '给这个月留出一段安全余量，不把预算用满。',
    unit: 'cents',
    targetRequired: true,
    targetLabel: '目标余量（元）'
  },
  {
    key: 'shared_spend_cap',
    slot: 'monthly_goal',
    groupKey: 'saving',
    mode: 'cooperative',
    label: '共同支出上限',
    description: '给两个人的共同支出设一条月度上限。',
    unit: 'cents',
    targetRequired: true,
    targetLabel: '共同支出上限（元）'
  },
  {
    key: 'category_cap',
    slot: 'monthly_goal',
    groupKey: 'saving',
    mode: 'cooperative',
    label: '分类控费',
    description: '挑一个消费分类，把这类支出控制在目标金额内。',
    unit: 'cents',
    targetRequired: true,
    targetLabel: '分类预算上限（元）',
    categoryRequired: true
  },
  {
    key: 'milestone_cap',
    slot: 'monthly_goal',
    groupKey: 'planning',
    mode: 'cooperative',
    label: '备婚/大事专项预算',
    description: '把备婚或大额事项单独拎出来，避免吞掉正常生活预算。',
    unit: 'cents',
    targetRequired: true,
    targetLabel: '专项预算上限（元）',
    fixedCategoryKey: 'milestone'
  },
  {
    key: 'budget_duel',
    slot: 'monthly_goal',
    groupKey: 'competition',
    mode: 'competitive',
    label: '预算对决',
    description: '比一比谁更稳地守住自己的预算线。',
    unit: 'ratio',
    targetRequired: false,
    targetLabel: ''
  }
]

const WEEKLY_CHALLENGE_TEMPLATES = [
  {
    key: 'todo_clear',
    slot: 'weekly_challenge',
    groupKey: 'momentum',
    mode: 'cooperative',
    label: '清待办',
    description: '一起把这周最该推进的事往前推。',
    unit: 'count',
    targetRequired: true,
    targetLabel: '目标待办数'
  },
  {
    key: 'overdue_zero',
    slot: 'weekly_challenge',
    groupKey: 'momentum',
    mode: 'cooperative',
    label: '清掉超时待办',
    description: '把已经拖住的事清到 0，让这周重新运转起来。',
    unit: 'count',
    targetRequired: false,
    targetLabel: ''
  },
  {
    key: 'milestone_prep_clear',
    slot: 'weekly_challenge',
    groupKey: 'milestone',
    mode: 'cooperative',
    label: '关键准备推进',
    description: '把这周最重要的婚礼或大事准备项往前推。',
    unit: 'count',
    targetRequired: true,
    targetLabel: '目标推进项数'
  },
  {
    key: 'workout_together',
    slot: 'weekly_challenge',
    groupKey: 'rhythm',
    mode: 'cooperative',
    label: '一起运动',
    description: '给这周定一个一起动起来的节奏。',
    unit: 'count',
    targetRequired: true,
    targetLabel: '目标运动次数'
  },
  {
    key: 'steps_together',
    slot: 'weekly_challenge',
    groupKey: 'rhythm',
    mode: 'cooperative',
    label: '一起走到 X 步',
    description: '用总步数把两个人的日常节奏一起拉起来。',
    unit: 'steps',
    targetRequired: true,
    targetLabel: '目标总步数'
  },
  {
    key: 'weekly_spend_cap',
    slot: 'weekly_challenge',
    groupKey: 'planning',
    mode: 'cooperative',
    label: '本周共同支出控制',
    description: '把这周共同支出先稳住，避免临时失控。',
    unit: 'cents',
    targetRequired: true,
    targetLabel: '本周共同支出上限（元）'
  },
  {
    key: 'steps_duel',
    slot: 'weekly_challenge',
    groupKey: 'competition',
    mode: 'competitive',
    label: '步数 PK',
    description: '一周内比一比谁走得更多，但只做轻松的 PK。',
    unit: 'steps',
    targetRequired: false,
    targetLabel: ''
  }
]

const TEMPLATE_MAP = MONTHLY_GOAL_TEMPLATES.concat(WEEKLY_CHALLENGE_TEMPLATES).reduce((result, item) => {
  result[item.key] = item
  return result
}, {})

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

function isDateKeyInRange(dateKey, bounds) {
  const timestamp = startOfDay(parseDateKey(dateKey)).getTime()
  return timestamp >= startOfDay(bounds.start).getTime() && timestamp <= endOfDay(bounds.end).getTime()
}

function formatCurrency(amountCents) {
  const amount = Number(amountCents || 0) / 100
  const hasDecimals = Number(amountCents || 0) % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function formatCount(value) {
  return String(Math.max(0, Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function parseAmountToCents(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 0
  }

  const amount = Number(String(value).trim())

  if (!Number.isFinite(amount) || amount < 0) {
    return 0
  }

  return Math.round(amount * 100)
}

function getCategoryLabel(categoryKey = '') {
  const matched = EXPENSE_CATEGORIES.find((item) => item.key === categoryKey)
  return matched ? matched.label : ''
}

function buildTemplateGroups() {
  const grouped = MONTHLY_GOAL_TEMPLATES.concat(WEEKLY_CHALLENGE_TEMPLATES).reduce((result, item) => {
    const bucket = result[item.slot] || {}
    const group = bucket[item.groupKey] || {
      key: item.groupKey,
      label: GOAL_GROUP_LABELS[item.groupKey] || item.groupKey,
      templates: []
    }
    group.templates.push(item)
    bucket[item.groupKey] = group
    result[item.slot] = bucket
    return result
  }, {})

  return {
    monthlyGroups: Object.values(grouped.monthly_goal || {}).sort((left, right) => GOAL_GROUP_ORDER.indexOf(left.key) - GOAL_GROUP_ORDER.indexOf(right.key)),
    weeklyGroups: Object.values(grouped.weekly_challenge || {}).sort((left, right) => GOAL_GROUP_ORDER.indexOf(left.key) - GOAL_GROUP_ORDER.indexOf(right.key)),
    categoryOptions: EXPENSE_CATEGORIES
  }
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

async function getAllByCouple(collectionName, coupleId) {
  const items = []
  let skip = 0
  const limit = 100

  while (true) {
    const result = await db.collection(collectionName).where({
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

async function findBudgetDoc(coupleId) {
  const result = await db.collection(COLLECTIONS.budgetSettings).where({
    coupleId
  }).limit(1).get()

  return (result.data || [])[0] || null
}

async function getGoalsDocs(coupleId) {
  const result = await db.collection(COLLECTIONS.goals).where({
    coupleId
  }).limit(20).get()
  const docs = result.data || []

  function pick(slot) {
    return docs
      .filter((item) => item.slot === slot && item.status !== 'archived')
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
  }

  return {
    monthlyGoal: pick('monthly_goal'),
    weeklyChallenge: pick('weekly_challenge')
  }
}

function buildMemberUsers(couple) {
  return [
    { userId: couple.creatorUserId, label: (couple.creatorProfile && couple.creatorProfile.nickName) || '我' },
    { userId: couple.partnerUserId, label: (couple.partnerProfile && couple.partnerProfile.nickName) || '伴侣' }
  ].filter((item) => item.userId)
}

function normalizeBudgetSettings(doc = {}, couple) {
  const users = buildMemberUsers(couple)
  const budgetMap = {}

  if (Array.isArray(doc.memberBudgets) && doc.memberBudgets.length) {
    doc.memberBudgets.forEach((item) => {
      if (!item || !item.userId) {
        return
      }

      budgetMap[item.userId] = Math.max(0, Number(item.budgetCents || 0))
    })
  } else if (Number(doc.monthlyBudgetCents || 0) > 0 && users.length) {
    const average = Math.floor(Number(doc.monthlyBudgetCents || 0) / users.length)
    users.forEach((item, index) => {
      budgetMap[item.userId] = index === users.length - 1
        ? Number(doc.monthlyBudgetCents || 0) - average * (users.length - 1)
        : average
    })
  }

  return {
    memberBudgets: users.map((item) => ({
      userId: item.userId,
      label: item.label,
      budgetCents: budgetMap[item.userId] || 0
    }))
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

function buildBudgetOverview(settings = {}, store = {}, couple) {
  const users = buildMemberUsers(couple)
  const bounds = getPeriodBounds('monthly')
  const expenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const normalized = normalizeBudgetSettings(settings, couple)
  const spentByMember = buildBudgetSpendByMember(expenses, users)
  const memberSummaries = normalized.memberBudgets.map((item) => {
    const spentCents = Number(spentByMember[item.userId] || 0)
    const budgetCents = Number(item.budgetCents || 0)
    return {
      userId: item.userId,
      label: item.label,
      budgetCents,
      spentCents,
      spentDisplay: formatCurrency(spentCents),
      budgetDisplay: budgetCents ? formatCurrency(budgetCents) : '未设置',
      progressPercent: budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0
    }
  })
  const totalBudgetCents = memberSummaries.reduce((total, item) => total + item.budgetCents, 0)
  const spentCents = memberSummaries.reduce((total, item) => total + item.spentCents, 0)

  return {
    hasBudget: totalBudgetCents > 0,
    remainingCents: totalBudgetCents - spentCents,
    progressPercent: totalBudgetCents > 0 ? Math.round((spentCents / totalBudgetCents) * 100) : 0,
    memberSummaries
  }
}

function buildSharedMonthlySpent(store = {}) {
  const bounds = getPeriodBounds('monthly')
  return (store.expenses || []).reduce((total, item) => {
    if (item.ownerScope !== 'shared' || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildCategoryMonthlySpent(store = {}, categoryKey = '') {
  const bounds = getPeriodBounds('monthly')
  return (store.expenses || []).reduce((total, item) => {
    if (item.categoryKey !== categoryKey || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildSharedWeeklySpent(store = {}) {
  const bounds = getPeriodBounds('weekly')
  return (store.expenses || []).reduce((total, item) => {
    if (item.ownerScope !== 'shared' || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildWeeklyTodoCleared(store = {}) {
  const bounds = getPeriodBounds('weekly')
  return (store.todos || []).filter((item) => {
    return item.status === 'completed'
      && item.completedAt
      && isDateKeyInRange(String(item.completedAt).slice(0, 10), bounds)
  }).length
}

function buildWeeklyWorkoutCount(store = {}) {
  const bounds = getPeriodBounds('weekly')
  return (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds)).length
}

function buildOverdueTodoCount(store = {}) {
  const todayKey = toDateKey(new Date())
  return (store.todos || []).filter((item) => item.status === 'open' && item.dueAt && item.dueAt < todayKey).length
}

async function listRecentSteps(coupleId, startKey, endKey) {
  const result = await db.collection(COLLECTIONS.steps).where({
    coupleId,
    dateKey: _.gte(startKey).and(_.lte(endKey))
  }).limit(100).get()

  return result.data || []
}

function buildStepSummary(couple, openid, snapshots) {
  const bounds = getPeriodBounds('weekly')
  const partnerUserId = openid === couple.creatorUserId ? couple.partnerUserId : couple.creatorUserId
  const byUser = {
    [openid]: {},
    [partnerUserId]: {}
  }

  snapshots.forEach((item) => {
    if (!byUser[item.userId]) {
      byUser[item.userId] = {}
    }

    byUser[item.userId][item.dateKey] = Number(item.stepCount || 0)
  })

  let myWeekSteps = 0
  let partnerWeekSteps = 0
  let cursor = new Date(bounds.start.getTime())

  while (cursor.getTime() <= bounds.end.getTime()) {
    const key = toDateKey(cursor)
    myWeekSteps += (byUser[openid] && byUser[openid][key]) || 0
    partnerWeekSteps += (byUser[partnerUserId] && byUser[partnerUserId][key]) || 0
    cursor = addDays(cursor, 1)
  }

  return {
    hasMyData: !!Object.keys(byUser[openid] || {}).length,
    hasPartnerData: !!Object.keys(byUser[partnerUserId] || {}).length,
    my: {
      weekSteps: myWeekSteps
    },
    partner: {
      weekSteps: partnerWeekSteps
    }
  }
}

function getUserLabel(couple, userId, openid) {
  if (!userId) {
    return ''
  }

  if (userId === couple.creatorUserId) {
    return (couple.creatorProfile && couple.creatorProfile.nickName) || (userId === openid ? '我' : '伴侣')
  }

  if (userId === couple.partnerUserId) {
    return (couple.partnerProfile && couple.partnerProfile.nickName) || (userId === openid ? '我' : '伴侣')
  }

  return userId === openid ? '我' : '伴侣'
}

function decorateGoal(doc = {}, options = {}) {
  if (!doc) {
    return null
  }

  const template = TEMPLATE_MAP[doc.templateKey] || {}
  const {
    budgetOverview = {},
    sharedMonthlySpentCents = 0,
    sharedWeeklySpentCents = 0,
    weeklyTodoCleared = 0,
    weeklyWorkoutCount = 0,
    overdueTodoCount = 0,
    stepSummary = {},
    couple,
    openid,
    store = {}
  } = options
  const isEnded = doc.endDate ? toDateKey(new Date()) > doc.endDate : false
  const members = budgetOverview.memberSummaries || []
  const selfMember = members.find((item) => item.userId === openid) || null
  const partnerUserId = openid === couple.creatorUserId ? couple.partnerUserId : couple.creatorUserId
  const partnerMember = members.find((item) => item.userId === partnerUserId) || null
  const categoryKey = doc.categoryKey || template.fixedCategoryKey || ''
  const categoryLabel = getCategoryLabel(categoryKey)
  let detail = ''
  let progressLabel = ''
  let actionTarget = 'goals'
  let actionLabel = '去目标'
  let tone = 'goal-neutral'
  let achieved = false
  let winnerUserId = doc.winnerUserId || ''
  let currentLabel = ''

  if (doc.templateKey === 'save_buffer') {
    const remainingCents = Number(budgetOverview.remainingCents || 0)
    achieved = remainingCents >= doc.targetValue
    detail = `当前还剩 ${formatCurrency(remainingCents)}，目标至少剩下 ${formatCurrency(doc.targetValue)}`
    progressLabel = achieved ? '已达到目标余量' : `还差 ${formatCurrency(Math.max(doc.targetValue - remainingCents, 0))}`
    actionTarget = 'budget'
    actionLabel = '去预算'
    tone = achieved ? 'goal-done' : 'goal-coop'
    currentLabel = formatCurrency(remainingCents)
  } else if (doc.templateKey === 'shared_spend_cap') {
    achieved = sharedMonthlySpentCents <= doc.targetValue
    detail = `共同支出已用 ${formatCurrency(sharedMonthlySpentCents)} / ${formatCurrency(doc.targetValue)}`
    progressLabel = achieved ? `还在目标内 ${formatCurrency(Math.max(doc.targetValue - sharedMonthlySpentCents, 0))}` : `已超出 ${formatCurrency(Math.max(sharedMonthlySpentCents - doc.targetValue, 0))}`
    actionTarget = 'budget'
    actionLabel = '去预算'
    tone = achieved ? 'goal-coop' : 'goal-over'
    currentLabel = formatCurrency(sharedMonthlySpentCents)
  } else if (doc.templateKey === 'category_cap' || doc.templateKey === 'milestone_cap') {
    const currentCents = buildCategoryMonthlySpent(store, categoryKey)
    achieved = currentCents <= doc.targetValue
    detail = `${categoryLabel || '该分类'}已用 ${formatCurrency(currentCents)} / ${formatCurrency(doc.targetValue)}`
    progressLabel = achieved ? `还在目标内 ${formatCurrency(Math.max(doc.targetValue - currentCents, 0))}` : `已超出 ${formatCurrency(Math.max(currentCents - doc.targetValue, 0))}`
    actionTarget = 'expense'
    actionLabel = '去记账'
    tone = achieved ? 'goal-coop' : 'goal-over'
    currentLabel = formatCurrency(currentCents)
  } else if (doc.templateKey === 'budget_duel') {
    const ranked = [selfMember, partnerMember]
      .filter(Boolean)
      .filter((item) => Number(item.budgetCents || 0) > 0)
      .map((item) => ({
        userId: item.userId,
        label: item.label,
        ratio: item.budgetCents > 0 ? item.spentCents / item.budgetCents : 999,
        display: `${Math.round((item.budgetCents > 0 ? item.spentCents / item.budgetCents : 0) * 100)}%`
      }))
      .sort((left, right) => left.ratio - right.ratio)
    const leader = ranked[0] || null
    const runnerUp = ranked[1] || null

    if (leader && runnerUp) {
      if (isEnded) {
        winnerUserId = leader.userId
      }

      detail = isEnded
        ? `${leader.label} 这个月预算执行更稳`
        : `${leader.label} 暂时领先，预算执行度 ${leader.display}`
      progressLabel = isEnded ? `${leader.label} 胜出` : `暂时领先 ${Math.max(Math.round((runnerUp.ratio - leader.ratio) * 100), 0)} 个点`
      currentLabel = `${leader.label} ${leader.display}`
      tone = 'goal-competitive'
    } else {
      detail = '要先给两个人都设置预算，才能开始这个对决'
      progressLabel = '还不能开始'
      tone = 'goal-neutral'
    }

    actionTarget = 'budget'
    actionLabel = '去预算'
    achieved = !!winnerUserId
  } else if (doc.templateKey === 'todo_clear') {
    achieved = weeklyTodoCleared >= doc.targetValue
    detail = `这周已经清掉 ${weeklyTodoCleared} / ${doc.targetValue} 个待办`
    progressLabel = achieved ? '本周待办任务达成' : `还差 ${Math.max(doc.targetValue - weeklyTodoCleared, 0)} 个`
    currentLabel = `${weeklyTodoCleared} 个`
    actionTarget = 'todo'
    actionLabel = '去待办'
    tone = achieved ? 'goal-done' : 'goal-coop'
  } else if (doc.templateKey === 'overdue_zero') {
    achieved = overdueTodoCount === 0
    detail = achieved ? '这周已经把超时待办清到 0' : `当前还有 ${overdueTodoCount} 个超时待办`
    progressLabel = achieved ? '超时待办已清到 0' : `还剩 ${overdueTodoCount} 个`
    currentLabel = `${overdueTodoCount} 个`
    actionTarget = 'todo'
    actionLabel = '去待办'
    tone = achieved ? 'goal-done' : 'goal-coop'
  } else if (doc.templateKey === 'milestone_prep_clear') {
    achieved = weeklyTodoCleared >= doc.targetValue
    detail = `这周已经推进 ${weeklyTodoCleared} / ${doc.targetValue} 项关键准备`
    progressLabel = achieved ? '本周关键准备推进完成' : `还差 ${Math.max(doc.targetValue - weeklyTodoCleared, 0)} 项`
    currentLabel = `${weeklyTodoCleared} 项`
    actionTarget = 'todo'
    actionLabel = '去待办'
    tone = achieved ? 'goal-done' : 'goal-coop'
  } else if (doc.templateKey === 'workout_together') {
    achieved = weeklyWorkoutCount >= doc.targetValue
    detail = `这周已经一起运动 ${weeklyWorkoutCount} / ${doc.targetValue} 次`
    progressLabel = achieved ? '本周运动挑战达成' : `还差 ${Math.max(doc.targetValue - weeklyWorkoutCount, 0)} 次`
    currentLabel = `${weeklyWorkoutCount} 次`
    actionTarget = 'workout'
    actionLabel = '去运动'
    tone = achieved ? 'goal-done' : 'goal-coop'
  } else if (doc.templateKey === 'steps_together') {
    const mySteps = Number(stepSummary.my && stepSummary.my.weekSteps || 0)
    const partnerSteps = Number(stepSummary.partner && stepSummary.partner.weekSteps || 0)
    const totalSteps = mySteps + partnerSteps
    const hasMyData = !!stepSummary.hasMyData
    const hasPartnerData = !!stepSummary.hasPartnerData

    if (hasMyData && hasPartnerData) {
      achieved = totalSteps >= doc.targetValue
      detail = `这周一起走了 ${formatCount(totalSteps)} / ${formatCount(doc.targetValue)} 步`
      progressLabel = achieved ? '本周步数目标达成' : `还差 ${formatCount(Math.max(doc.targetValue - totalSteps, 0))} 步`
      currentLabel = `${formatCount(totalSteps)} 步`
      tone = achieved ? 'goal-done' : 'goal-coop'
    } else {
      detail = '要先让两个人都同步微信步数，才能开始这周步数目标'
      progressLabel = '还不能开始'
      tone = 'goal-neutral'
    }

    actionTarget = 'workout'
    actionLabel = '去运动'
  } else if (doc.templateKey === 'weekly_spend_cap') {
    achieved = sharedWeeklySpentCents <= doc.targetValue
    detail = `这周共同支出已用 ${formatCurrency(sharedWeeklySpentCents)} / ${formatCurrency(doc.targetValue)}`
    progressLabel = achieved ? `还在目标内 ${formatCurrency(Math.max(doc.targetValue - sharedWeeklySpentCents, 0))}` : `已超出 ${formatCurrency(Math.max(sharedWeeklySpentCents - doc.targetValue, 0))}`
    currentLabel = formatCurrency(sharedWeeklySpentCents)
    actionTarget = 'expense'
    actionLabel = '去记账'
    tone = achieved ? 'goal-coop' : 'goal-over'
  } else if (doc.templateKey === 'steps_duel') {
    const mySteps = Number(stepSummary.my && stepSummary.my.weekSteps || 0)
    const partnerSteps = Number(stepSummary.partner && stepSummary.partner.weekSteps || 0)
    const hasMyData = !!stepSummary.hasMyData
    const hasPartnerData = !!stepSummary.hasPartnerData

    if (hasMyData && hasPartnerData) {
      const selfWins = mySteps >= partnerSteps
      const leaderUserId = selfWins ? openid : partnerUserId
      const leaderLabel = selfWins ? getUserLabel(couple, openid, openid) : getUserLabel(couple, partnerUserId, openid)
      const difference = Math.abs(mySteps - partnerSteps)

      if (isEnded) {
        winnerUserId = leaderUserId
      }

      detail = isEnded ? `${leaderLabel} 赢了这周步数 PK` : `${leaderLabel} 暂时领先 ${formatCount(difference)} 步`
      progressLabel = isEnded ? `${leaderLabel} 胜出` : `差距 ${formatCount(difference)} 步`
      currentLabel = `${formatCount(mySteps)} · ${formatCount(partnerSteps)}`
      tone = 'goal-competitive'
      achieved = !!winnerUserId
    } else {
      detail = '要先让两个人都同步微信步数，才能开始步数 PK'
      progressLabel = '还不能开始'
      tone = 'goal-neutral'
    }

    actionTarget = 'workout'
    actionLabel = '去运动'
  }

  const wagerLabel = doc.wagerEnabled && Number(doc.wagerCents || 0) > 0
    ? (doc.wagerLabel || `彩头 ${formatCurrency(doc.wagerCents)}`)
    : ''
  const wagerStatusLabel = wagerLabel
    ? `${wagerLabel}${doc.settlementStatus === 'settled' ? '已兑现' : (winnerUserId ? '待兑现' : '进行中')}`
    : ''

  return {
    id: doc._id || doc.id,
    slot: doc.slot,
    templateKey: doc.templateKey,
    mode: doc.mode,
    label: doc.slot === 'monthly_goal'
      ? '本月共同目标'
      : ((template.groupKey === 'rhythm' || template.groupKey === 'competition') ? '本周可选挑战' : '本周推进重点'),
    title: doc.title,
    customTitle: doc.customTitle || '',
    detail,
    progressLabel,
    currentLabel,
    tone,
    status: doc.status || 'active',
    actionTarget,
    actionLabel,
    winnerUserId,
    winnerLabel: winnerUserId ? getUserLabel(couple, winnerUserId, openid) : '',
    wagerEnabled: !!doc.wagerEnabled,
    wagerLabel,
    wagerStatusLabel,
    categoryKey: doc.categoryKey || '',
    source: doc.source || 'manual',
    suggestionKind: doc.suggestionKind || '',
    settlementStatus: doc.settlementStatus || 'pending',
    canSettle: !!(doc.wagerEnabled && winnerUserId && doc.settlementStatus === 'pending'),
    isCompetitive: doc.mode === 'competitive',
    isEnded,
    achieved
  }
}

async function buildOverview(couple, openid) {
  const [store, budgetDoc, goalsDocs, snapshots] = await Promise.all([
    Promise.all([
      getAllByCouple(COLLECTIONS.expenses, couple._id),
      getAllByCouple(COLLECTIONS.todos, couple._id),
      getAllByCouple(COLLECTIONS.workouts, couple._id)
    ]).then(([expenses, todos, workouts]) => ({ expenses, todos, workouts })),
    findBudgetDoc(couple._id),
    getGoalsDocs(couple._id),
    listRecentSteps(couple._id, getPeriodBounds('weekly').startKey, getPeriodBounds('weekly').endKey)
  ])

  const budgetOverview = buildBudgetOverview(budgetDoc || {}, store, couple)
  const stepSummary = buildStepSummary(couple, openid, snapshots)
  const monthlyGoal = decorateGoal(goalsDocs.monthlyGoal, {
    budgetOverview,
    sharedMonthlySpentCents: buildSharedMonthlySpent(store),
    sharedWeeklySpentCents: buildSharedWeeklySpent(store),
    weeklyTodoCleared: buildWeeklyTodoCleared(store),
    weeklyWorkoutCount: buildWeeklyWorkoutCount(store),
    overdueTodoCount: buildOverdueTodoCount(store),
    stepSummary,
    store,
    couple,
    openid
  })
  const weeklyChallenge = decorateGoal(goalsDocs.weeklyChallenge, {
    budgetOverview,
    sharedMonthlySpentCents: buildSharedMonthlySpent(store),
    sharedWeeklySpentCents: buildSharedWeeklySpent(store),
    weeklyTodoCleared: buildWeeklyTodoCleared(store),
    weeklyWorkoutCount: buildWeeklyWorkoutCount(store),
    overdueTodoCount: buildOverdueTodoCount(store),
    stepSummary,
    store,
    couple,
    openid
  })
  const homeCard = weeklyChallenge || monthlyGoal || null
  const canUseSharedSteps = !!(stepSummary.hasMyData && stepSummary.hasPartnerData)
  const capabilities = {
    budgetDuelReady: (budgetOverview.memberSummaries || []).filter((item) => Number(item.budgetCents || 0) > 0).length >= 2,
    stepsDuelReady: canUseSharedSteps,
    stepsTogetherReady: canUseSharedSteps
  }

  return {
    monthlyGoal,
    weeklyChallenge,
    homeCard,
    hasAnyGoal: !!(monthlyGoal || weeklyChallenge),
    capabilities,
    templateGroups: buildTemplateGroups()
  }
}

function buildGoalPayload(payload = {}) {
  const template = TEMPLATE_MAP[payload.templateKey]

  if (!template) {
    return {
      ok: false,
      message: '目标模板不存在'
    }
  }

  const bounds = getPeriodBounds(template.slot === 'monthly_goal' ? 'monthly' : 'weekly')
  const targetValue = template.unit === 'cents'
    ? parseAmountToCents(payload.targetValue)
    : Number(payload.targetValue || 0)
  const customTitle = String(payload.customTitle || '').trim()
  const categoryKey = String(payload.categoryKey || template.fixedCategoryKey || '').trim()
  const categoryLabel = getCategoryLabel(categoryKey)

  if (template.targetRequired && targetValue <= 0) {
    return {
      ok: false,
      message: '请填写目标值'
    }
  }

  if (template.categoryRequired && !categoryKey) {
    return {
      ok: false,
      message: '先选一个要控制的分类'
    }
  }

  if (template.categoryRequired && !categoryLabel) {
    return {
      ok: false,
      message: '这个分类当前还不可用'
    }
  }

  const wagerCents = (template.key === 'budget_duel' || template.key === 'steps_duel') && payload.wagerEnabled
    ? parseAmountToCents(payload.wagerAmount)
    : 0
  const title = customTitle || (
    template.key === 'save_buffer' ? `本月底至少剩下 ${formatCurrency(targetValue)}` :
    template.key === 'shared_spend_cap' ? `本月共同支出控制在 ${formatCurrency(targetValue)} 内` :
    template.key === 'category_cap' ? `本月${categoryLabel || '该分类'}控制在 ${formatCurrency(targetValue)} 内` :
    template.key === 'milestone_cap' ? `本月备婚/大事支出控制在 ${formatCurrency(targetValue)} 内` :
    template.key === 'budget_duel' ? '这个月谁更守住自己的预算' :
    template.key === 'todo_clear' ? `这周清掉 ${targetValue} 个待办` :
    template.key === 'overdue_zero' ? '这周把超时待办清到 0' :
    template.key === 'milestone_prep_clear' ? `这周推进 ${targetValue} 项关键准备` :
    template.key === 'workout_together' ? `这周一起运动 ${targetValue} 次` :
    template.key === 'steps_together' ? `这周一起走到 ${formatCount(targetValue)} 步` :
    template.key === 'weekly_spend_cap' ? `这周共同支出控制在 ${formatCurrency(targetValue)} 内` :
    '这周步数 PK'
  )

  return {
    ok: true,
    goal: {
      slot: template.slot,
      templateKey: template.key,
      mode: template.mode,
      title,
      customTitle,
      targetValue,
      unit: template.unit,
      categoryKey,
      startDate: bounds.startKey,
      endDate: bounds.endKey,
      status: 'active',
      winnerUserId: '',
      wagerEnabled: wagerCents > 0,
      wagerCents,
      wagerLabel: wagerCents > 0 ? (String(payload.wagerLabel || '').trim() || `彩头 ${formatCurrency(wagerCents)}`) : '',
      settlementStatus: wagerCents > 0 ? 'pending' : 'cancelled',
      source: payload.source === 'suggested' ? 'suggested' : 'manual',
      suggestionKind: String(payload.suggestionKind || '').trim(),
      updatedAt: nowIso()
    }
  }
}

async function getGoalsOverview(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)

  return {
    ok: true,
    overview: await buildOverview(couple, openid)
  }
}

async function upsertGoal(openid, payload = {}) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const nextGoal = buildGoalPayload(payload)

  if (!nextGoal.ok) {
    return nextGoal
  }

  const budgetDoc = await findBudgetDoc(couple._id)
  const budgetOverview = buildBudgetOverview(budgetDoc || {}, {
    expenses: await getAllByCouple(COLLECTIONS.expenses, couple._id)
  }, couple)
  const snapshots = await listRecentSteps(couple._id, getPeriodBounds('weekly').startKey, getPeriodBounds('weekly').endKey)
  const stepSummary = buildStepSummary(couple, openid, snapshots)

  if (nextGoal.goal.templateKey === 'budget_duel') {
    const budgetsReady = (budgetOverview.memberSummaries || []).filter((item) => Number(item.budgetCents || 0) > 0).length >= 2
    if (!budgetsReady) {
      return {
        ok: false,
        message: '要先给两个人都设置预算，才能开始预算对决'
      }
    }
  }

  if ((nextGoal.goal.templateKey === 'steps_duel' || nextGoal.goal.templateKey === 'steps_together') && !(stepSummary.hasMyData && stepSummary.hasPartnerData)) {
    return {
      ok: false,
      message: nextGoal.goal.templateKey === 'steps_duel'
        ? '要先让两个人都同步微信步数，才能开始步数 PK'
        : '要先让两个人都同步微信步数，才能开始步数目标'
    }
  }

  const existingDocs = await getGoalsDocs(couple._id)
  const existing = nextGoal.goal.slot === 'monthly_goal' ? existingDocs.monthlyGoal : existingDocs.weeklyChallenge
  const now = nowIso()
  const doc = Object.assign({}, nextGoal.goal, {
    coupleId: couple._id,
    createdBy: openid,
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now
  })

  if (existing) {
    await db.collection(COLLECTIONS.goals).doc(existing._id).update({
      data: doc
    })
  } else {
    await db.collection(COLLECTIONS.goals).add({
      data: doc
    })
  }

  return {
    ok: true,
    overview: await buildOverview(couple, openid)
  }
}

async function archiveGoal(openid, payload = {}) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const docs = await getGoalsDocs(couple._id)
  const target = payload.slot === 'monthly_goal' ? docs.monthlyGoal : docs.weeklyChallenge

  if (!target) {
    return {
      ok: true,
      overview: await buildOverview(couple, openid)
    }
  }

  await db.collection(COLLECTIONS.goals).doc(target._id).update({
    data: {
      status: 'archived',
      updatedAt: nowIso()
    }
  })

  return {
    ok: true,
    overview: await buildOverview(couple, openid)
  }
}

async function settleWager(openid, payload = {}) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const docs = await getGoalsDocs(couple._id)
  const target = payload.slot === 'monthly_goal' ? docs.monthlyGoal : docs.weeklyChallenge

  if (!target) {
    return {
      ok: false,
      message: '没有找到对应的彩头记录'
    }
  }

  await db.collection(COLLECTIONS.goals).doc(target._id).update({
    data: {
      settlementStatus: payload.settlementStatus || 'settled',
      updatedAt: nowIso()
    }
  })

  return {
    ok: true,
    overview: await buildOverview(couple, openid)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getGoalsOverview'

  try {
    if (action === 'upsertGoal') {
      return await upsertGoal(OPENID, event.payload || {})
    }

    if (action === 'archiveGoal') {
      return await archiveGoal(OPENID, event.payload || {})
    }

    if (action === 'settleWager') {
      return await settleWager(OPENID, event.payload || {})
    }

    return await getGoalsOverview(OPENID)
  } catch (error) {
    console.error('[goals] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '目标请求失败'
    }
  }
}

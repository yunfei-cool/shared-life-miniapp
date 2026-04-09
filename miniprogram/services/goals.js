const {
  addDays,
  formatCurrency,
  getPeriodBounds,
  isDateKeyInRange,
  parseDateKey,
  toDateKey
} = require('../utils/date')
const { getDisplayNameByUserId } = require('../utils/member-display')
const { callCloudFunction, isPreviewMode } = require('./cloud')
const { buildBudgetOverviewFromStore, getPreviewBudgetSettings } = require('./budget')
const { getExpenseCategories, getRawStoreLocal } = require('./records')
const { getStepSummary } = require('./steps')

const GOALS_STORAGE_PREFIX = 'shared-life-goals:'
const EXPENSE_CATEGORY_OPTIONS = getExpenseCategories()
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
    titleBuilder: (targetValue) => `本月底至少剩下 ${formatCurrency(targetValue)}`,
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
    titleBuilder: (targetValue) => `本月共同支出控制在 ${formatCurrency(targetValue)} 内`,
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
    titleBuilder: (targetValue, extra = {}) => `本月${extra.categoryLabel || '该分类'}控制在 ${formatCurrency(targetValue)} 内`,
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
    titleBuilder: (targetValue) => `本月备婚/大事支出控制在 ${formatCurrency(targetValue)} 内`,
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
    titleBuilder: () => '这个月谁更守住自己的预算',
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
    titleBuilder: (targetValue) => `这周清掉 ${targetValue} 个待办`,
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
    titleBuilder: () => '这周把超时待办清到 0',
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
    titleBuilder: (targetValue) => `这周推进 ${targetValue} 项关键准备`,
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
    titleBuilder: (targetValue) => `这周一起运动 ${targetValue} 次`,
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
    titleBuilder: (targetValue) => `这周一起走到 ${formatCount(targetValue)} 步`,
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
    titleBuilder: (targetValue) => `这周共同支出控制在 ${formatCurrency(targetValue)} 内`,
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
    titleBuilder: () => '这周步数 PK',
    unit: 'steps',
    targetRequired: false,
    targetLabel: ''
  }
]

function nowIso() {
  return new Date().toISOString()
}

function getStorageKey(coupleId = '') {
  return `${GOALS_STORAGE_PREFIX}${coupleId}`
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
  const matched = EXPENSE_CATEGORY_OPTIONS.find((item) => item.key === categoryKey)
  return matched ? matched.label : ''
}

function buildTemplateMap() {
  return MONTHLY_GOAL_TEMPLATES.concat(WEEKLY_CHALLENGE_TEMPLATES).reduce((result, item) => {
    result[item.key] = item
    return result
  }, {})
}

const TEMPLATE_MAP = buildTemplateMap()

function getGoalsTemplates() {
  const grouped = (templates) => Object.values(templates.reduce((result, item) => {
    const groupKey = item.groupKey || 'saving'
    const group = result[groupKey] || {
      key: groupKey,
      label: GOAL_GROUP_LABELS[groupKey] || groupKey,
      templates: []
    }
    group.templates.push(item)
    result[groupKey] = group
    return result
  }, {})).sort((left, right) => GOAL_GROUP_ORDER.indexOf(left.key) - GOAL_GROUP_ORDER.indexOf(right.key))

  return {
    monthlyGoals: MONTHLY_GOAL_TEMPLATES,
    weeklyChallenges: WEEKLY_CHALLENGE_TEMPLATES,
    monthlyGroups: grouped(MONTHLY_GOAL_TEMPLATES),
    weeklyGroups: grouped(WEEKLY_CHALLENGE_TEMPLATES),
    categoryOptions: EXPENSE_CATEGORY_OPTIONS
  }
}

function shouldUseWager(templateKey = '') {
  return templateKey === 'budget_duel' || templateKey === 'steps_duel'
}

function getGoalDates(slot, baseDate = new Date()) {
  const periodType = slot === 'monthly_goal' ? 'monthly' : 'weekly'
  const bounds = getPeriodBounds(periodType, baseDate)

  return {
    startDate: bounds.startKey,
    endDate: bounds.endKey,
    periodType
  }
}

function normalizeGoal(goal = {}) {
  if (!goal || !goal.slot || !goal.templateKey) {
    return null
  }

  return {
    id: goal.id || goal._id || `${goal.slot}:${goal.templateKey}`,
    slot: goal.slot,
    templateKey: goal.templateKey,
    mode: goal.mode || (TEMPLATE_MAP[goal.templateKey] ? TEMPLATE_MAP[goal.templateKey].mode : 'cooperative'),
    title: goal.title || '',
    customTitle: goal.customTitle || '',
    targetValue: Number(goal.targetValue || 0),
    unit: goal.unit || (TEMPLATE_MAP[goal.templateKey] ? TEMPLATE_MAP[goal.templateKey].unit : ''),
    categoryKey: goal.categoryKey || '',
    startDate: goal.startDate || '',
    endDate: goal.endDate || '',
    status: goal.status || 'active',
    winnerUserId: goal.winnerUserId || '',
    wagerEnabled: !!goal.wagerEnabled,
    wagerCents: Number(goal.wagerCents || 0),
    wagerLabel: goal.wagerLabel || '',
    settlementStatus: goal.settlementStatus || 'pending',
    source: goal.source || 'manual',
    suggestionKind: goal.suggestionKind || '',
    createdBy: goal.createdBy || '',
    createdAt: goal.createdAt || nowIso(),
    updatedAt: goal.updatedAt || goal.createdAt || nowIso()
  }
}

function normalizeGoalsDocs(docs = {}) {
  return {
    monthlyGoal: normalizeGoal(docs.monthlyGoal) || null,
    weeklyChallenge: normalizeGoal(docs.weeklyChallenge) || null
  }
}

function getPreviewGoalsDocs(globalData = {}) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return normalizeGoalsDocs({})
  }

  const existing = wx.getStorageSync(getStorageKey(coupleId))
  return normalizeGoalsDocs(existing || {})
}

function persistPreviewGoalsDocs(globalData = {}, docs = {}) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return
  }

  wx.setStorageSync(getStorageKey(coupleId), normalizeGoalsDocs(docs))
}

function getDisplayNames(globalData = {}) {
  const currentUserId = globalData.userId || ''
  const partnerUserId = globalData.partnerInfo && globalData.partnerInfo.userId
    ? globalData.partnerInfo.userId
    : (globalData.coupleInfo
      ? (globalData.coupleInfo.creatorUserId === currentUserId
        ? globalData.coupleInfo.partnerUserId
        : globalData.coupleInfo.creatorUserId)
      : '')

  return {
    selfLabel: getDisplayNameByUserId(currentUserId, globalData, { selfFallback: '我' }),
    partnerLabel: getDisplayNameByUserId(partnerUserId, globalData, { partnerFallback: '伴侣' }),
    currentUserId,
    partnerUserId
  }
}

function buildSharedMonthlySpent(store = {}, baseDate = new Date()) {
  const bounds = getPeriodBounds('monthly', baseDate)
  return (store.expenses || []).reduce((total, item) => {
    if (item.ownerScope !== 'shared' || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildCategoryMonthlySpent(store = {}, categoryKey = '', baseDate = new Date()) {
  const bounds = getPeriodBounds('monthly', baseDate)
  return (store.expenses || []).reduce((total, item) => {
    if (item.categoryKey !== categoryKey || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildSharedWeeklySpent(store = {}, baseDate = new Date()) {
  const bounds = getPeriodBounds('weekly', baseDate)
  return (store.expenses || []).reduce((total, item) => {
    if (item.ownerScope !== 'shared' || !isDateKeyInRange(item.occurredOn, bounds)) {
      return total
    }

    return total + Number(item.amountCents || 0)
  }, 0)
}

function buildWeeklyTodoCompleted(store = {}, baseDate = new Date()) {
  const bounds = getPeriodBounds('weekly', baseDate)
  return (store.todos || []).filter((item) => {
    return item.status === 'completed'
      && item.completedAt
      && isDateKeyInRange(String(item.completedAt).slice(0, 10), bounds)
  }).length
}

function buildWeeklyWorkoutCount(store = {}, baseDate = new Date()) {
  const bounds = getPeriodBounds('weekly', baseDate)
  return (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds)).length
}

function buildOverdueTodoCount(store = {}, baseDate = new Date()) {
  const todayKey = toDateKey(baseDate)
  return (store.todos || []).filter((item) => item.status === 'open' && item.dueAt && item.dueAt < todayKey).length
}

function buildInputs(globalData = {}, store = {}, budgetOverview = {}, stepSummary = {}, baseDate = new Date()) {
  const names = getDisplayNames(globalData)

  return Object.assign({}, names, {
    baseDate,
    store,
    budgetOverview,
    stepSummary,
    sharedMonthlySpentCents: buildSharedMonthlySpent(store, baseDate),
    sharedWeeklySpentCents: buildSharedWeeklySpent(store, baseDate),
    weeklyTodoClearedCount: buildWeeklyTodoCompleted(store, baseDate),
    weeklyWorkoutCount: buildWeeklyWorkoutCount(store, baseDate),
    overdueTodoCount: buildOverdueTodoCount(store, baseDate)
  })
}

function buildGoalProgress(doc, inputs = {}) {
  const template = TEMPLATE_MAP[doc.templateKey] || {}
  const budgetOverview = inputs.budgetOverview || {}
  const memberSummaries = budgetOverview.memberSummaries || []
  const selfMember = memberSummaries.find((item) => item.userId === inputs.currentUserId) || null
  const partnerMember = memberSummaries.find((item) => item.userId === inputs.partnerUserId) || null
  const isEnded = doc.endDate ? toDateKey(inputs.baseDate) > doc.endDate : false
  const categoryKey = doc.categoryKey || template.fixedCategoryKey || ''
  const categoryLabel = getCategoryLabel(categoryKey)

  if (doc.templateKey === 'save_buffer') {
    const remainingCents = Number(budgetOverview.remainingCents || 0)
    const achieved = remainingCents >= doc.targetValue
    const gap = Math.max(doc.targetValue - remainingCents, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `当前还剩 ${formatCurrency(remainingCents)}，目标至少剩下 ${formatCurrency(doc.targetValue)}`,
      progressLabel: achieved ? '已达到目标余量' : `还差 ${formatCurrency(gap)}`,
      targetLabel: formatCurrency(doc.targetValue),
      currentLabel: formatCurrency(remainingCents),
      actionTarget: 'budget',
      actionLabel: '去预算',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'shared_spend_cap') {
    const currentCents = Number(inputs.sharedMonthlySpentCents || 0)
    const achieved = currentCents <= doc.targetValue
    const gap = Math.max(currentCents - doc.targetValue, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `共同支出已用 ${formatCurrency(currentCents)} / ${formatCurrency(doc.targetValue)}`,
      progressLabel: achieved ? `还在目标内 ${formatCurrency(doc.targetValue - currentCents)}` : `已超出 ${formatCurrency(gap)}`,
      targetLabel: formatCurrency(doc.targetValue),
      currentLabel: formatCurrency(currentCents),
      actionTarget: 'budget',
      actionLabel: '去预算',
      tone: achieved ? 'goal-coop' : 'goal-over',
      isEnded
    }
  }

  if (doc.templateKey === 'category_cap' || doc.templateKey === 'milestone_cap') {
    const currentCents = Number(buildCategoryMonthlySpent(inputs.store, categoryKey, inputs.baseDate) || 0)
    const achieved = currentCents <= doc.targetValue
    const gap = Math.max(currentCents - doc.targetValue, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `${categoryLabel || '该分类'}已用 ${formatCurrency(currentCents)} / ${formatCurrency(doc.targetValue)}`,
      progressLabel: achieved ? `还在目标内 ${formatCurrency(doc.targetValue - currentCents)}` : `已超出 ${formatCurrency(gap)}`,
      targetLabel: formatCurrency(doc.targetValue),
      currentLabel: formatCurrency(currentCents),
      actionTarget: 'expense',
      actionLabel: '去记账',
      tone: achieved ? 'goal-coop' : 'goal-over',
      isEnded
    }
  }

  if (doc.templateKey === 'budget_duel') {
    const members = [selfMember, partnerMember].filter(Boolean).filter((item) => Number(item.budgetCents || 0) > 0)

    if (members.length < 2) {
      return {
        achieved: false,
        leaderUserId: '',
        winnerUserId: '',
        title: doc.title,
        detail: '要先给两个人都设置预算，才能开始这个对决',
        progressLabel: '还不能开始',
        targetLabel: '',
        currentLabel: '',
        actionTarget: 'budget',
        actionLabel: '去预算',
        tone: 'goal-neutral',
        isEnded
      }
    }

    const ranked = members
      .map((item) => ({
        userId: item.userId,
        label: item.label,
        ratio: item.budgetCents > 0 ? item.spentCents / item.budgetCents : 999,
        display: `${Math.round((item.budgetCents > 0 ? item.spentCents / item.budgetCents : 0) * 100)}%`
      }))
      .sort((left, right) => left.ratio - right.ratio)
    const leader = ranked[0]
    const runnerUp = ranked[1]
    const diff = Math.max(Math.round((runnerUp.ratio - leader.ratio) * 100), 0)
    const winnerUserId = isEnded ? leader.userId : ''

    return {
      achieved: !!winnerUserId,
      leaderUserId: leader.userId,
      winnerUserId,
      title: doc.title,
      detail: isEnded
        ? `${leader.label} 这个月预算执行更稳`
        : `${leader.label} 暂时领先，预算执行度 ${leader.display}`,
      progressLabel: isEnded ? `${leader.label} 胜出` : `暂时领先 ${diff} 个点`,
      targetLabel: '',
      currentLabel: `${leader.label} ${leader.display}`,
      actionTarget: 'budget',
      actionLabel: '去预算',
      tone: 'goal-competitive',
      isEnded
    }
  }

  if (doc.templateKey === 'todo_clear') {
    const currentCount = Number(inputs.weeklyTodoClearedCount || 0)
    const achieved = currentCount >= doc.targetValue
    const gap = Math.max(doc.targetValue - currentCount, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `这周已经清掉 ${currentCount} / ${doc.targetValue} 个待办`,
      progressLabel: achieved ? '本周待办任务达成' : `还差 ${gap} 个`,
      targetLabel: `${doc.targetValue} 个`,
      currentLabel: `${currentCount} 个`,
      actionTarget: 'todo',
      actionLabel: '去待办',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'overdue_zero') {
    const overdueCount = Number(inputs.overdueTodoCount || 0)
    const achieved = overdueCount === 0

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: achieved ? '这周已经把超时待办清掉了' : `当前还有 ${overdueCount} 个超时待办`,
      progressLabel: achieved ? '超时待办已清到 0' : `还剩 ${overdueCount} 个`,
      targetLabel: '0 个',
      currentLabel: `${overdueCount} 个`,
      actionTarget: 'todo',
      actionLabel: '去待办',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'milestone_prep_clear') {
    const currentCount = Number(inputs.weeklyTodoClearedCount || 0)
    const achieved = currentCount >= doc.targetValue
    const gap = Math.max(doc.targetValue - currentCount, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `这周已经推进 ${currentCount} / ${doc.targetValue} 项关键准备`,
      progressLabel: achieved ? '本周关键准备推进完成' : `还差 ${gap} 项`,
      targetLabel: `${doc.targetValue} 项`,
      currentLabel: `${currentCount} 项`,
      actionTarget: 'todo',
      actionLabel: '去待办',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'workout_together') {
    const currentCount = Number(inputs.weeklyWorkoutCount || 0)
    const achieved = currentCount >= doc.targetValue
    const gap = Math.max(doc.targetValue - currentCount, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `这周已经一起运动 ${currentCount} / ${doc.targetValue} 次`,
      progressLabel: achieved ? '本周运动挑战达成' : `还差 ${gap} 次`,
      targetLabel: `${doc.targetValue} 次`,
      currentLabel: `${currentCount} 次`,
      actionTarget: 'workout',
      actionLabel: '去运动',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'steps_together') {
    const summary = inputs.stepSummary || {}
    const mySteps = Number(summary.my && summary.my.weekSteps || 0)
    const partnerSteps = Number(summary.partner && summary.partner.weekSteps || 0)
    const totalSteps = mySteps + partnerSteps
    const hasMyData = !!summary.hasMyData
    const hasPartnerData = !!summary.hasPartnerData

    if (!hasMyData || !hasPartnerData) {
      return {
        achieved: false,
        leaderUserId: '',
        winnerUserId: '',
        title: doc.title,
        detail: '要先让两个人都同步微信步数，才能开始这周步数目标',
        progressLabel: '还不能开始',
        targetLabel: '',
        currentLabel: '',
        actionTarget: 'workout',
        actionLabel: '去运动',
        tone: 'goal-neutral',
        isEnded
      }
    }

    const achieved = totalSteps >= doc.targetValue
    const gap = Math.max(doc.targetValue - totalSteps, 0)
    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `这周一起走了 ${formatCount(totalSteps)} / ${formatCount(doc.targetValue)} 步`,
      progressLabel: achieved ? '本周步数目标达成' : `还差 ${formatCount(gap)} 步`,
      targetLabel: `${formatCount(doc.targetValue)} 步`,
      currentLabel: `${formatCount(totalSteps)} 步`,
      actionTarget: 'workout',
      actionLabel: '去运动',
      tone: achieved ? 'goal-done' : 'goal-coop',
      isEnded
    }
  }

  if (doc.templateKey === 'weekly_spend_cap') {
    const currentCents = Number(inputs.sharedWeeklySpentCents || 0)
    const achieved = currentCents <= doc.targetValue
    const gap = Math.max(currentCents - doc.targetValue, 0)

    return {
      achieved,
      leaderUserId: '',
      winnerUserId: achieved ? (doc.winnerUserId || inputs.currentUserId || '') : '',
      title: doc.title,
      detail: `这周共同支出已用 ${formatCurrency(currentCents)} / ${formatCurrency(doc.targetValue)}`,
      progressLabel: achieved ? `还在目标内 ${formatCurrency(doc.targetValue - currentCents)}` : `已超出 ${formatCurrency(gap)}`,
      targetLabel: formatCurrency(doc.targetValue),
      currentLabel: formatCurrency(currentCents),
      actionTarget: 'expense',
      actionLabel: '去记账',
      tone: achieved ? 'goal-coop' : 'goal-over',
      isEnded
    }
  }

  if (doc.templateKey === 'steps_duel') {
    const summary = inputs.stepSummary || {}
    const mySteps = Number(summary.my && summary.my.weekSteps || 0)
    const partnerSteps = Number(summary.partner && summary.partner.weekSteps || 0)
    const hasMyData = summary.hasMyData !== false && summary.my && summary.my.weekDisplay !== '未同步'
    const hasPartnerData = summary.hasPartnerData !== false && summary.partner && summary.partner.weekDisplay !== '未同步'

    if (!hasMyData || !hasPartnerData) {
      return {
        achieved: false,
        leaderUserId: '',
        winnerUserId: '',
        title: doc.title,
        detail: '要先让两个人都同步微信步数，才能开始步数 PK',
        progressLabel: '还不能开始',
        targetLabel: '',
        currentLabel: '',
        actionTarget: 'workout',
        actionLabel: '去运动',
        tone: 'goal-neutral',
        isEnded
      }
    }

    const selfWins = mySteps >= partnerSteps
    const leaderUserId = selfWins ? inputs.currentUserId : inputs.partnerUserId
    const leaderLabel = selfWins ? inputs.selfLabel : inputs.partnerLabel
    const diff = Math.abs(mySteps - partnerSteps)
    const winnerUserId = isEnded ? leaderUserId : ''

    return {
      achieved: !!winnerUserId,
      leaderUserId,
      winnerUserId,
      title: doc.title,
      detail: isEnded
        ? `${leaderLabel} 赢了这周步数 PK`
        : `${leaderLabel} 暂时领先 ${formatCount(diff)} 步`,
      progressLabel: isEnded ? `${leaderLabel} 胜出` : `差距 ${formatCount(diff)} 步`,
      targetLabel: '',
      currentLabel: `${inputs.selfLabel} ${formatCount(mySteps)} · ${inputs.partnerLabel} ${formatCount(partnerSteps)}`,
      actionTarget: 'workout',
      actionLabel: '去运动',
      tone: 'goal-competitive',
      isEnded
    }
  }

  return {
    achieved: false,
    leaderUserId: '',
    winnerUserId: '',
    title: doc.title,
    detail: '',
    progressLabel: '',
    targetLabel: '',
    currentLabel: '',
    actionTarget: 'goals',
    actionLabel: '去目标',
    tone: 'goal-neutral',
    isEnded
  }
}

function decorateGoalCard(doc, inputs = {}) {
  if (!doc) {
    return null
  }

  const template = TEMPLATE_MAP[doc.templateKey] || {}
  const progress = buildGoalProgress(doc, inputs)
  const winnerLabel = progress.winnerUserId
    ? getDisplayNameByUserId(progress.winnerUserId, {
      userId: inputs.currentUserId,
      partnerInfo: inputs.partnerUserId ? { userId: inputs.partnerUserId, nickName: inputs.partnerLabel } : null,
      userInfo: { userId: inputs.currentUserId, nickName: inputs.selfLabel }
    }, {
      selfFallback: inputs.selfLabel,
      partnerFallback: inputs.partnerLabel
    })
    : ''
  const wagerLabel = doc.wagerEnabled && doc.wagerCents > 0
    ? (doc.wagerLabel || `彩头 ${formatCurrency(doc.wagerCents)}`)
    : ''
  const wagerStatusLabel = wagerLabel
    ? `${wagerLabel}${doc.settlementStatus === 'settled' ? '已兑现' : (progress.winnerUserId ? '待兑现' : '进行中')}`
    : ''

  return {
    id: doc.id,
    slot: doc.slot,
    templateKey: doc.templateKey,
    mode: doc.mode,
    label: doc.slot === 'monthly_goal'
      ? '本月共同目标'
      : ((template.groupKey === 'rhythm' || template.groupKey === 'competition') ? '本周可选挑战' : '本周推进重点'),
    title: progress.title,
    customTitle: doc.customTitle || '',
    detail: progress.detail,
    progressLabel: progress.progressLabel,
    targetLabel: progress.targetLabel,
    currentLabel: progress.currentLabel,
    tone: progress.tone,
    status: doc.status,
    actionTarget: progress.actionTarget,
    actionLabel: progress.actionLabel,
    endDate: doc.endDate,
    winnerUserId: progress.winnerUserId || doc.winnerUserId || '',
    winnerLabel: winnerLabel || '',
    isCompetitive: doc.mode === 'competitive',
    categoryKey: doc.categoryKey || '',
    source: doc.source || 'manual',
    suggestionKind: doc.suggestionKind || '',
    wagerEnabled: doc.wagerEnabled,
    wagerLabel,
    wagerStatusLabel,
    settlementStatus: doc.settlementStatus || 'pending',
    canSettle: !!(doc.wagerEnabled && (progress.winnerUserId || doc.winnerUserId) && doc.settlementStatus === 'pending'),
    isEnded: progress.isEnded,
    achieved: progress.achieved
  }
}

function buildGoalsOverviewFromDocs(docs = {}, inputs = {}) {
  const monthlyGoal = decorateGoalCard(docs.monthlyGoal, inputs)
  const weeklyChallenge = decorateGoalCard(docs.weeklyChallenge, inputs)
  const homeCard = (weeklyChallenge && weeklyChallenge.status !== 'archived') || (monthlyGoal && monthlyGoal.status !== 'archived')
    ? (weeklyChallenge && weeklyChallenge.status !== 'archived' ? weeklyChallenge : monthlyGoal)
    : null
  const budgetMembers = ((inputs.budgetOverview || {}).memberSummaries || []).filter((item) => Number(item.budgetCents || 0) > 0)
  const canUseSharedSteps = !!(inputs.stepSummary && inputs.stepSummary.hasMyData && inputs.stepSummary.hasPartnerData)
  const capabilities = {
    budgetDuelReady: budgetMembers.length >= 2,
    stepsDuelReady: canUseSharedSteps,
    stepsTogetherReady: canUseSharedSteps
  }

  return {
    monthlyGoal,
    weeklyChallenge,
    homeCard,
    hasAnyGoal: !!(monthlyGoal || weeklyChallenge),
    capabilities,
    templateGroups: getGoalsTemplates()
  }
}

async function getGoalsOverview(globalData = {}) {
  if (isPreviewMode(globalData)) {
    const docs = getPreviewGoalsDocs(globalData)
    const store = getRawStoreLocal(globalData)
    const budgetOverview = buildBudgetOverviewFromStore(getPreviewBudgetSettings(globalData), store, globalData)
    const stepResult = await getStepSummary(globalData)
    const stepSummary = stepResult.ok ? stepResult.summary : {}

    return {
      ok: true,
      overview: buildGoalsOverviewFromDocs(docs, buildInputs(globalData, store, budgetOverview, stepSummary))
    }
  }

  return await callCloudFunction('goals', {
    action: 'getGoalsOverview'
  })
}

function buildGoalPayload(payload = {}, globalData = {}) {
  const template = TEMPLATE_MAP[payload.templateKey]

  if (!template) {
    return {
      ok: false,
      message: '目标模板不存在'
    }
  }

  const dates = getGoalDates(template.slot)
  const targetValue = template.unit === 'cents'
    ? parseAmountToCents(payload.targetValue)
    : Number(payload.targetValue || 0)
  const customTitle = String(payload.customTitle || '').trim()
  const categoryKey = String(payload.categoryKey || template.fixedCategoryKey || '').trim()
  const categoryLabel = getCategoryLabel(categoryKey)

  if (template.targetRequired && targetValue <= 0) {
    return {
      ok: false,
      message: `请填写${template.targetLabel || '目标值'}`
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

  const wagerCents = shouldUseWager(template.key) && payload.wagerEnabled
    ? parseAmountToCents(payload.wagerAmount)
    : 0
  const generatedTitle = template.titleBuilder(targetValue, { categoryKey, categoryLabel })

  return {
    ok: true,
    goal: normalizeGoal({
      slot: template.slot,
      templateKey: template.key,
      mode: template.mode,
      title: customTitle || generatedTitle,
      customTitle,
      targetValue,
      unit: template.unit,
      categoryKey,
      startDate: dates.startDate,
      endDate: dates.endDate,
      status: 'active',
      winnerUserId: '',
      wagerEnabled: wagerCents > 0,
      wagerCents,
      wagerLabel: wagerCents > 0
        ? (String(payload.wagerLabel || '').trim() || `彩头 ${formatCurrency(wagerCents)}`)
        : '',
      settlementStatus: wagerCents > 0 ? 'pending' : 'cancelled',
      source: payload.source === 'suggested' ? 'suggested' : 'manual',
      suggestionKind: String(payload.suggestionKind || '').trim(),
      createdBy: globalData.userId || '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
  }
}

async function upsertGoal(globalData = {}, payload = {}) {
  if (isPreviewMode(globalData)) {
    const docs = getPreviewGoalsDocs(globalData)
    const nextGoal = buildGoalPayload(payload, globalData)

    if (!nextGoal.ok) {
      return nextGoal
    }

    const store = getRawStoreLocal(globalData)
    const budgetOverview = buildBudgetOverviewFromStore(getPreviewBudgetSettings(globalData), store, globalData)
    const stepResult = await getStepSummary(globalData)
    const stepSummary = stepResult.ok ? stepResult.summary : {}

    if (nextGoal.goal.templateKey === 'budget_duel') {
      const hasTwoBudgets = (budgetOverview.memberSummaries || []).filter((item) => Number(item.budgetCents || 0) > 0).length >= 2
      if (!hasTwoBudgets) {
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

    const nextDocs = Object.assign({}, docs, {
      [nextGoal.goal.slot === 'monthly_goal' ? 'monthlyGoal' : 'weeklyChallenge']: nextGoal.goal
    })
    persistPreviewGoalsDocs(globalData, nextDocs)

    return {
      ok: true,
      overview: buildGoalsOverviewFromDocs(nextDocs, buildInputs(globalData, store, budgetOverview, stepSummary))
    }
  }

  return await callCloudFunction('goals', {
    action: 'upsertGoal',
    payload
  })
}

async function archiveGoal(globalData = {}, slot = '') {
  if (isPreviewMode(globalData)) {
    const docs = getPreviewGoalsDocs(globalData)
    const key = slot === 'monthly_goal' ? 'monthlyGoal' : 'weeklyChallenge'

    if (docs[key]) {
      docs[key] = Object.assign({}, docs[key], {
        status: 'archived',
        updatedAt: nowIso()
      })
    }

    persistPreviewGoalsDocs(globalData, docs)
    const store = getRawStoreLocal(globalData)
    const budgetOverview = buildBudgetOverviewFromStore(getPreviewBudgetSettings(globalData), store, globalData)
    const stepResult = await getStepSummary(globalData)
    const stepSummary = stepResult.ok ? stepResult.summary : {}

    return {
      ok: true,
      overview: buildGoalsOverviewFromDocs(docs, buildInputs(globalData, store, budgetOverview, stepSummary))
    }
  }

  return await callCloudFunction('goals', {
    action: 'archiveGoal',
    payload: {
      slot
    }
  })
}

async function settleWager(globalData = {}, payload = {}) {
  if (isPreviewMode(globalData)) {
    const docs = getPreviewGoalsDocs(globalData)
    const key = payload.slot === 'monthly_goal' ? 'monthlyGoal' : 'weeklyChallenge'

    if (docs[key]) {
      docs[key] = Object.assign({}, docs[key], {
        settlementStatus: payload.settlementStatus || 'settled',
        updatedAt: nowIso()
      })
    }

    persistPreviewGoalsDocs(globalData, docs)
    const store = getRawStoreLocal(globalData)
    const budgetOverview = buildBudgetOverviewFromStore(getPreviewBudgetSettings(globalData), store, globalData)
    const stepResult = await getStepSummary(globalData)
    const stepSummary = stepResult.ok ? stepResult.summary : {}

    return {
      ok: true,
      overview: buildGoalsOverviewFromDocs(docs, buildInputs(globalData, store, budgetOverview, stepSummary))
    }
  }

  return await callCloudFunction('goals', {
    action: 'settleWager',
    payload
  })
}

module.exports = {
  archiveGoal,
  getGoalsOverview,
  getGoalsTemplates,
  settleWager,
  upsertGoal
}

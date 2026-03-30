const {
  addDays,
  daysUntil,
  formatCurrency,
  formatPercentChange,
  getPeriodBounds,
  getPreviousPeriodBounds,
  isDateKeyInRange,
  toDateKey
} = require('../utils/date')
const {
  getDisplayNameByUserId,
  getPartnerDisplayName,
  getSelfDisplayName,
  hasDisplayProfile
} = require('../utils/member-display')
const { getRawStoreLocal, getRecentActivitiesLocal, getUpcomingAnniversaryFromStore } = require('./records')
const { callCloudFunction, isPreviewMode } = require('./cloud')
const { buildBudgetOverviewFromStore, getPreviewBudgetSettings } = require('./budget')
const { getStepSummary } = require('./steps')
const { getGoalsOverview } = require('./goals')

function sumExpenses(expenses) {
  return expenses.reduce((total, item) => total + item.amountCents, 0)
}

function getTopCategoryLabel(expenses) {
  const totals = {}

  expenses.forEach((item) => {
    totals[item.categoryLabel] = (totals[item.categoryLabel] || 0) + item.amountCents
  })

  const ranked = Object.keys(totals)
    .map((name) => ({ name, value: totals[name] }))
    .sort((left, right) => right.value - left.value)

  return ranked.slice(0, 2).map((item) => item.name).join('、')
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

function buildActivationChecklist(options = {}) {
  const {
    coupleInfo = null,
    userInfo = null,
    partnerInfo = null,
    budgetCard = {},
    store = {},
    stepCard = {}
  } = options
  const spaceConnected = !!(coupleInfo && coupleInfo.status === 'paired')
  const profileReady = hasDisplayProfile(userInfo) && hasDisplayProfile(partnerInfo)
  const budgetMembers = Array.isArray(budgetCard.members) ? budgetCard.members : []
  const budgetReady = budgetMembers.length >= 2 && budgetMembers.every((item) => Number(item.budgetCents || 0) > 0)
  const firstSharedExpenseReady = (store.expenses || []).some((item) => item.ownerScope === 'shared')
  const firstAssignedTodoReady = (store.todos || []).some((item) => !!item.assigneeUserId)
  const stepSyncReady = !!stepCard.hasAnyData
  const selfLabel = getSelfDisplayName({ userInfo, partnerInfo }, '我')
  const partnerLabel = getPartnerDisplayName({ userInfo, partnerInfo }, '伴侣')

  const items = [
    {
      key: 'space',
      title: '连上共享空间',
      detail: !spaceConnected
        ? '先去「我们」把空间连起来'
        : (profileReady ? '共享空间和资料都已就绪' : '空间已连接，还差完善资料'),
      status: spaceConnected && profileReady ? 'done' : 'pending',
      actionLabel: spaceConnected && !profileReady ? '去完善' : '去我们',
      target: 'profile',
      isOptional: false
    },
    {
      key: 'budget',
      title: '设置两个人的本月预算',
      detail: budgetReady ? `${selfLabel}和${partnerLabel}都已设置预算` : `先把${selfLabel}和${partnerLabel}的预算都设好`,
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
      createPrefill: {
        ownerChoice: 'shared'
      },
      openEditor: true,
      isOptional: false
    },
    {
      key: 'assigned_todo',
      title: '分配第一个待办',
      detail: firstAssignedTodoReady ? '已经分配过待办' : `先把一条待办分给${selfLabel}或${partnerLabel}`,
      status: firstAssignedTodoReady ? 'done' : 'pending',
      actionLabel: '去待办',
      target: 'todo',
      createPrefill: {
        assigneeChoice: 'partner'
      },
      openEditor: true,
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
    optionalCompletedCount: items.filter((item) => item.isOptional && item.status === 'done').length,
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

  const today = new Date(baseDate.getTime())
  const isSunday = today.getDay() === 0
  const monthlyBounds = getPeriodBounds('monthly', baseDate)
  const isMonthEnd = toDateKey(today) === monthlyBounds.endKey

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

function buildRecoveryRitual(options = {}) {
  const {
    weeklyTotal = 0,
    todoTotal = 0,
    workoutCount = 0
  } = options

  if (weeklyTotal > 0 || todoTotal > 0 || workoutCount > 0) {
    return null
  }

  return {
    mode: 'recovery',
    title: '这周还没真正开始',
    detail: '先记一笔共同支出或分一个待办，让首页重新活起来',
    actionLabel: '先去记录',
    target: 'expense'
  }
}

function buildFinanceHero(spendCard = {}, spendChart = {}, budgetCard = {}) {
  return {
    label: '生活账本',
    weeklySpendDisplay: spendCard.totalDisplay || formatCurrency(0),
    weeklyDeltaDisplay: spendCard.deltaDisplay || '首个周期',
    weeklyDetail: spendCard.detail || '开始记录后，这里会自动对比',
    focusText: spendCard.focusText || '继续记录，这里会显示主要花费',
    budgetRemainingDisplay: budgetCard.balanceLabel || '去设置预算',
    budgetProgressWidth: Number(budgetCard.progressWidth || 12),
    budgetFocusText: budgetCard.focusText || '设置好预算后，这里会开始显示本月余量',
    budgetActionLabel: budgetCard.hasBudget ? '去预算' : '去设置预算',
    hasBudget: !!budgetCard.hasBudget,
    budgetTone: !budgetCard.hasBudget ? 'setup' : (Number(budgetCard.progressPercent || 0) >= 100 ? 'over' : (Number(budgetCard.progressPercent || 0) >= 85 ? 'near' : 'calm')),
    trend: spendChart.trend || [],
    categories: spendChart.categories || [],
    members: budgetCard.members || []
  }
}

function buildGoalEntryCard() {
  return {
    visible: true,
    title: '还没有当前目标',
    detail: '可以先设一个本月共同目标，或者开始本周挑战。',
    primaryLabel: '设一个共同目标',
    primaryContext: {
      slot: 'monthly_goal'
    },
    secondaryLabel: '开始本周挑战',
    secondaryContext: {
      slot: 'weekly_challenge'
    },
    tone: 'goal-entry'
  }
}

function buildSuggestionCard(options = {}) {
  const {
    budgetCard = {},
    todoCard = {},
    anniversaryCard = {},
    stepCard = {},
    workoutCard = {},
    baseDate = new Date()
  } = options
  const progressPercent = Number(budgetCard.progressPercent || 0)
  const openCount = Number(todoCard.openCount || 0)
  const overdueMatch = String(todoCard.detail || '').match(/^(\d+)/)
  const overdueCount = overdueMatch ? Number(overdueMatch[1] || 0) : 0
  const title = String(anniversaryCard.title || '')
  const daysLeftMatch = String(anniversaryCard.daysLeftLabel || '').match(/(\d+)/)
  const anniversaryDaysLeft = daysLeftMatch ? Number(daysLeftMatch[1] || 99) : 99
  const monthlyBounds = getPeriodBounds('monthly', baseDate)
  const weeklyBounds = getPeriodBounds('weekly', baseDate)
  const combinedWeekSteps = Number(stepCard.combinedWeekSteps || 0)
  const suggestedTodoTarget = Math.max(2, Math.min(openCount, 5))
  const suggestedStepsTarget = Math.max(combinedWeekSteps + 8000, 50000)

  if (budgetCard.hasBudget && progressPercent >= 100) {
    return {
      visible: true,
      kind: 'budget_over',
      dismissKey: `budget-over:${monthlyBounds.startKey}`,
      title: '本月共同预算已超出',
      detail: '接下来要花的钱先排进待办再决定，先把大额支出排一排。',
      actionLabel: '接受建议',
      secondaryLabel: '暂不处理',
      acceptMode: 'goal_prefill',
      prefill: {
        slot: 'monthly_goal',
        templateKey: 'shared_spend_cap',
        source: 'suggested',
        suggestionKind: 'budget_over'
      },
      tone: 'budget-over'
    }
  }

  if (budgetCard.hasBudget && progressPercent >= 85) {
    return {
      visible: true,
      kind: 'budget_near',
      dismissKey: `budget-near:${monthlyBounds.startKey}`,
      title: '本月共同预算已接近上限',
      detail: '接下来要花的钱先排进待办，避免临时加购。',
      actionLabel: '接受建议',
      secondaryLabel: '暂不处理',
      acceptMode: 'goal_prefill',
      prefill: {
        slot: 'monthly_goal',
        templateKey: 'shared_spend_cap',
        source: 'suggested',
        suggestionKind: 'budget_near'
      },
      tone: 'budget-near'
    }
  }

  if (overdueCount >= 2) {
    return {
      visible: true,
      kind: 'overdue_zero',
      dismissKey: `overdue-zero:${weeklyBounds.startKey}`,
      title: '这周先把超时待办清掉',
      detail: '先把已经拖住的事清到 0，首页和报告会更像真的在运转。',
      actionLabel: '接受建议',
      secondaryLabel: '暂不处理',
      acceptMode: 'goal_prefill',
      prefill: {
        slot: 'weekly_challenge',
        templateKey: 'overdue_zero',
        source: 'suggested',
        suggestionKind: 'overdue_zero'
      },
      tone: 'todo'
    }
  }

  if (openCount >= 3) {
    return {
      visible: true,
      kind: 'todo_clear',
      dismissKey: `todo-clear:${weeklyBounds.startKey}`,
      title: `这周先清掉 ${suggestedTodoTarget} 个待办`,
      detail: '先把积压的事往前推，首页和报告会更像真的在运转。',
      actionLabel: '接受建议',
      secondaryLabel: '暂不处理',
      acceptMode: 'goal_prefill',
      prefill: {
        slot: 'weekly_challenge',
        templateKey: 'todo_clear',
        targetValue: suggestedTodoTarget,
        source: 'suggested',
        suggestionKind: 'todo_clear'
      },
      tone: 'todo'
    }
  }

  if (stepCard.hasMyData && stepCard.hasPartnerData && Number(workoutCard.totalCount || 0) <= 1) {
    return {
      visible: true,
      kind: 'steps_together',
      dismissKey: `steps-together:${weeklyBounds.startKey}`,
      title: '这周一起把步数拉起来',
      detail: '先把生活节奏找回来，哪怕只是多走一段路。',
      actionLabel: '接受建议',
      secondaryLabel: '暂不处理',
      acceptMode: 'goal_prefill',
      prefill: {
        slot: 'weekly_challenge',
        templateKey: 'steps_together',
        targetValue: suggestedStepsTarget,
        source: 'suggested',
        suggestionKind: 'steps_together'
      },
      tone: 'rhythm'
    }
  }

  if (title && title !== '还没有纪念日' && anniversaryDaysLeft <= 14 && String(anniversaryCard.prepTodo || '').indexOf('还') === 0) {
    return {
      visible: true,
      kind: 'anniversary_prep',
      dismissKey: `anniversary:${weeklyBounds.startKey}`,
      title: '纪念日快到了',
      detail: '先补一个准备待办，别把重要的事拖到最后一天。',
      acceptMode: 'direct',
      actionTarget: 'todo',
      actionLabel: '去待办',
      secondaryLabel: '暂不处理',
      tone: 'relationship'
    }
  }

  return null
}

function buildMissionSummaryFromGoalCard(card = null) {
  if (!card) {
    return null
  }

  return {
    visible: true,
    title: card.label,
    headline: card.title,
    detail: card.detail,
    progressLabel: card.progressLabel,
    currentLabel: card.currentLabel || '',
    wagerStatusLabel: card.wagerStatusLabel || '',
    actionTarget: 'goals',
    actionLabel: '去目标',
    tone: card.tone || 'goal'
  }
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

function buildBudgetCardLocal(globalData = {}, store) {
  const settings = getPreviewBudgetSettings(globalData)
  const overview = buildBudgetOverviewFromStore(settings, store, globalData)

  return {
    label: '本月预算',
    hasBudget: overview.hasBudget,
    spentDisplay: overview.spentDisplay,
    totalDisplay: overview.totalBudgetDisplay,
    progressPercent: overview.progressPercent,
    progressWidth: overview.progressWidth,
    balanceLabel: overview.remainingDisplay,
    focusText: overview.focusText,
    members: overview.memberSummaries || []
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

function buildWorkoutSummaryLocal(globalData = {}, store, baseDate = new Date()) {
  const weeklyBounds = getPeriodBounds('weekly', baseDate)
  const currentUserId = globalData.userId || ''
  const weeklyWorkouts = (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds))
  const myWorkouts = weeklyWorkouts.filter((item) => item.userId === currentUserId)
  const partnerWorkouts = weeklyWorkouts.filter((item) => item.userId && item.userId !== currentUserId)
  const totalMinutes = weeklyWorkouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')

  return {
    label: '本周运动',
    myCount: myWorkouts.length,
    partnerCount: partnerWorkouts.length,
    totalCount: weeklyWorkouts.length,
    totalDurationLabel: `${totalMinutes} 分钟`,
    detail: `${selfLabel} ${myWorkouts.length} 次 · ${partnerLabel} ${partnerWorkouts.length} 次`,
    focusText: weeklyWorkouts.length
      ? `这周一共动了 ${weeklyWorkouts.length} 次，累计 ${totalMinutes} 分钟`
      : '这周还没有运动记录'
  }
}

function buildStepCardLocal(globalData = {}) {
  return getStepSummary(globalData).then((result) => result.summary)
}

async function buildDashboardLocal(globalData = {}, storeOverride = null, activitiesOverride = null) {
  const store = storeOverride || getRawStoreLocal(globalData)
  const weeklyBounds = getPeriodBounds('weekly')
  const previousWeeklyBounds = getPreviousPeriodBounds('weekly')
  const weeklyExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds))
  const previousWeeklyExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, previousWeeklyBounds))
  const weeklyTotal = sumExpenses(weeklyExpenses)
  const previousWeeklyTotal = sumExpenses(previousWeeklyExpenses)
  const topCategory = getTopCategoryLabel(weeklyExpenses) || ''
  const openTodos = store.todos.filter((item) => item.status === 'open')
  const completedTodos = store.todos.filter((item) => item.status === 'completed')
  const overdueTodos = openTodos.filter((item) => item.dueAt && item.dueAt < new Date().toISOString().slice(0, 10))
  const dueSoonTodos = openTodos.filter((item) => {
    if (!item.dueAt) {
      return false
    }

    const days = daysUntil(item.dueAt)
    return days >= 0 && days <= 1
  })
  const nextAnniversary = getUpcomingAnniversaryFromStore(store)

  const stepCard = await buildStepCardLocal(globalData)
  const budgetCard = buildBudgetCardLocal(globalData, store)
  const workoutCard = buildWorkoutSummaryLocal(globalData, store)
  const activationChecklist = buildActivationChecklist({
    coupleInfo: globalData.coupleInfo,
    userInfo: globalData.userInfo,
    partnerInfo: globalData.partnerInfo,
    budgetCard,
    store,
    stepCard
  })
  const ritualCard = buildRitualCard(activationChecklist) || buildRecoveryRitual({
    weeklyTotal,
    todoTotal: openTodos.length + completedTodos.length,
    workoutCount: workoutCard.totalCount
  })
  const planningPrompt = buildBudgetPlanningPrompt(budgetCard)
  const goalsResult = await getGoalsOverview(globalData).catch(() => ({ ok: false }))
  const goalsOverview = goalsResult.ok ? goalsResult.overview : null
  const goalCard = goalsOverview && goalsOverview.homeCard ? goalsOverview.homeCard : null
  const suggestionCard = buildSuggestionCard({
    budgetCard,
    todoCard: {
      openCount: openTodos.length,
      detail: `${overdueTodos.length} 个已超时，${dueSoonTodos.length} 个 24 小时内到期`
    },
    anniversaryCard: nextAnniversary ? {
      title: nextAnniversary.title,
      daysLeftLabel: nextAnniversary.daysLeftLabel,
      prepTodo: nextAnniversary.linkedTodoLabel.replace('准备项: ', '')
    } : {},
    stepCard,
    workoutCard,
    baseDate: new Date()
  })
  const goalEntryCard = goalCard ? null : buildGoalEntryCard()
  const financeHero = buildFinanceHero({
    totalDisplay: formatCurrency(weeklyTotal),
    deltaDisplay: formatPercentChange(weeklyTotal, previousWeeklyTotal),
    detail: previousWeeklyTotal
      ? `比上周${weeklyTotal >= previousWeeklyTotal ? '多' : '少'} ${formatCurrency(Math.abs(weeklyTotal - previousWeeklyTotal))}`
      : '开始记录后，这里会自动对比',
    focusText: topCategory ? `这周主要花在 ${topCategory}` : '继续记录，这里会显示主要花费'
  }, {
    trend: buildSpendTrend(weeklyExpenses, weeklyBounds),
    categories: buildPercentBars(weeklyExpenses)
  }, budgetCard)

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
    financeHero,
    todoCard: {
      label: '待办进度',
      completedCount: completedTodos.length,
      openCount: openTodos.length,
      detail: `${overdueTodos.length} 个已超时，${dueSoonTodos.length} 个 24 小时内到期`,
      planningPrompt
    },
    budgetCard,
    goalCard,
    goalEntryCard,
    suggestionCard,
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
    workoutCard,
    stepCard,
    activationChecklist,
    ritualCard,
    goalsOverview,
    activityFeed: activitiesOverride || getRecentActivitiesLocal(globalData, store)
  }
}

async function buildDashboard(globalData = {}) {
  if (isPreviewMode(globalData)) {
    return await buildDashboardLocal(globalData)
  }

  const result = await callCloudFunction('dashboard', {
    action: 'getHomeDashboard'
  })

  if (!result.ok) {
    throw new Error(result.message || '首页加载失败')
  }

  const stepResult = await getStepSummary(globalData)
  const dashboard = result.dashboard || null

  if (!dashboard) {
    return dashboard
  }

  const stepCard = stepResult.ok ? stepResult.summary : {
      label: '微信步数',
      authorizationState: 'unauthorized',
      statusLabel: '去开启微信运动同步',
      actionLabel: '去开启',
      canSync: true,
      my: {
        todayDisplay: '未同步',
        weekDisplay: '未同步'
      },
      partner: {
        todayDisplay: '未同步',
        weekDisplay: '未同步'
      },
      combinedWeekDisplay: '0 步',
      focusText: '打开首页后会自动同步最近步数',
      detailText: '先开启微信运动权限',
      trend: []
    }
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')

  const activationChecklist = dashboard.activationChecklist
    ? Object.assign({}, dashboard.activationChecklist, {
      items: (dashboard.activationChecklist.items || []).map((item) => {
        if (item.key !== 'steps') {
          return item
        }

        return Object.assign({}, item, {
          status: stepCard.hasAnyData ? 'done' : 'pending',
          detail: stepCard.hasAnyData ? '最近步数已同步' : '可选增强，不影响启动完成',
          actionLabel: stepCard.hasAnyData ? '去运动' : '去开启'
        })
      }),
      optionalCompletedCount: stepCard.hasAnyData ? 1 : 0
    })
    : null

  const budgetCardBase = dashboard.budgetCard && Array.isArray(dashboard.budgetCard.members)
    ? Object.assign({}, dashboard.budgetCard, {
      members: dashboard.budgetCard.members.map((item) => Object.assign({}, item, {
        label: getDisplayNameByUserId(item.userId, globalData, {
          selfFallback: selfLabel,
          partnerFallback: partnerLabel
        })
      }))
    })
    : dashboard.budgetCard
  const workoutCard = dashboard.workoutCard
    ? Object.assign({}, dashboard.workoutCard, {
      detail: `${selfLabel} ${dashboard.workoutCard.myCount || 0} 次 · ${partnerLabel} ${dashboard.workoutCard.partnerCount || 0} 次`
    })
    : dashboard.workoutCard
  const weeklyHasSpend = !!(((dashboard.spendChart && dashboard.spendChart.trend) || []).find((item) => {
    return !!item.hasSpend || !!item.isActive || Number(item.amountCents || 0) > 0 || String(item.amountLabel || '') !== '￥0'
  }))
  const ritualCard = activationChecklist
    ? buildRitualCard(activationChecklist) || buildRecoveryRitual({
      weeklyTotal: weeklyHasSpend ? 1 : 0,
      todoTotal: Number((dashboard.todoCard && dashboard.todoCard.openCount) || 0) + Number((dashboard.todoCard && dashboard.todoCard.completedCount) || 0),
      workoutCount: Number((workoutCard && workoutCard.totalCount) || 0)
    })
    : dashboard.ritualCard
  const goalsResult = await getGoalsOverview(globalData).catch(() => ({ ok: false }))
  const goalsOverview = goalsResult.ok ? goalsResult.overview : null
  const goalCard = goalsOverview && goalsOverview.homeCard ? goalsOverview.homeCard : null
  const suggestionCard = buildSuggestionCard({
    budgetCard: budgetCardBase,
    todoCard: dashboard.todoCard,
    anniversaryCard: dashboard.anniversaryCard,
    stepCard,
    workoutCard,
    baseDate: new Date()
  })
  const goalEntryCard = goalCard ? null : buildGoalEntryCard()
  const financeHero = buildFinanceHero(dashboard.spendCard, dashboard.spendChart, budgetCardBase)

  return Object.assign({}, dashboard, {
    budgetCard: budgetCardBase,
    financeHero,
    workoutCard,
    stepCard,
    activationChecklist,
    ritualCard,
    goalCard,
    goalEntryCard,
    suggestionCard,
    goalsOverview
  })
}

module.exports = {
  buildDashboard
}

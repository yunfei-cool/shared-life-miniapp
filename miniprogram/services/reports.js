const {
  addDays,
  daysUntil,
  formatCurrency,
  formatMonthDay,
  formatPercentChange,
  formatPeriodLabel,
  getPeriodBounds,
  getPreviousPeriodBounds,
  isDateKeyInRange,
  parseDateKey,
  toDateKey
} = require('../utils/date')
const { getPartnerDisplayName, getSelfDisplayName } = require('../utils/member-display')
const { getRawStore, getCurrentUserId, getUpcomingAnniversaryFromStore } = require('./records')
const { callCloudFunction, isPreviewMode } = require('./cloud')
const { buildBudgetOverviewFromStore, getPreviewBudgetSettings } = require('./budget')
const { getGoalsOverview } = require('./goals')

const CATEGORY_COLORS = ['#D97A3D', '#F0B387', '#8E6D5A', '#D8C9BD']
const OWNER_COLORS = ['#2B211C', '#9B7B67', '#D9B89F']

function sumExpenses(expenses) {
  return expenses.reduce((total, item) => total + item.amountCents, 0)
}

function buildPercentList(items, totalCents, palette) {
  if (!totalCents) {
    return items.map((item, index) => ({
      key: item.key || item.name,
      name: item.name,
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
      key: item.key || item.name,
      name: item.name,
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
      currentBarHeight: item.currentValue > 0 ? Math.max(54, Math.round(Math.sqrt(currentRatio) * 132)) : 6,
      previousBarHeight: item.previousValue > 0 ? Math.max(34, Math.round(Math.sqrt(previousRatio) * 118)) : 6,
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

function buildMissionSummary(report = null, periodType = 'weekly', goalsOverview = null) {
  if (!report) {
    return null
  }

  const goalCard = periodType === 'monthly'
    ? (goalsOverview && goalsOverview.monthlyGoal)
    : (goalsOverview && goalsOverview.weeklyChallenge)

  if (goalCard) {
    return {
      visible: true,
      sectionTitle: '目标进展',
      label: goalCard.label,
      title: goalCard.title,
      detail: goalCard.detail,
      progressLabel: goalCard.progressLabel,
      currentLabel: goalCard.currentLabel || '',
      wagerStatusLabel: goalCard.wagerStatusLabel || '',
      tone: goalCard.tone || 'goal',
      actionTarget: goalCard.actionTarget || 'goals',
      actionLabel: goalCard.actionLabel || '去目标'
    }
  }

  const budgetSummary = report.budgetSummary || {}
  const progressPercent = Number(budgetSummary.progressPercent || 0)

  if (budgetSummary.hasBudget && progressPercent >= 100) {
    return {
      visible: true,
      sectionTitle: '本期共享任务',
      label: '预算和待办',
      title: '本月共同预算已超出',
      detail: '这个周期先把接下来的支出排进待办，再决定要不要买。',
      progressLabel: '先做规划，再做支出',
      currentLabel: '',
      wagerStatusLabel: '',
      tone: 'mission-budget',
      actionTarget: 'todo',
      actionLabel: '去待办'
    }
  }

  if (budgetSummary.hasBudget && progressPercent >= 85) {
    return {
      visible: true,
      sectionTitle: '本期共享任务',
      label: '预算和待办',
      title: '预算已接近上限',
      detail: '接下来要花的钱，先排进待办再决定。',
      progressLabel: '把要花的钱先排进待办',
      currentLabel: '',
      wagerStatusLabel: '',
      tone: 'mission-budget',
      actionTarget: 'todo',
      actionLabel: '去待办'
    }
  }

  if (String(report.todoSummary || '').indexOf('超时') >= 0) {
    return {
      visible: true,
      sectionTitle: '本期共享任务',
      label: '待办推进',
      title: '这周先清掉积压待办',
      detail: '把已经拖住的事先往前推，首页和报告会更像真的在运转。',
      progressLabel: '先清掉超时项',
      currentLabel: '',
      wagerStatusLabel: '',
      tone: 'mission-neutral',
      actionTarget: 'todo',
      actionLabel: '去待办'
    }
  }

  if (String(report.anniversarySummary || '').indexOf('还没准备项') >= 0) {
    return {
      visible: true,
      sectionTitle: '本期共享任务',
      label: '纪念日准备',
      title: '纪念日快到了',
      detail: '先补一个准备待办，别把重要的事拖到最后一天。',
      progressLabel: '先补一个准备待办',
      currentLabel: '',
      wagerStatusLabel: '',
      tone: 'mission-relationship',
      actionTarget: 'todo',
      actionLabel: '去待办'
    }
  }

  return {
    visible: true,
    sectionTitle: '本期共享任务',
    label: '共同目标',
    title: '设一个共同目标',
    detail: '给这个月定一个预算目标，或者开始一场本周节奏挑战。',
    progressLabel: '先定一个目标',
    currentLabel: '',
    wagerStatusLabel: '',
    tone: 'mission-entry',
    actionTarget: 'goals',
    actionLabel: '去目标'
  }
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

function buildOwnerBreakdown(expenses, globalData) {
  const currentUserId = getCurrentUserId(globalData)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')
  const values = {
    共同: 0,
    [selfLabel]: 0,
    [partnerLabel]: 0
  }

  expenses.forEach((item) => {
    if (item.ownerScope === 'shared') {
      values['共同'] += item.amountCents
      return
    }

    if (item.ownerUserId === currentUserId) {
      values[selfLabel] += item.amountCents
      return
    }

    values[partnerLabel] += item.amountCents
  })

  return [
    { key: 'shared', name: '共同', value: values['共同'] },
    { key: 'me', name: selfLabel, value: values[selfLabel] },
    { key: 'partner', name: partnerLabel, value: values[partnerLabel] }
  ]
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

function buildBudgetSpendByMemberLocal(expenses, members) {
  const totals = {}
  const sortedUserIds = members.map((item) => item.userId).filter(Boolean).slice().sort()

  members.forEach((item) => {
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

function buildBudgetSummaryLocal(globalData, store, periodType, baseDate = new Date()) {
  const settings = getPreviewBudgetSettings(globalData)
  const overview = buildBudgetOverviewFromStore(settings, store, globalData, baseDate)
  const bounds = getPeriodBounds(periodType, baseDate)
  const periodExpenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const periodSpentByMember = buildBudgetSpendByMemberLocal(periodExpenses, overview.memberSummaries || [])
  const periodSpentCents = sumExpenses(periodExpenses)

  return {
    hasBudget: overview.hasBudget,
    totalBudgetCents: overview.totalBudgetCents,
    totalBudgetDisplay: overview.totalBudgetDisplay,
    spentCents: overview.spentCents,
    spentDisplay: overview.spentDisplay,
    remainingCents: overview.remainingCents,
    remainingDisplay: overview.remainingDisplay,
    progressPercent: overview.progressPercent,
    progressWidth: overview.progressWidth,
    focusText: overview.focusText,
    sharedRuleText: overview.sharedRuleText,
    periodSpentCents,
    periodSpentDisplay: formatCurrency(periodSpentCents),
    periodSpentLabel: periodType === 'weekly' ? '本周新增' : '本月新增',
    memberSummaries: (overview.memberSummaries || []).map((item) => ({
      userId: item.userId,
      label: item.label,
      budgetCents: item.budgetCents,
      budgetDisplay: item.budgetDisplay,
      spentCents: item.spentCents,
      spentDisplay: item.spentDisplay,
      remainingCents: item.remainingCents,
      remainingDisplay: item.remainingDisplay,
      progressPercent: item.progressPercent,
      progressWidth: item.progressWidth,
      statusTone: item.statusTone,
      periodSpentCents: periodSpentByMember[item.userId] || 0,
      periodSpentDisplay: formatCurrency(periodSpentByMember[item.userId] || 0)
    }))
  }
}

function buildWorkoutSummaryLocal(globalData, store, periodType, baseDate = new Date()) {
  const bounds = getPeriodBounds(periodType, baseDate)
  const currentUserId = getCurrentUserId(globalData, store)
  const workouts = (store.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const mine = workouts.filter((item) => item.userId === currentUserId)
  const partner = workouts.filter((item) => item.userId && item.userId !== currentUserId)
  const totalMinutes = workouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0)
  const labelPrefix = periodType === 'weekly' ? '本周' : '本月'
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')

  function buildMember(label, items) {
    const durationMinutes = items.reduce((total, item) => total + Number(item.durationMinutes || 0), 0)
    return {
      label,
      count: items.length,
      countDisplay: `${items.length} 次`,
      durationMinutes,
      durationDisplay: `${durationMinutes} 分钟`,
      detail: items.length ? `${items.length} 次 · ${durationMinutes} 分钟` : '还没有记录'
    }
  }

  return {
    hasWorkouts: workouts.length > 0,
    sectionTitle: '运动节奏',
    totalCount: workouts.length,
    totalCountDisplay: `${workouts.length} 次`,
    totalDurationMinutes: totalMinutes,
    totalDurationDisplay: `${totalMinutes} 分钟`,
    focusText: workouts.length
      ? `${labelPrefix}记录了 ${workouts.length} 次运动，整体还在保持节奏`
      : `${labelPrefix}还没有运动记录，先把节奏慢慢找回来`,
    memberSummaries: [
      buildMember(selfLabel, mine),
      buildMember(partnerLabel, partner)
    ]
  }
}

function decorateReportDisplayNames(report, globalData = {}) {
  if (!report) {
    return report
  }

  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')
  const ownerBreakdown = (report.ownerBreakdown || []).map((item) => {
    if (item.key === 'me' || item.name === '我') {
      return Object.assign({}, item, { key: 'me', name: selfLabel })
    }

    if (item.key === 'partner' || item.name === '伴侣') {
      return Object.assign({}, item, { key: 'partner', name: partnerLabel })
    }

    if (item.name === '共同') {
      return Object.assign({}, item, { key: 'shared' })
    }

    return Object.assign({}, item, { key: item.key || item.name })
  })

  const workoutSummary = report.workoutSummary
    ? Object.assign({}, report.workoutSummary, {
      memberSummaries: (report.workoutSummary.memberSummaries || []).map((item) => {
        if (item.label === '我') {
          return Object.assign({}, item, { label: selfLabel })
        }

        if (item.label === '伴侣') {
          return Object.assign({}, item, { label: partnerLabel })
        }

        return item
      })
    })
    : report.workoutSummary

  return Object.assign({}, report, {
    ownerBreakdown,
    ownerVisual: buildDonutVisual(ownerBreakdown, report.totalCents || 0),
    workoutSummary
  })
}

function buildHistory(periodType, baseDate = new Date()) {
  const first = getPreviousPeriodBounds(periodType, baseDate)
  const second = getPreviousPeriodBounds(periodType, first.start)

  return [
    {
      id: `${periodType}_history_1`,
      periodLabel: formatPeriodLabel(periodType, first),
      statusLabel: '已归档'
    },
    {
      id: `${periodType}_history_2`,
      periodLabel: formatPeriodLabel(periodType, second),
      statusLabel: '已归档'
    }
  ]
}

function buildReportForType(globalData, periodType, store, baseDate = new Date()) {
  const bounds = getPeriodBounds(periodType, baseDate)
  const previousBounds = getPreviousPeriodBounds(periodType, baseDate)

  const expenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const previousExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, previousBounds))
  const totalCents = sumExpenses(expenses)
  const previousTotalCents = sumExpenses(previousExpenses)
  const categories = pickTopCategories(expenses)
  const ownerBreakdownRaw = buildOwnerBreakdown(expenses, globalData)
  const overdueTodos = store.todos.filter((item) => item.status === 'open' && item.dueAt && daysUntil(item.dueAt, baseDate) < 0).length
  const anniversarySummary = buildAnniversarySummary(store, baseDate)
  const topCategory = categories[0] ? categories[0].name : ''
  const categoryBreakdown = buildPercentList(
    categories.length ? categories : [{ name: '暂无支出', value: 0 }],
    totalCents,
    CATEGORY_COLORS
  )
  const ownerBreakdown = buildPercentList(ownerBreakdownRaw, totalCents, OWNER_COLORS)
  const trendSeries = buildTrendSeries(expenses, previousExpenses, periodType, bounds, previousBounds)
  const categoryChanges = buildCategoryChanges(expenses, previousExpenses)
  const budgetSummary = buildBudgetSummaryLocal(globalData, store, periodType, baseDate)
  const planningAlert = buildBudgetPlanningAlert(budgetSummary)
  const alerts = buildAlerts(totalCents, previousTotalCents, trendSeries, categoryChanges, overdueTodos, anniversarySummary)
  if (planningAlert) {
    alerts.unshift(planningAlert)
  }
  const workoutSummary = buildWorkoutSummaryLocal(globalData, store, periodType, baseDate)
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
    ownerBreakdown,
    ownerVisual: buildDonutVisual(ownerBreakdown, totalCents),
    trendSeries,
    categoryChanges,
    alerts: alerts.slice(0, 3),
    budgetSummary,
    workoutSummary,
    todoSummary: buildTodoSummary(store, bounds, baseDate),
    anniversarySummary,
    aiSummary: buildSummary(totalCents, previousTotalCents, topCategory),
    suggestions: buildSuggestions(topCategory, overdueTodos, anniversarySummary),
    history: buildHistory(periodType, baseDate)
  }
}

async function getReportsView(globalData = {}) {
  const goalsResult = await getGoalsOverview(globalData).catch(() => ({ ok: false }))
  const goalsOverview = goalsResult.ok ? goalsResult.overview : null

  if (!isPreviewMode(globalData)) {
    const result = await callCloudFunction('reports', {
      action: 'getCurrentReports'
    })

    if (!result.ok) {
      throw new Error(result.message || '报告加载失败')
    }

    const reports = result.reports || {
      weekly: null,
      monthly: null
    }

    const weekly = decorateReportDisplayNames(reports.weekly, globalData)
    const monthly = decorateReportDisplayNames(reports.monthly, globalData)

    return {
      weekly: weekly ? Object.assign({}, weekly, {
        missionSummary: buildMissionSummary(weekly, 'weekly', goalsOverview)
      }) : null,
      monthly: monthly ? Object.assign({}, monthly, {
        missionSummary: buildMissionSummary(monthly, 'monthly', goalsOverview)
      }) : null
    }
  }

  const store = await getRawStore(globalData)
  const weekly = buildReportForType(globalData, 'weekly', store)
  const monthly = buildReportForType(globalData, 'monthly', store)

  return {
    weekly: Object.assign({}, weekly, {
      missionSummary: buildMissionSummary(weekly, 'weekly', goalsOverview)
    }),
    monthly: Object.assign({}, monthly, {
      missionSummary: buildMissionSummary(monthly, 'monthly', goalsOverview)
    })
  }
}

async function getReportDetail(globalData = {}, periodType, periodStart) {
  if (!periodType || !periodStart) {
    throw new Error('报告参数不完整')
  }

  const goalsResult = await getGoalsOverview(globalData).catch(() => ({ ok: false }))
  const goalsOverview = goalsResult.ok ? goalsResult.overview : null

  if (!isPreviewMode(globalData)) {
    const result = await callCloudFunction('reports', {
      action: 'getReportDetail',
      payload: {
        periodType,
        periodStart
      }
    })

    if (!result.ok) {
      throw new Error(result.message || '报告详情加载失败')
    }

    const report = decorateReportDisplayNames(result.report || null, globalData)
    return report ? Object.assign({}, report, {
      missionSummary: buildMissionSummary(report, periodType, goalsOverview)
    }) : null
  }

  const store = await getRawStore(globalData)
  const report = decorateReportDisplayNames(buildReportForType(globalData, periodType, store, parseDateKey(periodStart)), globalData)
  return report ? Object.assign({}, report, {
    missionSummary: buildMissionSummary(report, periodType, goalsOverview)
  }) : null
}

async function listReportHistory(globalData = {}) {
  if (isPreviewMode(globalData)) {
    const reports = await getReportsView(globalData)
    return {
      weekly: reports.weekly && reports.weekly.history ? reports.weekly.history : [],
      monthly: reports.monthly && reports.monthly.history ? reports.monthly.history : []
    }
  }

  const result = await callCloudFunction('reports', {
    action: 'listReportHistory'
  })

  if (!result.ok) {
    throw new Error(result.message || '历史报告加载失败')
  }

  return result.history || {
    weekly: [],
    monthly: []
  }
}

module.exports = {
  getReportDetail,
  getReportsView,
  listReportHistory
}

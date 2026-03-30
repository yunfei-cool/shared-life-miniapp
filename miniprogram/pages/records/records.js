const app = getApp()
const {
  createAnniversary,
  createExpense,
  createTodo,
  createWorkout,
  deleteAnniversary,
  deleteExpense,
  deleteTodo,
  deleteWorkout,
  getExpenseCategories,
  getWorkoutTypes,
  listRecordSections,
  toggleTodoStatus,
  updateAnniversary,
  updateExpense,
  updateTodo,
  updateWorkout
} = require('../../services/records')
const { getStepSummary } = require('../../services/steps')
const { refreshSessionFromCloud } = require('../../services/session')
const { consumeRecordsEntryContext } = require('../../utils/records-entry')
const { addDays, formatCurrency, formatMonthDay, formatMonthLabel, getPeriodBounds, isDateKeyInRange, parseDateKey, toDateKey } = require('../../utils/date')
const { getPartnerDisplayName, getSelfDisplayName } = require('../../utils/member-display')
const { resolvePairState } = require('../../utils/pair-state')

function buildOwnerOptions(globalData = {}) {
  return [
    { label: '共同', value: 'shared' },
    { label: getSelfDisplayName(globalData, '我'), value: 'me' },
    { label: getPartnerDisplayName(globalData, '伴侣'), value: 'partner' }
  ]
}

function buildAssigneeOptions(globalData = {}) {
  return [
    { label: '共同', value: 'shared' },
    { label: getSelfDisplayName(globalData, '我'), value: 'me' },
    { label: getPartnerDisplayName(globalData, '伴侣'), value: 'partner' }
  ]
}

const ANNIVERSARY_TYPE_OPTIONS = [
  { label: '周年纪念', value: 'relationship' },
  { label: '重要日子', value: 'custom' }
]

const RELATIONSHIP_MILESTONE_OPTIONS = [
  { label: '在一起', value: '在一起' },
  { label: '领证', value: '领证' },
  { label: '结婚', value: '结婚' }
]

function buildExpenseOwnerFilterOptions(globalData = {}) {
  return [
    { label: '全部归属', value: 'all' },
    { label: '共同', value: 'shared' },
    { label: getSelfDisplayName(globalData, '我'), value: 'me' },
    { label: getPartnerDisplayName(globalData, '伴侣'), value: 'partner' }
  ]
}

const EXPENSE_RANGE_FILTER_OPTIONS = [
  { label: '全部时间', value: 'all' },
  { label: '近 7 天', value: '7d' },
  { label: '近 30 天', value: '30d' },
  { label: '本月', value: 'month' },
  { label: '自定义', value: 'custom' }
]

function buildTodoFilterOptions(globalData = {}) {
  const selfLabel = getSelfDisplayName(globalData, '我')
  return [
    { label: '全部', value: 'all' },
    { label: selfLabel === '我' ? '分给我' : `分给${selfLabel}`, value: 'assigned_to_me' },
    { label: '今天到期', value: 'due_today' }
  ]
}

const WORKOUT_FILTER_OPTIONS = [
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '全部', value: 'all' }
]

function getTodayDateKey() {
  return toDateKey(new Date())
}

function formatAmountInput(amountCents) {
  const amount = (amountCents || 0) / 100
  const fixed = amount.toFixed(2)
  return fixed.replace(/\.00$/, '').replace(/(\.\d*[1-9])0$/, '$1')
}

function createExpenseForm() {
  const categories = getExpenseCategories()

  return {
    amount: '',
    categoryKey: categories[0] ? categories[0].key : 'dining',
    ownerChoice: 'shared',
    occurredOn: getTodayDateKey(),
    note: ''
  }
}

function createTodoForm() {
  return {
    title: '',
    assigneeChoice: 'shared',
    dueAt: '',
    note: ''
  }
}

function createAnniversaryForm() {
  return {
    kind: 'relationship',
    title: '在一起',
    date: getTodayDateKey(),
    note: '',
    prepTodoTitle: ''
  }
}

function createWorkoutForm() {
  const workoutTypes = getWorkoutTypes()

  return {
    typeKey: workoutTypes[0] ? workoutTypes[0].key : 'run',
    durationMinutes: '',
    occurredOn: getTodayDateKey(),
    note: ''
  }
}

function buildCreateFormWithPrefill(segment, prefill = {}) {
  if (segment === 'expense') {
    return Object.assign(createExpenseForm(), {
      ownerChoice: prefill.ownerChoice || createExpenseForm().ownerChoice,
      categoryKey: prefill.categoryKey || createExpenseForm().categoryKey,
      occurredOn: prefill.occurredOn || createExpenseForm().occurredOn,
      note: Object.prototype.hasOwnProperty.call(prefill, 'note') ? prefill.note : createExpenseForm().note
    })
  }

  if (segment === 'todo') {
    return Object.assign(createTodoForm(), {
      assigneeChoice: prefill.assigneeChoice || createTodoForm().assigneeChoice,
      dueAt: prefill.dueAt || createTodoForm().dueAt,
      title: Object.prototype.hasOwnProperty.call(prefill, 'title') ? prefill.title : createTodoForm().title,
      note: Object.prototype.hasOwnProperty.call(prefill, 'note') ? prefill.note : createTodoForm().note
    })
  }

  if (segment === 'anniversary') {
    return Object.assign(createAnniversaryForm(), prefill)
  }

  return Object.assign(createWorkoutForm(), prefill)
}

function createEmptyStepSummary() {
  return {
    label: '微信步数',
    authorizationState: 'unauthorized',
    statusLabel: '去开启微信运动同步',
    actionLabel: '去开启',
    canSync: true,
    my: {
      label: '我',
      todayDisplay: '未同步',
      weekDisplay: '未同步'
    },
    partner: {
      label: '伴侣',
      todayDisplay: '未同步',
      weekDisplay: '未同步'
    },
    combinedWeekDisplay: '0 步',
    focusText: '打开首页后会自动同步最近步数',
    detailText: '步数和手动运动日志会分开记录',
    trend: []
  }
}

function getCurrentUserId(globalData = {}) {
  return globalData.userId || ''
}

function buildExpenseCategoryFilters(categories) {
  return [{
    label: '全部分类',
    value: 'all'
  }].concat(categories.map((item) => ({
    label: item.label,
    value: item.key
  })))
}

function resolveExpenseRange(filters) {
  const today = new Date()

  if (filters.rangePreset === '7d') {
    return {
      startKey: toDateKey(addDays(today, -6)),
      endKey: toDateKey(today)
    }
  }

  if (filters.rangePreset === '30d') {
    return {
      startKey: toDateKey(addDays(today, -29)),
      endKey: toDateKey(today)
    }
  }

  if (filters.rangePreset === 'month') {
    const bounds = getPeriodBounds('monthly', today)

    return {
      startKey: bounds.startKey,
      endKey: bounds.endKey
    }
  }

  if (filters.rangePreset === 'custom') {
    let startKey = filters.rangeStart || ''
    let endKey = filters.rangeEnd || ''

    if (startKey && endKey && parseDateKey(startKey).getTime() > parseDateKey(endKey).getTime()) {
      const swapped = startKey
      startKey = endKey
      endKey = swapped
    }

    return {
      startKey,
      endKey
    }
  }

  return {
    startKey: '',
    endKey: ''
  }
}

function buildExpenseView(expenses, filters, categories, globalData = {}) {
  const rangeOptions = EXPENSE_RANGE_FILTER_OPTIONS
  const categoryOptions = buildExpenseCategoryFilters(categories)
  const ownerOptions = buildExpenseOwnerFilterOptions(globalData)
  const nextRangePreset = rangeOptions.some((item) => item.value === filters.rangePreset) ? filters.rangePreset : 'all'
  const nextRangeStart = filters.rangeStart || ''
  const nextRangeEnd = filters.rangeEnd || ''
  const nextCategoryFilter = categoryOptions.some((item) => item.value === filters.categoryKey) ? filters.categoryKey : 'all'
  const nextOwnerFilter = ownerOptions.some((item) => item.value === filters.ownerKey) ? filters.ownerKey : 'all'
  const nextSearchQuery = String(filters.searchQuery || '').trim()
  const nextSearchQueryLower = nextSearchQuery.toLowerCase()
  const range = resolveExpenseRange({
    rangePreset: nextRangePreset,
    rangeStart: nextRangeStart,
    rangeEnd: nextRangeEnd
  })

  const filteredExpenses = expenses.filter((item) => {
    if (range.startKey && item.occurredOn < range.startKey) {
      return false
    }

    if (range.endKey && item.occurredOn > range.endKey) {
      return false
    }

    if (nextCategoryFilter !== 'all' && item.categoryKey !== nextCategoryFilter) {
      return false
    }

    if (nextOwnerFilter !== 'all' && item.ownerKey !== nextOwnerFilter) {
      return false
    }

    if (nextSearchQuery) {
      const haystack = [
        item.category,
        item.note,
        item.ownerLabel,
        item.dateLabel
      ].join(' ').toLowerCase()

      if (haystack.indexOf(nextSearchQueryLower) < 0) {
        return false
      }
    }

    return true
  })

  const groups = []
  const grouped = {}

  const rangeLabelMap = rangeOptions.reduce((result, item) => {
    result[item.value] = item.label
    return result
  }, {})
  const activeCategory = categoryOptions.find((item) => item.value === nextCategoryFilter)
  const activeOwner = ownerOptions.find((item) => item.value === nextOwnerFilter)
  const filterHintParts = []

  if (nextRangePreset === 'custom' && (range.startKey || range.endKey)) {
    const startLabel = range.startKey ? formatMonthDay(parseDateKey(range.startKey)) : '最早'
    const endLabel = range.endKey ? formatMonthDay(parseDateKey(range.endKey)) : '今天'
    filterHintParts.push(`${startLabel} - ${endLabel}`)
  } else if (nextRangePreset !== 'all') {
    filterHintParts.push(rangeLabelMap[nextRangePreset])
  }

  if (activeCategory && activeCategory.value !== 'all') {
    filterHintParts.push(activeCategory.label)
  }

  if (activeOwner && activeOwner.value !== 'all') {
    filterHintParts.push(activeOwner.label)
  }

  if (nextSearchQuery) {
    filterHintParts.push(`搜索“${nextSearchQuery}”`)
  }

  const rangeWindowLabel = range.startKey || range.endKey
    ? `${range.startKey ? formatMonthDay(parseDateKey(range.startKey)) : '最早'} - ${range.endKey ? formatMonthDay(parseDateKey(range.endKey)) : '今天'}`
    : ''
  const useRangeGroup = nextRangePreset !== 'all'

  if (useRangeGroup) {
    groups.push({
      key: `range:${nextRangePreset}:${range.startKey || 'start'}:${range.endKey || 'end'}`,
      label: nextRangePreset === 'month' ? '本月' : (rangeLabelMap[nextRangePreset] || '所选时间'),
      metaLabel: rangeWindowLabel,
      totalCents: filteredExpenses.reduce((total, item) => total + item.amountCents, 0),
      items: filteredExpenses
    })
  } else {
    filteredExpenses.forEach((item) => {
      if (!grouped[item.monthKey]) {
        grouped[item.monthKey] = {
          key: item.monthKey,
          label: item.monthLabel,
          metaLabel: '',
          totalCents: 0,
          items: []
        }
        groups.push(grouped[item.monthKey])
      }

      grouped[item.monthKey].totalCents += item.amountCents
      grouped[item.monthKey].items.push(item)
    })
  }

  return {
    expenseRangeOptions: rangeOptions,
    expenseCategoryOptions: categoryOptions,
    expenseOwnerOptions: ownerOptions,
    expenseRangePreset: nextRangePreset,
    expenseRangeStart: nextRangeStart,
    expenseRangeEnd: nextRangeEnd,
    expenseCategoryFilter: nextCategoryFilter,
    expenseOwnerFilter: nextOwnerFilter,
    expenseSearchQuery: nextSearchQuery,
    expenseGroups: groups.map((group) => Object.assign({}, group, {
      totalDisplay: formatCurrency(group.totalCents),
      countLabel: `${group.items.length} 笔`
    })),
    expenseSectionCaption: filterHintParts.length ? filterHintParts.join(' · ') : '按时间查看',
    expenseFilterHint: filterHintParts.length ? filterHintParts.join(' · ') : '全部账单',
    expenseFilteredCount: filteredExpenses.length,
    expenseFilteredTotal: formatCurrency(filteredExpenses.reduce((total, item) => total + item.amountCents, 0))
  }
}

function buildWorkoutView(workouts, preset, todayDateKey = getTodayDateKey()) {
  const nextPreset = WORKOUT_FILTER_OPTIONS.some((item) => item.value === preset) ? preset : 'week'
  const today = parseDateKey(todayDateKey)
  const weeklyBounds = getPeriodBounds('weekly', today)
  const monthlyBounds = getPeriodBounds('monthly', today)
  let visibleWorkouts = workouts.slice()
  let sectionCaption = '按周或按月查看'
  let emptyText = '还没有运动记录，先记一次。'
  const groups = []

  if (nextPreset === 'week') {
    visibleWorkouts = visibleWorkouts.filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds))
    sectionCaption = `${formatMonthDay(weeklyBounds.start)} - ${formatMonthDay(weeklyBounds.end)}`
    emptyText = '这周还没有运动记录。'
    if (visibleWorkouts.length) {
      groups.push({
        key: `week:${weeklyBounds.startKey}`,
        label: '本周运动',
        metaLabel: sectionCaption,
        totalMinutes: visibleWorkouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0),
        items: visibleWorkouts
      })
    }
  } else if (nextPreset === 'month') {
    visibleWorkouts = visibleWorkouts.filter((item) => isDateKeyInRange(item.occurredOn, monthlyBounds))
    sectionCaption = formatMonthLabel(monthlyBounds.start)
    emptyText = '这个月还没有运动记录。'
    if (visibleWorkouts.length) {
      groups.push({
        key: `month:${monthlyBounds.startKey}`,
        label: '本月运动',
        metaLabel: sectionCaption,
        totalMinutes: visibleWorkouts.reduce((total, item) => total + Number(item.durationMinutes || 0), 0),
        items: visibleWorkouts
      })
    }
  } else {
    const grouped = {}

    visibleWorkouts.forEach((item) => {
      if (!grouped[item.monthKey]) {
        grouped[item.monthKey] = {
          key: item.monthKey,
          label: item.monthLabel,
          metaLabel: '',
          totalMinutes: 0,
          items: []
        }
        groups.push(grouped[item.monthKey])
      }

      grouped[item.monthKey].totalMinutes += Number(item.durationMinutes || 0)
      grouped[item.monthKey].items.push(item)
    })
  }

  return {
    workoutFilterOptions: WORKOUT_FILTER_OPTIONS,
    workoutFilterPreset: nextPreset,
    workoutSectionCount: `${visibleWorkouts.length} 次`,
    workoutSectionCaption: sectionCaption,
    workoutEmptyText: emptyText,
    workoutGroups: groups.map((group) => Object.assign({}, group, {
      totalDurationLabel: `${group.totalMinutes} 分钟`,
      countLabel: `${group.items.length} 次`
    }))
  }
}

function buildTodoView(todos, preset, globalData = {}, todayDateKey = getTodayDateKey()) {
  const todoFilterOptions = buildTodoFilterOptions(globalData)
  const nextPreset = todoFilterOptions.some((item) => item.value === preset) ? preset : 'all'
  const currentUserId = getCurrentUserId(globalData)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const assignedTitle = selfLabel === '我' ? '分给我的待办' : `分给${selfLabel}的待办`
  const assignedEmptyText = selfLabel === '我' ? '还没有分给我的待办。' : `还没有分给${selfLabel}的待办。`
  let visibleTodos = todos.slice()
  let sectionTitle = '当前待办'
  let emptyText = '还没有待办，新增一项吧。'

  if (nextPreset === 'assigned_to_me') {
    visibleTodos = visibleTodos.filter((item) => item.assigneeKey === 'me' && item.status === 'open')
    sectionTitle = assignedTitle
    emptyText = assignedEmptyText
  } else if (nextPreset === 'due_today') {
    visibleTodos = visibleTodos.filter((item) => item.dueAt === todayDateKey && item.status === 'open')
    sectionTitle = '今天到期'
    emptyText = '今天还没有到期的待办。'
  } else if (currentUserId) {
    visibleTodos = visibleTodos.slice()
  }

  return {
    todoFilterPreset: nextPreset,
    todoFilterOptions,
    todoVisibleRecords: visibleTodos,
    todoSectionTitle: sectionTitle,
    todoSectionCount: `${visibleTodos.length} 项`,
    todoEmptyText: emptyText
  }
}

function createEditorState() {
  return {
    editorVisible: false,
    editorMode: 'create',
    editorSegment: 'expense',
    editorTitle: '',
    editingRecordId: ''
  }
}

function buildOverviewStats(records, todayDateKey = getTodayDateKey()) {
  const currentMonthKey = String(todayDateKey || getTodayDateKey()).slice(0, 7)
  const monthlyExpenseCount = (records.expenses || []).filter((item) => item.occurredOn.slice(0, 7) === currentMonthKey).length
  const openTodoCount = (records.todos || []).filter((item) => item.status !== 'completed').length
  const anniversaryCount = (records.anniversaries || []).length
  const weeklyBounds = getPeriodBounds('weekly', parseDateKey(todayDateKey || getTodayDateKey()))
  const weeklyWorkoutCount = (records.workouts || []).filter((item) => isDateKeyInRange(item.occurredOn, weeklyBounds)).length

  return {
    monthlyExpenseCount,
    openTodoCount,
    anniversaryCount,
    weeklyWorkoutCount
  }
}

function buildExpenseFormFromRecord(record) {
  return {
    amount: formatAmountInput(record.amountCents),
    categoryKey: record.categoryKey,
    ownerChoice: record.ownerKey,
    occurredOn: record.occurredOn,
    note: record.note || ''
  }
}

function buildTodoFormFromRecord(record) {
  return {
    title: record.title,
    assigneeChoice: record.assigneeKey || 'shared',
    dueAt: record.dueAt || '',
    note: record.note || ''
  }
}

function buildAnniversaryFormFromRecord(record) {
  return {
    kind: record.type === 'relationship' ? 'relationship' : 'custom',
    title: record.baseTitle || record.title,
    date: record.date,
    note: record.note || '',
    prepTodoTitle: record.linkedTodoLabel && record.linkedTodoLabel.indexOf('准备项: ') === 0
      ? record.linkedTodoLabel.replace('准备项: ', '')
      : ''
  }
}

function buildWorkoutFormFromRecord(record) {
  return {
    typeKey: record.typeKey,
    durationMinutes: String(record.durationMinutes || ''),
    occurredOn: record.occurredOn,
    note: record.note || ''
  }
}

function buildEditorTitle(mode, segment) {
  const prefix = mode === 'create' ? '新增' : '编辑'
  const labelMap = {
    expense: '账单',
    todo: '待办',
    anniversary: '纪念日',
    workout: '运动'
  }

  return `${prefix}${labelMap[segment] || '记录'}`
}

function findRecord(records, segment, recordId) {
  if (!recordId) {
    return null
  }

  const map = {
    expense: records.expenses || [],
    todo: records.todos || [],
    anniversary: records.anniversaries || [],
    workout: records.workouts || []
  }

  return (map[segment] || []).find((item) => item.id === recordId) || null
}

function extractLegacySegment() {
  const nextSegment = wx.getStorageSync('recordsDefaultSegment')

  if (!nextSegment) {
    return null
  }

  wx.removeStorageSync('recordsDefaultSegment')
  return {
    segment: nextSegment
  }
}

Page({
  data: Object.assign({
    isLoading: true,
    pairState: 'guest',
    activeSegment: 'expense',
    highlightRecordId: '',
    todayDateKey: getTodayDateKey(),
    expenseCategories: getExpenseCategories(),
    workoutTypes: getWorkoutTypes(),
    ownerOptions: buildOwnerOptions(),
    assigneeOptions: buildAssigneeOptions(),
    anniversaryTypeOptions: ANNIVERSARY_TYPE_OPTIONS,
    relationshipMilestoneOptions: RELATIONSHIP_MILESTONE_OPTIONS,
    expenseRangeOptions: EXPENSE_RANGE_FILTER_OPTIONS,
    expenseCategoryOptions: buildExpenseCategoryFilters(getExpenseCategories()),
    expenseOwnerOptions: buildExpenseOwnerFilterOptions(),
    expenseRangePreset: 'all',
    expenseRangeStart: '',
    expenseRangeEnd: '',
    expenseCategoryFilter: 'all',
    expenseOwnerFilter: 'all',
    expenseSearchQuery: '',
    todoFilterOptions: buildTodoFilterOptions(),
    todoFilterPreset: 'all',
    todoVisibleRecords: [],
    todoSectionTitle: '当前待办',
    todoSectionCount: '0 项',
    todoEmptyText: '还没有待办，新增一项吧。',
    workoutFilterOptions: WORKOUT_FILTER_OPTIONS,
    workoutFilterPreset: 'week',
    workoutGroups: [],
    workoutSectionCount: '0 次',
    workoutSectionCaption: '按周或按月查看',
    workoutEmptyText: '还没有运动记录，先记一次。',
    expenseFilterHint: '全部账单',
    expenseGroups: [],
    expenseFilteredCount: 0,
    expenseFilteredTotal: formatCurrency(0),
    expenseSectionCaption: '按时间查看',
    overviewStats: {
      monthlyExpenseCount: 0,
      openTodoCount: 0,
      anniversaryCount: 0,
      weeklyWorkoutCount: 0
    },
    stepSummary: createEmptyStepSummary(),
    expenseForm: createExpenseForm(),
    todoForm: createTodoForm(),
    anniversaryForm: createAnniversaryForm(),
    workoutForm: createWorkoutForm(),
    records: {
      expenses: [],
      todos: [],
      anniversaries: [],
      workouts: []
    }
  }, createEditorState()),

  onLoad() {
    wx.setNavigationBarTitle({
      title: '记录'
    })
  },

  onShow() {
    const entryContext = consumeRecordsEntryContext() || extractLegacySegment()

    if (entryContext) {
      this.applyEntryContext(entryContext)
      return
    }

    this.refreshPage()
  },

  async applyEntryContext(context = {}) {
    const patch = {
      activeSegment: context.segment || this.data.activeSegment,
      highlightRecordId: context.highlightId || ''
    }

    if (context.segment === 'expense') {
      if (Object.prototype.hasOwnProperty.call(context, 'rangePreset')) {
        patch.expenseRangePreset = context.rangePreset
      }

      if (Object.prototype.hasOwnProperty.call(context, 'rangeStart')) {
        patch.expenseRangeStart = context.rangeStart || ''
      }

      if (Object.prototype.hasOwnProperty.call(context, 'rangeEnd')) {
        patch.expenseRangeEnd = context.rangeEnd || ''
      }

      if (Object.prototype.hasOwnProperty.call(context, 'categoryKey')) {
        patch.expenseCategoryFilter = context.categoryKey || 'all'
      }

      if (Object.prototype.hasOwnProperty.call(context, 'ownerKey')) {
        patch.expenseOwnerFilter = context.ownerKey || 'all'
      }

      if (Object.prototype.hasOwnProperty.call(context, 'searchQuery')) {
        patch.expenseSearchQuery = context.searchQuery || ''
      }
    }

    if (context.segment === 'todo' && Object.prototype.hasOwnProperty.call(context, 'preset')) {
      patch.todoFilterPreset = context.preset || 'all'
    }

    if (context.segment === 'workout' && Object.prototype.hasOwnProperty.call(context, 'preset')) {
      patch.workoutFilterPreset = context.preset || 'week'
    }

    this.setData(patch)
    await this.refreshPage()

    if (context.openEditor) {
      this.openEditor(context.segment || this.data.activeSegment, 'create', null, context.createPrefill || {})
    }
  },

  async refreshPage() {
    this.setData({
      isLoading: true
    })

    let globalData = app.globalData || {}

    try {
      const refreshed = await refreshSessionFromCloud(app)

      if (!refreshed.ok) {
        wx.showToast({
          title: refreshed.message || '记录更新失败',
          icon: 'none'
        })
      } else {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '记录更新失败',
        icon: 'none'
      })
    }

    const pairState = resolvePairState(globalData || {})
    let records = {
      expenses: [],
      todos: [],
      anniversaries: [],
      workouts: []
    }
    let stepSummary = createEmptyStepSummary()

    if (pairState === 'paired') {
      try {
        records = await listRecordSections(globalData)
      } catch (error) {
        wx.showToast({
          title: error && error.message ? error.message : '记录加载失败',
          icon: 'none'
        })
      }

    }

    const ownerOptions = buildOwnerOptions(globalData)
    const assigneeOptions = buildAssigneeOptions(globalData)
    const expenseOwnerOptions = buildExpenseOwnerFilterOptions(globalData)
    const expenseView = buildExpenseView(records.expenses, {
      rangePreset: this.data.expenseRangePreset,
      rangeStart: this.data.expenseRangeStart,
      rangeEnd: this.data.expenseRangeEnd,
      categoryKey: this.data.expenseCategoryFilter,
      ownerKey: this.data.expenseOwnerFilter,
      searchQuery: this.data.expenseSearchQuery
    }, this.data.expenseCategories, globalData)
    const overviewStats = buildOverviewStats(records, this.data.todayDateKey)
    const todoView = buildTodoView(records.todos, this.data.todoFilterPreset, globalData, this.data.todayDateKey)
    const workoutView = buildWorkoutView(records.workouts, this.data.workoutFilterPreset, this.data.todayDateKey)

    if (pairState === 'paired' && this.data.activeSegment === 'workout') {
      const stepResult = await getStepSummary(globalData)
      if (stepResult.ok && stepResult.summary) {
        stepSummary = stepResult.summary
      }
    }

    this.setData({
      isLoading: false,
      pairState,
      records,
      ownerOptions,
      assigneeOptions,
      overviewStats,
      expenseRangeOptions: expenseView.expenseRangeOptions,
      expenseCategoryOptions: expenseView.expenseCategoryOptions,
      expenseOwnerOptions,
      expenseRangePreset: expenseView.expenseRangePreset,
      expenseRangeStart: expenseView.expenseRangeStart,
      expenseRangeEnd: expenseView.expenseRangeEnd,
      expenseCategoryFilter: expenseView.expenseCategoryFilter,
      expenseOwnerFilter: expenseView.expenseOwnerFilter,
      expenseSearchQuery: expenseView.expenseSearchQuery,
      expenseFilterHint: expenseView.expenseFilterHint,
      expenseGroups: expenseView.expenseGroups,
      expenseFilteredCount: expenseView.expenseFilteredCount,
      expenseFilteredTotal: expenseView.expenseFilteredTotal,
      expenseSectionCaption: expenseView.expenseSectionCaption,
      todoFilterOptions: todoView.todoFilterOptions,
      todoFilterPreset: todoView.todoFilterPreset,
      todoVisibleRecords: todoView.todoVisibleRecords,
      todoSectionTitle: todoView.todoSectionTitle,
      todoSectionCount: todoView.todoSectionCount,
      todoEmptyText: todoView.todoEmptyText,
      workoutFilterOptions: workoutView.workoutFilterOptions,
      workoutFilterPreset: workoutView.workoutFilterPreset,
      workoutGroups: workoutView.workoutGroups,
      workoutSectionCount: workoutView.workoutSectionCount,
      workoutSectionCaption: workoutView.workoutSectionCaption,
      workoutEmptyText: workoutView.workoutEmptyText,
      stepSummary
    })
  },

  onSegmentTap(e) {
    const nextSegment = e.currentTarget.dataset.segment

    this.setData(Object.assign({
      activeSegment: nextSegment,
      highlightRecordId: ''
    }, createEditorState()))

    if (nextSegment === 'workout') {
      this.refreshStepSummary()
    }
  },

  async refreshStepSummary(options = {}) {
    const pairState = resolvePairState(app.globalData || {})

    if (pairState !== 'paired') {
      this.setData({
        stepSummary: createEmptyStepSummary()
      })
      return {
        ok: false,
        message: '先连接共享空间'
      }
    }

    const result = await getStepSummary(app.globalData || {}, {
      requestAuth: !!options.requestAuth
    })

    if (!result.ok) {
      if (options.showToast !== false) {
        wx.showToast({
          title: result.message || '微信步数同步失败',
          icon: 'none'
        })
      }
      return result
    }

    this.setData({
      stepSummary: result.summary || createEmptyStepSummary()
    })

    return result
  },

  onGoSetupTap() {
    wx.switchTab({
      url: '/pages/profile/profile'
    })
  },

  setFormField(formKey, field, value) {
    this.setData({
      [`${formKey}.${field}`]: value
    })
  },

  openEditor(segment, mode, record = null, createPrefill = null) {
    const patch = Object.assign({
      activeSegment: segment,
      editorVisible: true,
      editorMode: mode,
      editorSegment: segment,
      editorTitle: buildEditorTitle(mode, segment),
      editingRecordId: record ? record.id : '',
      highlightRecordId: record ? record.id : this.data.highlightRecordId
    }, createEditorState())

    patch.editorVisible = true
    patch.editorMode = mode
    patch.editorSegment = segment
    patch.editorTitle = buildEditorTitle(mode, segment)
    patch.editingRecordId = record ? record.id : ''

    if (segment === 'expense') {
      patch.expenseForm = record ? buildExpenseFormFromRecord(record) : buildCreateFormWithPrefill('expense', createPrefill || {})
    } else if (segment === 'todo') {
      patch.todoForm = record ? buildTodoFormFromRecord(record) : buildCreateFormWithPrefill('todo', createPrefill || {})
    } else if (segment === 'anniversary') {
      patch.anniversaryForm = record ? buildAnniversaryFormFromRecord(record) : buildCreateFormWithPrefill('anniversary', createPrefill || {})
    } else {
      patch.workoutForm = record ? buildWorkoutFormFromRecord(record) : buildCreateFormWithPrefill('workout', createPrefill || {})
    }

    this.setData(patch)
  },

  closeEditor() {
    this.setData(createEditorState())
  },

  onAddRecordTap(e) {
    const segment = e.currentTarget.dataset.segment || this.data.activeSegment
    this.openEditor(segment, 'create')
  },

  onRecordTap(e) {
    const { segment, id } = e.currentTarget.dataset
    const record = findRecord(this.data.records, segment, id)

    if (!record) {
      return
    }

    this.openEditor(segment, 'edit', record)
  },

  onEditorMaskTap() {
    this.closeEditor()
  },

  onEditorCloseTap() {
    this.closeEditor()
  },

  onEditorPanelTap() {},

  resetSegmentForm(segment = this.data.editorSegment || this.data.activeSegment) {
    if (segment === 'expense') {
      this.setData({
        expenseForm: createExpenseForm()
      })
      return
    }

    if (segment === 'todo') {
      this.setData({
        todoForm: createTodoForm()
      })
      return
    }

    if (segment === 'anniversary') {
      this.setData({
        anniversaryForm: createAnniversaryForm()
      })
      return
    }

    this.setData({
      workoutForm: createWorkoutForm()
    })
  },

  showResult(result, successText, resetSegment) {
    if (!result.ok) {
      wx.showToast({
        title: result.message,
        icon: 'none'
      })
      return
    }

    wx.showToast({
      title: successText,
      icon: 'success'
    })

    this.resetSegmentForm(resetSegment)
    this.closeEditor()
    return this.refreshPage()
  },

  onEditorDeleteTap() {
    const segment = this.data.editorSegment
    const recordId = this.data.editingRecordId

    if (!recordId) {
      return
    }

    const confirmContent = {
      expense: '删除后这笔账单会从记录、首页和报告里一起消失。',
      todo: '删除后这条待办会从记录和首页里移除。',
      anniversary: '删除后这个纪念日会从记录、首页和报告里移除。'
      ,
      workout: '删除后这条运动记录会从记录和首页动态里移除。'
    }
    const successText = {
      expense: '账单已删除',
      todo: '待办已删除',
      anniversary: '纪念日已删除',
      workout: '运动已删除'
    }

    wx.showModal({
      title: '确认删除',
      content: confirmContent[segment] || '删除后将无法恢复。',
      confirmText: '删除',
      confirmColor: '#d1495b',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        const actionMap = {
          expense: deleteExpense,
          todo: deleteTodo,
          anniversary: deleteAnniversary,
          workout: deleteWorkout
        }
        const result = actionMap[segment] ? await actionMap[segment](app.globalData, recordId) : {
          ok: false,
          message: '暂时还不能删除这条记录'
        }

        await this.showResult(result, successText[segment] || '已删除', segment)
      }
    })
  },

  async onEditorSubmit() {
    const actionMap = {
      expense: {
        create: () => createExpense(app.globalData, this.data.expenseForm),
        update: () => updateExpense(app.globalData, this.data.editingRecordId, this.data.expenseForm),
        createText: '已记一笔',
        updateText: '账单已更新'
      },
      todo: {
        create: () => createTodo(app.globalData, this.data.todoForm),
        update: () => updateTodo(app.globalData, this.data.editingRecordId, this.data.todoForm),
        createText: '待办已添加',
        updateText: '待办已更新'
      },
      anniversary: {
        create: () => createAnniversary(app.globalData, this.data.anniversaryForm),
        update: () => updateAnniversary(app.globalData, this.data.editingRecordId, this.data.anniversaryForm),
        createText: '纪念日已添加',
        updateText: '纪念日已更新'
      },
      workout: {
        create: () => createWorkout(app.globalData, this.data.workoutForm),
        update: () => updateWorkout(app.globalData, this.data.editingRecordId, this.data.workoutForm),
        createText: '运动已记录',
        updateText: '运动已更新'
      }
    }
    const actionSet = actionMap[this.data.editorSegment]
    const mode = this.data.editorMode === 'edit' ? 'update' : 'create'

    if (!actionSet) {
      return
    }

    const result = await actionSet[mode]()
    await this.showResult(result, mode === 'update' ? actionSet.updateText : actionSet.createText, this.data.editorSegment)
  },

  onExpenseAmountInput(e) {
    this.setFormField('expenseForm', 'amount', e.detail.value)
  },

  onExpenseNoteInput(e) {
    this.setFormField('expenseForm', 'note', e.detail.value)
  },

  onExpenseCategoryTap(e) {
    this.setFormField('expenseForm', 'categoryKey', e.currentTarget.dataset.value)
  },

  onExpenseOwnerTap(e) {
    this.setFormField('expenseForm', 'ownerChoice', e.currentTarget.dataset.value)
  },

  onExpenseDateChange(e) {
    this.setFormField('expenseForm', 'occurredOn', e.detail.value)
  },

  updateExpenseFilters(nextFilters = {}) {
    const expenseView = buildExpenseView(this.data.records.expenses, {
      rangePreset: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseRangePreset')
        ? nextFilters.expenseRangePreset
        : this.data.expenseRangePreset,
      rangeStart: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseRangeStart')
        ? nextFilters.expenseRangeStart
        : this.data.expenseRangeStart,
      rangeEnd: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseRangeEnd')
        ? nextFilters.expenseRangeEnd
        : this.data.expenseRangeEnd,
      categoryKey: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseCategoryFilter')
        ? nextFilters.expenseCategoryFilter
        : this.data.expenseCategoryFilter,
      ownerKey: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseOwnerFilter')
        ? nextFilters.expenseOwnerFilter
        : this.data.expenseOwnerFilter,
      searchQuery: Object.prototype.hasOwnProperty.call(nextFilters, 'expenseSearchQuery')
        ? nextFilters.expenseSearchQuery
        : this.data.expenseSearchQuery
    }, this.data.expenseCategories)

    this.setData({
      expenseRangeOptions: expenseView.expenseRangeOptions,
      expenseCategoryOptions: expenseView.expenseCategoryOptions,
      expenseOwnerOptions: expenseView.expenseOwnerOptions,
      expenseRangePreset: expenseView.expenseRangePreset,
      expenseRangeStart: expenseView.expenseRangeStart,
      expenseRangeEnd: expenseView.expenseRangeEnd,
      expenseCategoryFilter: expenseView.expenseCategoryFilter,
      expenseOwnerFilter: expenseView.expenseOwnerFilter,
      expenseSearchQuery: expenseView.expenseSearchQuery,
      expenseFilterHint: expenseView.expenseFilterHint,
      expenseGroups: expenseView.expenseGroups,
      expenseFilteredCount: expenseView.expenseFilteredCount,
      expenseFilteredTotal: expenseView.expenseFilteredTotal,
      expenseSectionCaption: expenseView.expenseSectionCaption,
      highlightRecordId: Object.prototype.hasOwnProperty.call(nextFilters, 'highlightRecordId')
        ? nextFilters.highlightRecordId
        : this.data.highlightRecordId
    })
  },

  onExpenseRangePresetTap(e) {
    this.updateExpenseFilters({
      expenseRangePreset: e.currentTarget.dataset.value,
      highlightRecordId: ''
    })
  },

  onExpenseRangeStartChange(e) {
    this.updateExpenseFilters({
      expenseRangePreset: 'custom',
      expenseRangeStart: e.detail.value,
      highlightRecordId: ''
    })
  },

  onExpenseRangeEndChange(e) {
    this.updateExpenseFilters({
      expenseRangePreset: 'custom',
      expenseRangeEnd: e.detail.value,
      highlightRecordId: ''
    })
  },

  onExpenseCategoryFilterTap(e) {
    this.updateExpenseFilters({
      expenseCategoryFilter: e.currentTarget.dataset.value,
      highlightRecordId: ''
    })
  },

  onExpenseOwnerFilterTap(e) {
    this.updateExpenseFilters({
      expenseOwnerFilter: e.currentTarget.dataset.value,
      highlightRecordId: ''
    })
  },

  onExpenseSearchInput(e) {
    this.updateExpenseFilters({
      expenseSearchQuery: e.detail.value,
      highlightRecordId: ''
    })
  },

  onExpenseSearchClearTap() {
    this.updateExpenseFilters({
      expenseSearchQuery: '',
      highlightRecordId: ''
    })
  },

  onTodoFilterTap(e) {
    const preset = e.currentTarget.dataset.value || 'all'
    const todoView = buildTodoView(this.data.records.todos, preset, app.globalData, this.data.todayDateKey)

    this.setData({
      todoFilterPreset: todoView.todoFilterPreset,
      todoVisibleRecords: todoView.todoVisibleRecords,
      todoSectionTitle: todoView.todoSectionTitle,
      todoSectionCount: todoView.todoSectionCount,
      todoEmptyText: todoView.todoEmptyText,
      highlightRecordId: ''
    })
  },

  onWorkoutFilterTap(e) {
    const preset = e.currentTarget.dataset.value || 'week'
    const workoutView = buildWorkoutView(this.data.records.workouts, preset, this.data.todayDateKey)

    this.setData({
      workoutFilterPreset: workoutView.workoutFilterPreset,
      workoutGroups: workoutView.workoutGroups,
      workoutSectionCount: workoutView.workoutSectionCount,
      workoutSectionCaption: workoutView.workoutSectionCaption,
      workoutEmptyText: workoutView.workoutEmptyText,
      highlightRecordId: ''
    })
  },

  async onWorkoutStepSyncTap() {
    const result = await this.refreshStepSummary({
      requestAuth: true
    })

    if (!result.ok) {
      return
    }

    wx.showToast({
      title: result.summary && result.summary.authorizationState === 'authorized' ? '步数已同步' : '还没有开启微信运动',
      icon: result.summary && result.summary.authorizationState === 'authorized' ? 'success' : 'none'
    })
  },

  onTodoTitleInput(e) {
    this.setFormField('todoForm', 'title', e.detail.value)
  },

  onTodoNoteInput(e) {
    this.setFormField('todoForm', 'note', e.detail.value)
  },

  onTodoAssigneeTap(e) {
    this.setFormField('todoForm', 'assigneeChoice', e.currentTarget.dataset.value)
  },

  onTodoDateChange(e) {
    this.setFormField('todoForm', 'dueAt', e.detail.value)
  },

  onTodoClearDueTap() {
    this.setFormField('todoForm', 'dueAt', '')
  },

  onAnniversaryTitleInput(e) {
    this.setFormField('anniversaryForm', 'title', e.detail.value)
  },

  onAnniversaryTypeTap(e) {
    const { value } = e.currentTarget.dataset

    this.setData({
      anniversaryForm: Object.assign({}, this.data.anniversaryForm, {
        kind: value,
        title: value === 'relationship' ? '在一起' : ''
      })
    })
  },

  onAnniversaryPresetTap(e) {
    this.setFormField('anniversaryForm', 'title', e.currentTarget.dataset.value)
  },

  onAnniversaryNoteInput(e) {
    this.setFormField('anniversaryForm', 'note', e.detail.value)
  },

  onAnniversaryPrepTodoInput(e) {
    this.setFormField('anniversaryForm', 'prepTodoTitle', e.detail.value)
  },

  onAnniversaryDateChange(e) {
    this.setFormField('anniversaryForm', 'date', e.detail.value)
  },

  onWorkoutTypeTap(e) {
    this.setFormField('workoutForm', 'typeKey', e.currentTarget.dataset.value)
  },

  onWorkoutDurationInput(e) {
    this.setFormField('workoutForm', 'durationMinutes', e.detail.value)
  },

  onWorkoutDateChange(e) {
    this.setFormField('workoutForm', 'occurredOn', e.detail.value)
  },

  onWorkoutNoteInput(e) {
    this.setFormField('workoutForm', 'note', e.detail.value)
  },

  async onToggleTodo(e) {
    const { id } = e.currentTarget.dataset
    const result = await toggleTodoStatus(app.globalData, id)

    if (result && result.ok === false) {
      wx.showToast({
        title: result.message || '待办状态更新失败',
        icon: 'none'
      })
      return
    }

    await this.refreshPage()
  }
})

const app = getApp()
const { getExpenseCategories } = require('../../services/records')
const { getReportDetail, getReportsView } = require('../../services/reports')
const { consumeReportsEntryContext } = require('../../utils/reports-entry')
const { refreshSessionFromCloud } = require('../../services/session')
const { openRecordsWithContext } = require('../../utils/records-entry')
const { resolvePairState } = require('../../utils/pair-state')

const CATEGORY_LABEL_MAP = getExpenseCategories().reduce((result, item) => {
  result[item.label] = item.key
  return result
}, {})

function getRangePresetForType(activeType) {
  return activeType === 'monthly' ? 'month' : '7d'
}

function getVisualItemKey(item = {}) {
  return item.key || item.name || ''
}

function buildVisualState(report, visualMode, selectedKey) {
  if (!report) {
    return {
      visualMode,
      visualItems: [],
      visualStyle: '',
      selectedVisualKey: '',
      selectedVisualTitle: '',
      selectedVisualValue: '',
      selectedVisualMeta: '',
      selectedVisualColor: ''
    }
  }

  const visualItems = visualMode === 'owner' ? report.ownerBreakdown : report.categoryBreakdown
  const visualStyle = visualMode === 'owner' ? report.ownerVisual.style : report.categoryVisual.style
  const selectedItem = visualItems.find((item) => getVisualItemKey(item) === selectedKey) || null

  if (!selectedItem) {
    return {
      visualMode,
      visualItems,
      visualStyle,
      selectedVisualKey: '',
      selectedVisualTitle: report.totalDisplay,
      selectedVisualValue: visualMode === 'owner' ? '归属分布' : '总支出',
      selectedVisualMeta: visualMode === 'owner' ? '点下面的归属查看占比' : '点下面的分类查看占比',
      selectedVisualColor: ''
    }
  }

  return {
    visualMode,
    visualItems,
    visualStyle,
    selectedVisualKey: getVisualItemKey(selectedItem),
    selectedVisualTitle: selectedItem.amountLabel,
    selectedVisualValue: selectedItem.name,
    selectedVisualMeta: selectedItem.value,
    selectedVisualColor: selectedItem.color
  }
}

Page({
  data: {
    isLoading: true,
    pairState: 'guest',
    activeType: 'weekly',
    requestedPeriodStart: '',
    requestedPeriodType: '',
    visualMode: 'category',
    visualItems: [],
    visualStyle: '',
    selectedVisualKey: '',
    selectedVisualTitle: '',
    selectedVisualValue: '',
    selectedVisualMeta: '',
    selectedVisualColor: '',
    currentReport: null,
    reports: {
      weekly: null,
      monthly: null
    }
  },

  onLoad(options = {}) {
    wx.setNavigationBarTitle({
      title: '报告'
    })

    if (options.periodStart) {
      this.setData({
        activeType: options.periodType === 'monthly' ? 'monthly' : 'weekly',
        requestedPeriodType: options.periodType === 'monthly' ? 'monthly' : 'weekly',
        requestedPeriodStart: options.periodStart
      })
    }
  },

  async onShow() {
    const entryContext = consumeReportsEntryContext()
    const nextType = wx.getStorageSync('reportsDefaultType')
    const activeType = (entryContext && entryContext.periodType) || nextType || this.data.activeType
    const requestedPeriodStart = entryContext && entryContext.periodStart
      ? entryContext.periodStart
      : this.data.requestedPeriodStart
    const requestedPeriodType = entryContext && entryContext.periodType
      ? entryContext.periodType
      : this.data.requestedPeriodType

    if (nextType) {
      wx.removeStorageSync('reportsDefaultType')
    }

    this.setData({
      activeType,
      requestedPeriodStart,
      requestedPeriodType
    })

    await this.refreshPage(activeType)
  },

  async refreshPage(activeType = this.data.activeType) {
    this.setData({
      isLoading: true
    })

    let globalData = app.globalData || {}

    try {
      const refreshed = await refreshSessionFromCloud(app)

      if (!refreshed.ok) {
        wx.showToast({
          title: refreshed.message || '报告更新失败',
          icon: 'none'
        })
      } else {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '报告更新失败',
        icon: 'none'
      })
    }

    const pairState = resolvePairState(globalData || {})
    let reports = {
      weekly: null,
      monthly: null
    }

    if (pairState === 'paired') {
      try {
        reports = await getReportsView(globalData)
      } catch (error) {
        wx.showToast({
          title: error && error.message ? error.message : '报告加载失败',
          icon: 'none'
        })
      }
    }

    let currentReport = reports[activeType]

    if (
      pairState === 'paired' &&
      this.data.requestedPeriodStart &&
      this.data.requestedPeriodType === activeType
    ) {
      try {
        currentReport = await getReportDetail(globalData, activeType, this.data.requestedPeriodStart)
      } catch (error) {
        wx.showToast({
          title: error && error.message ? error.message : '指定报告加载失败',
          icon: 'none'
        })
      }
    }

    const visualState = buildVisualState(currentReport, this.data.visualMode, '')

    this.setData({
      isLoading: false,
      pairState,
      activeType,
      reports,
      currentReport,
      visualMode: visualState.visualMode,
      visualItems: visualState.visualItems,
      visualStyle: visualState.visualStyle,
      selectedVisualKey: visualState.selectedVisualKey,
      selectedVisualTitle: visualState.selectedVisualTitle,
      selectedVisualValue: visualState.selectedVisualValue,
      selectedVisualMeta: visualState.selectedVisualMeta,
      selectedVisualColor: visualState.selectedVisualColor
    })
  },

  onTypeTap(e) {
    const activeType = e.currentTarget.dataset.type
    const currentReport = this.data.reports[activeType]
    const visualState = buildVisualState(currentReport, this.data.visualMode, '')

    this.setData({
      activeType,
      currentReport,
      visualItems: visualState.visualItems,
      visualStyle: visualState.visualStyle,
      selectedVisualKey: visualState.selectedVisualKey,
      selectedVisualTitle: visualState.selectedVisualTitle,
      selectedVisualValue: visualState.selectedVisualValue,
      selectedVisualMeta: visualState.selectedVisualMeta,
      selectedVisualColor: visualState.selectedVisualColor
    })
  },

  onVisualModeTap(e) {
    const visualMode = e.currentTarget.dataset.mode
    const visualState = buildVisualState(this.data.currentReport, visualMode, '')

    this.setData({
      visualMode,
      visualItems: visualState.visualItems,
      visualStyle: visualState.visualStyle,
      selectedVisualKey: visualState.selectedVisualKey,
      selectedVisualTitle: visualState.selectedVisualTitle,
      selectedVisualValue: visualState.selectedVisualValue,
      selectedVisualMeta: visualState.selectedVisualMeta,
      selectedVisualColor: visualState.selectedVisualColor
    })
  },

  onVisualItemTap(e) {
    const selectedKey = e.currentTarget.dataset.key || e.currentTarget.dataset.name

    if (selectedKey === this.data.selectedVisualKey) {
      const context = {
        rangePreset: getRangePresetForType(this.data.activeType)
      }

      if (this.data.visualMode === 'category') {
        context.categoryKey = CATEGORY_LABEL_MAP[e.currentTarget.dataset.name] || selectedKey || 'all'
      } else {
        context.ownerKey = selectedKey
      }

      this.openRecords('expense', context)
      return
    }

    const nextKey = selectedKey === this.data.selectedVisualKey ? '' : selectedKey
    const visualState = buildVisualState(this.data.currentReport, this.data.visualMode, nextKey)

    this.setData({
      visualItems: visualState.visualItems,
      visualStyle: visualState.visualStyle,
      selectedVisualKey: visualState.selectedVisualKey,
      selectedVisualTitle: visualState.selectedVisualTitle,
      selectedVisualValue: visualState.selectedVisualValue,
      selectedVisualMeta: visualState.selectedVisualMeta,
      selectedVisualColor: visualState.selectedVisualColor
    })
  },

  openRecords(segment, extra = {}) {
    openRecordsWithContext(Object.assign({
      segment
    }, extra))
  },

  onVisualDetailTap() {
    const context = {
      rangePreset: getRangePresetForType(this.data.activeType)
    }

    if (this.data.visualMode === 'category' && this.data.selectedVisualKey) {
      context.categoryKey = CATEGORY_LABEL_MAP[this.data.selectedVisualValue] || this.data.selectedVisualKey || 'all'
    }

    if (this.data.visualMode === 'owner' && this.data.selectedVisualKey) {
      context.ownerKey = this.data.selectedVisualKey
    }

    this.openRecords('expense', context)
  },

  onBudgetTap() {
    wx.navigateTo({
      url: '/pages/budget/budget'
    })
  },

  onBudgetCategoryTap(e) {
    const { key } = e.currentTarget.dataset

    this.openRecords('expense', {
      rangePreset: 'month',
      categoryKey: key || 'all'
    })
  },

  onWorkoutTap() {
    this.openRecords('workout', {
      preset: this.data.activeType === 'monthly' ? 'month' : 'week'
    })
  },

  onMissionSummaryTap() {
    const missionSummary = this.data.currentReport && this.data.currentReport.missionSummary

    if (!missionSummary) {
      return
    }

    if (missionSummary.actionTarget === 'budget') {
      this.onBudgetTap()
      return
    }

    if (missionSummary.actionTarget === 'workout') {
      this.onWorkoutTap()
      return
    }

    if (missionSummary.actionTarget === 'goals') {
      wx.navigateTo({
        url: '/pages/goals/goals'
      })
      return
    }

    this.openRecords(missionSummary.actionTarget || 'todo')
  },

  onChangeCardTap(e) {
    const categoryName = e.currentTarget.dataset.name

    this.openRecords('expense', {
      rangePreset: getRangePresetForType(this.data.activeType),
      categoryKey: CATEGORY_LABEL_MAP[categoryName] || 'all'
    })
  },

  onAlertTap(e) {
    const kind = e.currentTarget.dataset.kind || ''
    const title = e.currentTarget.dataset.title || ''
    const categoryMatch = title.match(/^(.+)\s+上升得最快$/)

    if (kind === 'budget_planning' || title.indexOf('待办') >= 0) {
      this.openRecords('todo')
      return
    }

    if (title.indexOf('纪念日') >= 0) {
      this.openRecords('anniversary')
      return
    }

    this.openRecords('expense', {
      rangePreset: getRangePresetForType(this.data.activeType),
      categoryKey: categoryMatch ? (CATEGORY_LABEL_MAP[categoryMatch[1]] || 'all') : 'all'
    })
  },

  onSignalTap(e) {
    const segment = e.currentTarget.dataset.segment
    this.openRecords(segment || 'todo')
  },

  onGoSetupTap() {
    wx.switchTab({
      url: '/pages/profile/profile'
    })
  }
})

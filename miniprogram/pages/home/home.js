const app = getApp()
const { buildDashboard } = require('../../services/dashboard')
const { getGoalsTemplates, upsertGoal } = require('../../services/goals')
const { getStepSummary } = require('../../services/steps')
const { loginUser, refreshSessionFromCloud } = require('../../services/session')
const { openRecordsWithContext } = require('../../utils/records-entry')
const { resolvePairState } = require('../../utils/pair-state')
const { formatTodayLabel } = require('../../utils/date')

const SUGGESTION_DISMISS_KEY = 'homeSuggestionDismissed:'

function createGoalComposerForm() {
  return {
    templateKey: '',
    targetValue: '',
    customTitle: '',
    categoryKey: '',
    wagerEnabled: false,
    wagerAmount: '',
    wagerLabel: '',
    source: 'manual',
    suggestionKind: ''
  }
}

function getGoalTemplateByKey(key = '') {
  const templates = getGoalsTemplates()
  return templates.monthlyGoals.concat(templates.weeklyChallenges).find((item) => item.key === key) || null
}

function getGoalTemplateCapability(templateKey = '', overview = null) {
  const capabilities = (overview && overview.capabilities) || {}

  if (templateKey === 'budget_duel' && !capabilities.budgetDuelReady) {
    return {
      disabled: true,
      hint: '先给两个人都设置预算，才能开始预算对决。'
    }
  }

  if ((templateKey === 'steps_duel' || templateKey === 'steps_together') && !capabilities.stepsTogetherReady) {
    return {
      disabled: true,
      hint: templateKey === 'steps_duel'
        ? '先让两个人都同步微信步数，才能开始步数 PK。'
        : '先让两个人都同步微信步数，才能一起设步数目标。'
    }
  }

  return {
    disabled: false,
    hint: ''
  }
}

function decorateGoalTemplateGroups(groups = [], overview = null) {
  return groups.map((group) => Object.assign({}, group, {
    templates: (group.templates || []).map((item) => {
      const capability = getGoalTemplateCapability(item.key, overview)
      return Object.assign({}, item, capability)
    })
  }))
}

function buildGoalComposerForm(context = {}) {
  return Object.assign({}, createGoalComposerForm(), {
    templateKey: context.templateKey || '',
    targetValue: typeof context.targetValue === 'undefined' || context.targetValue === null ? '' : String(context.targetValue),
    customTitle: context.customTitle || '',
    categoryKey: context.categoryKey || '',
    wagerEnabled: !!context.wagerEnabled,
    wagerAmount: typeof context.wagerAmount === 'undefined' || context.wagerAmount === null ? '' : String(context.wagerAmount),
    wagerLabel: context.wagerLabel || '',
    source: context.source || 'manual',
    suggestionKind: context.suggestionKind || ''
  })
}

function createEmptyDashboard() {
  return {
    financeHero: {
      label: '生活账本',
      weeklySpendDisplay: '￥0',
      weeklyDeltaDisplay: '首个周期',
      weeklyDetail: '开始记录后，这里会自动对比',
      focusText: '继续记录，这里会显示主要花费',
      budgetRemainingDisplay: '去设置预算',
      budgetProgressWidth: 12,
      budgetFocusText: '设置好预算后，这里会开始显示本月余量',
      budgetActionLabel: '去设置预算',
      hasBudget: false,
      budgetTone: 'setup',
      trend: [],
      categories: [],
      members: []
    },
    spendCard: {
      totalDisplay: '￥0',
      deltaDisplay: '首个周期',
      detail: '开始记录后，这里会自动对比',
      focusText: '继续记录，这里会显示主要花费'
    },
    spendChart: {
      trend: [],
      categories: []
    },
    todoCard: {
      label: '待办进度',
      completedCount: 0,
      openCount: 0,
      detail: '0 个已超时，0 个 24 小时内到期',
      planningPrompt: {
        visible: false,
        title: '',
        detail: '',
        tone: 'calm'
      }
    },
    budgetCard: {
      label: '本月预算',
      hasBudget: false,
      spentDisplay: '￥0',
      totalDisplay: '未设置',
      balanceLabel: '去设置预算',
      focusText: '设置好预算后，这里会开始显示本月余量',
      progressWidth: 12,
      categories: []
    },
    goalCard: null,
    goalEntryCard: {
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
    },
    suggestionCard: null,
    goalsOverview: null,
    anniversaryCard: {
      label: '最近纪念日',
      title: '还没有纪念日',
      dateLabel: '去记录里添加',
      daysLeftLabel: '--',
      prepTodo: '先建立一个重要日子'
    },
    workoutCard: {
      label: '本周运动',
      totalCount: 0,
      totalDurationLabel: '0 分钟',
      detail: '两个人的运动会显示在这里',
      focusText: '这周还没有运动记录'
    },
    stepCard: {
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
      detailText: '先开启微信运动权限'
    },
    activationChecklist: {
      requiredCompletedCount: 0,
      requiredTotalCount: 4,
      optionalCompletedCount: 0,
      remainingRequiredCount: 4,
      allRequiredCompleted: false,
      items: []
    },
    ritualCard: null,
    activityFeed: []
  }
}

Page({
  data: {
    isLoading: true,
    userInfo: null,
    coupleInfo: null,
    partnerInfo: null,
    pairState: 'guest',
    todayLabel: '',
    inviteCodeDisplay: '待生成',
    dashboard: null,
    goalComposerVisible: false,
    goalComposerSlot: 'monthly_goal',
    goalComposerTitle: '',
    goalComposerSubtitle: '',
    goalComposerGroups: [],
    goalComposerCategoryOptions: [],
    goalComposerForm: createGoalComposerForm(),
    goalComposerSelectedTemplate: null
  },

  onLoad() {
  },

  onShow() {
    this.refreshPage()
  },

  async onPullDownRefresh() {
    await this.refreshPage({
      forceSessionRefresh: true
    })
    wx.stopPullDownRefresh()
  },

  async refreshPage(options = {}) {
    this.setData({
      isLoading: true
    })

    let globalData = app.globalData || {}

    try {
      const refreshed = await refreshSessionFromCloud(app, {
        force: !!options.forceSessionRefresh
      })

      if (!refreshed.ok) {
        wx.showToast({
          title: refreshed.message || '首页更新失败',
          icon: 'none'
        })
      } else {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '首页更新失败',
        icon: 'none'
      })
    }

    const pairState = resolvePairState(globalData)
    let dashboard = null

    if (pairState === 'paired') {
      try {
        dashboard = await buildDashboard(globalData)
      } catch (error) {
        wx.showToast({
          title: error && error.message ? error.message : '首页加载失败',
          icon: 'none'
        })
      }

      dashboard = dashboard || createEmptyDashboard()

      if (dashboard.suggestionCard && this.isSuggestionDismissed(dashboard.suggestionCard)) {
        dashboard.suggestionCard = Object.assign({}, dashboard.suggestionCard, {
          visible: false
        })
      }
    }

    this.setData({
      isLoading: false,
      userInfo: globalData.userInfo || null,
      coupleInfo: globalData.coupleInfo || null,
      partnerInfo: globalData.partnerInfo || null,
      pairState,
      todayLabel: formatTodayLabel(),
      inviteCodeDisplay: globalData.coupleInfo && globalData.coupleInfo.inviteCode ? globalData.coupleInfo.inviteCode : '待生成',
      dashboard
    })
  },

  onLoginTap() {
    if (!wx.getUserProfile) {
      wx.showToast({
        title: '当前微信版本不支持获取资料',
        icon: 'none'
      })
      return
    }

    wx.getUserProfile({
      desc: '用于建立共享生活空间',
      success: async (res) => {
        const result = await loginUser(app, res.userInfo)

        if (!result.ok) {
          wx.showToast({
            title: result.message || '登录失败',
            icon: 'none'
          })
          return
        }

        wx.showToast({
          title: '登录成功',
          icon: 'success'
        })

        await this.refreshPage()
      }
    })
  },

  onGoSetupTap() {
    wx.switchTab({
      url: '/pages/profile/profile'
    })
  },

  goToSummaryTarget(target, context = {}) {
    if (target === 'profile') {
      wx.switchTab({
        url: '/pages/profile/profile'
      })
      return
    }

    if (target === 'budget') {
      wx.navigateTo({
        url: '/pages/budget/budget'
      })
      return
    }

    if (target === 'goals') {
      wx.navigateTo({
        url: '/pages/goals/goals'
      })
      return
    }

    if (target === 'report') {
      wx.setStorageSync('reportsDefaultType', context.periodType || 'weekly')
      wx.switchTab({
        url: '/pages/reports/reports'
      })
      return
    }

    openRecordsWithContext(Object.assign({
      segment: target || 'expense'
    }, context))
  },

  onSummaryTap(e) {
    const { target } = e.currentTarget.dataset
    const context = target === 'expense'
      ? { rangePreset: '7d' }
      : {}
    this.goToSummaryTarget(target, context)
  },

  onActivityTap(e) {
    const { type, targetId } = e.currentTarget.dataset

    if (type === 'report_generated') {
      this.goToSummaryTarget('report')
      return
    }

    const segmentMap = {
      expense_created: 'expense',
      todo_created: 'todo',
      todo_completed: 'todo',
      anniversary_created: 'anniversary',
      workout_created: 'workout'
    }

    this.goToSummaryTarget(segmentMap[type] || 'expense', {
      highlightId: targetId || ''
    })
  },

  onWorkoutTap() {
    this.goToSummaryTarget('workout')
  },

  onFinanceHeroTap(e) {
    const { target } = e.currentTarget.dataset
    const context = target === 'expense'
      ? { rangePreset: '7d' }
      : {}
    this.goToSummaryTarget(target || 'expense', context)
  },

  onGoalTap() {
    wx.navigateTo({
      url: '/pages/goals/goals'
    })
  },

  onGoalEntryTap(e) {
    const type = e.currentTarget.dataset.type || 'monthly'
    const dashboard = this.data.dashboard || {}
    const entryCard = dashboard.goalEntryCard || null
    const context = type === 'weekly'
      ? ((entryCard && entryCard.secondaryContext) || { slot: 'weekly_challenge' })
      : ((entryCard && entryCard.primaryContext) || { slot: 'monthly_goal' })

    this.openGoalComposer(context)
  },

  getDismissKey(suggestionCard = {}) {
    const coupleId = this.data.coupleInfo && this.data.coupleInfo.id ? this.data.coupleInfo.id : ''
    return coupleId && suggestionCard.dismissKey ? `${SUGGESTION_DISMISS_KEY}${coupleId}:${suggestionCard.dismissKey}` : ''
  },

  isSuggestionDismissed(suggestionCard = {}) {
    const key = this.getDismissKey(suggestionCard)
    return key ? !!wx.getStorageSync(key) : false
  },

  onSuggestionAcceptTap() {
    const dashboard = this.data.dashboard || {}
    const suggestionCard = dashboard.suggestionCard || null

    if (!suggestionCard || this.isSuggestionDismissed(suggestionCard)) {
      return
    }

    if (suggestionCard.acceptMode === 'goal_prefill' && suggestionCard.prefill) {
      this.openGoalComposer(Object.assign({}, suggestionCard.prefill, {
        fromSuggestion: true
      }))
      return
    }

    this.goToSummaryTarget(suggestionCard.actionTarget || 'todo')
  },

  onSuggestionDismissTap() {
    const dashboard = this.data.dashboard || {}
    const suggestionCard = dashboard.suggestionCard || null
    const key = this.getDismissKey(suggestionCard)

    if (!suggestionCard || !key) {
      return
    }

    wx.setStorageSync(key, true)
    this.setData({
      'dashboard.suggestionCard': Object.assign({}, suggestionCard, {
        visible: false
      })
    })
  },

  onActivationItemTap(e) {
    const { key } = e.currentTarget.dataset
    const items = (((this.data.dashboard || {}).activationChecklist || {}).items) || []
    const targetItem = items.find((item) => item.key === key)

    if (!targetItem) {
      return
    }

    this.goToSummaryTarget(targetItem.target, {
      openEditor: !!targetItem.openEditor,
      createPrefill: targetItem.createPrefill || {}
    })
  },

  onRitualTap() {
    const ritualCard = this.data.dashboard && this.data.dashboard.ritualCard

    if (!ritualCard) {
      return
    }

    if (ritualCard.mode === 'review') {
      this.goToSummaryTarget('report', {
        periodType: ritualCard.periodType || 'weekly'
      })
      return
    }

    if (ritualCard.mode === 'recovery') {
      this.goToSummaryTarget(ritualCard.target || 'expense', {
        openEditor: true,
        createPrefill: {
          ownerChoice: 'shared'
        }
      })
    }
  },

  openGoalComposer(context = {}) {
    const dashboard = this.data.dashboard || {}
    const goalsOverview = dashboard.goalsOverview || null
    const slot = context.slot === 'weekly_challenge' ? 'weekly_challenge' : 'monthly_goal'
    const templates = getGoalsTemplates()
    const groups = slot === 'weekly_challenge'
      ? decorateGoalTemplateGroups(templates.weeklyGroups || [], goalsOverview)
      : decorateGoalTemplateGroups(templates.monthlyGroups || [], goalsOverview)
    const form = buildGoalComposerForm(context)
    const selectedTemplate = form.templateKey ? getGoalTemplateByKey(form.templateKey) : null

    this.setData({
      goalComposerVisible: true,
      goalComposerSlot: slot,
      goalComposerTitle: slot === 'weekly_challenge' ? '开始本周挑战' : '设一个共同目标',
      goalComposerSubtitle: slot === 'weekly_challenge'
        ? '先选一个推进事情、生活节奏或轻竞赛模板。'
        : '先选一个省钱或预算类模板，再决定标题和目标值。',
      goalComposerGroups: groups,
      goalComposerCategoryOptions: templates.categoryOptions || [],
      goalComposerForm: form,
      goalComposerSelectedTemplate: selectedTemplate
    })
  },

  closeGoalComposer() {
    this.setData({
      goalComposerVisible: false,
      goalComposerForm: createGoalComposerForm(),
      goalComposerSelectedTemplate: null
    })
  },

  onGoalComposerMaskTap() {
    this.closeGoalComposer()
  },

  onGoalComposerPanelTap() {},

  onGoalComposerTemplateTap(e) {
    const { key } = e.currentTarget.dataset
    const capability = getGoalTemplateCapability(key, (this.data.dashboard || {}).goalsOverview || null)

    if (capability.disabled) {
      wx.showToast({
        title: capability.hint || '当前还不能开启',
        icon: 'none'
      })
      return
    }

    const template = getGoalTemplateByKey(key)
    const form = this.data.goalComposerForm || createGoalComposerForm()

    this.setData({
      goalComposerForm: Object.assign({}, createGoalComposerForm(), {
        templateKey: key || '',
        source: form.source || 'manual',
        suggestionKind: form.suggestionKind || ''
      }),
      goalComposerSelectedTemplate: template || null
    })
  },

  onGoalComposerInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({
      [`goalComposerForm.${field}`]: e.detail.value
    })
  },

  onGoalComposerCategoryTap(e) {
    const { key } = e.currentTarget.dataset
    this.setData({
      'goalComposerForm.categoryKey': key || ''
    })
  },

  onGoalComposerWagerToggle(e) {
    this.setData({
      'goalComposerForm.wagerEnabled': !!e.detail.value
    })
  },

  async onGoalComposerSave() {
    const form = this.data.goalComposerForm || {}

    if (!form.templateKey) {
      wx.showToast({
        title: '先选一个模板',
        icon: 'none'
      })
      return
    }

    const result = await upsertGoal(app.globalData || {}, {
      templateKey: form.templateKey,
      targetValue: form.targetValue,
      customTitle: form.customTitle,
      categoryKey: form.categoryKey,
      source: form.source,
      suggestionKind: form.suggestionKind,
      wagerEnabled: !!form.wagerEnabled,
      wagerAmount: form.wagerAmount,
      wagerLabel: form.wagerLabel
    })

    if (!result.ok) {
      wx.showToast({
        title: result.message || '保存目标失败',
        icon: 'none'
      })
      return
    }

    if (form.source === 'suggested') {
      const suggestionCard = ((this.data.dashboard || {}).suggestionCard) || null
      const dismissKey = this.getDismissKey(suggestionCard)
      if (dismissKey) {
        wx.setStorageSync(dismissKey, true)
      }
    }

    wx.showToast({
      title: '目标已保存',
      icon: 'success'
    })

    this.closeGoalComposer()
    await this.refreshPage()
  },

  async onStepSyncTap(e) {
    if (e && typeof e.stopPropagation === 'function') {
      e.stopPropagation()
    }

    const result = await getStepSummary(app.globalData || {}, {
      requestAuth: true
    })

    if (!result.ok) {
      wx.showToast({
        title: result.message || '步数同步失败',
        icon: 'none'
      })
      return
    }

    wx.showToast({
      title: result.summary && result.summary.authorizationState === 'authorized' ? '步数已同步' : '还没有开启微信运动',
      icon: result.summary && result.summary.authorizationState === 'authorized' ? 'success' : 'none'
    })

    await this.refreshPage()
  }
})

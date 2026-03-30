const app = getApp()
const { getGoalsOverview, getGoalsTemplates, upsertGoal, archiveGoal, settleWager } = require('../../services/goals')
const { refreshSessionFromCloud } = require('../../services/session')
const { consumeGoalsEntryContext } = require('../../utils/goals-entry')
const { resolvePairState } = require('../../utils/pair-state')
const { openRecordsWithContext } = require('../../utils/records-entry')

function createGoalForm() {
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

function getCapabilityState(templateKey = '', overview = null) {
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

function decorateGroups(groups = [], overview = null) {
  return groups.map((group) => Object.assign({}, group, {
    templates: (group.templates || []).map((item) => {
      const capability = getCapabilityState(item.key, overview)
      return Object.assign({}, item, capability)
    })
  }))
}

function buildFormFromContext(context = {}) {
  return Object.assign({}, createGoalForm(), {
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

Page({
  data: {
    isLoading: true,
    pairState: 'guest',
    overview: null,
    categoryOptions: [],
    monthlyGroups: [],
    weeklyGroups: [],
    monthlyForm: createGoalForm(),
    weeklyForm: createGoalForm()
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '目标'
    })
  },

  onShow() {
    this.refreshPage()
  },

  async refreshPage() {
    this.setData({
      isLoading: true
    })

    let globalData = app.globalData || {}

    try {
      const refreshed = await refreshSessionFromCloud(app)
      if (refreshed.ok) {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      // ignore
    }

    const pairState = resolvePairState(globalData)
    let overview = null

    if (pairState === 'paired') {
      try {
        const result = await getGoalsOverview(globalData)
        if (result.ok) {
          overview = result.overview || null
        } else {
          wx.showToast({
            title: result.message || '目标加载失败',
            icon: 'none'
          })
        }
      } catch (error) {
        wx.showToast({
          title: error && error.message ? error.message : '目标加载失败',
          icon: 'none'
        })
      }
    }

    const templates = getGoalsTemplates()
    const monthlyGroups = decorateGroups(templates.monthlyGroups, overview)
    const weeklyGroups = decorateGroups(templates.weeklyGroups, overview)
    const entryContext = consumeGoalsEntryContext()
    const nextState = {
      isLoading: false,
      pairState,
      overview,
      categoryOptions: templates.categoryOptions || [],
      monthlyGroups,
      weeklyGroups
    }

    if (entryContext && entryContext.slot) {
      const formKey = entryContext.slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm'
      nextState[formKey] = buildFormFromContext(entryContext)
    }

    this.setData(nextState)
  },

  onGoSetupTap() {
    wx.switchTab({
      url: '/pages/profile/profile'
    })
  },

  onTemplateTap(e) {
    const { slot, key } = e.currentTarget.dataset
    const template = getGoalTemplateByKey(key)

    if (!template) {
      return
    }

    const capability = getCapabilityState(key, this.data.overview)
    if (capability.disabled) {
      wx.showToast({
        title: capability.hint || '当前还不能开启',
        icon: 'none'
      })
      return
    }

    const formKey = slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm'

    this.setData({
      [formKey]: Object.assign({}, createGoalForm(), {
        templateKey: key
      })
    })
  },

  onFormInput(e) {
    const { slot, field } = e.currentTarget.dataset
    const value = e.detail.value
    const formKey = slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm'
    this.setData({
      [`${formKey}.${field}`]: value
    })
  },

  onCategoryTap(e) {
    const { slot, key } = e.currentTarget.dataset
    const formKey = slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm'
    this.setData({
      [`${formKey}.categoryKey`]: key || ''
    })
  },

  onWagerToggle(e) {
    const { slot } = e.currentTarget.dataset
    const formKey = slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm'
    this.setData({
      [`${formKey}.wagerEnabled`]: !!e.detail.value
    })
  },

  async onSaveGoal(e) {
    const { slot } = e.currentTarget.dataset
    const form = slot === 'monthly_goal' ? this.data.monthlyForm : this.data.weeklyForm

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

    wx.showToast({
      title: '目标已保存',
      icon: 'success'
    })

    this.setData({
      overview: result.overview || null,
      [slot === 'monthly_goal' ? 'monthlyForm' : 'weeklyForm']: createGoalForm()
    })

    await this.refreshPage()
  },

  async onArchiveGoal(e) {
    const { slot } = e.currentTarget.dataset
    const result = await archiveGoal(app.globalData || {}, slot)

    if (!result.ok) {
      wx.showToast({
        title: result.message || '归档失败',
        icon: 'none'
      })
      return
    }

    wx.showToast({
      title: '已归档',
      icon: 'success'
    })

    this.setData({
      overview: result.overview || null
    })
  },

  async onSettleWager(e) {
    const { slot } = e.currentTarget.dataset
    const result = await settleWager(app.globalData || {}, {
      slot,
      settlementStatus: 'settled'
    })

    if (!result.ok) {
      wx.showToast({
        title: result.message || '更新失败',
        icon: 'none'
      })
      return
    }

    wx.showToast({
      title: '已标记兑现',
      icon: 'success'
    })

    this.setData({
      overview: result.overview || null
    })
  },

  onGoalActionTap(e) {
    const { target } = e.currentTarget.dataset

    if (target === 'budget') {
      wx.navigateTo({
        url: '/pages/budget/budget'
      })
      return
    }

    if (target === 'goals') {
      return
    }

    if (target === 'workout') {
      openRecordsWithContext({
        segment: 'workout'
      })
      return
    }

    openRecordsWithContext({
      segment: target || 'todo'
    })
  }
})

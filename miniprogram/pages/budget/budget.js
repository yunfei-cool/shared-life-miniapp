const app = getApp()
const { getBudgetView, updateBudgetSettings } = require('../../services/budget')
const { refreshSessionFromCloud } = require('../../services/session')
const { resolvePairState } = require('../../utils/pair-state')

function buildEmptyOverview() {
  return {
    hasBudget: false,
    totalBudgetDisplay: '未设置',
    spentDisplay: '￥0',
    remainingDisplay: '去设置预算',
    progressWidth: 12,
    progressLabel: '--',
    focusText: '设置好预算后，这里会开始显示本月余量',
    sharedRuleText: '共同支出会自动平摊到两个人',
    memberSummaries: []
  }
}

Page({
  data: {
    isLoading: true,
    pairState: 'guest',
    overview: buildEmptyOverview(),
    memberBudgetInputs: {}
  },

  onLoad() {
    wx.setNavigationBarTitle({
      title: '预算'
    })
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

      if (refreshed.ok) {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '预算加载失败',
        icon: 'none'
      })
    }

    const pairState = resolvePairState(globalData)

    if (pairState !== 'paired') {
      this.setData({
        isLoading: false,
        pairState,
        overview: buildEmptyOverview(),
        memberBudgetInputs: {}
      })
      return
    }

    const result = await getBudgetView(globalData)

    if (!result.ok) {
      wx.showToast({
        title: result.message || '预算加载失败',
        icon: 'none'
      })
      this.setData({
        isLoading: false,
        pairState,
        overview: buildEmptyOverview(),
        memberBudgetInputs: {}
      })
      return
    }

    const overview = result.overview || buildEmptyOverview()
    const memberBudgetInputs = {}

    ;(overview.memberSummaries || []).forEach((item) => {
      memberBudgetInputs[item.userId] = item.budgetInput || ''
    })

    this.setData({
      isLoading: false,
      pairState,
      overview,
      memberBudgetInputs
    })
  },

  onMemberBudgetInput(e) {
    const { userId } = e.currentTarget.dataset
    const memberBudgetInputs = Object.assign({}, this.data.memberBudgetInputs, {
      [userId]: e.detail.value
    })

    this.setData({
      memberBudgetInputs
    })
  },

  async onSaveTap() {
    if (this.data.pairState !== 'paired') {
      wx.showToast({
        title: '先连接共享空间',
        icon: 'none'
      })
      return
    }

    const payload = {
      members: (this.data.overview.memberSummaries || []).map((item) => ({
        userId: item.userId,
        budget: this.data.memberBudgetInputs[item.userId] || ''
      }))
    }

    const result = await updateBudgetSettings(app.globalData, payload)

    if (!result.ok) {
      wx.showToast({
        title: result.message || '预算保存失败',
        icon: 'none'
      })
      return
    }

    const overview = result.overview || buildEmptyOverview()
    const memberBudgetInputs = {}

    ;(overview.memberSummaries || []).forEach((item) => {
      memberBudgetInputs[item.userId] = item.budgetInput || ''
    })

    this.setData({
      overview,
      memberBudgetInputs
    })

    wx.showToast({
      title: '预算已更新',
      icon: 'success'
    })
  }
})

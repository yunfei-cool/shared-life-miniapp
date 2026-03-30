const GOALS_ENTRY_CONTEXT_KEY = 'goalsEntryContext'

function openGoalsWithContext(context = {}) {
  wx.setStorageSync(GOALS_ENTRY_CONTEXT_KEY, context)
  wx.navigateTo({
    url: '/pages/goals/goals'
  })
}

function consumeGoalsEntryContext() {
  const context = wx.getStorageSync(GOALS_ENTRY_CONTEXT_KEY)

  if (context) {
    wx.removeStorageSync(GOALS_ENTRY_CONTEXT_KEY)
  }

  return context || null
}

module.exports = {
  GOALS_ENTRY_CONTEXT_KEY,
  consumeGoalsEntryContext,
  openGoalsWithContext
}

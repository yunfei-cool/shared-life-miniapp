const REPORTS_ENTRY_CONTEXT_KEY = 'reportsEntryContext'

function openReportsWithContext(context = {}) {
  wx.setStorageSync(REPORTS_ENTRY_CONTEXT_KEY, context)
  wx.switchTab({
    url: '/pages/reports/reports'
  })
}

function consumeReportsEntryContext() {
  const context = wx.getStorageSync(REPORTS_ENTRY_CONTEXT_KEY)

  if (context) {
    wx.removeStorageSync(REPORTS_ENTRY_CONTEXT_KEY)
  }

  return context || null
}

module.exports = {
  consumeReportsEntryContext,
  openReportsWithContext,
  REPORTS_ENTRY_CONTEXT_KEY
}

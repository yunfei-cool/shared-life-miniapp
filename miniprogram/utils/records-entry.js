const RECORDS_ENTRY_CONTEXT_KEY = 'recordsEntryContext'

function openRecordsWithContext(context = {}) {
  wx.setStorageSync(RECORDS_ENTRY_CONTEXT_KEY, context)
  wx.switchTab({
    url: '/pages/records/records'
  })
}

function consumeRecordsEntryContext() {
  const context = wx.getStorageSync(RECORDS_ENTRY_CONTEXT_KEY)

  if (context) {
    wx.removeStorageSync(RECORDS_ENTRY_CONTEXT_KEY)
  }

  return context || null
}

module.exports = {
  consumeRecordsEntryContext,
  openRecordsWithContext,
  RECORDS_ENTRY_CONTEXT_KEY
}

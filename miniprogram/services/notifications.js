const { callCloudFunction, isPreviewMode } = require('./cloud')

function getDefaultNotificationPreferences() {
  return {
    todoAssignmentWanted: false,
    todoAssignmentArmed: false,
    todoDueWanted: false,
    todoDueArmed: false,
    todoAssignmentTemplateId: '',
    todoDueTemplateId: '',
    todoAssignmentTemplateConfigured: false,
    todoDueTemplateConfigured: false,
    lastAssignmentConsentAt: '',
    lastDueConsentAt: ''
  }
}

function normalizePreferences(result = {}) {
  return Object.assign(getDefaultNotificationPreferences(), result.preferences || {})
}

async function getNotificationPreferences(globalData = {}) {
  if (!globalData.isLoggedIn || isPreviewMode(globalData)) {
    return {
      ok: true,
      preferences: getDefaultNotificationPreferences()
    }
  }

  const result = await callCloudFunction('notifications', {
    action: 'getPreferences'
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    preferences: normalizePreferences(result)
  }
}

async function updateNotificationPreferences(globalData = {}, patch = {}) {
  if (!globalData.isLoggedIn || isPreviewMode(globalData)) {
    return {
      ok: false,
      message: '当前状态不能保存提醒设置'
    }
  }

  const result = await callCloudFunction('notifications', {
    action: 'updatePreferences',
    payload: patch
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    preferences: normalizePreferences(result)
  }
}

module.exports = {
  getDefaultNotificationPreferences,
  getNotificationPreferences,
  updateNotificationPreferences
}

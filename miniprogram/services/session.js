const SESSION_KEY = 'shared-life-session-v1'
const { callCloudFunction, isPreviewMode } = require('./cloud')
const { getSpaceState } = require('./couple')

function getDefaultSession() {
  return {
    userId: null,
    userInfo: null,
    coupleInfo: null,
    partnerInfo: null,
    isLoggedIn: false,
    hasCouple: false,
    cloudEnv: null
  }
}

function readSession() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null
  } catch (error) {
    return null
  }
}

function writeSession(globalData) {
  const payload = {
    userId: globalData.userId || null,
    userInfo: globalData.userInfo || null,
    coupleInfo: globalData.coupleInfo || null,
    partnerInfo: globalData.partnerInfo || null,
    isLoggedIn: !!globalData.isLoggedIn,
    hasCouple: !!globalData.hasCouple,
    cloudEnv: globalData.cloudEnv || null
  }

  wx.setStorageSync(SESSION_KEY, payload)
}

function hydrateApp(app) {
  const base = getDefaultSession()
  const stored = readSession()
  app.globalData = Object.assign(base, stored || {})
}

function persistApp(app) {
  writeSession(app.globalData || {})
}

function applySessionState(app, patch = {}) {
  const next = Object.assign(getDefaultSession(), app.globalData || {}, {
    userId: patch.userId || null,
    userInfo: patch.userInfo || null,
    coupleInfo: patch.coupleInfo || null,
    partnerInfo: patch.partnerInfo || null,
    isLoggedIn: !!patch.isLoggedIn,
    hasCouple: !!patch.hasCouple,
    cloudEnv: patch.cloudEnv || null
  })

  app.globalData = next
  persistApp(app)

  return next
}

function applyCoupleState(app, coupleInfo, partnerInfo = null, selfProfile = null) {
  const next = Object.assign(getDefaultSession(), app.globalData || {}, {
    coupleInfo: coupleInfo || null,
    partnerInfo: partnerInfo || null,
    hasCouple: !!coupleInfo,
    isLoggedIn: !!(app.globalData && app.globalData.isLoggedIn),
    userId: app.globalData && app.globalData.userId ? app.globalData.userId : null,
    userInfo: selfProfile || (app.globalData && app.globalData.userInfo ? app.globalData.userInfo : null),
    cloudEnv: app.globalData && app.globalData.cloudEnv ? app.globalData.cloudEnv : null
  })

  app.globalData = next
  persistApp(app)

  return next
}

async function loginUser(app, userInfo) {
  const result = await callCloudFunction('login')

  if (!result.ok) {
    return result
  }

  const next = Object.assign(getDefaultSession(), app.globalData || {}, {
    userId: result.openid || null,
    userInfo,
    isLoggedIn: true,
    cloudEnv: result.env || null
  })

  app.globalData = next
  persistApp(app)

  return {
    ok: true,
    session: next
  }
}

async function refreshSessionFromCloud(app) {
  const globalData = app.globalData || {}

  if (!globalData.isLoggedIn || !globalData.userInfo || isPreviewMode(globalData)) {
    return {
      ok: true,
      session: globalData
    }
  }

  const result = await getSpaceState(globalData)

  if (!result.ok) {
    return result
  }

  const next = applyCoupleState(app, result.coupleInfo, result.partnerInfo, result.selfProfile)

  return {
    ok: true,
    session: next
  }
}

function saveCoupleState(app, coupleInfo, partnerInfo = null, selfProfile = null) {
  return applyCoupleState(app, coupleInfo, partnerInfo, selfProfile)
}

function clearCoupleState(app) {
  return applyCoupleState(app, null, null, null)
}

function logoutUser(app) {
  app.globalData = getDefaultSession()
  wx.removeStorageSync(SESSION_KEY)
}

module.exports = {
  applyCoupleState,
  applySessionState,
  clearCoupleState,
  getDefaultSession,
  hydrateApp,
  loginUser,
  logoutUser,
  persistApp,
  refreshSessionFromCloud,
  saveCoupleState
}

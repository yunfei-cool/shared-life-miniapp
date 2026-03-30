const { addDays, toDateKey } = require('../utils/date')
const { getPartnerDisplayName, getSelfDisplayName } = require('../utils/member-display')
const { callCloudFunction, isPreviewMode } = require('./cloud')

const STEP_SYNC_THROTTLE_MS = 5 * 60 * 1000
let lastSilentSyncAt = 0

function formatCount(value) {
  return String(Math.max(0, Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function buildPreviewTrend() {
  const baseDate = new Date()
  const mySteps = [8120, 9640, 10210, 7350, 11240, 12880, 9430]
  const partnerSteps = [7030, 8480, 9250, 6880, 10920, 11740, 8210]
  const maxMemberSteps = Math.max(...mySteps, ...partnerSteps, 1)

  function scaleBar(value) {
    if (!value) {
      return 0
    }

    return Math.max(30, Math.round(Math.sqrt(value / maxMemberSteps) * 104))
  }

  return mySteps.map((item, index) => {
    const date = addDays(baseDate, index - 6)
    const partnerValue = partnerSteps[index]
    return {
      dateKey: toDateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      mySteps: item,
      partnerSteps: partnerValue,
      myHasValue: item > 0,
      partnerHasValue: partnerValue > 0,
      hasAnyValue: item > 0 || partnerValue > 0,
      myDisplay: formatCount(item),
      partnerDisplay: formatCount(partnerValue),
      myBarHeight: scaleBar(item),
      partnerBarHeight: scaleBar(partnerValue)
    }
  })
}

function buildComparisonText(mySteps, partnerSteps, hasMyData, hasPartnerData, selfLabel = '我', partnerLabel = '伴侣') {
  if (hasMyData && hasPartnerData) {
    if (!mySteps && !partnerSteps) {
      return '今天还没有步数记录'
    }

    if (mySteps === partnerSteps) {
      return `今天你们走得差不多，都是 ${formatCount(mySteps)} 步`
    }

    const difference = Math.abs(mySteps - partnerSteps)
    return mySteps > partnerSteps
      ? `今天${selfLabel}多走了 ${formatCount(difference)} 步`
      : `今天${partnerLabel}多走了 ${formatCount(difference)} 步`
  }

  if (hasMyData) {
    return `今天${selfLabel}走了 ${formatCount(mySteps)} 步`
  }

  if (hasPartnerData) {
    return `今天${partnerLabel}走了 ${formatCount(partnerSteps)} 步`
  }

  return '去开启微信运动同步'
}

function buildPreviewStepSummary(globalData = {}) {
  const trend = buildPreviewTrend()
  const today = trend[trend.length - 1]
  const myWeekTotal = trend.reduce((total, item) => total + item.mySteps, 0)
  const partnerWeekTotal = trend.reduce((total, item) => total + item.partnerSteps, 0)
  const weekTotal = myWeekTotal + partnerWeekTotal
  const maxDaySteps = trend.reduce((maxValue, item) => Math.max(maxValue, item.mySteps, item.partnerSteps), 0)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')

  return decorateSummary({
    label: '微信步数',
    hasAnyData: true,
    hasMyData: true,
    hasPartnerData: true,
    my: {
      label: selfLabel,
      todaySteps: today.mySteps,
      todayDisplay: formatCount(today.mySteps),
      weekSteps: myWeekTotal,
      weekDisplay: `${formatCount(myWeekTotal)} 步`
    },
    partner: {
      label: partnerLabel,
      todaySteps: today.partnerSteps,
      todayDisplay: formatCount(today.partnerSteps),
      weekSteps: partnerWeekTotal,
      weekDisplay: `${formatCount(partnerWeekTotal)} 步`
    },
    combinedWeekSteps: weekTotal,
    combinedWeekDisplay: `${formatCount(weekTotal)} 步`,
    focusText: buildComparisonText(today.mySteps, today.partnerSteps, true, true, selfLabel, partnerLabel),
    detailText: `本周${selfLabel} ${formatCount(myWeekTotal)} 步 · ${partnerLabel} ${formatCount(partnerWeekTotal)} 步`,
    rangeHint: `近 7 天最高 ${formatCount(maxDaySteps)} 步`,
    latestSyncLabel: '演示数据',
    trend
  }, {
    supported: true,
    authorized: true
  })
}

function getSettingPromise() {
  return new Promise((resolve) => {
    wx.getSetting({
      success: (res) => resolve(res.authSetting || {}),
      fail: () => resolve({})
    })
  })
}

function authorizeWeRun() {
  return new Promise((resolve) => {
    wx.authorize({
      scope: 'scope.werun',
      success: () => resolve({
        ok: true,
        authorized: true
      }),
      fail: () => resolve({
        ok: false,
        authorized: false,
        message: '还没有允许微信运动授权'
      })
    })
  })
}

function getWeRunData() {
  return new Promise((resolve) => {
    wx.getWeRunData({
      success: (res) => resolve({
        ok: true,
        data: res
      }),
      fail: (error) => resolve({
        ok: false,
        message: error && error.errMsg ? error.errMsg : '微信运动数据读取失败'
      })
    })
  })
}

function decorateSummary(summary = {}, state = {}) {
  const supported = state.supported !== false
  const authorized = !!state.authorized
  const decorated = Object.assign({
    label: '微信步数',
    hasAnyData: false,
    hasMyData: false,
    hasPartnerData: false,
    my: {
      label: '我',
      todaySteps: 0,
      todayDisplay: '未同步',
      weekSteps: 0,
      weekDisplay: '未同步'
    },
    partner: {
      label: '伴侣',
      todaySteps: 0,
      todayDisplay: '未同步',
      weekSteps: 0,
      weekDisplay: '未同步'
    },
    combinedWeekSteps: 0,
    combinedWeekDisplay: '0 步',
    focusText: '去开启微信运动同步',
    detailText: '打开首页后会自动同步最近步数',
    rangeHint: '',
    latestSyncLabel: '还没有同步记录',
    trend: []
  }, summary)

  if (!supported) {
    return Object.assign({}, decorated, {
      authorizationState: 'unsupported',
      statusLabel: '当前微信不支持',
      actionLabel: '',
      canSync: false
    })
  }

  if (!authorized) {
    return Object.assign({}, decorated, {
      authorizationState: 'unauthorized',
      statusLabel: '去开启微信运动同步',
      actionLabel: '去开启',
      canSync: true
    })
  }

  return Object.assign({}, decorated, {
    authorizationState: 'authorized',
    statusLabel: decorated.latestSyncLabel || '已同步微信运动',
    actionLabel: '重新同步',
    canSync: true
  })
}

async function getWeRunPermissionState() {
  const supported = typeof wx.getWeRunData === 'function'

  if (!supported) {
    return {
      supported: false,
      authorized: false
    }
  }

  const authSetting = await getSettingPromise()
  return {
    supported: true,
    authorized: !!authSetting['scope.werun']
  }
}

async function syncWeRun(globalData = {}, options = {}) {
  if (isPreviewMode(globalData)) {
    return {
      ok: true,
      supported: true,
      authorized: true,
      synced: true
    }
  }

  const permission = await getWeRunPermissionState()

  if (!permission.supported) {
    return {
      ok: false,
      supported: false,
      authorized: false,
      message: '当前微信不支持微信运动'
    }
  }

  let authorized = permission.authorized

  if (!authorized && options.requestAuth) {
    const authResult = await authorizeWeRun()
    authorized = authResult.authorized

    if (!authorized) {
      return Object.assign({
        supported: true
      }, authResult)
    }
  }

  if (!authorized) {
    return {
      ok: true,
      supported: true,
      authorized: false,
      synced: false
    }
  }

  const now = Date.now()

  if (!options.requestAuth && now - lastSilentSyncAt < STEP_SYNC_THROTTLE_MS) {
    return {
      ok: true,
      supported: true,
      authorized: true,
      synced: false,
      throttled: true
    }
  }

  const weRunResult = await getWeRunData()

  if (!weRunResult.ok) {
    return Object.assign({
      supported: true,
      authorized: true
    }, weRunResult)
  }

  if (!weRunResult.data || !weRunResult.data.cloudID || !wx.cloud || typeof wx.cloud.CloudID !== 'function') {
    return {
      ok: false,
      supported: true,
      authorized: true,
      message: '当前环境还不能通过云端同步微信步数'
    }
  }

  const result = await callCloudFunction('steps', {
    action: 'syncWeRun',
    weRunData: wx.cloud.CloudID(weRunResult.data.cloudID)
  })

  if (result.ok && !options.requestAuth) {
    lastSilentSyncAt = now
  }

  return Object.assign({
    supported: true,
    authorized: true,
    synced: !!result.ok
  }, result)
}

async function getStepSummary(globalData = {}, options = {}) {
  if (isPreviewMode(globalData)) {
    return {
      ok: true,
      summary: buildPreviewStepSummary(globalData)
    }
  }

  const syncResult = await syncWeRun(globalData, {
    requestAuth: !!options.requestAuth
  })
  const permissionState = {
    supported: syncResult.supported !== false,
    authorized: !!syncResult.authorized
  }

  if (!globalData.coupleInfo || !globalData.coupleInfo.id) {
    return {
      ok: true,
      summary: decorateSummary({}, permissionState)
    }
  }

  const result = await callCloudFunction('steps', {
    action: 'getStepSummary'
  })

  if (!syncResult.ok && (!result.ok || !result.summary || !result.summary.hasAnyData)) {
    return syncResult
  }

  if (!result.ok) {
    if (syncResult.ok === false && syncResult.message) {
      return syncResult
    }

    return result
  }

  const summary = decorateSummary(result.summary, permissionState)
  const selfLabel = getSelfDisplayName(globalData, '我')
  const partnerLabel = getPartnerDisplayName(globalData, '伴侣')
  summary.my = Object.assign({}, summary.my, {
    label: selfLabel
  })
  summary.partner = Object.assign({}, summary.partner, {
    label: partnerLabel
  })
  summary.focusText = buildComparisonText(
    summary.my.todaySteps,
    summary.partner.todaySteps,
    !!summary.hasMyData,
    !!summary.hasPartnerData,
    selfLabel,
    partnerLabel
  )
  summary.detailText = summary.hasAnyData
    ? `本周${selfLabel} ${formatCount(summary.my.weekSteps)} 步 · ${partnerLabel} ${formatCount(summary.partner.weekSteps)} 步`
    : '打开首页后会自动同步最近步数'

  return {
    ok: true,
    summary
  }
}

module.exports = {
  getStepSummary,
  getWeRunPermissionState,
  syncWeRun
}

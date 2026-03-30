const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const COLLECTIONS = {
  couples: 'couples',
  steps: 'step_snapshots'
}

function nowIso() {
  return new Date().toISOString()
}

function cloneDate(date) {
  return new Date(date.getTime())
}

function toShanghaiShiftedDate(date) {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
}

function fromShanghaiShiftedDate(date) {
  return new Date(date.getTime() - SHANGHAI_OFFSET_MS)
}

function startOfDay(date) {
  const shifted = toShanghaiShiftedDate(date)
  shifted.setUTCHours(0, 0, 0, 0)
  return fromShanghaiShiftedDate(shifted)
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000)
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function toDateKey(date) {
  const shifted = toShanghaiShiftedDate(date)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
}

function parseDateKey(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return fromShanghaiShiftedDate(new Date(Date.UTC(year, (month || 1) - 1, day || 1)))
}

function startOfWeek(date) {
  const day = toShanghaiShiftedDate(startOfDay(date)).getUTCDay()
  const offset = day === 0 ? -6 : 1 - day
  return addDays(startOfDay(date), offset)
}

function formatCount(value) {
  return String(Math.max(0, Number(value || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatTimeLabel(value) {
  if (!value) {
    return '还没有同步记录'
  }

  const date = toShanghaiShiftedDate(new Date(value))
  return `最近同步于 ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`
}

function formatDateKeyLabel(dateKey) {
  const [, month, day] = String(dateKey).split('-')
  return `${Number(month)}/${Number(day)}`
}

function buildComparisonText(mySteps, partnerSteps, hasMyData, hasPartnerData) {
  if (hasMyData && hasPartnerData) {
    if (!mySteps && !partnerSteps) {
      return '今天还没有步数记录'
    }

    if (mySteps === partnerSteps) {
      return `今天你们走得差不多，都是 ${formatCount(mySteps)} 步`
    }

    const difference = Math.abs(mySteps - partnerSteps)
    return mySteps > partnerSteps
      ? `今天我多走了 ${formatCount(difference)} 步`
      : `今天伴侣多走了 ${formatCount(difference)} 步`
  }

  if (hasMyData) {
    return `今天我走了 ${formatCount(mySteps)} 步`
  }

  if (hasPartnerData) {
    return `今天伴侣走了 ${formatCount(partnerSteps)} 步`
  }

  return '去开启微信运动同步'
}

async function listPairedCouplesByField(field, openid) {
  const result = await db.collection(COLLECTIONS.couples).where({
    [field]: openid,
    status: 'paired'
  }).get()

  return result.data || []
}

async function findPairedCouple(openid) {
  const [created, joined] = await Promise.all([
    listPairedCouplesByField('creatorUserId', openid),
    listPairedCouplesByField('partnerUserId', openid)
  ])

  return created
    .concat(joined)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime())[0] || null
}

function requirePairedCouple(couple) {
  if (!couple || couple.status !== 'paired') {
    throw new Error('共享空间还没连接完成')
  }
}

function normalizeWeRunPayload(weRunData = {}) {
  if (weRunData && weRunData.errCode) {
    throw new Error(weRunData.errMsg || '微信运动开放数据解密失败')
  }

  const rawContainer = weRunData && weRunData.data && typeof weRunData.data === 'object'
    ? weRunData.data
    : weRunData
  const rawList = Array.isArray(rawContainer.stepInfoList) ? rawContainer.stepInfoList : []
  const map = {}

  rawList.forEach((item) => {
    const timestamp = Number(item.timestamp || 0)
    const stepCount = Math.max(0, Number(item.step || 0))

    if (!timestamp) {
      return
    }

    const dateKey = toDateKey(new Date(timestamp * 1000))
    map[dateKey] = {
      dateKey,
      stepCount
    }
  })

  return Object.keys(map)
    .sort()
    .map((dateKey) => map[dateKey])
}

async function listSnapshotsByDateKeys(coupleId, userId, dateKeys) {
  if (!dateKeys.length) {
    return []
  }

  const result = await db.collection(COLLECTIONS.steps).where({
    coupleId,
    userId,
    dateKey: _.in(dateKeys)
  }).limit(Math.max(dateKeys.length, 20)).get()

  return result.data || []
}

async function listSnapshotsInRange(coupleId, userId, startKey, endKey) {
  const result = await db.collection(COLLECTIONS.steps).where({
    coupleId,
    userId,
    dateKey: _.gte(startKey).and(_.lte(endKey))
  }).limit(100).get()

  return result.data || []
}

async function saveStepSnapshots(coupleId, userId, rows) {
  if (!rows.length) {
    return []
  }

  const sortedRows = rows
    .slice()
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
  const cleanupStartKey = toDateKey(addDays(parseDateKey(sortedRows[0].dateKey), -1))
  const cleanupEndKey = sortedRows[sortedRows.length - 1].dateKey
  const syncedAt = nowIso()
  const existing = await listSnapshotsInRange(coupleId, userId, cleanupStartKey, cleanupEndKey)

  await Promise.all(existing.map((item) => db.collection(COLLECTIONS.steps).doc(item._id).remove()))

  await Promise.all(sortedRows.map(async (item) => {
    await db.collection(COLLECTIONS.steps).add({
      data: {
        coupleId,
        userId,
        dateKey: item.dateKey,
        stepCount: item.stepCount,
        source: 'werun',
        syncedAt,
        updatedAt: syncedAt
      }
    })
  }))

  return rows
}

async function listRecentSnapshots(coupleId, startKey, endKey) {
  const result = await db.collection(COLLECTIONS.steps).where({
    coupleId,
    dateKey: _.gte(startKey).and(_.lte(endKey))
  }).limit(100).get()

  return result.data || []
}

function buildStepSummary(couple, openid, snapshots, baseDate = new Date()) {
  const todayKey = toDateKey(baseDate)
  const rangeStart = addDays(baseDate, -6)
  const weekStart = startOfWeek(baseDate)
  const weekStartKey = toDateKey(weekStart)
  const partnerUserId = openid === couple.creatorUserId ? couple.partnerUserId : couple.creatorUserId
  const byUserAndDate = {}
  let latestSyncedAt = ''

  snapshots.forEach((item) => {
    if (!byUserAndDate[item.userId]) {
      byUserAndDate[item.userId] = {}
    }

    byUserAndDate[item.userId][item.dateKey] = Number(item.stepCount || 0)

    if (!latestSyncedAt || new Date(item.syncedAt || 0).getTime() > new Date(latestSyncedAt || 0).getTime()) {
      latestSyncedAt = item.syncedAt || latestSyncedAt
    }
  })

  const trendDays = []
  let trendCursor = startOfDay(rangeStart)

  while (trendCursor.getTime() <= startOfDay(baseDate).getTime()) {
    trendDays.push(toDateKey(trendCursor))
    trendCursor = addDays(trendCursor, 1)
  }

  const trendBase = trendDays.map((dateKey) => {
    const mySteps = (byUserAndDate[openid] && byUserAndDate[openid][dateKey]) || 0
    const partnerSteps = (byUserAndDate[partnerUserId] && byUserAndDate[partnerUserId][dateKey]) || 0

    return {
      dateKey,
      label: formatDateKeyLabel(dateKey),
      mySteps,
      partnerSteps
    }
  })
  const maxMemberSteps = Math.max(1, ...trendBase.map((item) => Math.max(item.mySteps, item.partnerSteps)))
  function scaleBar(value) {
    if (!value) {
      return 0
    }

    return Math.max(30, Math.round(Math.sqrt(value / maxMemberSteps) * 104))
  }

  const trend = trendBase.map((item) => Object.assign({}, item, {
    myDisplay: formatCount(item.mySteps),
    partnerDisplay: formatCount(item.partnerSteps),
    myHasValue: item.mySteps > 0,
    partnerHasValue: item.partnerSteps > 0,
    hasAnyValue: item.mySteps > 0 || item.partnerSteps > 0,
    myBarHeight: scaleBar(item.mySteps),
    partnerBarHeight: scaleBar(item.partnerSteps)
  }))
  const todayRow = trendBase.find((item) => item.dateKey === todayKey) || {
    mySteps: 0,
    partnerSteps: 0
  }
  const weeklyRows = trendBase.filter((item) => item.dateKey >= weekStartKey)
  const myWeekSteps = weeklyRows.reduce((total, item) => total + item.mySteps, 0)
  const partnerWeekSteps = weeklyRows.reduce((total, item) => total + item.partnerSteps, 0)
  const weekTotalSteps = myWeekSteps + partnerWeekSteps
  const maxDaySteps = trendBase.reduce((maxValue, item) => Math.max(maxValue, item.mySteps, item.partnerSteps), 0)
  const hasMyData = !!((byUserAndDate[openid] && Object.keys(byUserAndDate[openid]).length))
  const hasPartnerData = !!((byUserAndDate[partnerUserId] && Object.keys(byUserAndDate[partnerUserId]).length))
  const hasAnyData = hasMyData || hasPartnerData

  const focusText = buildComparisonText(todayRow.mySteps, todayRow.partnerSteps, hasMyData, hasPartnerData)

  return {
    label: '微信步数',
    hasAnyData,
    hasMyData,
    hasPartnerData,
    my: {
      todaySteps: todayRow.mySteps,
      todayDisplay: hasMyData ? formatCount(todayRow.mySteps) : '未同步',
      weekSteps: myWeekSteps,
      weekDisplay: hasMyData ? `${formatCount(myWeekSteps)} 步` : '未同步'
    },
    partner: {
      todaySteps: todayRow.partnerSteps,
      todayDisplay: hasPartnerData ? formatCount(todayRow.partnerSteps) : '未同步',
      weekSteps: partnerWeekSteps,
      weekDisplay: hasPartnerData ? `${formatCount(partnerWeekSteps)} 步` : '未同步'
    },
    combinedWeekSteps: weekTotalSteps,
    combinedWeekDisplay: `${formatCount(weekTotalSteps)} 步`,
    focusText,
    detailText: hasAnyData
      ? `本周我 ${formatCount(myWeekSteps)} 步 · 伴侣 ${formatCount(partnerWeekSteps)} 步`
      : '打开首页后会自动同步最近步数',
    rangeHint: hasAnyData ? `近 7 天最高 ${formatCount(maxDaySteps)} 步` : '',
    latestSyncLabel: formatTimeLabel(latestSyncedAt),
    trend
  }
}

async function syncWeRun(openid, event) {
  const couple = await findPairedCouple(openid)
  requirePairedCouple(couple)

  const rows = normalizeWeRunPayload(event.weRunData)

  if (!rows.length) {
    throw new Error('没有拿到微信运动数据')
  }

  await saveStepSnapshots(couple._id, openid, rows)

  return {
    ok: true,
    syncedCount: rows.length
  }
}

async function getStepSummary(openid) {
  const couple = await findPairedCouple(openid)
  requirePairedCouple(couple)
  const baseDate = new Date()
  const startKey = toDateKey(addDays(baseDate, -6))
  const endKey = toDateKey(baseDate)
  const snapshots = await listRecentSnapshots(couple._id, startKey, endKey)

  return {
    ok: true,
    summary: buildStepSummary(couple, openid, snapshots, baseDate)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getStepSummary'

  try {
    if (action === 'syncWeRun') {
      return await syncWeRun(OPENID, event)
    }

    return await getStepSummary(OPENID)
  } catch (error) {
    console.error('[steps] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '微信步数请求失败'
    }
  }
}

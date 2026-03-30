const {
  formatCurrency,
  getPeriodBounds,
  isDateKeyInRange
} = require('../utils/date')
const { getDisplayNameByUserId } = require('../utils/member-display')
const { callCloudFunction, isPreviewMode } = require('./cloud')
const { getRawStoreLocal } = require('./records')

const BUDGET_STORAGE_PREFIX = 'shared-life-budget:'
const DEFAULT_TOTAL_BUDGET_CENTS = 520000

function nowIso() {
  return new Date().toISOString()
}

function getStorageKey(coupleId) {
  return `${BUDGET_STORAGE_PREFIX}${coupleId}`
}

function getBudgetUsers(globalData = {}) {
  const currentUserId = globalData.userId || ''
  const creatorUserId = globalData.coupleInfo && globalData.coupleInfo.creatorUserId
  const partnerUserId = globalData.partnerInfo && globalData.partnerInfo.userId
    ? globalData.partnerInfo.userId
    : (globalData.coupleInfo
      ? (globalData.coupleInfo.creatorUserId === currentUserId
        ? globalData.coupleInfo.partnerUserId
        : globalData.coupleInfo.creatorUserId)
      : '')
  const seen = {}
  const items = [
    { userId: currentUserId, label: getDisplayNameByUserId(currentUserId, globalData, { selfFallback: '我' }) },
    { userId: partnerUserId, label: getDisplayNameByUserId(partnerUserId, globalData, { partnerFallback: '伴侣' }) }
  ]

  return items.filter((item) => {
    if (!item.userId || seen[item.userId]) {
      return false
    }

    seen[item.userId] = true
    return true
  }).map((item) => Object.assign({}, item, {
    roleKey: item.userId === creatorUserId ? 'creator' : 'partner'
  }))
}

function splitTotalBudget(totalBudgetCents, users) {
  if (!users.length) {
    return []
  }

  if (users.length === 1) {
    return [{
      userId: users[0].userId,
      budgetCents: totalBudgetCents
    }]
  }

  const firstBudget = Math.floor(totalBudgetCents / users.length)
  const memberBudgets = users.map((item) => ({
    userId: item.userId,
    budgetCents: firstBudget
  }))
  const remainder = totalBudgetCents - memberBudgets.reduce((total, item) => total + item.budgetCents, 0)

  memberBudgets[memberBudgets.length - 1].budgetCents += remainder
  return memberBudgets
}

function getDefaultBudgetSettings(globalData = {}) {
  return {
    memberBudgets: splitTotalBudget(DEFAULT_TOTAL_BUDGET_CENTS, getBudgetUsers(globalData)),
    updatedAt: nowIso()
  }
}

function normalizeSettings(settings = {}, globalData = {}) {
  const users = getBudgetUsers(globalData)
  const budgetMap = {}

  if (Array.isArray(settings.memberBudgets) && settings.memberBudgets.length) {
    settings.memberBudgets.forEach((item) => {
      if (!item || !item.userId) {
        return
      }

      budgetMap[item.userId] = Math.max(0, Number(item.budgetCents || 0))
    })
  } else if (Number(settings.monthlyBudgetCents || 0) > 0) {
    splitTotalBudget(Number(settings.monthlyBudgetCents || 0), users).forEach((item) => {
      budgetMap[item.userId] = item.budgetCents
    })
  }

  return {
    memberBudgets: users.map((item) => ({
      userId: item.userId,
      budgetCents: budgetMap[item.userId] || 0
    })),
    updatedAt: settings.updatedAt || nowIso()
  }
}

function ensureLocalBudgetSettings(globalData = {}) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return normalizeSettings({}, globalData)
  }

  const storageKey = getStorageKey(coupleId)
  const existing = wx.getStorageSync(storageKey)

  if (!existing || typeof existing !== 'object') {
    const defaults = getDefaultBudgetSettings(globalData)
    wx.setStorageSync(storageKey, defaults)
    return defaults
  }

  const normalized = normalizeSettings(existing, globalData)

  if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
    wx.setStorageSync(storageKey, normalized)
  }

  return normalized
}

function getPreviewBudgetSettings(globalData = {}) {
  return ensureLocalBudgetSettings(globalData)
}

function persistLocalBudgetSettings(globalData = {}, settings = {}) {
  const coupleId = globalData.coupleInfo && globalData.coupleInfo.id

  if (!coupleId) {
    return
  }

  wx.setStorageSync(getStorageKey(coupleId), Object.assign({}, normalizeSettings(settings, globalData), {
    updatedAt: nowIso()
  }))
}

function toAmountInput(amountCents) {
  const amount = Number(amountCents || 0) / 100
  const fixed = amount.toFixed(2)
  return fixed.replace(/\.00$/, '').replace(/(\.\d*[1-9])0$/, '$1')
}

function parseAmountToCents(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 0
  }

  const amount = Number(String(value).trim())

  if (!Number.isFinite(amount) || amount < 0) {
    return 0
  }

  return Math.round(amount * 100)
}

function buildMemberSpendMap(expenses, users) {
  const totals = {}
  const sortedUserIds = users.map((item) => item.userId).filter(Boolean).slice().sort()

  users.forEach((item) => {
    totals[item.userId] = 0
  })

  expenses.forEach((item) => {
    const amountCents = Number(item.amountCents || 0)

    if (amountCents <= 0) {
      return
    }

    if (item.ownerScope === 'shared') {
      if (!sortedUserIds.length) {
        return
      }

      if (sortedUserIds.length === 1) {
        totals[sortedUserIds[0]] = (totals[sortedUserIds[0]] || 0) + amountCents
        return
      }

      const firstShare = Math.floor(amountCents / 2)
      const secondShare = amountCents - firstShare
      totals[sortedUserIds[0]] = (totals[sortedUserIds[0]] || 0) + firstShare
      totals[sortedUserIds[1]] = (totals[sortedUserIds[1]] || 0) + secondShare
      return
    }

    if (item.ownerUserId && Object.prototype.hasOwnProperty.call(totals, item.ownerUserId)) {
      totals[item.ownerUserId] += amountCents
    }
  })

  return totals
}

function buildBudgetOverviewFromStore(settings = {}, store = {}, globalData = {}, baseDate = new Date()) {
  const normalized = normalizeSettings(settings, globalData)
  const users = getBudgetUsers(globalData)
  const bounds = getPeriodBounds('monthly', baseDate)
  const monthlyExpenses = (store.expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
  const spentByMember = buildMemberSpendMap(monthlyExpenses, users)
  const memberSummaries = users.map((item) => {
    const budgetEntry = normalized.memberBudgets.find((target) => target.userId === item.userId) || {
      budgetCents: 0
    }
    const budgetCents = Number(budgetEntry.budgetCents || 0)
    const spentCents = Number(spentByMember[item.userId] || 0)
    const remainingCents = budgetCents - spentCents
    const progressPercent = budgetCents > 0 ? Math.round((spentCents / budgetCents) * 100) : 0

    return {
      userId: item.userId,
      label: item.label,
      roleKey: item.roleKey,
      budgetCents,
      budgetDisplay: budgetCents ? formatCurrency(budgetCents) : '未设置',
      budgetInput: budgetCents ? toAmountInput(budgetCents) : '',
      spentCents,
      spentDisplay: formatCurrency(spentCents),
      remainingCents,
      remainingDisplay: budgetCents
        ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
        : '先设置预算',
      progressPercent,
      progressWidth: budgetCents ? Math.max(10, Math.min(progressPercent, 100)) : (spentCents ? 24 : 10),
      statusTone: budgetCents && remainingCents < 0 ? 'over' : (budgetCents && progressPercent >= 85 ? 'near' : 'calm')
    }
  })
  const totalBudgetCents = memberSummaries.reduce((total, item) => total + item.budgetCents, 0)
  const spentCents = memberSummaries.reduce((total, item) => total + item.spentCents, 0)
  const remainingCents = totalBudgetCents - spentCents
  const progressPercent = totalBudgetCents > 0 ? Math.round((spentCents / totalBudgetCents) * 100) : 0
  const focusMember = memberSummaries
    .slice()
    .sort((left, right) => {
      const leftScore = left.remainingCents < 0 ? 1000000 + Math.abs(left.remainingCents) : left.progressPercent
      const rightScore = right.remainingCents < 0 ? 1000000 + Math.abs(right.remainingCents) : right.progressPercent
      return rightScore - leftScore
    })[0] || null
  let focusText = '先设置两个人的本月预算'

  if (totalBudgetCents > 0 && focusMember) {
    if (focusMember.remainingCents < 0) {
      focusText = `${focusMember.label}已超支 ${formatCurrency(Math.abs(focusMember.remainingCents))}`
    } else if (focusMember.progressPercent >= 85) {
      focusText = `${focusMember.label}最接近上限`
    } else if (memberSummaries.length >= 2) {
      focusText = `${memberSummaries[0].label}还剩 ${formatCurrency(Math.max(memberSummaries[0].remainingCents, 0))} · ${memberSummaries[1].label}还剩 ${formatCurrency(Math.max(memberSummaries[1].remainingCents, 0))}`
    } else {
      focusText = focusMember.remainingCents >= 0 ? `还剩 ${formatCurrency(focusMember.remainingCents)}` : `超支 ${formatCurrency(Math.abs(focusMember.remainingCents))}`
    }
  }

  return {
    hasBudget: totalBudgetCents > 0,
    totalBudgetCents,
    totalBudgetDisplay: totalBudgetCents ? formatCurrency(totalBudgetCents) : '未设置',
    monthlyBudgetCents: totalBudgetCents,
    monthlyBudgetDisplay: totalBudgetCents ? formatCurrency(totalBudgetCents) : '未设置',
    spentCents,
    spentDisplay: formatCurrency(spentCents),
    remainingCents,
    remainingDisplay: totalBudgetCents
      ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
      : '去设置预算',
    progressPercent,
    progressWidth: totalBudgetCents ? Math.max(10, Math.min(progressPercent, 100)) : (spentCents ? 28 : 12),
    progressLabel: totalBudgetCents ? `${Math.max(progressPercent, 0)}%` : '--',
    balanceTone: totalBudgetCents && remainingCents < 0 ? 'over' : 'calm',
    focusText,
    periodLabel: `${bounds.startKey} - ${bounds.endKey}`,
    sharedRuleText: '共同支出会自动平摊到两个人',
    memberSummaries,
    categories: []
  }
}

async function getBudgetView(globalData = {}) {
  if (isPreviewMode(globalData)) {
    const settings = ensureLocalBudgetSettings(globalData)
    const store = getRawStoreLocal(globalData)
    const overview = buildBudgetOverviewFromStore(settings, store, globalData)

    return {
      ok: true,
      settings,
      overview
    }
  }

  const result = await callCloudFunction('budget', {
    action: 'getBudgetSettings'
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    settings: normalizeSettings(result.settings, globalData),
    overview: result.overview
  }
}

async function updateBudgetSettings(globalData = {}, payload = {}) {
  if (isPreviewMode(globalData)) {
    const users = getBudgetUsers(globalData)
    const memberBudgets = Array.isArray(payload.members)
      ? payload.members.map((item, index) => ({
        userId: item.userId || (users[index] && users[index].userId) || '',
        budgetCents: typeof item.budgetCents === 'number'
          ? Number(item.budgetCents || 0)
          : parseAmountToCents(item.budget)
      }))
      : []
    const normalized = normalizeSettings({
      memberBudgets,
      updatedAt: nowIso()
    }, globalData)
    persistLocalBudgetSettings(globalData, normalized)
    const store = getRawStoreLocal(globalData)

    return {
      ok: true,
      settings: normalized,
      overview: buildBudgetOverviewFromStore(normalized, store, globalData)
    }
  }

  const result = await callCloudFunction('budget', {
    action: 'updateBudgetSettings',
    payload
  })

  if (!result.ok) {
    return result
  }

  return {
    ok: true,
    settings: normalizeSettings(result.settings, globalData),
    overview: result.overview
  }
}

module.exports = {
  buildBudgetOverviewFromStore,
  getBudgetUsers,
  getBudgetView,
  getDefaultBudgetSettings,
  getPreviewBudgetSettings,
  normalizeSettings,
  updateBudgetSettings
}

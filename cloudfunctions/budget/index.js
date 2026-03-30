const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const ACTIVE_STATUSES = ['invited', 'paired']
const COLLECTIONS = {
  couples: 'couples',
  expenses: 'expenses',
  budgetSettings: 'budget_settings'
}

function nowIso() {
  return new Date().toISOString()
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function startOfDay(date) {
  const next = new Date(date.getTime())
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date) {
  const next = new Date(date.getTime())
  next.setHours(23, 59, 59, 999)
  return next
}

function getMonthlyBounds(baseDate = new Date()) {
  const start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
  const end = endOfDay(new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0))

  return {
    start,
    end,
    startKey: toDateKey(start),
    endKey: toDateKey(end)
  }
}

function isDateKeyInRange(dateKey, bounds) {
  const timestamp = startOfDay(new Date(`${dateKey}T00:00:00+08:00`)).getTime()
  return timestamp >= startOfDay(bounds.start).getTime() && timestamp <= endOfDay(bounds.end).getTime()
}

function formatCurrency(amountCents) {
  const amount = Number(amountCents || 0) / 100
  const hasDecimals = Number(amountCents || 0) % 100 !== 0
  return `￥${amount.toFixed(hasDecimals ? 2 : 0)}`
}

function toAmountInput(amountCents) {
  const amount = Number(amountCents || 0) / 100
  const fixed = amount.toFixed(2)
  return fixed.replace(/\.00$/, '').replace(/(\.\d*[1-9])0$/, '$1')
}

function buildMemberUsers(couple, openid) {
  return [
    {
      userId: openid === couple.creatorUserId ? couple.creatorUserId : couple.partnerUserId,
      label: '我',
      roleKey: openid === couple.creatorUserId ? 'creator' : 'partner'
    },
    {
      userId: openid === couple.creatorUserId ? couple.partnerUserId : couple.creatorUserId,
      label: '伴侣',
      roleKey: openid === couple.creatorUserId ? 'partner' : 'creator'
    }
  ].filter((item) => item.userId)
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

  const baseBudget = Math.floor(totalBudgetCents / users.length)
  const budgets = users.map((item) => ({
    userId: item.userId,
    budgetCents: baseBudget
  }))
  const remainder = totalBudgetCents - budgets.reduce((total, item) => total + item.budgetCents, 0)

  budgets[budgets.length - 1].budgetCents += remainder
  return budgets
}

function normalizeSettings(doc = {}, couple, openid) {
  const users = buildMemberUsers(couple, openid)
  const budgetMap = {}

  if (Array.isArray(doc.memberBudgets) && doc.memberBudgets.length) {
    doc.memberBudgets.forEach((item) => {
      if (!item || !item.userId) {
        return
      }

      budgetMap[item.userId] = Math.max(0, Number(item.budgetCents || 0))
    })
  } else if (Number(doc.monthlyBudgetCents || 0) > 0) {
    splitTotalBudget(Number(doc.monthlyBudgetCents || 0), users).forEach((item) => {
      budgetMap[item.userId] = item.budgetCents
    })
  }

  return {
    memberBudgets: users.map((item) => ({
      userId: item.userId,
      budgetCents: budgetMap[item.userId] || 0
    })),
    updatedAt: doc.updatedAt || nowIso()
  }
}

async function listActiveCouplesByField(field, openid) {
  const result = await db.collection(COLLECTIONS.couples).where({
    [field]: openid,
    status: _.in(ACTIVE_STATUSES)
  }).get()

  return result.data || []
}

async function findActiveCouple(openid) {
  const [created, joined] = await Promise.all([
    listActiveCouplesByField('creatorUserId', openid),
    listActiveCouplesByField('partnerUserId', openid)
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

async function getAllByCouple(collectionName, coupleId) {
  const collection = db.collection(collectionName)
  const items = []
  let skip = 0
  const limit = 100

  while (true) {
    const result = await collection.where({
      coupleId
    }).skip(skip).limit(limit).get()
    const chunk = result.data || []
    items.push(...chunk)

    if (chunk.length < limit) {
      break
    }

    skip += chunk.length
  }

  return items
}

async function findBudgetDoc(coupleId) {
  const result = await db.collection(COLLECTIONS.budgetSettings).where({
    coupleId
  }).limit(1).get()

  return (result.data || [])[0] || null
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
        totals[sortedUserIds[0]] += amountCents
        return
      }

      const firstShare = Math.floor(amountCents / 2)
      const secondShare = amountCents - firstShare
      totals[sortedUserIds[0]] += firstShare
      totals[sortedUserIds[1]] += secondShare
      return
    }

    if (item.ownerUserId && Object.prototype.hasOwnProperty.call(totals, item.ownerUserId)) {
      totals[item.ownerUserId] += amountCents
    }
  })

  return totals
}

function buildOverview(settings, expenses, couple, openid, baseDate = new Date()) {
  const users = buildMemberUsers(couple, openid)
  const normalized = normalizeSettings(settings, couple, openid)
  const bounds = getMonthlyBounds(baseDate)
  const monthlyExpenses = (expenses || []).filter((item) => isDateKeyInRange(item.occurredOn, bounds))
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
    spentCents,
    spentDisplay: formatCurrency(spentCents),
    remainingCents,
    remainingDisplay: totalBudgetCents
      ? (remainingCents >= 0 ? `还剩 ${formatCurrency(remainingCents)}` : `超支 ${formatCurrency(Math.abs(remainingCents))}`)
      : '去设置预算',
    progressPercent,
    progressWidth: totalBudgetCents > 0 ? Math.max(10, Math.min(progressPercent, 100)) : (spentCents ? 28 : 12),
    progressLabel: totalBudgetCents ? `${Math.max(progressPercent, 0)}%` : '--',
    focusText,
    sharedRuleText: '共同支出会自动平摊到两个人',
    memberSummaries
  }
}

function parseBudgetValue(value) {
  if (value === '' || value === null || typeof value === 'undefined') {
    return 0
  }

  const amount = Number(String(value).trim())

  if (!Number.isFinite(amount) || amount < 0) {
    return null
  }

  return Math.round(amount * 100)
}

function normalizePayload(payload = {}, couple, openid) {
  const users = buildMemberUsers(couple, openid)

  if (!Array.isArray(payload.members) || !payload.members.length) {
    return {
      ok: false,
      message: '请设置两个人的预算'
    }
  }

  const memberBudgets = users.map((item) => {
    const target = payload.members.find((member) => member.userId === item.userId) || {}
    const budgetCents = typeof target.budgetCents === 'number'
      ? Number(target.budgetCents || 0)
      : parseBudgetValue(target.budget)

    if (budgetCents === null) {
      return {
        invalid: true,
        userId: item.userId
      }
    }

    return {
      userId: item.userId,
      budgetCents
    }
  })

  if (memberBudgets.some((item) => item.invalid)) {
    return {
      ok: false,
      message: '请输入有效的预算金额'
    }
  }

  return {
    ok: true,
    settings: {
      memberBudgets
    }
  }
}

async function getBudgetSettings(openid) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const existing = await findBudgetDoc(couple._id)
  const settings = normalizeSettings(existing || {}, couple, openid)
  const expenses = await getAllByCouple(COLLECTIONS.expenses, couple._id)

  return {
    ok: true,
    settings,
    overview: buildOverview(settings, expenses, couple, openid)
  }
}

async function updateBudgetSettings(openid, payload = {}) {
  const couple = await findActiveCouple(openid)
  requirePairedCouple(couple)
  const normalized = normalizePayload(payload, couple, openid)

  if (!normalized.ok) {
    return normalized
  }

  const now = nowIso()
  const existing = await findBudgetDoc(couple._id)
  const doc = Object.assign({}, normalized.settings, {
    coupleId: couple._id,
    updatedAt: now
  })

  if (existing) {
    await db.collection(COLLECTIONS.budgetSettings).doc(existing._id).update({
      data: doc
    })
  } else {
    await db.collection(COLLECTIONS.budgetSettings).add({
      data: doc
    })
  }

  const expenses = await getAllByCouple(COLLECTIONS.expenses, couple._id)
  const settings = normalizeSettings(doc, couple, openid)

  return {
    ok: true,
    settings,
    overview: buildOverview(settings, expenses, couple, openid)
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getBudgetSettings'

  try {
    if (action === 'updateBudgetSettings') {
      return await updateBudgetSettings(OPENID, event.payload || {})
    }

    return await getBudgetSettings(OPENID)
  } catch (error) {
    console.error('[budget] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '预算请求失败'
    }
  }
}

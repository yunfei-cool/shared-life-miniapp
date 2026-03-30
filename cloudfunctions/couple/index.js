const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const COUPLES_COLLECTION = 'couples'
const ACTIVE_STATUSES = ['invited', 'paired']
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PROFILE_PLACEHOLDER_NAMES = ['未命名用户', '微信用户', '伴侣', '用户']

function nowIso() {
  return new Date().toISOString()
}

function toDateKey(value) {
  const date = value ? new Date(value) : new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function sanitizeUserProfile(userInfo = {}) {
  const nickName = String(userInfo.nickName || '').trim()

  return {
    userId: userInfo.userId || '',
    nickName: PROFILE_PLACEHOLDER_NAMES.includes(nickName) ? '' : nickName,
    avatarUrl: userInfo.avatarUrl || '',
    city: userInfo.city || ''
  }
}

function isSameProfile(left = {}, right = {}) {
  return (left.userId || '') === (right.userId || '')
    && (left.nickName || '') === (right.nickName || '')
    && (left.avatarUrl || '') === (right.avatarUrl || '')
    && (left.city || '') === (right.city || '')
}

function createInviteCode() {
  let code = ''

  for (let index = 0; index < 8; index += 1) {
    const randomIndex = Math.floor(Math.random() * INVITE_CODE_CHARS.length)
    code += INVITE_CODE_CHARS.charAt(randomIndex)
  }

  return code
}

async function generateUniqueInviteCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = createInviteCode()
    const existing = await db.collection(COUPLES_COLLECTION).where({
      inviteCode
    }).limit(1).get()

    if (!(existing.data || []).length) {
      return inviteCode
    }
  }

  throw new Error('邀请码生成失败，请稍后再试')
}

async function listActiveCouplesByField(field, openid) {
  const result = await db.collection(COUPLES_COLLECTION).where({
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

function buildPartnerInfo(couple, openid) {
  if (!couple || couple.status !== 'paired') {
    return null
  }

  if (couple.creatorUserId === openid) {
    return couple.partnerProfile || null
  }

  return couple.creatorProfile || null
}

function buildSelfProfile(couple, openid) {
  if (!couple) {
    return null
  }

  if (couple.creatorUserId === openid) {
    return couple.creatorProfile || null
  }

  if (couple.partnerUserId === openid) {
    return couple.partnerProfile || null
  }

  return null
}

function buildCoupleInfo(couple) {
  if (!couple) {
    return null
  }

  return {
    id: couple._id,
    createdAt: toDateKey(couple.createdAt),
    status: couple.status,
    inviteCode: couple.inviteCode || '',
    creatorUserId: couple.creatorUserId || null,
    partnerUserId: couple.partnerUserId || null
  }
}

function buildSpaceState(couple, openid) {
  return {
    ok: true,
    coupleInfo: buildCoupleInfo(couple),
    partnerInfo: buildPartnerInfo(couple, openid),
    selfProfile: buildSelfProfile(couple, openid)
  }
}

async function syncUserProfileIfNeeded(couple, openid, userInfo) {
  if (!couple || !userInfo) {
    return couple
  }

  const nextProfile = sanitizeUserProfile(Object.assign({}, userInfo, {
    userId: openid
  }))

  let field = ''
  let currentProfile = null

  if (couple.creatorUserId === openid) {
    field = 'creatorProfile'
    currentProfile = couple.creatorProfile || {}
  } else if (couple.partnerUserId === openid) {
    field = 'partnerProfile'
    currentProfile = couple.partnerProfile || {}
  } else {
    return couple
  }

  if (isSameProfile(currentProfile, nextProfile)) {
    return couple
  }

  await db.collection(COUPLES_COLLECTION).doc(couple._id).update({
    data: {
      [field]: nextProfile,
      updatedAt: nowIso()
    }
  })

  const refreshed = await db.collection(COUPLES_COLLECTION).doc(couple._id).get()
  return refreshed.data
}

async function createSpace(openid, event) {
  const current = await findActiveCouple(openid)

  if (current) {
    return {
      ok: false,
      message: '你已经在一个共享空间里了'
    }
  }

  const createdAt = nowIso()
  const userProfile = sanitizeUserProfile(Object.assign({}, event.userInfo, {
    userId: openid
  }))
  const inviteCode = await generateUniqueInviteCode()
  const result = await db.collection(COUPLES_COLLECTION).add({
    data: {
      creatorUserId: openid,
      creatorProfile: userProfile,
      partnerUserId: null,
      partnerProfile: {},
      status: 'invited',
      inviteCode,
      createdAt,
      updatedAt: createdAt
    }
  })
  const created = await db.collection(COUPLES_COLLECTION).doc(result._id).get()
  return buildSpaceState(created.data, openid)
}

async function joinSpace(openid, event) {
  const current = await findActiveCouple(openid)

  if (current) {
    return {
      ok: false,
      message: '请先离开当前共享空间'
    }
  }

  const inviteCode = String(event.inviteCode || '').trim().toUpperCase()

  if (!/^[A-Z2-9]{8}$/.test(inviteCode)) {
    return {
      ok: false,
      message: '请输入正确的邀请码'
    }
  }

  const search = await db.collection(COUPLES_COLLECTION).where({
    inviteCode,
    status: 'invited'
  }).limit(1).get()
  const target = (search.data || [])[0]

  if (!target) {
    return {
      ok: false,
      message: '邀请码不存在或已失效'
    }
  }

  if (target.creatorUserId === openid) {
    return {
      ok: false,
      message: '不能加入自己创建的空间'
    }
  }

  const nextProfile = sanitizeUserProfile(Object.assign({}, event.userInfo, {
    userId: openid
  }))
  const updatedAt = nowIso()
  const nextDoc = Object.assign({}, target, {
    partnerUserId: openid,
    partnerProfile: nextProfile,
    status: 'paired',
    pairedAt: updatedAt,
    inviteCode: null,
    updatedAt
  })

  delete nextDoc._id

  await db.collection(COUPLES_COLLECTION).doc(target._id).set({
    data: nextDoc
  })

  const joined = await db.collection(COUPLES_COLLECTION).doc(target._id).get()
  return buildSpaceState(joined.data, openid)
}

async function getSpaceState(openid, event) {
  const couple = await findActiveCouple(openid)
  const syncedCouple = await syncUserProfileIfNeeded(couple, openid, event.userInfo)
  return buildSpaceState(syncedCouple, openid)
}

async function updateProfile(openid, event) {
  const nextProfile = sanitizeUserProfile(Object.assign({}, event.userInfo, {
    userId: openid
  }))

  if (!nextProfile.nickName || !nextProfile.avatarUrl) {
    return {
      ok: false,
      message: '请先补全昵称和头像'
    }
  }

  const couple = await findActiveCouple(openid)

  if (!couple) {
    return {
      ok: true,
      coupleInfo: null,
      partnerInfo: null,
      selfProfile: nextProfile
    }
  }

  const syncedCouple = await syncUserProfileIfNeeded(couple, openid, nextProfile)
  const state = buildSpaceState(syncedCouple, openid)

  return Object.assign({}, state, {
    selfProfile: nextProfile
  })
}

async function leaveSpace(openid) {
  const couple = await findActiveCouple(openid)

  if (!couple) {
    return buildSpaceState(null, openid)
  }

  await db.collection(COUPLES_COLLECTION).doc(couple._id).update({
    data: {
      status: 'closed',
      inviteCode: null,
      updatedAt: nowIso(),
      closedAt: nowIso()
    }
  })

  return buildSpaceState(null, openid)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action || 'getSpaceState'

  try {
    if (action === 'createSpace') {
      return await createSpace(OPENID, event)
    }

    if (action === 'joinSpace') {
      return await joinSpace(OPENID, event)
    }

    if (action === 'leaveSpace') {
      return await leaveSpace(OPENID)
    }

    if (action === 'updateProfile') {
      return await updateProfile(OPENID, event)
    }

    return await getSpaceState(OPENID, event)
  } catch (error) {
    console.error('[couple] failed', action, error)
    return {
      ok: false,
      message: error && error.message ? error.message : '共享空间请求失败'
    }
  }
}

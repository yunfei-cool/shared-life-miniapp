const PROFILE_PLACEHOLDER_NAMES = ['未命名用户', '微信用户', '伴侣', '用户']

function normalizeProfile(profile = {}) {
  return profile || {}
}

function hasUsableNickName(profile = {}) {
  profile = normalizeProfile(profile)
  const nickName = String(profile.nickName || '').trim()
  return !!nickName && !PROFILE_PLACEHOLDER_NAMES.includes(nickName)
}

function hasShareableAvatar(profile = {}) {
  profile = normalizeProfile(profile)
  const avatarUrl = String(profile.avatarUrl || '').trim()

  if (!avatarUrl) {
    return false
  }

  return avatarUrl.indexOf('cloud://') === 0 || /^https?:\/\//.test(avatarUrl)
}

function hasDisplayProfile(profile = {}) {
  return hasUsableNickName(profile) && hasShareableAvatar(profile)
}

function getDisplayName(profile = {}, fallback = '') {
  profile = normalizeProfile(profile)
  return hasUsableNickName(profile) ? String(profile.nickName || '').trim() : fallback
}

function getSelfDisplayName(globalData = {}, fallback = '我') {
  return getDisplayName(globalData.userInfo || {}, fallback)
}

function getPartnerDisplayName(globalData = {}, fallback = '伴侣') {
  return getDisplayName(globalData.partnerInfo || {}, fallback)
}

function getDisplayNameByUserId(userId, globalData = {}, fallbacks = {}) {
  const selfFallback = fallbacks.selfFallback || '我'
  const partnerFallback = fallbacks.partnerFallback || '伴侣'
  const sharedFallback = fallbacks.sharedFallback || '共同'

  if (!userId) {
    return sharedFallback
  }

  if (userId === globalData.userId) {
    return getSelfDisplayName(globalData, selfFallback)
  }

  if (globalData.partnerInfo && userId === globalData.partnerInfo.userId) {
    return getPartnerDisplayName(globalData, partnerFallback)
  }

  if (globalData.coupleInfo && userId === globalData.coupleInfo.creatorUserId) {
    return userId === globalData.userId
      ? getSelfDisplayName(globalData, selfFallback)
      : getPartnerDisplayName(globalData, partnerFallback)
  }

  if (globalData.coupleInfo && userId === globalData.coupleInfo.partnerUserId) {
    return userId === globalData.userId
      ? getSelfDisplayName(globalData, selfFallback)
      : getPartnerDisplayName(globalData, partnerFallback)
  }

  return partnerFallback
}

module.exports = {
  PROFILE_PLACEHOLDER_NAMES,
  getDisplayName,
  getDisplayNameByUserId,
  getPartnerDisplayName,
  getSelfDisplayName,
  hasDisplayProfile,
  hasShareableAvatar
}

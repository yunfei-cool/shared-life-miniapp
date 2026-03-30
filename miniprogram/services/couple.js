const { callCloudFunction, isPreviewMode } = require('./cloud')

function shouldUploadAvatar(avatarUrl = '') {
  const value = String(avatarUrl || '').trim()

  if (!value) {
    return false
  }

  if (value.indexOf('cloud://') === 0 || /^https?:\/\//.test(value)) {
    return false
  }

  return true
}

function getAvatarExtension(avatarUrl = '') {
  const match = String(avatarUrl || '').match(/\.(png|bmp|jpeg|jpg|gif|webp)(?:$|\?)/i)
  const extension = match && match[1] ? match[1].toLowerCase() : 'png'
  return extension === 'jpeg' ? 'jpg' : extension
}

function normalizeSpaceState(result = {}) {
  return {
    coupleInfo: result.coupleInfo || null,
    partnerInfo: result.partnerInfo || null,
    selfProfile: result.selfProfile || null
  }
}

async function getSpaceState(globalData = {}) {
  if (!globalData.isLoggedIn || !globalData.userInfo || isPreviewMode(globalData)) {
    return {
      ok: true,
      coupleInfo: globalData.coupleInfo || null,
      partnerInfo: globalData.partnerInfo || null,
      selfProfile: globalData.userInfo || null
    }
  }

  const result = await callCloudFunction('couple', {
    action: 'getSpaceState',
    userInfo: globalData.userInfo || null
  })

  if (!result.ok) {
    return result
  }

  return Object.assign({
    ok: true
  }, normalizeSpaceState(result))
}

async function createSpace(globalData = {}) {
  const result = await callCloudFunction('couple', {
    action: 'createSpace',
    userInfo: globalData.userInfo || null
  })

  if (!result.ok) {
    return result
  }

  return Object.assign({
    ok: true
  }, normalizeSpaceState(result))
}

async function joinSpace(globalData = {}, inviteCode) {
  const result = await callCloudFunction('couple', {
    action: 'joinSpace',
    inviteCode,
    userInfo: globalData.userInfo || null
  })

  if (!result.ok) {
    return result
  }

  return Object.assign({
    ok: true
  }, normalizeSpaceState(result))
}

async function leaveSpace() {
  const result = await callCloudFunction('couple', {
    action: 'leaveSpace'
  })

  if (!result.ok) {
    return result
  }

  return Object.assign({
    ok: true
  }, normalizeSpaceState(result))
}

async function updateProfile(globalData = {}, userInfo = {}) {
  const result = await callCloudFunction('couple', {
    action: 'updateProfile',
    userInfo
  })

  if (!result.ok) {
    return result
  }

  return Object.assign({
    ok: true
  }, normalizeSpaceState(result))
}

async function uploadProfileAvatar(globalData = {}, avatarUrl = '') {
  if (!shouldUploadAvatar(avatarUrl)) {
    return {
      ok: true,
      avatarUrl: String(avatarUrl || '').trim()
    }
  }

  if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
    return {
      ok: false,
      message: '当前环境不支持头像上传'
    }
  }

  try {
    const extension = getAvatarExtension(avatarUrl)
    const cloudPath = `profile-avatars/${globalData.userId || 'user'}-${Date.now()}.${extension}`
    const result = await wx.cloud.uploadFile({
      cloudPath,
      filePath: avatarUrl
    })

    return {
      ok: true,
      avatarUrl: result.fileID || ''
    }
  } catch (error) {
    return {
      ok: false,
      message: error && error.errMsg ? error.errMsg : '头像上传失败'
    }
  }
}

module.exports = {
  createSpace,
  getSpaceState,
  joinSpace,
  leaveSpace,
  updateProfile,
  uploadProfileAvatar
}

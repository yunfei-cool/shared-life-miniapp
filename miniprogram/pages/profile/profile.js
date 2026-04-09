const app = getApp()
const {
  applyCoupleState,
  clearCoupleState,
  loginUser,
  logoutUser,
  refreshSessionFromCloud,
  saveCoupleState
} = require('../../services/session')
const { createSpace, joinSpace, leaveSpace, updateProfile, uploadProfileAvatar } = require('../../services/couple')
const { getWeRunPermissionState } = require('../../services/steps')
const { getRawStore } = require('../../services/records')
const { getPeriodBounds, isDateKeyInRange } = require('../../utils/date')
const { resolvePairState } = require('../../utils/pair-state')
const { openRecordsWithContext } = require('../../utils/records-entry')

function getEnvVersion() {
  try {
    if (typeof wx.getAccountInfoSync === 'function') {
      const accountInfo = wx.getAccountInfoSync()
      if (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion) {
        return accountInfo.miniProgram.envVersion
      }
    }
  } catch (error) {
    return 'develop'
  }

  return 'develop'
}

function shouldShowPreviewTools() {
  return getEnvVersion() !== 'release'
}

function createPreviewPartner() {
  return {
    userId: 'partner_demo',
    nickName: '小美',
    avatarUrl: '',
    city: '上海'
  }
}

function buildEmptySummary() {
  return {
    spendCount: '0 笔',
    todoCount: '0 项'
  }
}

function buildStepSyncView(permissionState = {}, pairState = 'guest') {
  if (pairState !== 'paired') {
    return {
      label: '去运动页管理',
      detail: '连接共享空间后，再同步双方的微信步数。'
    }
  }

  if (!permissionState.supported) {
    return {
      label: '当前微信不支持',
      detail: '这个微信版本还不能同步微信运动。'
    }
  }

  if (permissionState.authorized) {
    return {
      label: '已开启',
      detail: '打开首页或运动页时，会自动同步最近步数。'
    }
  }

  return {
    label: '去开启',
    detail: '去「记录 > 运动」开启后，会自动同步最近 30 天步数。'
  }
}

const PROFILE_PLACEHOLDER_NAMES = ['未命名用户', '微信用户', '伴侣', '用户']

function hasUsableNickName(profile = {}) {
  profile = profile || {}
  const nickName = String(profile.nickName || '').trim()
  return !!nickName && !PROFILE_PLACEHOLDER_NAMES.includes(nickName)
}

function hasShareableAvatar(profile = {}) {
  profile = profile || {}
  const avatarUrl = String(profile.avatarUrl || '').trim()

  if (!avatarUrl) {
    return false
  }

  return avatarUrl.indexOf('cloud://') === 0 || /^https?:\/\//.test(avatarUrl)
}

function hasCompleteProfile(profile = {}) {
  profile = profile || {}
  return hasUsableNickName(profile) && hasShareableAvatar(profile)
}

function getDisplayName(profile = {}, fallback = '去完善资料') {
  profile = profile || {}
  return hasUsableNickName(profile) ? String(profile.nickName || '').trim() : fallback
}

function getProfileInitial(profile = {}, fallback = '我') {
  const displayName = getDisplayName(profile, fallback)
  return String(displayName || fallback).trim().slice(0, 1) || fallback
}

function createProfileDraft(profile = {}) {
  profile = profile || {}
  const nickName = String(profile.nickName || '').trim()

  return {
    nickName: PROFILE_PLACEHOLDER_NAMES.includes(nickName) ? '' : nickName,
    avatarUrl: String(profile.avatarUrl || '').trim(),
    city: String(profile.city || '').trim()
  }
}

async function buildSummary(pairState, globalData = {}) {
  if (pairState !== 'paired') {
    return buildEmptySummary()
  }

  try {
    const store = await getRawStore(globalData)
    const monthBounds = getPeriodBounds('monthly')
    const monthExpenses = store.expenses.filter((item) => isDateKeyInRange(item.occurredOn, monthBounds))
    const openTodos = store.todos.filter((item) => item.status === 'open')

    return {
      spendCount: `${monthExpenses.length} 笔`,
      todoCount: `${openTodos.length} 项`
    }
  } catch (error) {
    return buildEmptySummary()
  }
}

Page({
  data: {
    isLoading: true,
    isLoggedIn: false,
    userInfo: null,
    pairState: 'guest',
    coupleInfo: null,
    partnerInfo: null,
    partnerInitial: 'TA',
    showPreviewTools: shouldShowPreviewTools(),
    stepSyncStatusLabel: '去运动页管理',
    stepSyncStatusDetail: '连接共享空间后，再同步双方的微信步数。',
    categories: ['餐饮', '出行', '日用', '礼物', '房租'],
    summary: buildEmptySummary(),
    profileEditorVisible: false,
    profileDraft: createProfileDraft(),
    userDisplayName: '去完善资料',
    partnerDisplayName: '待对方完善资料',
    userInitial: '我',
    profileNeedsAttention: false,
    partnerProfileNeedsAttention: false,
    profileActionLabel: '完善资料',
    profileHint: ''
  },

  onLoad() {
  },

  onShow() {
    this.refreshPage()
  },

  async refreshPage() {
    this.setData({
      isLoading: true
    })

    let globalData = app.globalData || {}

    try {
      const refreshed = await refreshSessionFromCloud(app)

      if (!refreshed.ok) {
        wx.showToast({
          title: refreshed.message || '空间状态更新失败',
          icon: 'none'
        })
      } else {
        globalData = refreshed.session || app.globalData || {}
      }
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : '空间状态更新失败',
        icon: 'none'
      })
    }

    const pairState = resolvePairState(globalData)
    const permissionState = await getWeRunPermissionState()

    const summary = await buildSummary(pairState, globalData)
    const stepSyncView = buildStepSyncView(permissionState, pairState)
    const selfProfile = globalData.userInfo || null
    const partnerProfile = globalData.partnerInfo || null
    const userDisplayName = getDisplayName(selfProfile, '去完善资料')
    const partnerDisplayName = getDisplayName(partnerProfile, '待对方完善资料')
    const profileNeedsAttention = !!selfProfile && !hasCompleteProfile(selfProfile)
    const partnerProfileNeedsAttention = pairState === 'paired' && (!!partnerProfile && !hasCompleteProfile(partnerProfile))

    this.setData({
      isLoading: false,
      isLoggedIn: !!globalData.isLoggedIn,
      userInfo: globalData.userInfo || null,
      pairState,
      coupleInfo: globalData.coupleInfo || null,
      partnerInfo: globalData.partnerInfo || null,
      userInitial: getProfileInitial(selfProfile, '我'),
      partnerInitial: getProfileInitial(partnerProfile, 'TA'),
      showPreviewTools: shouldShowPreviewTools(),
      stepSyncStatusLabel: stepSyncView.label,
      stepSyncStatusDetail: stepSyncView.detail,
      summary,
      userDisplayName,
      partnerDisplayName,
      profileNeedsAttention,
      partnerProfileNeedsAttention,
      profileActionLabel: profileNeedsAttention ? '完善资料' : '更新资料',
      profileHint: profileNeedsAttention
        ? '先补全昵称和头像，首页的启动流程才会完整。'
        : '昵称和头像会同步显示在共享空间里。'
    })
  },

  onLoginTap() {
    if (!wx.getUserProfile) {
      wx.showToast({
        title: '当前微信版本不支持获取资料',
        icon: 'none'
      })
      return
    }

    wx.getUserProfile({
      desc: '用于建立共享生活空间',
      success: async (res) => {
        const result = await loginUser(app, res.userInfo)

        if (!result.ok) {
          wx.showToast({
            title: result.message || '登录失败',
            icon: 'none'
          })
          return
        }

        wx.showToast({
          title: '登录成功',
          icon: 'success'
        })

        await this.refreshPage()
      }
    })
  },

  onCreateCoupleTap() {
    if (!this.data.isLoggedIn) {
      this.onLoginTap()
      return
    }

    wx.showModal({
      title: '创建共享空间',
      content: '创建后会生成邀请码，发给对方即可一起加入。',
      confirmText: '创建',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        const result = await createSpace(app.globalData)

        if (!result.ok) {
          wx.showToast({
            title: result.message || '创建失败',
            icon: 'none'
          })
          return
        }

        applyCoupleState(app, result.coupleInfo, result.partnerInfo, result.selfProfile)

        wx.showToast({
          title: '空间已创建',
          icon: 'success'
        })

        await this.refreshPage()
      }
    })
  },

  onJoinCoupleTap() {
    if (!this.data.isLoggedIn) {
      this.onLoginTap()
      return
    }

    wx.showModal({
      title: '加入共享空间',
      content: '',
      editable: true,
      placeholderText: '请输入 8 位邀请码',
      success: async (res) => {
        if (!res.confirm || !res.content) {
          return
        }

        const inviteCode = res.content.trim().toUpperCase()
        const result = await joinSpace(app.globalData, inviteCode)

        if (!result.ok) {
          wx.showToast({
            title: result.message || '加入失败',
            icon: 'none'
          })
          return
        }

        applyCoupleState(app, result.coupleInfo, result.partnerInfo, result.selfProfile)

        wx.showToast({
          title: '已进入共享空间',
          icon: 'success'
        })

        await this.refreshPage()
      }
    })
  },

  onPreviewCoupleTap() {
    if (!this.data.isLoggedIn) {
      this.onLoginTap()
      return
    }

    const currentUserId = app.globalData.userId
    const currentCouple = this.data.coupleInfo || null
    const previewCouple = currentCouple ? Object.assign({}, currentCouple, {
      status: 'paired',
      isPreview: true,
      previewOriginStatus: currentCouple.status || 'single',
      partnerUserId: 'partner_demo'
    }) : {
      id: `preview_${Date.now()}`,
      createdAt: new Date().toISOString().slice(0, 10),
      status: 'paired',
      inviteCode: '',
      creatorUserId: currentUserId,
      partnerUserId: 'partner_demo',
      isPreview: true,
      previewOriginStatus: 'single'
    }

    saveCoupleState(app, previewCouple, createPreviewPartner())

    wx.showToast({
      title: '已进入本地预览',
      icon: 'success'
    })

    this.refreshPage()
  },

  onExitPreviewTap() {
    const currentCouple = this.data.coupleInfo || null

    if (!currentCouple || !currentCouple.isPreview) {
      return
    }

    if (currentCouple.previewOriginStatus === 'invited') {
      const restoredCouple = Object.assign({}, currentCouple, {
        status: 'invited',
        partnerUserId: null
      })

      delete restoredCouple.isPreview
      delete restoredCouple.previewOriginStatus

      saveCoupleState(app, restoredCouple, null)
    } else {
      clearCoupleState(app)
    }

    wx.showToast({
      title: '已退出本地预览',
      icon: 'success'
    })

    this.refreshPage()
  },

  onCopyInviteCode() {
    const inviteCode = this.data.coupleInfo && this.data.coupleInfo.inviteCode

    if (!inviteCode) {
      wx.showToast({
        title: '当前没有邀请码',
        icon: 'none'
      })
      return
    }

    wx.setClipboardData({
      data: inviteCode,
      success: () => {
        wx.showToast({
          title: '邀请码已复制',
          icon: 'success'
        })
      }
    })
  },

  onManageStepSyncTap() {
    openRecordsWithContext({
      segment: 'workout'
    })
  },

  onProfileEditTap() {
    this.setData({
      profileEditorVisible: true,
      profileDraft: createProfileDraft(this.data.userInfo || {})
    })
  },

  onProfileEditCancelTap() {
    this.setData({
      profileEditorVisible: false,
      profileDraft: createProfileDraft(this.data.userInfo || {})
    })
  },

  onProfileNickNameInput(e) {
    this.setData({
      'profileDraft.nickName': e.detail.value
    })
  },

  onChooseAvatar(e) {
    this.setData({
      'profileDraft.avatarUrl': e.detail.avatarUrl || ''
    })
  },

  async onProfileSaveTap() {
    if (!this.data.isLoggedIn) {
      return
    }

    const avatarUploadResult = await uploadProfileAvatar(app.globalData || {}, (this.data.profileDraft && this.data.profileDraft.avatarUrl) || '')

    if (!avatarUploadResult.ok) {
      wx.showToast({
        title: avatarUploadResult.message || '头像上传失败',
        icon: 'none'
      })
      return
    }

    const nextProfile = Object.assign({}, this.data.userInfo || {}, this.data.profileDraft || {}, {
      avatarUrl: avatarUploadResult.avatarUrl || ''
    })
    const result = await updateProfile(app.globalData || {}, nextProfile)

    if (!result.ok) {
      wx.showToast({
        title: result.message || '资料保存失败',
        icon: 'none'
      })
      return
    }

    applyCoupleState(
      app,
      Object.prototype.hasOwnProperty.call(result, 'coupleInfo') ? result.coupleInfo : (app.globalData.coupleInfo || null),
      Object.prototype.hasOwnProperty.call(result, 'partnerInfo') ? result.partnerInfo : (app.globalData.partnerInfo || null),
      result.selfProfile || nextProfile
    )

    this.setData({
      profileEditorVisible: false
    })

    wx.showToast({
      title: '资料已更新',
      icon: 'success'
    })

    await this.refreshPage()
  },

  onLeaveCoupleTap() {
    wx.showModal({
      title: '离开共享空间',
      content: '这会关闭当前共享空间，但保留你的登录信息。',
      confirmText: '离开',
      confirmColor: '#d1495b',
      success: async (res) => {
        if (!res.confirm) {
          return
        }

        if (this.data.coupleInfo && this.data.coupleInfo.isPreview) {
          this.onExitPreviewTap()
          return
        } else {
          const result = await leaveSpace()

          if (!result.ok) {
            wx.showToast({
              title: result.message || '离开失败',
              icon: 'none'
            })
            return
          }

          applyCoupleState(app, result.coupleInfo, result.partnerInfo, result.selfProfile)
        }

        wx.showToast({
          title: '已回到单人状态',
          icon: 'success'
        })

        await this.refreshPage()
      }
    })
  },

  onHelpTap() {
    wx.showModal({
      title: '使用说明',
      content: '这是一个两个人一起管理生活的小程序。先连上共享空间，再设置预算、记共同支出、分配待办，首页和报告就会开始工作。',
      showCancel: false
    })
  },

  onPrivacyTap() {
    wx.showModal({
      title: '隐私与数据说明',
      content: '我们只会保存你主动填写的资料，以及你们共同使用时产生的账单、待办、纪念日、预算、运动和步数汇总。微信步数只在你主动打开小程序时同步，不做后台静默抓取。',
      showCancel: false
    })
  },

  onDeleteInfoTap() {
    wx.showModal({
      title: '数据删除与账号注销',
      content: '如果你要彻底停止使用，可以先在共享空间中离开，再退出登录。若需要删除已有共享数据，请两个人都确认后，联系维护者处理当前云端数据。',
      showCancel: false
    })
  },

  onLogoutTap() {
    wx.showModal({
      title: '退出登录',
      content: '退出后会清除当前登录状态，下次打开需要重新登录。',
      confirmText: '退出',
      confirmColor: '#d1495b',
      success: (res) => {
        if (!res.confirm) {
          return
        }

        logoutUser(app)
        this.refreshPage()
      }
    })
  }
})

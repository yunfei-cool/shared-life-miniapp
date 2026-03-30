function resolvePairState(globalData = {}) {
  if (!globalData.isLoggedIn || !globalData.userInfo) {
    return 'guest'
  }

  if (!globalData.hasCouple || !globalData.coupleInfo) {
    return 'single'
  }

  const status = globalData.coupleInfo.status

  if (status === 'pending' || status === 'invited') {
    return 'invited'
  }

  return 'paired'
}

module.exports = {
  resolvePairState
}

function normalizeResult(result = {}) {
  if (typeof result !== 'object' || result === null) {
    return {
      ok: false,
      message: '云函数返回格式不正确'
    }
  }

  if (Object.prototype.hasOwnProperty.call(result, 'ok')) {
    return result
  }

  return Object.assign({
    ok: true
  }, result)
}

function getErrorMessage(error) {
  if (!error) {
    return '请求失败，请稍后再试'
  }

  if (typeof error === 'string') {
    return error
  }

  if (error.errMsg) {
    return error.errMsg
  }

  if (error.message) {
    return error.message
  }

  return '请求失败，请稍后再试'
}

function callCloudFunction(name, data = {}) {
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name,
      data,
      success: (res) => {
        resolve(normalizeResult(res.result))
      },
      fail: (error) => {
        resolve({
          ok: false,
          message: getErrorMessage(error)
        })
      }
    })
  })
}

function isPreviewMode(globalData = {}) {
  return !!(globalData.coupleInfo && globalData.coupleInfo.isPreview)
}

module.exports = {
  callCloudFunction,
  getErrorMessage,
  isPreviewMode
}

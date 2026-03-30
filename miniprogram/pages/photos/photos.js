// photos.js - 照片页面
const app = getApp()

Page({
  data: {
    // 用户信息
    userInfo: null,
    hasUserInfo: false,
    hasCouple: false,

    // 照片数据
    photos: [], // 照片列表
    isLoading: true,
    isRefreshing: false,

    // 筛选状态
    filterType: 'all', // 'all', 'me', 'partner', 'recent'
    selectedAlbum: 'all', // 相册筛选

    // 上传状态
    isUploading: false,
    uploadProgress: 0,

    // 预览状态
    previewIndex: 0,
    showPreview: false,

    // 编辑模式
    editMode: false,
    selectedPhotos: []
  },

  onLoad: function(options) {
    this.initPage()
  },

  onShow: function() {
    this.checkUserStatus()
    this.loadPhotos()
  },

  onPullDownRefresh: function() {
    this.refreshPhotos()
  },

  // 初始化页面
  initPage: function() {
    // 设置页面标题
    wx.setNavigationBarTitle({
      title: '照片'
    })
  },

  // 检查用户状态
  checkUserStatus: function() {
    const userInfo = app.globalData.userInfo
    const hasCouple = app.globalData.hasCouple

    this.setData({
      userInfo: userInfo,
      hasUserInfo: !!userInfo,
      hasCouple: hasCouple
    })

    // 如果未登录或没有情侣空间，显示空状态
    if (!userInfo || !hasCouple) {
      this.setData({ isLoading: false })
    }
  },

  // 加载照片
  loadPhotos: function() {
    if (!this.data.hasUserInfo || !this.data.hasCouple) {
      this.setData({ isLoading: false })
      return
    }

    this.setData({ isLoading: true })

    // 模拟数据加载
    setTimeout(() => {
      // 模拟照片数据
      const mockPhotos = [
        {
          id: '1',
          url: 'https://example.com/photo1.jpg',
          thumbnail: 'https://example.com/photo1-thumb.jpg',
          title: '周末旅行',
          description: '美丽的风景',
          timestamp: '2026-03-25 15:20',
          date: '2天前',
          uploadedBy: 'me',
          album: '旅行',
          likes: 3,
          comments: 2
        },
        {
          id: '2',
          url: 'https://example.com/photo2.jpg',
          thumbnail: 'https://example.com/photo2-thumb.jpg',
          title: '一起做饭',
          description: '美味的晚餐',
          timestamp: '2026-03-24 18:30',
          date: '3天前',
          uploadedBy: 'partner',
          album: '日常',
          likes: 5,
          comments: 1
        },
        {
          id: '3',
          url: 'https://example.com/photo3.jpg',
          thumbnail: 'https://example.com/photo3-thumb.jpg',
          title: '看电影',
          description: '影院合影',
          timestamp: '2026-03-23 20:15',
          date: '4天前',
          uploadedBy: 'both',
          album: '娱乐',
          likes: 8,
          comments: 3
        },
        {
          id: '4',
          url: 'https://example.com/photo4.jpg',
          thumbnail: 'https://example.com/photo4-thumb.jpg',
          title: '公园散步',
          description: '春天的花朵',
          timestamp: '2026-03-22 14:10',
          date: '5天前',
          uploadedBy: 'me',
          album: '旅行',
          likes: 2,
          comments: 0
        },
        {
          id: '5',
          url: 'https://example.com/photo5.jpg',
          thumbnail: 'https://example.com/photo5-thumb.jpg',
          title: '早餐时间',
          description: '丰盛的早餐',
          timestamp: '2026-03-21 08:45',
          date: '6天前',
          uploadedBy: 'partner',
          album: '日常',
          likes: 4,
          comments: 2
        },
        {
          id: '6',
          url: 'https://example.com/photo6.jpg',
          thumbnail: 'https://example.com/photo6-thumb.jpg',
          title: '游戏之夜',
          description: '一起玩游戏',
          timestamp: '2026-03-20 21:30',
          date: '7天前',
          uploadedBy: 'both',
          album: '娱乐',
          likes: 6,
          comments: 4
        }
      ]

      this.setData({
        photos: mockPhotos,
        isLoading: false
      })
    }, 800)
  },

  // 刷新照片
  refreshPhotos: function() {
    this.setData({ isRefreshing: true })

    setTimeout(() => {
      // 重新加载数据
      this.loadPhotos()
      this.setData({ isRefreshing: false })
      wx.stopPullDownRefresh()
    }, 1000)
  },

  // 上传照片
  onUploadTap: function() {
    if (!this.data.hasUserInfo || !this.data.hasCouple) {
      wx.showToast({
        title: '请先登录并创建情侣空间',
        icon: 'none'
      })
      return
    }

    wx.chooseImage({
      count: 9, // 最多选择9张
      sizeType: ['original', 'compressed'], // 可以指定是原图还是压缩图
      sourceType: ['album', 'camera'], // 可以指定来源是相册还是相机
      success: (res) => {
        // 开始上传
        this.uploadPhotos(res.tempFilePaths)
      }
    })
  },

  // 上传照片到云存储
  uploadPhotos: function(filePaths) {
    this.setData({
      isUploading: true,
      uploadProgress: 0
    })

    const totalFiles = filePaths.length
    let uploadedCount = 0

    // 模拟上传过程
    const uploadInterval = setInterval(() => {
      uploadedCount++
      const progress = Math.round((uploadedCount / totalFiles) * 100)

      this.setData({
        uploadProgress: progress
      })

      if (uploadedCount >= totalFiles) {
        clearInterval(uploadInterval)

        setTimeout(() => {
          this.setData({
            isUploading: false,
            uploadProgress: 0
          })

          wx.showToast({
            title: '上传成功',
            icon: 'success'
          })

          // 刷新照片列表
          this.refreshPhotos()
        }, 500)
      }
    }, 300)
  },

  // 查看照片
  onPhotoTap: function(e) {
    const { index } = e.currentTarget.dataset
    const urls = this.data.photos.map(photo => photo.url)

    wx.previewImage({
      current: urls[index],
      urls: urls
    })
  },

  // 筛选照片
  onFilterTap: function(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ filterType: type })

    // TODO: 实现筛选逻辑
    wx.showToast({
      title: `筛选: ${type === 'all' ? '全部' : type === 'me' ? '我的' : type === 'partner' ? '伴侣' : '最近'}`,
      icon: 'none'
    })
  },

  // 切换编辑模式
  toggleEditMode: function() {
    const editMode = !this.data.editMode
    this.setData({
      editMode: editMode,
      selectedPhotos: editMode ? [] : []
    })
  },

  // 选择照片（编辑模式）
  onPhotoSelect: function(e) {
    const { id } = e.currentTarget.dataset
    const { selectedPhotos } = this.data

    const index = selectedPhotos.indexOf(id)
    if (index > -1) {
      selectedPhotos.splice(index, 1)
    } else {
      selectedPhotos.push(id)
    }

    this.setData({ selectedPhotos })
  },

  // 删除选中照片
  deleteSelectedPhotos: function() {
    const { selectedPhotos, photos } = this.data

    if (selectedPhotos.length === 0) {
      wx.showToast({
        title: '请选择要删除的照片',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '删除照片',
      content: `确定要删除选中的 ${selectedPhotos.length} 张照片吗？`,
      confirmText: '删除',
      confirmColor: '#D63031',
      success: (res) => {
        if (res.confirm) {
          // 模拟删除
          const newPhotos = photos.filter(photo => !selectedPhotos.includes(photo.id))

          this.setData({
            photos: newPhotos,
            selectedPhotos: [],
            editMode: false
          })

          wx.showToast({
            title: '删除成功',
            icon: 'success'
          })
        }
      }
    })
  },

  // 查看相册
  onAlbumTap: function(e) {
    const album = e.currentTarget.dataset.album
    this.setData({ selectedAlbum: album })

    // TODO: 实现相册筛选
    wx.showToast({
      title: `相册: ${album}`,
      icon: 'none'
    })
  },

  // 点赞照片
  onLikeTap: function(e) {
    const { id } = e.currentTarget.dataset
    const { photos } = this.data

    const updatedPhotos = photos.map(photo => {
      if (photo.id === id) {
        return { ...photo, likes: photo.likes + 1 }
      }
      return photo
    })

    this.setData({ photos: updatedPhotos })

    // 显示点赞动画
    wx.showToast({
      title: '已点赞',
      icon: 'success',
      duration: 1000
    })
  }
})
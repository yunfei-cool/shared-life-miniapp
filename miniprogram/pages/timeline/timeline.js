// timeline.js - 时间线页面
const app = getApp()

Page({
  data: {
    // 用户信息
    userInfo: null,
    hasUserInfo: false,
    hasCouple: false,

    // 时间线数据
    timelineEvents: [], // 时间线事件数组
    isLoading: true,
    isRefreshing: false,

    // 筛选状态
    filterType: 'all', // 'all', 'todos', 'photos', 'anniversaries'
    filterDate: null, // 日期筛选
  },

  onLoad: function(options) {
    this.initPage()
  },

  onShow: function() {
    this.checkUserStatus()
    this.loadTimelineData()
  },

  onPullDownRefresh: function() {
    this.refreshTimelineData()
  },

  // 初始化页面
  initPage: function() {
    // 设置页面标题
    wx.setNavigationBarTitle({
      title: '时间线'
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
      this.showEmptyState()
    }
  },

  // 加载时间线数据
  loadTimelineData: function() {
    if (!this.data.hasUserInfo || !this.data.hasCouple) {
      this.setData({ isLoading: false })
      return
    }

    this.setData({ isLoading: true })

    // 模拟数据加载
    setTimeout(() => {
      // 模拟时间线事件
      const mockEvents = [
        {
          id: '1',
          type: 'todo_completed',
          title: '完成待办：看电影',
          description: '一起看了《星际穿越》',
          timestamp: '2026-03-26 20:30',
          date: '昨天',
          user: 'me',
          icon: '✅',
          color: '#00B894'
        },
        {
          id: '2',
          type: 'photo_uploaded',
          title: '上传新照片',
          description: '周末旅行的美景',
          timestamp: '2026-03-25 15:20',
          date: '2天前',
          user: 'partner',
          icon: '📸',
          color: '#6C5CE7'
        },
        {
          id: '3',
          type: 'anniversary_created',
          title: '添加纪念日',
          description: '在一起100天纪念',
          timestamp: '2026-03-24 10:15',
          date: '3天前',
          user: 'me',
          icon: '🎉',
          color: '#FF6B8B'
        },
        {
          id: '4',
          type: 'todo_created',
          title: '创建待办：买groceries',
          description: '周末一起做饭',
          timestamp: '2026-03-23 09:45',
          date: '4天前',
          user: 'both',
          icon: '📝',
          color: '#4ECDC4'
        }
      ]

      this.setData({
        timelineEvents: mockEvents,
        isLoading: false
      })
    }, 800)
  },

  // 刷新时间线数据
  refreshTimelineData: function() {
    this.setData({ isRefreshing: true })

    setTimeout(() => {
      // 重新加载数据
      this.loadTimelineData()
      this.setData({ isRefreshing: false })
      wx.stopPullDownRefresh()
    }, 1000)
  },

  // 显示空状态
  showEmptyState: function() {
    this.setData({ isLoading: false })
  },

  // 筛选时间线
  onFilterTap: function(e) {
    const type = e.currentTarget.dataset.type
    this.setData({ filterType: type })

    // 根据筛选类型重新加载数据
    // TODO: 实现筛选逻辑
  },

  // 查看事件详情
  onEventTap: function(e) {
    const { id, type } = e.currentTarget.dataset

    switch(type) {
      case 'todo_completed':
      case 'todo_created':
        wx.navigateTo({
          url: '/pages/index/index?type=todo&id=' + id
        })
        break
      case 'photo_uploaded':
        wx.navigateTo({
          url: '/pages/photos/photos'
        })
        break
      case 'anniversary_created':
        wx.navigateTo({
          url: '/pages/index/index?type=anniversary&id=' + id
        })
        break
      default:
        wx.showToast({
          title: '查看详情',
          icon: 'none'
        })
    }
  },

  // 添加新事件
  onAddEventTap: function() {
    wx.showActionSheet({
      itemList: ['添加待办', '上传照片', '添加纪念日'],
      success: (res) => {
        switch(res.tapIndex) {
          case 0:
            wx.navigateTo({
              url: '/pages/index/index?type=todo'
            })
            break
          case 1:
            wx.navigateTo({
              url: '/pages/photos/photos?action=upload'
            })
            break
          case 2:
            wx.navigateTo({
              url: '/pages/index/index?type=anniversary'
            })
            break
        }
      }
    })
  }
})
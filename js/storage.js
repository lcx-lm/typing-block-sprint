/* ============================================================
   字块冲刺 · 本地存储封装
   统一前缀 typingBlock_
   localStorage 不可用时降级为内存存储，并只提示一次
   ============================================================ */

(function (global) {
  'use strict';

  var PREFIX = 'typingBlock_';
  var memory = {};
  var usable = true;
  var warned = false;
  var noticeFn = null;

  // 探测 localStorage 是否可用（隐私模式 / 禁用 Cookie 时会抛异常）
  try {
    var probe = PREFIX + '__probe';
    global.localStorage.setItem(probe, '1');
    global.localStorage.removeItem(probe);
  } catch (e) {
    usable = false;
  }

  function warnOnce() {
    if (warned) return;
    warned = true;
    if (typeof noticeFn === 'function') {
      noticeFn('浏览器本地存储不可用，本次数据仅保存在当前页面，刷新后会丢失。');
    } else if (global.console && console.warn) {
      console.warn('[字块冲刺] localStorage 不可用，已降级为内存存储。');
    }
  }

  var TBStore = {
    PREFIX: PREFIX,

    isUsable: function () {
      return usable;
    },

    // 注册降级提示的回调（由 UI 层注入，避免弹出原生 alert）
    onDegrade: function (fn) {
      noticeFn = fn;
    },

    get: function (key, fallback) {
      var k = PREFIX + key;
      try {
        if (!usable) {
          warnOnce();
          return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : fallback;
        }
        var v = global.localStorage.getItem(k);
        return v === null ? fallback : v;
      } catch (e) {
        warnOnce();
        return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : fallback;
      }
    },

    set: function (key, value) {
      var k = PREFIX + key;
      try {
        if (!usable) {
          warnOnce();
          memory[k] = String(value);
          return false;
        }
        global.localStorage.setItem(k, String(value));
        return true;
      } catch (e) {
        warnOnce();
        memory[k] = String(value);
        return false;
      }
    },

    remove: function (key) {
      var k = PREFIX + key;
      try {
        if (usable) global.localStorage.removeItem(k);
      } catch (e) {
        /* 忽略：删除失败不影响主流程 */
      }
      delete memory[k];
    },

    getJSON: function (key, fallback) {
      var raw = this.get(key, null);
      if (raw === null) return fallback;
      try {
        var val = JSON.parse(raw);
        return val === null || val === undefined ? fallback : val;
      } catch (e) {
        // 数据损坏时回退默认值，避免整页崩溃
        return fallback;
      }
    },

    setJSON: function (key, value) {
      try {
        return this.set(key, JSON.stringify(value));
      } catch (e) {
        return false;
      }
    },

    // 重置所有本作品数据
    resetAll: function () {
      var keys = ['nickname', 'bestScore', 'bestWpm', 'leaderboard', 'settings', 'helpSeen', 'guideSeen', 'levelProgress', 'wrongBook', 'rankPoints', 'rankRecord', 'history'];
      for (var i = 0; i < keys.length; i++) {
        this.remove(keys[i]);
      }
      memory = {};
    }
  };

  global.TBStore = TBStore;
})(window);

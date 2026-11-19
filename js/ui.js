/* ============================================================
   字块冲刺 · UI 层
   负责：页面切换、HUD 渲染、弹窗、提示、排行榜表格
   所有用户数据一律用 textContent 写入，避免 XSS
   ============================================================ */

(function (global) {
  'use strict';

  var UI = {
    els: {},

    init: function () {
      var e = this.els;
      e.screens = {
        HOME: document.getElementById('screen-home'),
        SELECT: document.getElementById('screen-select'),
        PLAYING: document.getElementById('screen-play'),
        RESULT: document.getElementById('screen-result')
      };
      e.gameArea = document.getElementById('gameArea');
      e.pauseMask = document.getElementById('pauseMask');
      e.flash = document.getElementById('flash');
      e.toast = document.getElementById('toast');
      e.modalRoot = document.getElementById('modalRoot');

      e.hudScore = document.getElementById('hudScore');
      e.hudLevel = document.getElementById('hudLevel');
      e.hudTarget = document.getElementById('hudTarget');
      e.hudLevelItem = document.getElementById('hudLevelItem');
      e.hudTargetItem = document.getElementById('hudTargetItem');
      e.hudAiItem = document.getElementById('hudAiItem');
      e.hudAi = document.getElementById('hudAi');
      e.hudTime = document.getElementById('hudTime');
      e.hudCombo = document.getElementById('hudCombo');
      e.hudInput = document.getElementById('hudInput');
      e.hearts = document.getElementById('hudHearts');
      this._lives = 3;
      e.nickLabel = document.getElementById('nickLabel');
      e.homeBest = document.getElementById('homeBest');
      e.homeBestWpm = document.getElementById('homeBestWpm');
      e.homeLb = document.getElementById('homeLb');
    },

    /* ---------------- 主题 ---------------- */
    applyTheme: function (theme) {
      var next = theme === 'dark' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
    },

    /* ---------------- 页面切换 ---------------- */
    showScreen: function (name) {
      var map = this.els.screens;
      Object.keys(map).forEach(function (key) {
        var el = map[key];
        if (!el) return;
        el.classList.toggle('is-active', key === name);
      });
      document.body.dataset.state = name;
      this.setPauseMask(false);
      // 切换页面时回到顶部，避免小屏停留在滚动位置
      global.scrollTo(0, 0);
    },

    setPauseMask: function (on) {
      this.els.pauseMask.classList.toggle('is-on', !!on);
    },

    /* ---------------- HUD ---------------- */
    updateHUD: function (d) {
      var e = this.els;
      e.hudScore.textContent = d.score;
      e.hudLevel.textContent = d.level + ' / ' + d.levelTotal;
      e.hudTarget.textContent = d.levelScore + ' / ' + d.levelTarget;
      e.hudTime.textContent = d.time + 's';
      e.hudTime.classList.toggle('is-low', d.time <= 10);
      e.hudCombo.textContent = d.combo;
      e.hudInput.textContent = d.input ? d.input : '—';

      // 单机闯关显示关卡与目标；冲刺 / AI 对战隐藏，只保留分数与倒计时
      var solo = d.mode !== 'sprint' && d.mode !== 'versus';
      if (e.hudLevelItem) e.hudLevelItem.hidden = !solo;
      if (e.hudTargetItem) e.hudTargetItem.hidden = !solo;
      if (e.hudAiItem) e.hudAiItem.hidden = d.mode !== 'versus';
      if (e.hudAi) e.hudAi.textContent = d.aiScore || 0;

      // 生命：3 颗爱心，失去的那颗变成灰色裂纹并播放碎裂动画
      var lives = Math.max(0, Math.min(3, typeof d.lives === 'number' ? d.lives : 3));
      var hearts = e.hearts ? e.hearts.querySelectorAll('.heart') : [];
      var i;
      for (i = 0; i < hearts.length; i++) {
        var lost = i >= lives;
        hearts[i].classList.toggle('is-lost', lost);
        // 新一局恢复的爱心要清掉上一局的碎裂动画残留
        if (!lost) hearts[i].classList.remove('is-breaking');
      }
      if (lives < this._lives && hearts[lives]) {
        var h = hearts[lives];
        h.classList.remove('is-breaking');
        void h.offsetWidth;
        h.classList.add('is-breaking');
      }
      this._lives = lives;
      if (e.hearts) e.hearts.setAttribute('aria-label', '剩余生命 ' + lives + ' 颗');
    },

    updateNickname: function (name) {
      this.els.nickLabel.textContent = name;
    },

    updateHomeStats: function (bestScore, bestWpm) {
      this.els.homeBest.textContent = bestScore;
      this.els.homeBestWpm.textContent = bestWpm;
    },

    /* ---------------- 反馈 ---------------- */
    flash: function () {
      var el = this.els.flash;
      el.classList.remove('is-on');
      // 强制重排以重启动画
      void el.offsetWidth;
      el.classList.add('is-on');
    },

    toast: function (msg) {
      var el = this.els.toast;
      el.textContent = msg;
      el.classList.add('is-on');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(function () {
        el.classList.remove('is-on');
      }, 1700);
    },

    /* ---------------- 排行榜表格 ---------------- */
    renderLeaderboard: function (container, records, limit) {
      container.innerHTML = '';
      var list = (records || []).slice(0, limit || 10);

      if (!list.length) {
        var empty = document.createElement('div');
        empty.className = 'lb-empty';
        empty.textContent = '还没有记录，先来一局吧';
        container.appendChild(empty);
        return;
      }

      var table = document.createElement('table');
      table.className = 'lb-table';

      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      ['#', '昵称', '分数', 'WPM', '准确率', '日期'].forEach(function (title) {
        var th = document.createElement('th');
        th.textContent = title;
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      list.forEach(function (rec, i) {
        var tr = document.createElement('tr');

        var tdRank = document.createElement('td');
        tdRank.className = 'num';
        tdRank.textContent = i + 1;
        tr.appendChild(tdRank);

        var tdName = document.createElement('td');
        tdName.textContent = rec.name || '玩家';
        tr.appendChild(tdName);

        var tdScore = document.createElement('td');
        tdScore.className = 'num';
        tdScore.textContent = rec.score;
        tr.appendChild(tdScore);

        var tdWpm = document.createElement('td');
        tdWpm.className = 'num';
        tdWpm.textContent = rec.wpm;
        tr.appendChild(tdWpm);

        var tdAcc = document.createElement('td');
        tdAcc.className = 'num';
        tdAcc.textContent = rec.accuracy + '%';
        tr.appendChild(tdAcc);

        var tdDate = document.createElement('td');
        tdDate.textContent = rec.date || '—';
        tr.appendChild(tdDate);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    },

    /* ---------------- 弹窗 ---------------- */
    openModal: function (opts) {
      this.closeModal();

      var root = this.els.modalRoot;
      var mask = document.createElement('div');
      mask.className = 'modal-mask';

      var card = document.createElement('div');
      card.className = 'modal-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');

      var title = document.createElement('div');
      title.className = 'modal-title';
      title.textContent = opts.title || '';
      card.appendChild(title);

      var body = document.createElement('div');
      body.className = 'modal-body';
      if (opts.content instanceof Node) {
        body.appendChild(opts.content);
      } else if (typeof opts.content === 'string') {
        // 这里的字符串全部来自代码内静态文案，不含用户输入
        body.innerHTML = opts.content;
      }
      card.appendChild(body);

      if (opts.actions && opts.actions.length) {
        var foot = document.createElement('div');
        foot.className = 'modal-foot';
        opts.actions.forEach(function (act) {
          var btn = document.createElement('button');
          btn.className = 'btn ' + (act.primary ? 'primary' : 'ghost');
          btn.textContent = act.label;
          btn.addEventListener('click', function () {
            if (typeof act.onClick === 'function') act.onClick();
          });
          foot.appendChild(btn);
        });
        card.appendChild(foot);
      }

      mask.appendChild(card);
      root.appendChild(mask);

      // 点击遮罩空白处关闭
      mask.addEventListener('mousedown', function (ev) {
        if (ev.target === mask) UI.closeModal();
      });

      return card;
    },

    closeModal: function () {
      this.els.modalRoot.innerHTML = '';
    },

    confirm: function (title, text, onOk) {
      this.openModal({
        title: title,
        content: '<p>' + text + '</p>',
        actions: [
          { label: '取消', onClick: function () { UI.closeModal(); } },
          { label: '确定', primary: true, onClick: function () { UI.closeModal(); onOk(); } }
        ]
      });
    },

    // 文本输入弹窗：用于修改昵称
    promptText: function (title, value, maxLen, onOk) {
      var wrap = document.createElement('div');

      var tip = document.createElement('p');
      tip.textContent = '最多 ' + maxLen + ' 个字符，保存后立即生效。';
      wrap.appendChild(tip);

      var input = document.createElement('input');
      input.className = 'modal-input';
      input.type = 'text';
      input.maxLength = maxLen;
      input.value = value || '';
      wrap.appendChild(input);

      var card = this.openModal({
        title: title,
        content: wrap,
        actions: [
          { label: '取消', onClick: function () { UI.closeModal(); } },
          {
            label: '保存',
            primary: true,
            onClick: function () {
              var v = input.value.trim().slice(0, maxLen);
              if (!v) {
                UI.toast('昵称不能为空');
                return;
              }
              UI.closeModal();
              onOk(v);
            }
          }
        ]
      });

      setTimeout(function () { input.focus(); }, 30);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var v = input.value.trim().slice(0, maxLen);
          if (!v) {
            UI.toast('昵称不能为空');
            return;
          }
          UI.closeModal();
          onOk(v);
        }
      });

      return card;
    }
  };

  global.UI = UI;
})(window);

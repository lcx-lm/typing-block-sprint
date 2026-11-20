/* ============================================================
   字块冲刺 · UI 层
   负责：页面切换、HUD 渲染、弹窗、提示、排行榜表格
   所有用户数据一律用 textContent 写入，避免 XSS
   ============================================================ */

(function (global) {
  'use strict';

  // 双跑道里的迷你爱心，固定 3 颗
  function fillMiniHearts(box) {
    if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('i');
      dot.className = 'mini-heart';
      box.appendChild(dot);
    }
  }

  function paintMiniHearts(box, lives) {
    if (!box) return;
    var dots = box.querySelectorAll('.mini-heart');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-lost', i >= lives);
    }
  }

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
      e.versusBar = document.getElementById('versusBar');
      e.vbPlayerScore = document.getElementById('vbPlayerScore');
      e.vbAiScore = document.getElementById('vbAiScore');
      e.vbFill = document.getElementById('vbFill');
      e.vbTrack = document.getElementById('vbTrack');
      e.vbHold = document.getElementById('vbHold');
      e.laneWrap = document.getElementById('laneWrap');
      e.lanePlayer = document.getElementById('lanePlayer');
      e.laneAi = document.getElementById('laneAi');
      e.playerMiniHearts = document.getElementById('playerMiniHearts');
      e.aiMiniHearts = document.getElementById('aiMiniHearts');
      e.aiState = document.getElementById('aiState');
      fillMiniHearts(e.playerMiniHearts);
      fillMiniHearts(e.aiMiniHearts);
      this._lives = 3;
      e.nickLabel = document.getElementById('nickLabel');
      e.homeBest = document.getElementById('homeBest');
      e.homeBestWpm = document.getElementById('homeBestWpm');
      e.homeTrend = document.getElementById('homeTrend');
      e.trendSum = document.getElementById('trendSum');
      this._combo = 0;
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

      // 连击动效：连击增加时弹一下，≥5 连进入高亮态
      var combo = typeof d.combo === 'number' ? d.combo : 0;
      if (combo > (this._combo || 0) && combo > 0) {
        e.hudCombo.classList.remove('is-bump');
        void e.hudCombo.offsetWidth;
        e.hudCombo.classList.add('is-bump');
      }
      e.hudCombo.classList.toggle('is-hot', combo >= 5);
      this._combo = combo;

      e.hudInput.textContent = d.input ? d.input : '—';

      // 单机闯关显示关卡与目标；冲刺 / AI 对战 / 错词复习隐藏
      var solo = d.mode === 'solo';
      if (e.hudLevelItem) e.hudLevelItem.hidden = !solo;
      if (e.hudTargetItem) e.hudTargetItem.hidden = !solo;
      if (e.hudAiItem) e.hudAiItem.hidden = d.mode !== 'versus';
      if (e.hudAi) e.hudAi.textContent = d.aiScore || 0;

      // AI 对战：双跑道 + 拔河条
      var versus = d.mode === 'versus';
      if (e.versusBar) e.versusBar.hidden = !versus;
      if (e.laneWrap) e.laneWrap.hidden = !versus;
      if (e.gameArea) e.gameArea.classList.toggle('is-versus', versus);
      if (versus && e.vbFill) {
        var share = typeof d.versusShare === 'number' ? d.versusShare : 0.5;
        share = Math.max(0, Math.min(1, share));
        e.vbFill.style.width = (share * 100).toFixed(1) + '%';
        if (e.vbPlayerScore) e.vbPlayerScore.textContent = d.score;
        if (e.vbAiScore) e.vbAiScore.textContent = d.aiScore || 0;

        var side = d.versusSide || '';
        if (e.vbTrack) {
          e.vbTrack.classList.toggle('is-hot-player', side === 'player');
          e.vbTrack.classList.toggle('is-hot-ai', side === 'ai');
        }
        if (e.vbHold) {
          if (side && d.versusHold > 0) {
            e.vbHold.hidden = false;
            e.vbHold.textContent = (side === 'player' ? '你' : 'AI') + ' 压制 ' +
              Math.max(0, 3 - d.versusHold).toFixed(1) + 's';
          } else {
            e.vbHold.hidden = true;
          }
        }
        paintMiniHearts(e.playerMiniHearts, Math.max(0, Math.min(3, d.lives)));
        paintMiniHearts(e.aiMiniHearts, Math.max(0, Math.min(3,
          typeof d.aiLives === 'number' ? d.aiLives : 3)));
        if (e.aiState) e.aiState.textContent = d.aiState || '等待';
      }

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
      this.els.homeBestWpm.textContent = bestWpm + ' 词/分';
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

    /* ---------------- 成绩记录表格 ---------------- */
    renderHistory: function (container, records) {
      container.innerHTML = '';
      // 最新的一局排在最前
      var list = (records || []).slice().reverse();

      if (!list.length) {
        var empty = document.createElement('div');
        empty.className = 'lb-empty';
        empty.textContent = '还没有记录，先来一局吧';
        container.appendChild(empty);
        return;
      }

      var MODE_NAME = { solo: '单机闯关', sprint: '限时冲刺', versus: 'AI 对战' };

      var table = document.createElement('table');
      table.className = 'lb-table';

      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      ['日期', '模式', '得分', '打字速度', '准确率'].forEach(function (title) {
        var th = document.createElement('th');
        th.textContent = title;
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      list.forEach(function (rec) {
        var tr = document.createElement('tr');

        var tdDate = document.createElement('td');
        tdDate.className = 'lb-date';
        tdDate.textContent = rec.date || '—';
        tr.appendChild(tdDate);

        var tdMode = document.createElement('td');
        tdMode.textContent = MODE_NAME[rec.mode] || '单机闯关';
        tr.appendChild(tdMode);

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

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
    },

    /* ---------------- 成绩趋势 ---------------- */
    renderTrend: function (container, list) {
      if (!container) return;
      container.innerHTML = '';

      var data = (list || []).slice(-10);
      if (data.length < 2) {
        var empty = document.createElement('div');
        empty.className = 'trend-empty';
        empty.textContent = data.length ? '再玩一局就能看到走势' : '还没有成绩记录，先来一局吧';
        container.appendChild(empty);
        if (this.els.trendSum) this.els.trendSum.textContent = '';
        return;
      }

      var max = -Infinity;
      var min = Infinity;
      var total = 0;
      data.forEach(function (d) {
        var s = d.score || 0;
        if (s > max) max = s;
        if (s < min) min = s;
        total += s;
      });
      var avg = total / data.length;

      var NS = 'http://www.w3.org/2000/svg';
      // 宽度取容器实际像素，文字不随留白被放大；容器隐藏时退回 1000
      var W = Math.max(320, Math.round(container.clientWidth || 0) || 1000);
      var H = 168;
      var padL = 44;
      var padR = 14;
      var padT = 16;
      var padB = 26;
      var innerW = W - padL - padR;
      var innerH = H - padT - padB;

      // 纵轴范围：在最低/最高分外留一点余量，避免折线贴边
      var raw = Math.max(1, max - min);
      var lo = Math.max(0, Math.floor(min - raw * 0.2));
      var hi = Math.ceil(max + raw * 0.2);
      if (hi - lo < 1) hi = lo + 1;

      var step = innerW / (data.length - 1);
      var yOf = function (v) {
        return padT + (1 - (v - lo) / (hi - lo)) * innerH;
      };
      var pts = data.map(function (d, i) {
        return {
          x: padL + i * step,
          y: yOf(d.score || 0),
          score: d.score || 0,
          date: d.date || ''
        };
      });

      var chart = document.createElement('div');
      chart.className = 'trend-chart';

      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('class', 'trend-svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', '最近 ' + data.length + ' 局得分走势，平均 ' + Math.round(avg) + ' 分');

      function node(name, attrs, cls) {
        var n = document.createElementNS(NS, name);
        if (attrs) {
          for (var k in attrs) n.setAttribute(k, attrs[k]);
        }
        if (cls) n.setAttribute('class', cls);
        return n;
      }

      // 纵轴：三条横向网格线与分数刻度
      [hi, Math.round((hi + lo) / 2), lo].forEach(function (v) {
        var gy = yOf(v);
        svg.appendChild(node('line', { x1: padL, x2: W - padR, y1: gy, y2: gy }, 'trend-grid'));
        var tick = node('text', { x: padL - 7, y: gy + 4, 'text-anchor': 'end' }, 'trend-tick');
        tick.textContent = v;
        svg.appendChild(tick);
      });

      // 坐标轴：竖轴为分数，横轴为时间先后
      svg.appendChild(node('line', { x1: padL, x2: padL, y1: padT, y2: H - padB }, 'trend-axis'));
      svg.appendChild(node('line', { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB }, 'trend-axis'));

      var used = {};
      [0, Math.floor((data.length - 1) / 2), data.length - 1].forEach(function (i) {
        if (used[i]) return;
        used[i] = true;
        var p = pts[i];
        var label = node('text', {
          x: p.x,
          y: H - padB + 15,
          'text-anchor': i === 0 ? 'start' : (i === data.length - 1 ? 'end' : 'middle')
        }, 'trend-tick');
        label.textContent = p.date ? p.date.slice(5, 10) : ('第 ' + (i + 1) + ' 局');
        svg.appendChild(label);
      });

      // 折线下方的面积
      var dPath = 'M ' + pts[0].x.toFixed(1) + ' ' + (H - padB);
      pts.forEach(function (p) {
        dPath += ' L ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      });
      dPath += ' L ' + pts[pts.length - 1].x.toFixed(1) + ' ' + (H - padB) + ' Z';
      svg.appendChild(node('path', { d: dPath }, 'trend-area'));

      // 折线
      svg.appendChild(node('polyline', {
        points: pts.map(function (p) {
          return p.x.toFixed(1) + ',' + p.y.toFixed(1);
        }).join(' ')
      }, 'trend-line'));

      // 平均线
      var avgY = yOf(avg);
      svg.appendChild(node('line', { x1: padL, x2: W - padR, y1: avgY, y2: avgY }, 'trend-avg'));
      var avgLabel = node('text', { x: W - padR, y: avgY - 5, 'text-anchor': 'end' }, 'trend-avg-label');
      avgLabel.textContent = '平均 ' + Math.round(avg);
      svg.appendChild(avgLabel);

      // 数据点
      var dots = [];
      pts.forEach(function (p, i) {
        var isLast = i === pts.length - 1;
        var dot = node('circle', {
          cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: isLast ? 3.6 : 2.6
        }, 'trend-dot' + (isLast ? ' is-last' : ''));
        svg.appendChild(dot);
        dots.push(dot);
      });

      // 悬停 / 键盘聚焦时显示的分数气泡
      var tip = document.createElement('div');
      tip.className = 'trend-tip';
      tip.setAttribute('aria-hidden', 'true');

      function showTip(i) {
        var p = pts[i];
        tip.innerHTML = '';
        var b = document.createElement('b');
        b.textContent = p.score;
        var sub = document.createElement('span');
        sub.textContent = p.date || ('第 ' + (i + 1) + ' 局');
        tip.appendChild(b);
        tip.appendChild(sub);
        tip.style.left = (p.x / W * 100) + '%';
        tip.style.top = (p.y / H * 100) + '%';
        tip.className = 'trend-tip is-show' +
          (i === 0 ? ' is-left' : (i === pts.length - 1 ? ' is-right' : ''));
        dots.forEach(function (d, k) { d.classList.toggle('is-active', k === i); });
      }
      function hideTip() {
        tip.className = 'trend-tip';
        dots.forEach(function (d) { d.classList.remove('is-active'); });
      }

      // 命中区比圆点大，鼠标和 Tab 键都能触发
      pts.forEach(function (p, i) {
        var hit = node('circle', {
          cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 14,
          tabindex: '0', role: 'button'
        }, 'trend-hit');
        hit.setAttribute('aria-label', '第 ' + (i + 1) + ' 局，' + p.score + ' 分' +
          (p.date ? '，' + p.date : ''));
        hit.addEventListener('mouseenter', function () { showTip(i); });
        hit.addEventListener('mouseleave', hideTip);
        hit.addEventListener('focus', function () { showTip(i); });
        hit.addEventListener('blur', hideTip);
        hit.addEventListener('click', function () { showTip(i); });
        svg.appendChild(hit);
      });

      chart.appendChild(svg);
      chart.appendChild(tip);
      container.appendChild(chart);

      if (this.els.trendSum) {
        this.els.trendSum.textContent = '近 ' + data.length + ' 局 · 最高 ' + max +
          ' · 平均 ' + Math.round(avg);
      }
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

      if (opts.title) {
        var title = document.createElement('div');
        title.className = 'modal-title' + (opts.titleCenter ? ' is-center' : '');
        title.textContent = opts.title;
        card.appendChild(title);
      }

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
        foot.className = 'modal-foot' + (opts.centerActions ? ' is-center' : '');
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

      // 点击遮罩空白处关闭；祝贺弹窗等必须二选一时传 closeOnMask:false
      if (opts.closeOnMask !== false) {
        mask.addEventListener('mousedown', function (ev) {
          if (ev.target === mask) UI.closeModal();
        });
      }

      return card;
    },

    closeModal: function () {
      this.els.modalRoot.innerHTML = '';
    },

    // 礼炮彩带：从屏幕左右下角向斜上方喷出，纯 DOM + CSS，无外部素材
    celebrate: function () {
      var old = document.getElementById('confettiLayer');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var layer = document.createElement('div');
      layer.id = 'confettiLayer';
      layer.className = 'confetti-layer';
      layer.setAttribute('aria-hidden', 'true');

      var colors = ['#5eead4', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#f87171'];
      var total = 64;

      for (var i = 0; i < total; i++) {
        var piece = document.createElement('i');
        piece.className = 'confetti-piece';
        if (i % 5 === 0) piece.classList.add('is-round');

        var fromLeft = i % 2 === 0;
        piece.style.left = fromLeft ? '6%' : '94%';
        piece.style.bottom = '4%';
        piece.style.background = colors[i % colors.length];

        // 左右礼炮口向斜上方喷出，再受重力落下
        var tx = (fromLeft ? 1 : -1) * (60 + Math.random() * 260);
        var ty = -(180 + Math.random() * 340);
        var rot = (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 720);
        piece.style.setProperty('--tx', tx.toFixed(0) + 'px');
        piece.style.setProperty('--ty', ty.toFixed(0) + 'px');
        piece.style.setProperty('--tx2', (tx * 1.25).toFixed(0) + 'px');
        piece.style.setProperty('--ty2', (ty + 320).toFixed(0) + 'px');
        piece.style.setProperty('--rot', rot.toFixed(0) + 'deg');
        piece.style.setProperty('--rot2', (rot * 1.6).toFixed(0) + 'deg');
        piece.style.setProperty('--d', (Math.random() * 0.18).toFixed(2) + 's');
        layer.appendChild(piece);
      }

      document.body.appendChild(layer);
      setTimeout(function () {
        if (layer.parentNode) layer.parentNode.removeChild(layer);
      }, 2600);
    },

    confirm: function (title, text, onOk, opts) {
      this.openModal({
        title: title,
        titleCenter: !!(opts && opts.titleCenter),
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

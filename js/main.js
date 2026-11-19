/* ============================================================
   字块冲刺 · 入口与页面逻辑
   负责：状态机路由、首页/选择页渲染、设置、帮助、结算落库
   ============================================================ */

(function (global) {
  'use strict';

  var ST = global.TBStore;

  var DATA = {
    nickname: '玩家',
    bestScore: 0,
    bestWpm: 0,
    leaderboard: [],
    settings: { sound: true, theme: 'light' },
    helpSeen: false,
    guideSeen: false,
    levelProgress: {}
  };

  // 选择页当前选中项
  var picked = { setKey: 'cet4', diffKey: 'normal', level: 1 };
  // 结算页“再来一局”使用的配置
  var lastConfig = { setKey: 'cet4', diffKey: 'normal', level: 1 };

  /* ---------------- 持久化读取 ---------------- */
  function loadData() {
    DATA.nickname = ST.get('nickname', '玩家') || '玩家';
    DATA.bestScore = parseInt(ST.get('bestScore', '0'), 10) || 0;
    DATA.bestWpm = parseInt(ST.get('bestWpm', '0'), 10) || 0;

    var lb = ST.getJSON('leaderboard', []);
    DATA.leaderboard = Array.isArray(lb) ? lb.filter(function (r) {
      return r && typeof r === 'object' && typeof r.score === 'number';
    }) : [];

    var settings = ST.getJSON('settings', { sound: true, theme: 'light' });
    DATA.settings = {
      sound: !settings || settings.sound !== false,
      theme: settings && settings.theme === 'dark' ? 'dark' : 'light'
    };

    DATA.helpSeen = ST.get('helpSeen', '0') === '1';
    DATA.guideSeen = readFlag('guideSeen');

    var lp = ST.getJSON('levelProgress', {});
    DATA.levelProgress = lp && typeof lp === 'object' && !Array.isArray(lp) ? lp : {};
  }

  /* ---------------- 关卡解锁进度 ----------------
     进度按“词库 + 难度”分别记录，值为已通关的最高关卡。
     ------------------------------------------------ */
  function progressKey(setKey, diffKey) {
    return setKey + ':' + diffKey;
  }

  function clearedLevels(setKey, diffKey) {
    var v = parseInt(DATA.levelProgress[progressKey(setKey, diffKey)], 10);
    return isFinite(v) && v > 0 ? v : 0;
  }

  function unlockedMax(setKey, diffKey) {
    return Math.min(Game.getLevelCount(setKey), clearedLevels(setKey, diffKey) + 1);
  }

  function saveLevelClear(level, setKey, diffKey) {
    if (!(level > clearedLevels(setKey, diffKey))) return;
    DATA.levelProgress[progressKey(setKey, diffKey)] = level;
    ST.setJSON('levelProgress', DATA.levelProgress);
  }

  function saveLeaderboard() {
    // 分数降序；同分按 WPM 降序；最多保留 10 条
    DATA.leaderboard.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.wpm - a.wpm;
    });
    DATA.leaderboard = DATA.leaderboard.slice(0, 10);
    ST.setJSON('leaderboard', DATA.leaderboard);
  }

  function formatDate(d) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* ---------------- 首次进入引导 ----------------
     流程：WELCOME（昵称）→ GUIDE（7 步对话）→ HOME
     guideSeen 记录在 localStorage 的 typingBlock_guideSeen 中
     ------------------------------------------------ */
  var GUIDE_STEPS = [
    '你好，我是字块冲刺的引导员。接下来用 1 分钟告诉你这个游戏怎么玩。',
    '游戏开始后，屏幕上会从顶部掉下带英文单词的方块。你的任务是在方块落地之前，把单词完整敲出来。',
    '每敲对一个字母，方块上对应的字母会亮起来。敲完整单词，方块就会被消除并得分。方块下方有中文释义，边打边记。',
    '敲错一个字母只会清空连击，不扣爱心，别慌。屏幕上方有 3 颗爱心，方块掉到底部就会碎掉一颗。',
    '连续正确消除会累积连击，连击越高，单次得分加成越高。但一旦敲错，连击归零，所以稳比快更重要。',
    '每关限时 50 秒，第一关大约打掉 10 个词就能过关，之后目标逐关提高。通过后会自动解锁下一关，下次进来可以直接选已通关的关卡。',
    '每局结束会结算得分、准确率、WPM 和最高连击，成绩会进本地排行榜。准备好了吗？点击开始游戏。'
  ];

  var ONBOARD = {
    step: 0,
    active: false,
    els: null,
    timer: 0
  };

  function readFlag(key) {
    var v = ST.get(key, '');
    return v === '1' || v === 'true';
  }

  function initGuide() {
    var e = ONBOARD.els = {
      layer: document.getElementById('guideLayer'),
      welcome: document.getElementById('welcomeMask'),
      welcomeInput: document.getElementById('welcomeInput'),
      welcomeErr: document.getElementById('welcomeErr'),
      welcomeStart: document.getElementById('welcomeStart'),
      guide: document.getElementById('guideMask'),
      text: document.getElementById('guideText'),
      stepText: document.getElementById('guideStepText'),
      dots: document.getElementById('guideDots'),
      next: document.getElementById('guideNext'),
      skip: document.getElementById('guideSkip')
    };

    // 步骤圆点只创建一次，后续只切换状态
    for (var i = 0; i < GUIDE_STEPS.length; i++) {
      var dot = document.createElement('i');
      dot.className = 'guide-dot';
      e.dots.appendChild(dot);
    }

    e.welcomeStart.addEventListener('click', submitWelcome);
    e.welcomeInput.addEventListener('input', function () {
      e.welcomeErr.hidden = true;
    });
    e.welcomeInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        submitWelcome();
      }
    });

    e.next.addEventListener('click', nextGuide);
    e.skip.addEventListener('click', skipGuide);
  }

  function showGuideLayer() {
    ONBOARD.active = true;
    ONBOARD.els.layer.hidden = false;
  }

  // 隐藏引导并把焦点计时器清掉，避免影响后续对局
  function hideGuideLayer() {
    ONBOARD.active = false;
    if (ONBOARD.timer) {
      clearTimeout(ONBOARD.timer);
      ONBOARD.timer = 0;
    }
    ONBOARD.els.layer.hidden = true;
    ONBOARD.els.welcome.hidden = true;
    ONBOARD.els.guide.hidden = true;
  }

  // 进入首页前的统一收尾
  function enterHome() {
    hideGuideLayer();
    refreshHome();
    UI.showScreen('HOME');
  }

  function maybeAutoHelp() {
    if (DATA.helpSeen) return;
    DATA.helpSeen = true;
    ST.set('helpSeen', '1');
    openHelp();
  }

  function startWelcome() {
    // 进入引导前先停掉可能存在的对局，确保没有 HUD 和游戏循环
    Game.stop();
    UI.showScreen('WELCOME');

    var e = ONBOARD.els;
    showGuideLayer();
    e.guide.hidden = true;
    e.welcome.hidden = false;
    e.welcomeErr.hidden = true;

    var saved = ST.get('nickname', '');
    e.welcomeInput.value = saved ? String(saved).slice(0, 12) : '玩家';

    ONBOARD.timer = setTimeout(function () {
      ONBOARD.timer = 0;
      if (!e.welcome.hidden) {
        e.welcomeInput.focus();
        e.welcomeInput.select();
      }
    }, 40);
  }

  function submitWelcome() {
    var e = ONBOARD.els;
    var v = (e.welcomeInput.value || '').trim().slice(0, 12);

    // 空字符串与纯空格都在这里被拦下
    if (!v) {
      e.welcomeErr.hidden = false;
      e.welcomeInput.focus();
      return;
    }

    DATA.nickname = v;
    ST.set('nickname', v);
    UI.updateNickname(v);

    e.welcome.hidden = true;
    startGuide();
  }

  function startGuide() {
    Game.stop();
    UI.showScreen('GUIDE');

    var e = ONBOARD.els;
    showGuideLayer();
    e.welcome.hidden = true;
    e.guide.hidden = false;

    ONBOARD.step = 0;
    renderGuideStep();
  }

  function renderGuideStep() {
    var e = ONBOARD.els;
    var idx = ONBOARD.step;
    var last = idx === GUIDE_STEPS.length - 1;

    // 文案全部走 textContent
    e.text.textContent = GUIDE_STEPS[idx];
    e.stepText.textContent = (idx + 1) + ' / ' + GUIDE_STEPS.length;
    e.next.textContent = last ? '开始游戏' : '下一步';

    var dots = e.dots.querySelectorAll('.guide-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-on', i === idx);
      dots[i].classList.toggle('is-done', i < idx);
    }

    // 每一步把焦点交给主按钮，方便键盘操作；不参与游戏输入判定
    if (ONBOARD.timer) clearTimeout(ONBOARD.timer);
    ONBOARD.timer = setTimeout(function () {
      ONBOARD.timer = 0;
      if (!e.guide.hidden) e.next.focus();
    }, 0);
  }

  function nextGuide() {
    if (ONBOARD.step < GUIDE_STEPS.length - 1) {
      ONBOARD.step++;
      renderGuideStep();
      return;
    }
    finishGuide();
  }

  function skipGuide() {
    finishGuide();
  }

  function finishGuide() {
    // 只有完成或跳过才写入 guideSeen，刷新后不再出现引导
    ST.set('guideSeen', '1');
    DATA.guideSeen = true;
    ONBOARD.step = 0;

    // 引导已覆盖帮助内容，首次进入不再重复弹出帮助弹窗
    if (!DATA.helpSeen) {
      DATA.helpSeen = true;
      ST.set('helpSeen', '1');
    }

    enterHome();
  }

  // 启动时决定先走 WELCOME 还是 GUIDE：昵称已存在则跳过昵称输入
  function startOnboarding() {
    if (ST.get('nickname', '')) {
      DATA.nickname = ST.get('nickname', DATA.nickname) || DATA.nickname;
      UI.updateNickname(DATA.nickname);
      startGuide();
    } else {
      startWelcome();
    }
  }

  /* ---------------- 首页 ---------------- */
  function refreshHome() {
    UI.updateNickname(DATA.nickname);
    UI.updateHomeStats(DATA.bestScore, DATA.bestWpm);
    UI.renderLeaderboard(UI.els.homeLb, DATA.leaderboard, 5);
  }

  /* ---------------- 选择页 ---------------- */
  function buildSetCards() {
    var grid = document.getElementById('setGrid');
    grid.innerHTML = '';

    Object.keys(WORD_SETS).forEach(function (key) {
      var item = WORD_SETS[key];
      var card = document.createElement('button');
      card.className = 'pick-card' + (key === picked.setKey ? ' is-on' : '');
      card.type = 'button';

      var name = document.createElement('div');
      name.className = 'pick-name';
      name.textContent = item.name;

      var sub = document.createElement('div');
      sub.className = 'pick-sub';
      sub.textContent = key === 'code' ? '编程关键字' : (key === 'ai' ? '人工智能术语' : '常用词汇');

      var count = document.createElement('div');
      count.className = 'pick-count';
      count.textContent = '共 ' + item.words.length + ' 词 · ' + Game.getLevelCount(key) + ' 关';

      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(count);

      card.addEventListener('click', function () {
        picked.setKey = key;
        picked.level = unlockedMax(key, picked.diffKey);
        var all = grid.querySelectorAll('.pick-card');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('is-on');
        card.classList.add('is-on');
        buildLevelGrid();
      });

      grid.appendChild(card);
    });
  }

  function buildDiffCards() {
    var grid = document.getElementById('diffGrid');
    grid.innerHTML = '';
    var diffs = Game.DIFFICULTIES;

    Object.keys(diffs).forEach(function (key) {
      var d = diffs[key];
      var card = document.createElement('button');
      card.className = 'pick-card' + (key === picked.diffKey ? ' is-on' : '');
      card.type = 'button';

      var name = document.createElement('div');
      name.className = 'pick-name';
      name.textContent = d.name;

      var sub = document.createElement('div');
      sub.className = 'pick-sub';
      sub.textContent = d.desc;

      var count = document.createElement('div');
      count.className = 'pick-count';
      count.textContent = '得分系数 ×' + d.coef.toFixed(1);

      card.appendChild(name);
      card.appendChild(sub);
      card.appendChild(count);

      card.addEventListener('click', function () {
        picked.diffKey = key;
        picked.level = unlockedMax(picked.setKey, key);
        var all = grid.querySelectorAll('.pick-card');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('is-on');
        card.classList.add('is-on');
        buildLevelGrid();
      });

      grid.appendChild(card);
    });
  }

  /* ---------------- 关卡选择：只有通关后逐关解锁 ---------------- */
  function buildLevelGrid() {
    var grid = document.getElementById('levelGrid');
    if (!grid) return;

    var total = Game.getLevelCount(picked.setKey);
    var cleared = clearedLevels(picked.setKey, picked.diffKey);
    var max = Math.min(total, cleared + 1);
    picked.level = Math.max(1, Math.min(max, picked.level || 1));

    grid.innerHTML = '';
    for (var i = 1; i <= total; i++) {
      (function (lv) {
        var locked = lv > max;
        var done = lv <= cleared;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-chip' +
          (locked ? ' is-locked' : '') +
          (done ? ' is-cleared' : '') +
          (lv === picked.level ? ' is-on' : '');
        btn.textContent = lv;
        btn.disabled = locked;
        btn.title = locked ? '通过前一关后解锁' : (done ? '已通关，可重新挑战' : '当前可挑战');

        btn.addEventListener('click', function () {
          picked.level = lv;
          var all = grid.querySelectorAll('.level-chip');
          for (var j = 0; j < all.length; j++) all[j].classList.remove('is-on');
          btn.classList.add('is-on');
          updateLevelNote();
        });

        grid.appendChild(btn);
      })(i);
    }

    updateLevelNote();
  }

  function updateLevelNote() {
    var note = document.getElementById('levelNote');
    if (!note) return;

    var total = Game.getLevelCount(picked.setKey);
    var cleared = clearedLevels(picked.setKey, picked.diffKey);
    var prefix = '共 ' + total + ' 关，已通关 ' + cleared + ' 关；';

    note.textContent = cleared >= total
      ? prefix + '已全部解锁，可任选关卡重玩'
      : prefix + '第 ' + (cleared + 1) + ' 关已解锁';

    var btn = document.getElementById('startGameBtn');
    if (btn) btn.textContent = '开始第 ' + picked.level + ' 关';
  }

  /* ---------------- 结算 ---------------- */
  function handleGameEnd(stats) {
    // 失败后“再来一局”重试失败的那一关，通关后从原起关卡重玩
    lastConfig = {
      setKey: stats.setKey,
      diffKey: stats.diffKey,
      level: stats.win ? stats.startLevel : stats.levelIndex
    };

    var isNewRecord = stats.score > DATA.bestScore;

    if (isNewRecord) {
      DATA.bestScore = stats.score;
      ST.set('bestScore', DATA.bestScore);
    }
    if (stats.wpm > DATA.bestWpm) {
      DATA.bestWpm = stats.wpm;
      ST.set('bestWpm', DATA.bestWpm);
    }

    // 写入排行榜
    DATA.leaderboard.push({
      name: DATA.nickname,
      score: stats.score,
      wpm: stats.wpm,
      accuracy: stats.accuracy,
      date: formatDate(new Date())
    });
    saveLeaderboard();

    // 结算页数据
    document.getElementById('resScore').textContent = stats.score;
    document.getElementById('resAcc').textContent = stats.accuracy + '%';
    document.getElementById('resWpm').textContent = stats.wpm;
    document.getElementById('resCombo').textContent = stats.maxCombo;

    // 关卡结果：通关 / 时间到 / 爱心碎完
    var status = document.getElementById('resStatus');
    var lvText = '第 ' + stats.levelIndex + ' / ' + stats.levelTotal + ' 关';
    if (stats.win) {
      status.textContent = lvText + ' · 全部通关';
    } else if (stats.failReason === 'time') {
      status.textContent = lvText + ' · 时间到，本局结束';
    } else {
      status.textContent = lvText + ' · 爱心碎完，本局结束';
    }
    status.classList.toggle('is-win', !!stats.win);

    // 破纪录标记：两种状态都给明确文案
    var recBadge = document.getElementById('resNew');
    recBadge.hidden = false;
    recBadge.textContent = isNewRecord ? '破纪录' : '未破纪录';
    recBadge.classList.toggle('plain', !isNewRecord);

    // 打错的单词：去重后最多 10 个
    var wrap = document.getElementById('resWrong');
    wrap.innerHTML = '';
    var seen = {};
    var shown = 0;

    for (var i = 0; i < stats.wrongWords.length && shown < 10; i++) {
      var w = stats.wrongWords[i];
      if (seen[w]) continue;
      seen[w] = true;
      shown++;

      var chip = document.createElement('span');
      chip.className = 'wrong-chip';
      chip.textContent = w;
      wrap.appendChild(chip);
    }

    if (shown === 0) {
      var none = document.createElement('span');
      none.className = 'wrong-none';
      none.textContent = '本局没有打错的单词，漂亮';
      wrap.appendChild(none);
    }

    UI.showScreen('RESULT');
  }

  /* ---------------- 弹窗内容 ---------------- */
  function openHelp() {
    UI.openModal({
      title: '玩法与规则',
      content:
        '<p><b>玩法</b></p>' +
        '<ul>' +
          '<li>方块带着英文单词从顶部下落，按顺序敲完整个单词即可消除得分</li>' +
          '<li>输入正确前缀时，方块上对应的字母会高亮</li>' +
          '<li>方块下方有中文释义，边打边记</li>' +
        '</ul>' +
        '<p><b>关卡规则</b></p>' +
        '<ul>' +
          '<li>关卡数由词库词数自动计算（<b>6 ~ 50</b> 关），每关使用一组词</li>' +
          '<li>初次进入只解锁第 <b>1</b> 关，通关后自动解锁下一关，并记录已通关关卡</li>' +
          '<li>每关限时 <b>50</b> 秒，第一关约需打掉 <b>10</b> 个词，目标逐关递增</li>' +
          '<li>目标分按本关平均词长、目标词数与难度系数自动计算</li>' +
        '</ul>' +
        '<p><b>生命规则</b></p>' +
        '<ul>' +
          '<li>每关开始时重置 <b>3</b> 颗爱心</li>' +
          '<li>方块掉到底部，碎掉 <b>1</b> 颗爱心并被移除</li>' +
          '<li>打错字母只会清空连击，<b>不扣爱心</b></li>' +
          '<li>3 颗爱心全部碎掉或本关时间用完，本局立即结束</li>' +
        '</ul>' +
        '<p><b>计分</b></p>' +
        '<p>单次得分 = 单词长度 × 10 × 难度系数 × (1 + 连击数 × 0.1)</p>' +
        '<p>难度系数：简单 <b>0.8</b> · 普通 <b>1.0</b> · 困难 <b>1.3</b></p>' +
        '<p><b>操作</b></p>' +
        '<ul>' +
          '<li><b>字母 / 数字键</b>：逐字母输入当前单词</li>' +
          '<li><b>Backspace</b>：清空当前输入，不扣爱心</li>' +
          '<li><b>Esc</b>：暂停 / 继续；切换到其他窗口会自动暂停</li>' +
        '</ul>' +
        '<p>请使用<b>英文输入法</b>。检测到中文输入法组合输入时会暂停判定并给出提示。</p>',
      actions: [{ label: '知道了', primary: true, onClick: function () { UI.closeModal(); } }]
    });
  }

  function openLeaderboard() {
    var wrap = document.createElement('div');
    UI.renderLeaderboard(wrap, DATA.leaderboard, 10);
    UI.openModal({
      title: '排行榜 · Top 10',
      content: wrap,
      actions: [{ label: '关闭', onClick: function () { UI.closeModal(); } }]
    });
  }

  function openSettings() {
    var wrap = document.createElement('div');

    // 音效开关
    var row = document.createElement('div');
    row.className = 'switch-row';

    var k = document.createElement('div');
    k.className = 'k';
    k.textContent = '音效';
    var small = document.createElement('small');
    small.textContent = '消除、出错、结算提示音';
    k.appendChild(small);

    var sw = document.createElement('button');
    sw.className = 'switch' + (DATA.settings.sound ? ' is-on' : '');
    sw.type = 'button';
    sw.setAttribute('aria-label', '音效开关');
    var knob = document.createElement('i');
    sw.appendChild(knob);

    sw.addEventListener('click', function () {
      DATA.settings.sound = !DATA.settings.sound;
      sw.classList.toggle('is-on', DATA.settings.sound);
      ST.setJSON('settings', DATA.settings);
      Game.setSound(DATA.settings.sound);
    });

    row.appendChild(k);
    row.appendChild(sw);
    wrap.appendChild(row);

    // 主题开关：默认亮色，开启后切换为暗色
    var themeRow = document.createElement('div');
    themeRow.className = 'switch-row';

    var themeKey = document.createElement('div');
    themeKey.className = 'k';
    themeKey.textContent = '暗色模式';
    var themeSmall = document.createElement('small');
    themeSmall.textContent = '关闭时使用亮色主题';
    themeKey.appendChild(themeSmall);

    var themeSw = document.createElement('button');
    themeSw.className = 'switch' + (DATA.settings.theme === 'dark' ? ' is-on' : '');
    themeSw.type = 'button';
    themeSw.setAttribute('aria-label', '暗色模式开关');
    themeSw.appendChild(document.createElement('i'));

    themeSw.addEventListener('click', function () {
      DATA.settings.theme = DATA.settings.theme === 'dark' ? 'light' : 'dark';
      themeSw.classList.toggle('is-on', DATA.settings.theme === 'dark');
      ST.setJSON('settings', DATA.settings);
      UI.applyTheme(DATA.settings.theme);
    });

    themeRow.appendChild(themeKey);
    themeRow.appendChild(themeSw);
    wrap.appendChild(themeRow);

    // 重新观看新手引导（保留当前昵称，跳过昵称输入）
    var btnGuide = document.createElement('button');
    btnGuide.className = 'btn ghost small';
    btnGuide.textContent = '重新观看新手引导';
    btnGuide.style.marginTop = '14px';
    btnGuide.addEventListener('click', function () {
      UI.closeModal();
      ST.remove('guideSeen');
      DATA.guideSeen = false;
      Game.stop();
      startOnboarding();
    });
    wrap.appendChild(btnGuide);

    // 清空排行榜
    var btnClear = document.createElement('button');
    btnClear.className = 'btn ghost small';
    btnClear.textContent = '清空排行榜';
    btnClear.style.marginTop = '14px';
    btnClear.addEventListener('click', function () {
      UI.confirm('清空排行榜', '将删除全部排行榜记录，且无法恢复。确定继续？', function () {
        DATA.leaderboard = [];
        ST.setJSON('leaderboard', DATA.leaderboard);
        refreshHome();
        UI.toast('排行榜已清空');
      });
    });
    wrap.appendChild(btnClear);

    // 重置所有数据
    var btnReset = document.createElement('button');
    btnReset.className = 'btn ghost small';
    btnReset.textContent = '重置所有数据';
    btnReset.style.marginTop = '8px';
    btnReset.addEventListener('click', function () {
      UI.confirm('重置所有数据', '昵称、最高分、排行榜、设置、关卡解锁进度与新手引导进度都会被清空，下次进入将重新走引导。确定继续？', function () {
        ST.resetAll();
        DATA.nickname = '玩家';
        DATA.bestScore = 0;
        DATA.bestWpm = 0;
        DATA.leaderboard = [];
        DATA.settings = { sound: true, theme: 'light' };
        DATA.helpSeen = false;
        DATA.guideSeen = false;
        DATA.levelProgress = {};
        picked.level = 1;
        Game.setSound(true);
        UI.applyTheme('light');
        refreshHome();
        UI.toast('已恢复到初始状态');
      });
    });
    wrap.appendChild(btnReset);

    UI.openModal({
      title: '设置',
      content: wrap,
      actions: [{ label: '关闭', onClick: function () { UI.closeModal(); } }]
    });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 首页
    document.getElementById('modeSolo').addEventListener('click', function () {
      picked.level = unlockedMax(picked.setKey, picked.diffKey);
      buildLevelGrid();
      UI.showScreen('SELECT');
    });

    document.getElementById('nickBtn').addEventListener('click', function () {
      UI.promptText('修改昵称', DATA.nickname, 12, function (v) {
        DATA.nickname = v;
        ST.set('nickname', v);
        UI.updateNickname(v);
        UI.toast('昵称已保存');
      });
    });

    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('helpBtn').addEventListener('click', openHelp);
    document.getElementById('viewAllBtn').addEventListener('click', openLeaderboard);

    // 选择页
    document.getElementById('backHomeBtn').addEventListener('click', function () {
      UI.showScreen('HOME');
      refreshHome();
    });

    document.getElementById('startGameBtn').addEventListener('click', function () {
      Game.start(picked.setKey, picked.diffKey, picked.level);
    });

    // 对局页
    document.getElementById('pauseBtn').addEventListener('click', function () {
      Game.pause();
    });
    document.getElementById('resumeBtn').addEventListener('click', function () {
      Game.resume();
    });

    // 结算页
    document.getElementById('againBtn').addEventListener('click', function () {
      Game.start(lastConfig.setKey, lastConfig.diffKey, lastConfig.level);
    });

    document.getElementById('changeSetBtn').addEventListener('click', function () {
      Game.stop();
      picked.setKey = lastConfig.setKey;
      picked.diffKey = lastConfig.diffKey;
      picked.level = unlockedMax(picked.setKey, picked.diffKey);
      buildSetCards();
      buildDiffCards();
      buildLevelGrid();
      UI.showScreen('SELECT');
    });

    document.getElementById('resultHomeBtn').addEventListener('click', function () {
      Game.stop();
      refreshHome();
      UI.showScreen('HOME');
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    UI.init();
    ST.onDegrade(function (msg) { UI.toast(msg); });

    loadData();
    UI.applyTheme(DATA.settings.theme);
    Game.setSound(DATA.settings.sound);
    Game.onEnd = handleGameEnd;
    Game.onLevelClear = saveLevelClear;

    Game.init();
    initGuide();

    refreshHome();
    buildSetCards();
    buildDiffCards();
    buildLevelGrid();
    bindEvents();

    if (DATA.guideSeen) {
      UI.showScreen('HOME');
      maybeAutoHelp();
    } else {
      // 首次进入：WELCOME → GUIDE → HOME
      startOnboarding();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

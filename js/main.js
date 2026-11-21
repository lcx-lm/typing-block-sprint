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
    settings: { sound: true, theme: 'light' },
    helpSeen: false,
    guideSeen: false,
    levelProgress: {},
    wrongBook: {},
    rankPoints: 0,
    rankRecord: { wins: 0, losses: 0, draws: 0 },
    history: []
  };

  // 选择页当前选中项
  var picked = { setKey: 'cet4', diffKey: 'normal', level: 1, mode: 'solo' };
  // 结算页“再来一局”使用的配置
  var lastConfig = { setKey: 'cet4', diffKey: 'normal', level: 1, mode: 'solo' };
  // 本局开始前已通关的关卡数，用于计算“首次通关”加分
  var runBaseCleared = 0;

  /* ---------------- 段位 ---------------- */
  var RANKS = [
    { name: '青铜', min: 0 },
    { name: '白银', min: 100 },
    { name: '黄金', min: 300 },
    { name: '铂金', min: 600 },
    { name: '钻石', min: 1000 }
  ];

  function rankOf(points) {
    var p = Math.max(0, parseInt(points, 10) || 0);
    var idx = 0;
    for (var i = RANKS.length - 1; i >= 0; i--) {
      if (p >= RANKS[i].min) { idx = i; break; }
    }
    return {
      index: idx,
      name: RANKS[idx].name,
      min: RANKS[idx].min,
      next: RANKS[idx + 1] || null
    };
  }

  function updateRankChip() {
    var el = document.getElementById('rankLabel');
    if (el) el.textContent = rankOf(DATA.rankPoints).name;
  }

  /* ---------------- 持久化读取 ---------------- */
  function loadData() {
    DATA.nickname = ST.get('nickname', '玩家') || '玩家';
    DATA.bestScore = parseInt(ST.get('bestScore', '0'), 10) || 0;
    DATA.bestWpm = parseInt(ST.get('bestWpm', '0'), 10) || 0;

    var settings = ST.getJSON('settings', { sound: true, theme: 'light' });
    DATA.settings = {
      sound: !settings || settings.sound !== false,
      theme: settings && settings.theme === 'dark' ? 'dark' : 'light'
    };

    DATA.helpSeen = ST.get('helpSeen', '0') === '1';
    DATA.guideSeen = readFlag('guideSeen');

    var lp = ST.getJSON('levelProgress', {});
    DATA.levelProgress = lp && typeof lp === 'object' && !Array.isArray(lp) ? lp : {};

    var wb = ST.getJSON('wrongBook', {});
    DATA.wrongBook = wb && typeof wb === 'object' && !Array.isArray(wb) ? wb : {};
    // 兼容旧格式/损坏数据：只保留带合法 word 字段的条目，避免复习时崩溃
    Object.keys(DATA.wrongBook).forEach(function (k) {
      var arr = DATA.wrongBook[k];
      DATA.wrongBook[k] = Array.isArray(arr) ? arr.filter(function (item) {
        return item && typeof item === 'object' && typeof item.word === 'string' && item.word;
      }) : [];
    });

    DATA.rankPoints = Math.max(0, parseInt(ST.get('rankPoints', '0'), 10) || 0);
    var rr = ST.getJSON('rankRecord', {});
    DATA.rankRecord = {
      wins: Math.max(0, parseInt(rr && rr.wins, 10) || 0),
      losses: Math.max(0, parseInt(rr && rr.losses, 10) || 0),
      draws: Math.max(0, parseInt(rr && rr.draws, 10) || 0)
    };

    var hist = ST.getJSON('history', []);
    DATA.history = Array.isArray(hist) ? hist.filter(function (h) {
      return h && typeof h === 'object' && typeof h.score === 'number';
    }).slice(-20) : [];
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

  /* ---------------- 错词本 ----------------
     按词库记录打错的单词，同一单词累计次数，最多保留 120 个。
     ------------------------------------------------ */
  var WRONG_MAX = 120;

  function wrongList(setKey) {
    var list = DATA.wrongBook[setKey];
    return Array.isArray(list) ? list : [];
  }

  function addWrongWord(word, meaning, setKey) {
    if (!word) return;
    var list = DATA.wrongBook[setKey];
    if (!Array.isArray(list)) list = DATA.wrongBook[setKey] = [];

    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].word === word) {
        target = list[i];
        break;
      }
    }

    if (target) {
      target.count = (target.count || 1) + 1;
      if (meaning) target.meaning = meaning;
    } else {
      list.push({ word: word, meaning: meaning || '', count: 1 });
    }

    list.sort(function (a, b) { return (b.count || 0) - (a.count || 0); });
    if (list.length > WRONG_MAX) list.length = WRONG_MAX;

    ST.setJSON('wrongBook', DATA.wrongBook);
    renderWrongBook();
  }

  function renderWrongBook() {
    var box = document.getElementById('homeWrong');
    var note = document.getElementById('homeWrongNote');
    if (!box) return;

    var list = wrongList(picked.setKey);
    var set = WORD_SETS[picked.setKey];

    box.innerHTML = '';
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'wb-empty';
      empty.textContent = '还没有错词';
      box.appendChild(empty);
    } else {
      list.slice(0, 8).forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'wb-item';

        var word = document.createElement('span');
        word.className = 'wb-word';
        word.textContent = item.word;

        var mean = document.createElement('span');
        mean.className = 'wb-meaning';
        mean.textContent = item.meaning || '';

        var count = document.createElement('span');
        count.className = 'wb-count';
        count.textContent = '×' + (item.count || 1);

        row.appendChild(word);
        row.appendChild(mean);
        row.appendChild(count);
        box.appendChild(row);
      });
    }

    if (note) {
      note.textContent = set
        ? '当前词库：' + set.name + ' · 共 ' + list.length + ' 个错词，对局中优先出现'
        : '打错的单词会自动收集，对局中优先出现';
    }

    var reviewBtn = document.getElementById('reviewWrongBtn');
    if (reviewBtn) {
      reviewBtn.textContent = list.length ? '复习错词（' + list.length + '）' : '复习错词';
    }
  }

  function formatDate(d) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 关卡序号转中文：1 → 一，23 → 二十三
  function numToCn(n) {
    var cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    var v = Math.max(0, parseInt(n, 10) || 0);
    if (v < 10) return cn[v];
    if (v < 20) return '十' + (v % 10 ? cn[v % 10] : '');
    if (v < 100) return cn[Math.floor(v / 10)] + '十' + (v % 10 ? cn[v % 10] : '');
    return String(v);
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
    '每关限时 50 秒，第一关大约打掉 6 个词就能过关，之后目标逐关提高。通过后会自动解锁下一关，下次进来可以直接选已通关的关卡。',
    '每局结束会结算得分、准确率、打字速度和最高连击，成绩会存进「最近表现」记录。准备好了吗？点击开始游戏。'
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
    updateRankChip();
    UI.renderTrend(UI.els.homeTrend, DATA.history);
    renderWrongBook();
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
        renderWrongBook();
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
    if (!note || picked.mode !== 'solo') return;

    var total = Game.getLevelCount(picked.setKey);
    var cleared = clearedLevels(picked.setKey, picked.diffKey);
    var prefix = '共 ' + total + ' 关，已通关 ' + cleared + ' 关；';

    note.textContent = cleared >= total
      ? prefix + '已全部解锁，可任选关卡重玩'
      : prefix + '第 ' + (cleared + 1) + ' 关已解锁';

    var btn = document.getElementById('startGameBtn');
    if (btn) btn.textContent = '开始第 ' + picked.level + ' 关';
  }

  /* ---------------- 模式与开局 ---------------- */
  function applyModeToSelect() {
    var solo = picked.mode === 'solo';
    var banner = document.getElementById('modeBanner');
    var levelSection = document.getElementById('levelSection');
    var diffNote = document.getElementById('diffNote');
    var btn = document.getElementById('startGameBtn');

    if (levelSection) levelSection.hidden = !solo;

    if (banner) {
      if (solo) banner.textContent = '单机闯关 · 逐关解锁';
      else if (picked.mode === 'sprint') banner.textContent = '限时冲刺 · 60 秒整库词池';
      else if (picked.mode === 'review') banner.textContent = '错词复习 · 60 秒错词池';
      else banner.textContent = 'AI 对战 · 60 秒同场抢分';
    }

    if (diffNote) {
      diffNote.textContent = picked.mode === 'versus'
        ? '难度决定下落速度，以及 AI 的读词反应、打字速度与失误率'
        : '难度决定下落速度、出块间隔与单词长度上限';
    }

    if (solo) {
      updateLevelNote();
    } else if (btn) {
      if (picked.mode === 'sprint') btn.textContent = '开始冲刺';
      else if (picked.mode === 'review') btn.textContent = '开始复习';
      else btn.textContent = '开始对战';
    }
  }

  function openSelect(mode) {
    picked.mode = mode;
    if (mode === 'solo') picked.level = unlockedMax(picked.setKey, picked.diffKey);
    buildLevelGrid();
    applyModeToSelect();
    UI.showScreen('SELECT');
  }

  function launchGame() {
    var words = wrongList(picked.setKey);
    if (picked.mode === 'review' && !words.length) {
      UI.toast('错词本是空的，先玩一局收集错词');
      return;
    }
    runBaseCleared = picked.mode === 'solo' ? clearedLevels(picked.setKey, picked.diffKey) : 0;
    lastConfig = {
      setKey: picked.setKey,
      diffKey: picked.diffKey,
      level: picked.level,
      mode: picked.mode
    };
    Game.start(picked.setKey, picked.diffKey, picked.level, words, picked.mode);
  }

  /* ---------------- 排位积分 ---------------- */
  function calcRankOutcome(stats, mode) {
    // 刚进入一关、本关一个单词都没消除就退出：不扣分，也不计胜负。
    // 用 levelWords 而不是 wordsCleared，避免「前几关打了很多词，刚进新关卡就退出」被误扣。
    if (stats.failReason === 'quit' && !stats.levelWords) {
      return { delta: 0, result: 'none', bonus: 0 };
    }

    if (mode === 'sprint') {
      if (stats.score >= 600) return { delta: 15, result: 'win' };
      if (stats.score >= 400) return { delta: 5, result: 'win' };
      return { delta: -8, result: 'lose' };
    }

    if (mode === 'versus') {
      var winner = stats.versusWinner ||
        (stats.score > stats.aiScore ? 'player' : (stats.score === stats.aiScore ? 'draw' : 'ai'));
      if (winner === 'player') return { delta: 20, result: 'win' };
      if (winner === 'draw') return { delta: 5, result: 'draw' };
      return { delta: -10, result: 'lose' };
    }

    // 主动退出且本关已消除过单词 / 爱心耗尽 / 时间到：只要本关没有通过，
    // 一律按本关失败结算 −10，不把本局前面已通过的关卡折算成 +5/+20 加分，
    // 否则「本关没达标、只是累计分高」也会被判成胜场加积分。
    // 从通关弹窗点「退出」时本关已经通过（quitCleared），仍按正常通关结算。
    if (!stats.win && !stats.quitCleared) {
      return { delta: -10, result: 'lose', bonus: 0 };
    }

    // stats.cleared 是「已通关到第几关」的绝对关卡号，
    // 从中途关卡开始时需要换算成本局真正通过的关数，否则会少打多给分。
    var runCleared = stats.cleared
      ? Math.max(0, stats.cleared - (stats.startLevel || 1) + 1)
      : 0;

    // 走完最后一关：+30；从通关弹窗退出：按本局通过关数给 +20 / +5
    var delta;
    var result = 'win';
    if (stats.win) {
      delta = 30;
    } else if (runCleared >= 3) {
      delta = 20;
    } else {
      delta = 5;
    }

    // 本局首次通关的关卡，每关额外 +10
    var bonus = 0;
    for (var lv = stats.startLevel; lv <= stats.cleared; lv++) {
      if (lv > runBaseCleared) bonus++;
    }

    return { delta: delta + bonus * 10, result: result, bonus: bonus };
  }

  function applyRankResult(delta, result) {
    var before = rankOf(DATA.rankPoints);
    var pts = Math.max(0, DATA.rankPoints + delta);
    DATA.rankPoints = pts;
    ST.set('rankPoints', String(pts));

    if (result === 'win') DATA.rankRecord.wins++;
    else if (result === 'draw') DATA.rankRecord.draws++;
    else DATA.rankRecord.losses++;
    ST.setJSON('rankRecord', DATA.rankRecord);

    var after = rankOf(pts);
    updateRankChip();

    if (after.index > before.index) {
      UI.toast('段位提升：' + after.name + '！');
    }
    return after;
  }

  /* ---------------- 结算页辅助：大字动效与段位结算动画 ---------------- */
  var rankTimers = [];

  function clearRankTimers() {
    for (var i = 0; i < rankTimers.length; i++) clearTimeout(rankTimers[i]);
    rankTimers = [];
  }

  // 大字结论：所有结论（失败 / 通关 / 胜利 / 破纪录等）都逐字从上方掉落，
  // 返回值是整段掉字动效的总时长（毫秒），供积分动画排队使用
  function renderVerdict(el, text, cls) {
    el.className = 'result-verdict ' + cls + ' is-drop';
    el.innerHTML = '';
    for (var i = 0; i < text.length; i++) {
      var ch = document.createElement('span');
      ch.className = 'drop-char';
      ch.textContent = text.charAt(i);
      ch.style.setProperty('--i', i);
      el.appendChild(ch);
    }
    // 与 CSS 保持一致：0.6s 起始停顿 + 每字 0.16s 间隔 + 0.72s 掉落动画
    return 600 + Math.max(0, text.length - 1) * 160 + 720;
  }

  // 本局积分：先显示原有进度，再动态涨（或退）到结算后的进度
  // 节奏：等大字结论落定 → 弹出加减分 → 进度条从结算前位置走 / 退 → 揭示段位与文案
  function playRankLine(els, a, timers) {
    var deltaEl = els.delta;
    var totalEl = els.total;
    var rankName = els.rankName;
    var fill = els.fill;
    var label = els.label;
    var note = els.note;
    var t0 = a.delay || 0;

    deltaEl.className = 'rank-line-delta' + (a.delta > 0 ? ' up' : (a.delta < 0 ? ' down' : ''));
    deltaEl.textContent = (a.delta > 0 ? '+' : '') + a.delta;
    totalEl.textContent = a.before;
    rankName.textContent = a.rankName;
    rankName.classList.remove('is-reveal');
    note.textContent = a.progText;
    note.classList.remove('is-reveal');
    label.textContent = a.denom ? (a.before + '/' + a.denom) : String(a.before);

    var rspan = a.denom ? (a.denom - a.curMin) : 1;
    var pctBefore = a.denom ? Math.max(0, Math.min(100, ((a.before - a.curMin) / rspan) * 100)) : 100;
    var pctAfter = a.denom ? Math.max(0, Math.min(100, ((a.after - a.curMin) / rspan) * 100)) : 100;
    fill.style.transition = 'none';
    fill.style.width = pctBefore + '%';
    // 触发重排，保证后续 width 变化能触发过渡
    void fill.offsetWidth;
    fill.style.transition = '';

    timers.push(setTimeout(function () {
      deltaEl.classList.add('is-reveal');
    }, t0));
    timers.push(setTimeout(function () {
      fill.style.width = pctAfter + '%';
      tweenLabel(label, a.before, a.after, a.denom, 1200);
      tweenLabel(totalEl, a.before, a.after, null, 1200);
    }, t0 + 700));
    timers.push(setTimeout(function () {
      rankName.classList.add('is-reveal');
      note.classList.add('is-reveal');
    }, t0 + 700 + 1300));
  }

  function playRankInline(a) {
    clearRankTimers();
    playRankLine({
      delta: document.getElementById('resRankDelta'),
      total: document.getElementById('resRankAfter'),
      rankName: document.getElementById('resRankName'),
      fill: document.getElementById('resRankFill'),
      label: document.getElementById('resRankBarLabel'),
      note: document.getElementById('resRankProgressText')
    }, a, rankTimers);
  }

  // 通关弹窗里的加分进度条：容器由 game.js 提供，这里负责数据与动画
  var clearDialogTimers = [];

  Game.renderClearRank = function (box, info) {
    // 按「现在退出本局会结算多少」预估积分，与最终结算页的数字保持一致
    var outcome = calcRankOutcome({
      mode: 'solo',
      cleared: info.cleared,
      startLevel: info.startLevel,
      win: !!info.isFinal,
      quitCleared: !info.isFinal,
      wordsCleared: 1,
      failReason: 'time'
    }, 'solo');
    var before = DATA.rankPoints;
    var after = Math.max(0, before + outcome.delta);
    var afterRank = rankOf(after);
    var denom = afterRank.next ? afterRank.next.min : null;
    var progText = afterRank.next
      ? '距' + afterRank.next.name + '还差 ' + Math.max(0, afterRank.next.min - after) + ' 分'
      : '已达到最高段位';

    var line = document.createElement('div');
    line.className = 'rank-line';
    line.innerHTML =
      '<div class="rank-line-head">' +
        '<span class="rank-line-cap">本局总计积分</span>' +
        '<b class="rank-line-delta"></b>' +
        '<span class="rank-line-caret">›</span>' +
        '<span class="rank-line-pts"><b></b><i class="rank-line-rank"></i></span>' +
      '</div>' +
      '<div class="rank-glow-bar"><i class="rank-glow-fill"></i></div>' +
      '<div class="rank-line-foot">' +
        '<span class="rank-line-note"></span>' +
        '<span class="rank-line-label"></span>' +
      '</div>';
    box.appendChild(line);

    for (var i = 0; i < clearDialogTimers.length; i++) clearTimeout(clearDialogTimers[i]);
    clearDialogTimers = [];

    playRankLine({
      delta: line.querySelector('.rank-line-delta'),
      total: line.querySelector('.rank-line-pts b'),
      rankName: line.querySelector('.rank-line-rank'),
      fill: line.querySelector('.rank-glow-fill'),
      label: line.querySelector('.rank-line-label'),
      note: line.querySelector('.rank-line-note')
    }, {
      before: before,
      after: after,
      delta: outcome.delta,
      denom: denom,
      curMin: afterRank.min,
      rankName: afterRank.name,
      progText: progText,
      delay: info.delay || 0
    }, clearDialogTimers);
  };

  function tweenLabel(el, from, to, denom, dur) {
    var start = null;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.textContent = denom ? (to + '/' + denom) : String(to);
    }
    function step(ts) {
      if (done) return;
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var val = Math.round(from + (to - from) * p);
      el.textContent = denom ? (val + '/' + denom) : String(val);
      if (p < 1) global.requestAnimationFrame(step);
      else finish();
    }
    global.requestAnimationFrame(step);
    // 兜底：rAF 在后台标签页会被节流，用定时器保证最终值一定到位
    setTimeout(finish, dur + 100);
  }

  /* ---------------- 结算 ---------------- */
  function handleGameEnd(stats) {
    var mode = stats.mode || 'solo';

    // 失败后“再来一局”重试失败的那一关，通关后从原起关卡重玩
    lastConfig = {
      setKey: stats.setKey,
      diffKey: stats.diffKey,
      level: mode === 'solo' ? (stats.win ? stats.startLevel : stats.levelIndex) : 1,
      mode: mode
    };

    // 段位积分先结算，保持与结算页展示一致
    var isReview = mode === 'review';
    var beforePoints = DATA.rankPoints;
    var outcome = isReview ? { delta: 0, result: 'none', bonus: 0 } : calcRankOutcome(stats, mode);
    // result 为 none（错词复习、未消除任何单词就退出）时不写入段位战绩
    var afterRank = outcome.result === 'none'
      ? rankOf(DATA.rankPoints)
      : applyRankResult(outcome.delta, outcome.result);

    var isNewRecord = !isReview && stats.score > DATA.bestScore;

    if (isNewRecord) {
      DATA.bestScore = stats.score;
      ST.set('bestScore', DATA.bestScore);
    }
    if (!isReview && stats.wpm > DATA.bestWpm) {
      DATA.bestWpm = stats.wpm;
      ST.set('bestWpm', DATA.bestWpm);
    }

    // 写入成绩记录（错词复习不计入）
    if (!isReview) {
      DATA.history.push({
        score: stats.score,
        wpm: stats.wpm,
        accuracy: stats.accuracy,
        mode: mode,
        date: formatDate(new Date())
      });
      if (DATA.history.length > 20) DATA.history = DATA.history.slice(-20);
      ST.setJSON('history', DATA.history);
    }

    // 主动退出：会扣分时进入失败结算页，展示积分倒扣与进度条倒退；
    // 不扣分（一个词都没消）或仍加分（如冲刺 400 分以上退出、通关弹窗退出）时直接回首页
    if (stats.failReason === 'quit' && !(outcome.delta < 0)) {
      Game.stop();
      refreshHome();
      UI.showScreen('HOME');
      return;
    }

    document.getElementById('resScore').textContent = stats.score;
    document.getElementById('resAcc').textContent = stats.accuracy + '%';
    document.getElementById('resWpm').textContent = stats.wpm + ' 词/分';
    document.getElementById('resCombo').textContent = stats.maxCombo;

    // 第一步数据区：所有模式统一四项本局指标；冲刺在卡片下方补一行历史最佳做对比
    var gridEl = document.getElementById('resGrid');
    var vsEl = document.getElementById('resVsTable');
    var bestEl = document.getElementById('resBest');
    document.getElementById('resCap1').textContent = '本局得分';
    document.getElementById('resCap2').textContent = '本局准确率';
    document.getElementById('resItem3').hidden = false;
    document.getElementById('resItem4').hidden = false;
    gridEl.hidden = false;
    vsEl.hidden = true;
    bestEl.hidden = mode !== 'sprint';
    if (mode === 'sprint') {
      document.getElementById('resBestScore').textContent = DATA.bestScore;
      document.getElementById('resBestWpm').textContent = DATA.bestWpm;
    } else if (mode === 'versus') {
      gridEl.hidden = true;
      vsEl.hidden = false;
      document.getElementById('vsYouScore').textContent = stats.score;
      document.getElementById('vsAiScore').textContent = stats.aiScore;
      document.getElementById('vsYouCombo').textContent = stats.maxCombo;
      document.getElementById('vsAiCombo').textContent = stats.aiMaxCombo || 0;
      document.getElementById('vsYouLives').textContent = stats.livesLeft;
      document.getElementById('vsAiLives').textContent = stats.aiLives;
    }

    // 结算状态：按模式区分文案；AI 对战同时算出胜负方，供比分区复用
    var status = document.getElementById('resStatus');
    var winView;
    var vsWinner = null;
    if (mode === 'review') {
      status.textContent = '错词复习 · 60 秒打掉 ' + stats.wordsCleared + ' 个错词' +
        (stats.failReason === 'lives' ? ' · 爱心提前耗尽' : '') +
        (stats.failReason === 'quit' ? ' · 主动退出' : '');
      winView = stats.failReason !== 'lives';
    } else if (mode === 'sprint') {
      status.textContent = stats.failReason === 'lives' ? '爱心提前耗尽'
        : (stats.failReason === 'quit' ? '主动退出' : '时间到');
      winView = outcome.delta > 0;
    } else if (mode === 'versus') {
      vsWinner = stats.versusWinner ||
        (stats.score > stats.aiScore ? 'player' : (stats.score === stats.aiScore ? 'draw' : 'ai'));
      var cmp = vsWinner === 'player' ? '胜利' : (vsWinner === 'draw' ? '平局' : '失败');
      // 不同结束原因用不同辅助文案，避免所有结果都只说「胜利 / 失败」
      var why;
      if (stats.failReason === 'ko') {
        why = vsWinner === 'player' ? '成功压制 AI' : '被 AI 反超';
      } else if (stats.failReason === 'aiLives') {
        why = 'AI 爱心耗尽';
      } else if (stats.failReason === 'lives') {
        why = '你的爱心耗尽';
      } else if (stats.failReason === 'quit') {
        why = '你退出了本局';
      } else if (vsWinner === 'draw') {
        why = '双方势均力敌';
      } else if (vsWinner === 'player') {
        why = '时间到，比分领先';
      } else {
        why = '时间到，比分落后';
      }
      status.textContent = 'AI 对战 · ' + why;
      winView = vsWinner === 'player';
    } else {
      var lvText = '第 ' + stats.levelIndex + ' / ' + stats.levelTotal + ' 关';
      if (stats.win) {
        status.textContent = lvText + ' · 全部通关';
      } else if (stats.failReason === 'quit') {
        status.textContent = lvText + ' · 已退出本局';
      } else if (stats.failReason === 'time') {
        status.textContent = lvText + ' · 时间到，本局结束';
      } else {
        status.textContent = '第' + numToCn(stats.levelIndex) + '关';
      }
      winView = !!stats.win;
    }
    status.classList.toggle('is-win', winView);

    var verdict = document.getElementById('resVerdict');
    var bigText, bigCls;
    if (mode === 'review') {
      bigText = stats.failReason === 'lives' ? '复习结束' : '复习完成';
      bigCls = 'is-mid';
    } else if (mode === 'sprint') {
      // 冲刺统一「挑战完成」；只有主动退出且导致扣分时按失败展示
      var sprintLose = stats.failReason === 'quit' && outcome.delta < 0;
      bigText = sprintLose ? '失败' : '挑战完成';
      bigCls = sprintLose ? 'is-lose' : 'is-win';
    } else if (mode === 'versus') {
      bigText = cmp;
      bigCls = cmp === '胜利' ? 'is-win' : (cmp === '失败' ? 'is-lose' : 'is-mid');
    } else {
      if (stats.win) { bigText = '全部通关'; bigCls = 'is-win'; }
      else if (stats.failReason === 'quit') { bigText = '失败'; bigCls = 'is-lose'; }
      else if (stats.failReason === 'time') { bigText = '时间到'; bigCls = winView ? 'is-win' : 'is-lose'; }
      else { bigText = '失败'; bigCls = 'is-lose'; }
    }
    var dropMs = renderVerdict(verdict, bigText, bigCls);

    // 单机失败（含中途退出扣分）时，把「第 N 关」移到大字上方并居中；其它情况放回大字下方
    // AI 对战的大字下方先是比分，状态行要排在比分之后
    if (mode === 'solo' && !winView && stats.failReason !== 'time') {
      verdict.parentNode.insertBefore(status, verdict);
      status.classList.add('is-above');
    } else {
      var statusBefore = mode === 'versus' ? document.getElementById('resVsScore') : verdict;
      statusBefore.parentNode.insertBefore(status, statusBefore.nextSibling);
      status.classList.remove('is-above');
    }

    var vsScoreEl = document.getElementById('resVsScore');
    vsScoreEl.hidden = mode !== 'versus';
    if (mode === 'versus') {
      var gap = Math.abs(stats.score - stats.aiScore);
      document.getElementById('resVsYou').textContent = stats.score;
      document.getElementById('resVsAi').textContent = stats.aiScore;

      var gapEl = document.getElementById('resVsGap');
      if (vsWinner === 'draw') {
        gapEl.textContent = '双方打成平局';
      } else if (vsWinner === 'player') {
        gapEl.textContent = '你领先 AI ' + gap + ' 分';
      } else {
        gapEl.textContent = 'AI 领先你 ' + gap + ' 分';
      }
      gapEl.className = 'vs-score-gap ' +
        (vsWinner === 'player' ? 'is-win' : (vsWinner === 'ai' ? 'is-lose' : 'is-mid'));
    }

    // 本局积分：直接在第一页动态展示变化与段位进度（错词复习不参与）
    var rankLine = document.getElementById('resRankLine');
    var reviewNote = document.getElementById('resReviewNote');
    if (isReview) {
      rankLine.hidden = true;
      reviewNote.hidden = false;
    } else {
      rankLine.hidden = false;
      reviewNote.hidden = true;

      var denom = afterRank.next ? afterRank.next.min : null;
      var progText = '已达到最高段位';
      if (afterRank.next) {
        progText = '距' + afterRank.next.name + '还差 ' + Math.max(0, afterRank.next.min - DATA.rankPoints) + ' 分';
      }
      // 等大字掉完再开始积分动画：先弹出加减分，再走进度条
      var rankDelay = dropMs + 500;
      playRankInline({
        before: beforePoints,
        after: DATA.rankPoints,
        delta: outcome.delta,
        denom: denom,
        curMin: afterRank.min,
        rankName: afterRank.name,
        progText: progText,
        delay: rankDelay
      });
    }

    // 新纪录徽章：只有真正刷新最高分才显示，失败局不挂，避免「新纪录」和「失败」同时出现
    var recBadge = document.getElementById('resNew');
    var recOk = mode === 'sprint' || (mode === 'versus' && vsWinner === 'player');
    recBadge.hidden = !(isNewRecord && !isReview && recOk);
    document.getElementById('resRecordRow').hidden = recBadge.hidden;

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
      none.textContent = '本局没有打错的单词，继续保持！';
      wrap.appendChild(none);
    }
    document.getElementById('resWrongHint').hidden = shown === 0;

    UI.showScreen('RESULT');
  }

  /* ---------------- 弹窗内容 ---------------- */
  function openRankInfo() {
    var r = rankOf(DATA.rankPoints);
    var wrap = document.createElement('div');

    var hero = document.createElement('div');
    hero.className = 'rank-hero';
    var name = document.createElement('div');
    name.className = 'rank-name';
    name.textContent = r.name;
    var pts = document.createElement('div');
    pts.className = 'rank-points';
    pts.textContent = DATA.rankPoints;
    var unit = document.createElement('span');
    unit.textContent = '积分';
    pts.appendChild(unit);
    hero.appendChild(name);
    hero.appendChild(pts);
    wrap.appendChild(hero);

    var bar = document.createElement('div');
    bar.className = 'rank-bar';
    var fill = document.createElement('i');
    var pct = 100;
    if (r.next) {
      var span = r.next.min - r.min;
      pct = Math.max(0, Math.min(100, ((DATA.rankPoints - r.min) / span) * 100));
    }
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    wrap.appendChild(bar);

    var next = document.createElement('div');
    next.className = 'rank-next';
    next.textContent = r.next
      ? '距 ' + r.next.name + ' 还差 ' + Math.max(0, r.next.min - DATA.rankPoints) + ' 分'
      : '已达到最高段位';
    wrap.appendChild(next);

    var rec = document.createElement('div');
    rec.className = 'rank-record';
    rec.textContent = '战绩：胜 ' + DATA.rankRecord.wins +
      ' · 平 ' + DATA.rankRecord.draws +
      ' · 负 ' + DATA.rankRecord.losses;
    wrap.appendChild(rec);

    var ladder = document.createElement('div');
    ladder.className = 'rank-ladder';
    var ladderTitle = document.createElement('div');
    ladderTitle.className = 't';
    ladderTitle.textContent = '段位门槛';
    ladder.appendChild(ladderTitle);
    RANKS.forEach(function (rk, i) {
      var row = document.createElement('div');
      row.className = 'rank-step' + (i === r.index ? ' is-now' : '');
      var stepName = document.createElement('span');
      stepName.className = 'rank-step-name';
      stepName.textContent = rk.name;
      var stepRange = document.createElement('span');
      stepRange.className = 'rank-step-range';
      stepRange.textContent = RANKS[i + 1]
        ? rk.min + '–' + (RANKS[i + 1].min - 1) + ' 分'
        : rk.min + ' 分以上';
      row.appendChild(stepName);
      row.appendChild(stepRange);
      ladder.appendChild(row);
    });
    wrap.appendChild(ladder);

    var rules = document.createElement('div');
    rules.className = 'rank-rules';
    var t = document.createElement('div');
    t.className = 't';
    t.textContent = '积分规则';
    rules.appendChild(t);

    var ul = document.createElement('ul');
    [
      '单机闯关：全部通关 +30；通过 3 关及以上 +20；通过 1–2 关 +5；一关未过 −10',
      '单机闯关：每首次通过一关，额外 +10',
      '限时冲刺：600 分及以上 +15；400–599 分 +5；低于 400 分 −8',
      'AI 对战：高于 AI +20；与 AI 持平 +5；低于 AI −10',
      '积分最低为 0，不会扣成负数'
    ].forEach(function (text) {
      var li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
    rules.appendChild(ul);
    wrap.appendChild(rules);

    UI.openModal({
      title: '段位与积分',
      content: wrap,
      actions: [{ label: '知道了', primary: true, onClick: function () { UI.closeModal(); } }]
    });
  }

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
          '<li>每关限时 <b>50</b> 秒，第一关约需打掉 <b>6</b> 个词（普通难度），目标逐关递增</li>' +
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
        '<p><b>模式</b></p>' +
        '<ul>' +
          '<li><b>单机闯关</b>：逐关解锁，每关 50 秒，达到目标分过关</li>' +
          '<li><b>限时冲刺</b>：整库词池单局 60 秒，不设关卡，冲击最高分</li>' +
          '<li><b>AI 对战</b>：左右双跑道各 60 秒。AI 会读词、逐字输入、偶尔打错，也会小概率走神整词漏看；任一方 3 颗爱心碎完即判负，一方分数占比达到 <b>70%</b> 并保持 <b>3</b> 秒可压制获胜，否则时间到按比分判定</li>' +
          '<li><b>错词复习</b>：从错词本首页点击「复习错词」，用当前词库的错词打一局 60 秒，不参与排名与段位积分；错词越少出块越慢，同屏不会出现重复单词</li>' +
        '</ul>' +
        '<p><b>成绩趋势</b></p>' +
        '<p>首页「最近表现」记录最近 20 局得分，并画出最近 10 局的走势，可用来观察自己是否在进步。</p>' +
        '<p><b>段位积分</b></p>' +
        '<p>每局结束按胜负增减积分；点击首页段位旁的「!」可查看当前段位、积分进度与完整规则。</p>' +
        '<p><b>操作</b></p>' +
        '<ul>' +
          '<li><b>字母 / 数字键</b>：逐字母输入当前单词</li>' +
          '<li><b>Backspace</b>：清空当前输入，不扣爱心</li>' +
          '<li><b>Esc</b>：暂停 / 继续；切换到其他窗口会自动暂停；暂停中可点「退出本局」立即结算</li>' +
        '</ul>' +
        '<p>请使用<b>英文输入法</b>。检测到中文输入法组合输入时会暂停判定并给出提示。</p>',
      actions: [{ label: '知道了', primary: true, onClick: function () { UI.closeModal(); } }]
    });
  }

  function openHistory() {
    var wrap = document.createElement('div');
    wrap.className = 'history-wrap';
    UI.renderHistory(wrap, DATA.history);
    UI.openModal({
      title: '全部记录',
      content: wrap,
      actions: [{ label: '关闭', onClick: function () { UI.closeModal(); } }]
    });
  }

  function openSettings() {
    var wrap = document.createElement('div');

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

    var btnReset = document.createElement('button');
    btnReset.className = 'btn ghost small';
    btnReset.textContent = '重置所有数据';
    btnReset.style.marginTop = '14px';
    btnReset.addEventListener('click', function () {
      UI.confirm('重置所有数据', '昵称、最高分、成绩记录、段位积分、设置、关卡解锁进度、错词本与新手引导进度都会被清空，下次进入将重新走引导。确定继续？', function () {
        ST.resetAll();
        DATA.nickname = '玩家';
        DATA.bestScore = 0;
        DATA.bestWpm = 0;
        DATA.settings = { sound: true, theme: 'light' };
        DATA.helpSeen = false;
        DATA.guideSeen = false;
        DATA.levelProgress = {};
        DATA.wrongBook = {};
        DATA.rankPoints = 0;
        DATA.rankRecord = { wins: 0, losses: 0, draws: 0 };
        DATA.history = [];
        picked.level = 1;
        picked.mode = 'solo';
        Game.setSound(true);
        UI.applyTheme('light');
        refreshHome();
        UI.closeModal();
        startOnboarding();
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
      openSelect('solo');
    });
    document.getElementById('modeSprint').addEventListener('click', function () {
      openSelect('sprint');
    });
    document.getElementById('modeVersus').addEventListener('click', function () {
      openSelect('versus');
    });

    document.getElementById('rankTipBtn').addEventListener('click', openRankInfo);

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
    document.getElementById('historyBtn').addEventListener('click', openHistory);

    // 错词本：直接以当前词库的错词开一局 60 秒复习
    document.getElementById('reviewWrongBtn').addEventListener('click', function () {
      var words = wrongList(picked.setKey);
      if (!words.length) {
        UI.toast('当前词库还没有错词，先玩一局收集');
        return;
      }
      runBaseCleared = 0;
      lastConfig = {
        setKey: picked.setKey,
        diffKey: picked.diffKey,
        level: 1,
        mode: 'review'
      };
      Game.start(picked.setKey, picked.diffKey, 1, words, 'review');
    });

    // 错词本：只清空当前选中词库的记录
    document.getElementById('clearWrongBtn').addEventListener('click', function () {
      var list = wrongList(picked.setKey);
      if (!list.length) {
        UI.toast('当前词库还没有错词');
        return;
      }
      var setName = WORD_SETS[picked.setKey] ? WORD_SETS[picked.setKey].name : picked.setKey;
      UI.confirm('清空错词本', '将清空「' + setName + '」的 ' + list.length + ' 个错词，且不可恢复。确定继续？', function () {
        DATA.wrongBook[picked.setKey] = [];
        ST.setJSON('wrongBook', DATA.wrongBook);
        renderWrongBook();
        UI.toast('错词本已清空');
      });
    });

    // 选择页
    document.getElementById('backHomeBtn').addEventListener('click', function () {
      UI.showScreen('HOME');
      refreshHome();
    });

    document.getElementById('startGameBtn').addEventListener('click', launchGame);

    // 对局页
    document.getElementById('pauseBtn').addEventListener('click', function () {
      Game.pause();
    });
    document.getElementById('resumeBtn').addEventListener('click', function () {
      Game.resume();
    });
    document.getElementById('quitGameBtn').addEventListener('click', function () {
      var info = Game.getQuitInfo();
      // 开局后一个单词都还没消除：直接退出，不扣积分
      if (!info.wordsCleared) {
        Game.quit();
        return;
      }
      // 已有消除记录：先说明当前进度与退出代价，确认后再退出
      var preview = calcRankOutcome({
        score: info.score,
        cleared: info.cleared,
        startLevel: info.startLevel,
        win: false,
        // 主动退出对战按认输结算（与 Game.quit() 一致），预览不能按当前比分算成胜利
        versusWinner: info.mode === 'versus' ? 'ai' : info.versusWinner,
        aiScore: info.aiScore,
        wordsCleared: info.wordsCleared,
        levelWords: info.levelWords,
        failReason: 'quit'
      }, info.mode);
      // 单机闯关显示「本关」得分，冲刺与对战没有关卡概念，显示整局得分
      var shownScore = info.mode === 'solo' ? info.levelScore : info.score;
      var lines = [info.mode === 'solo'
        ? '本关目前已得 <b>' + shownScore + '</b> 分。'
        : '目前已得 <b>' + shownScore + '</b> 分。'];
      if (info.mode === 'solo') {
        lines.push(info.remainingWords > 0
          ? '再消除约 <b>' + info.remainingWords + '</b> 个单词即可通过本关。'
          : '本关目标分已达成。');
      }
      if (preview.delta < 0) {
        // 退出会按失败结算：单机与冲刺直接算失败，AI 对战算认输（同样判负）
        lines.push(info.mode === 'versus'
          ? '现在退出将算作 <b>失败</b>（认输），并扣除 <b>' + (-preview.delta) + '</b> 积分。'
          : '现在退出将算作 <b>失败</b>，并扣除 <b>' + (-preview.delta) + '</b> 积分。');
      } else if (preview.delta > 0) {
        lines.push('现在退出不算失败，仍可获得 <b>+' + preview.delta + '</b> 积分。');
      } else {
        lines.push('现在退出不扣积分。');
      }
      UI.confirm('是否退出？', lines.join('<br>'), function () {
        Game.quit();
      }, { titleCenter: true, bodyCenter: true, centerActions: true });
    });

    // 结算页
    document.getElementById('againBtn').addEventListener('click', function () {
      var mode = lastConfig.mode || 'solo';
      var words = wrongList(lastConfig.setKey);
      if (mode === 'review' && !words.length) {
        UI.toast('错词本已清空，无法再来一局');
        return;
      }
      runBaseCleared = mode === 'solo' ? clearedLevels(lastConfig.setKey, lastConfig.diffKey) : 0;
      Game.start(lastConfig.setKey, lastConfig.diffKey, lastConfig.level, words, mode);
    });

    document.getElementById('changeSetBtn').addEventListener('click', function () {
      Game.stop();
      picked.setKey = lastConfig.setKey;
      picked.diffKey = lastConfig.diffKey;
      picked.mode = lastConfig.mode || 'solo';
      picked.level = unlockedMax(picked.setKey, picked.diffKey);
      buildSetCards();
      buildDiffCards();
      buildLevelGrid();
      applyModeToSelect();
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
    Game.onWrongWord = addWrongWord;

    Game.init();
    initGuide();

    refreshHome();
    buildSetCards();
    buildDiffCards();
    buildLevelGrid();
    applyModeToSelect();
    bindEvents();

    if (DATA.guideSeen) {
      UI.showScreen('HOME');
      maybeAutoHelp();
    } else {
      startOnboarding();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);

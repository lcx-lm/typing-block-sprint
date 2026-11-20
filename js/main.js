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

    var wb = ST.getJSON('wrongBook', {});
    DATA.wrongBook = wb && typeof wb === 'object' && !Array.isArray(wb) ? wb : {};

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

    // 复习入口按钮：显示当前词库的错词数量，空时给出提示
    var reviewBtn = document.getElementById('reviewWrongBtn');
    if (reviewBtn) {
      reviewBtn.textContent = list.length ? '复习错词（' + list.length + '）' : '复习错词';
    }
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
    updateRankChip();
    UI.renderLeaderboard(UI.els.homeLb, DATA.leaderboard, 5);
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
    // 开局后一个单词都没消除就退出：不扣分，也不计胜负
    if (stats.failReason === 'quit' && !stats.wordsCleared) {
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

    var delta;
    var result = 'lose';
    if (stats.win) {
      delta = 30;
      result = 'win';
    } else if (stats.cleared >= 3) {
      delta = 20;
      result = 'win';
    } else if (stats.cleared >= 1) {
      delta = 5;
      result = 'win';
    } else {
      delta = -10;
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
  var rankAnim = null;
  var rankTimers = [];

  function clearRankTimers() {
    for (var i = 0; i < rankTimers.length; i++) clearTimeout(rankTimers[i]);
    rankTimers = [];
  }

  // 大字结论：只有「失败」用石头碎裂动效，其余用弹出动效
  function renderVerdict(el, text, cls) {
    el.className = 'result-verdict ' + cls;
    if (cls === 'is-lose' && text === '失败') {
      el.classList.add('is-shatter');
      buildShatter(el, text);
    } else {
      el.classList.remove('is-shatter');
      el.textContent = text;
    }
  }

  function buildShatter(el, text) {
    el.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'shatter-wrap';
    var tiles = [
      { clip: 'polygon(0 0, 33.33% 0, 33.33% 50%, 0 50%)', to: 'translate(-36px,-24px) rotate(-15deg)' },
      { clip: 'polygon(33.33% 0, 66.67% 0, 66.67% 50%, 33.33% 50%)', to: 'translate(0,-40px) rotate(8deg)' },
      { clip: 'polygon(66.67% 0, 100% 0, 100% 50%, 66.67% 50%)', to: 'translate(36px,-22px) rotate(16deg)' },
      { clip: 'polygon(0 50%, 33.33% 50%, 33.33% 100%, 0 100%)', to: 'translate(-30px,34px) rotate(13deg)' },
      { clip: 'polygon(33.33% 50%, 66.67% 50%, 66.67% 100%, 33.33% 100%)', to: 'translate(2px,42px) rotate(-10deg)' },
      { clip: 'polygon(66.67% 50%, 100% 50%, 100% 100%, 66.67% 100%)', to: 'translate(38px,30px) rotate(-17deg)' }
    ];
    for (var i = 0; i < tiles.length; i++) {
      var s = document.createElement('span');
      s.className = 'shard';
      s.textContent = text;
      s.style.webkitClipPath = tiles[i].clip;
      s.style.clipPath = tiles[i].clip;
      s.style.setProperty('--to', tiles[i].to);
      s.style.setProperty('--delay', (i * 0.035) + 's');
      wrap.appendChild(s);
    }
    for (var j = 0; j < 10; j++) {
      var d = document.createElement('i');
      d.className = 'debris';
      d.style.setProperty('--dx', (Math.random() * 180 - 90) + 'px');
      d.style.setProperty('--dy', (Math.random() * 130 - 30) + 'px');
      d.style.setProperty('--dr', (Math.random() * 420 - 210) + 'deg');
      d.style.setProperty('--delay', (0.26 + Math.random() * 0.22) + 's');
      wrap.appendChild(d);
    }
    el.appendChild(wrap);
  }

  // 把第二步重置到“只显示原有积分”的初始状态
  function resetRankStep2(a) {
    clearRankTimers();
    var beforeEl = document.getElementById('resRankBefore');
    var deltaEl = document.getElementById('resRankDelta');
    var afterCol = document.querySelector('.rs-after-col');
    var rankName = document.getElementById('resRankName');
    var progText = document.getElementById('resRankProgressText');
    var fill = document.getElementById('resRankFill');
    var label = document.getElementById('resRankBarLabel');

    beforeEl.textContent = a.before;
    deltaEl.textContent = (a.delta > 0 ? '+' : '') + a.delta;
    deltaEl.className = 'rs-op ' + (a.delta > 0 ? 'up' : (a.delta < 0 ? 'down' : 'flat'));
    deltaEl.hidden = true;
    document.getElementById('resRankAfter').textContent = a.after;
    afterCol.hidden = true;
    rankName.textContent = a.rankName;
    rankName.hidden = true;
    progText.textContent = a.progText;
    progText.hidden = true;

    var rspan = a.denom ? (a.denom - a.curMin) : 1;
    var pctBefore = a.denom ? Math.max(0, Math.min(100, ((a.before - a.curMin) / rspan) * 100)) : 100;
    fill.style.transition = 'none';
    fill.style.width = pctBefore + '%';
    label.textContent = a.denom ? (a.before + '/' + a.denom) : String(a.before);
    // 触发重排，保证后续 width 变化能触发过渡
    void fill.offsetWidth;
    fill.style.transition = '';
  }

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

  // 点“下一步”后依次揭示：扣分项 → 当前总分 → 进度条回退 → 段位名
  function playRankSettle() {
    if (!rankAnim) return;
    var a = rankAnim;
    var deltaEl = document.getElementById('resRankDelta');
    var afterCol = document.querySelector('.rs-after-col');
    var rankName = document.getElementById('resRankName');
    var progText = document.getElementById('resRankProgressText');
    var fill = document.getElementById('resRankFill');
    var label = document.getElementById('resRankBarLabel');

    clearRankTimers();
    rankTimers.push(setTimeout(function () {
      deltaEl.hidden = false;
      deltaEl.classList.add('rs-reveal');
    }, 450));
    rankTimers.push(setTimeout(function () {
      afterCol.hidden = false;
      afterCol.classList.add('rs-reveal');
    }, 950));
    rankTimers.push(setTimeout(function () {
      var rspan = a.denom ? (a.denom - a.curMin) : 1;
      var pctAfter = a.denom ? Math.max(0, Math.min(100, ((a.after - a.curMin) / rspan) * 100)) : 100;
      fill.style.width = pctAfter + '%';
      tweenLabel(label, a.before, a.after, a.denom, 650);
    }, 1300));
    rankTimers.push(setTimeout(function () {
      rankName.hidden = false;
      rankName.classList.add('rs-reveal');
      progText.hidden = false;
      progText.classList.add('rs-reveal');
    }, 2050));
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

    // 写入排行榜（错词复习不参与排名）
    if (!isReview) {
      DATA.leaderboard.push({
        name: DATA.nickname,
        score: stats.score,
        wpm: stats.wpm,
        accuracy: stats.accuracy,
        date: formatDate(new Date())
      });
      saveLeaderboard();

      // 成绩历史：仅保留最近 20 局，用于首页趋势图
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

    // 结算页数据
    document.getElementById('resScore').textContent = stats.score;
    document.getElementById('resAcc').textContent = stats.accuracy + '%';
    document.getElementById('resWpm').textContent = stats.wpm;
    document.getElementById('resCombo').textContent = stats.maxCombo;

    // 第一步数据区按模式统一排版：关卡/复习四项，冲刺得分+最佳 WPM，AI 对战换成左右对比表
    var gridEl = document.getElementById('resGrid');
    var vsEl = document.getElementById('resVsTable');
    document.getElementById('resCap1').textContent = '本局得分';
    document.getElementById('resCap2').textContent = '准确率';
    document.getElementById('resItem3').hidden = false;
    document.getElementById('resItem4').hidden = false;
    gridEl.hidden = false;
    gridEl.classList.remove('is-two');
    vsEl.hidden = true;
    if (mode === 'sprint') {
      // 冲刺只展示得分 + 最佳 WPM，两列铺满
      gridEl.classList.add('is-two');
      document.getElementById('resCap2').textContent = '最佳 WPM';
      document.getElementById('resAcc').textContent = DATA.bestWpm;
      document.getElementById('resItem3').hidden = true;
      document.getElementById('resItem4').hidden = true;
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

    // 结算状态：按模式区分文案
    var status = document.getElementById('resStatus');
    var winView;
    if (mode === 'review') {
      status.textContent = '错词复习 · 60 秒打掉 ' + stats.wordsCleared + ' 个错词' +
        (stats.failReason === 'lives' ? ' · 爱心提前耗尽' : '') +
        (stats.failReason === 'quit' ? ' · 主动退出' : '');
      winView = stats.failReason !== 'lives';
    } else if (mode === 'sprint') {
      status.textContent = '限时冲刺 · 60 秒得分 ' + stats.score +
        (stats.failReason === 'lives' ? ' · 爱心提前耗尽' : '') +
        (stats.failReason === 'quit' ? ' · 主动退出' : '');
      winView = outcome.delta > 0;
    } else if (mode === 'versus') {
      var vWinner = stats.versusWinner ||
        (stats.score > stats.aiScore ? 'player' : (stats.score === stats.aiScore ? 'draw' : 'ai'));
      var cmp = vWinner === 'player' ? '胜利' : (vWinner === 'draw' ? '平局' : '失败');
      var why = '';
      if (stats.failReason === 'ko') {
        why = vWinner === 'player' ? '拔河压制' : '被 AI 压制';
      } else if (stats.failReason === 'aiLives') {
        why = 'AI 爱心碎完';
      } else if (stats.failReason === 'lives') {
        why = '你的爱心碎完';
      } else if (stats.failReason === 'quit') {
        why = '你退出了本局';
      } else {
        why = '时间到，按比分判定';
      }
      status.textContent = 'AI 对战 · 你 ' + stats.score + ' : ' + stats.aiScore +
        ' AI · ' + cmp + '（' + why + '）';
      winView = vWinner === 'player';
    } else {
      var lvText = '第 ' + stats.levelIndex + ' / ' + stats.levelTotal + ' 关';
      if (stats.win) {
        status.textContent = lvText + ' · 全部通关';
      } else if (stats.failReason === 'quit') {
        status.textContent = lvText + ' · 已退出本局';
      } else if (stats.failReason === 'time') {
        status.textContent = lvText + ' · 时间到，本局结束';
      } else {
        status.textContent = lvText + ' · 爱心碎完，本局结束';
      }
      winView = !!stats.win || (stats.failReason === 'quit' && stats.cleared > 0);
    }
    status.classList.toggle('is-win', winView);

    // 大字结论：胜利 / 失败 / 通关 等，放在结算页中间
    var verdict = document.getElementById('resVerdict');
    var bigText, bigCls;
    if (mode === 'review') {
      bigText = stats.failReason === 'lives' ? '复习结束' : '复习完成';
      bigCls = 'is-mid';
    } else if (mode === 'sprint') {
      // 冲刺按是否刷新最高分给出结论
      bigText = isNewRecord ? '破纪录' : '未破纪录';
      bigCls = isNewRecord ? 'is-win' : 'is-lose';
    } else if (mode === 'versus') {
      bigText = cmp;
      bigCls = cmp === '胜利' ? 'is-win' : (cmp === '失败' ? 'is-lose' : 'is-mid');
    } else {
      if (stats.win) { bigText = '全部通关'; bigCls = 'is-win'; }
      else if (stats.failReason === 'quit') { bigText = '已退出'; bigCls = 'is-mid'; }
      else if (stats.failReason === 'time') { bigText = '时间到'; bigCls = winView ? 'is-win' : 'is-lose'; }
      else { bigText = '失败'; bigCls = 'is-lose'; }
    }
    renderVerdict(verdict, bigText, bigCls);

    // 第二步：段位积分变化与进度条（错词复习不参与）
    var summaryEl = document.getElementById('resRankSummary');
    var progEl = document.getElementById('resRankProgress');
    var reviewNote = document.getElementById('resReviewNote');
    clearRankTimers();
    if (isReview) {
      rankAnim = null;
      summaryEl.hidden = true;
      progEl.hidden = true;
      reviewNote.hidden = false;
    } else {
      summaryEl.hidden = false;
      progEl.hidden = false;
      reviewNote.hidden = true;

      var denom = afterRank.next ? afterRank.next.min : null;
      var progText = '已达到最高段位';
      if (afterRank.next) {
        progText = '距 ' + afterRank.next.name + ' 还差 ' + Math.max(0, afterRank.next.min - DATA.rankPoints) + ' 分';
      }
      rankAnim = {
        before: beforePoints,
        after: DATA.rankPoints,
        delta: outcome.delta,
        denom: denom,
        curMin: afterRank.min,
        rankName: afterRank.name,
        progText: progText
      };
      resetRankStep2(rankAnim);
    }

    // 破纪录标记：冲刺已用大字结论展示，其余模式只在真破纪录时补一个徽章
    var recBadge = document.getElementById('resNew');
    var missBadge = document.getElementById('resMiss');
    recBadge.hidden = !(isNewRecord && !isReview && mode !== 'sprint');
    missBadge.hidden = true;
    document.getElementById('resRecordRow').hidden = recBadge.hidden;

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

    // 每次结算都先回到第一步
    document.getElementById('resStep1').classList.add('is-active');
    document.getElementById('resStep2').classList.remove('is-active');

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
      '积分最低为 0；段位门槛：青铜 0 / 白银 100 / 黄金 300 / 铂金 600 / 钻石 1000'
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
      UI.confirm('重置所有数据', '昵称、最高分、排行榜、段位积分、设置、关卡解锁进度、错词本与新手引导进度都会被清空，下次进入将重新走引导。确定继续？', function () {
        ST.resetAll();
        DATA.nickname = '玩家';
        DATA.bestScore = 0;
        DATA.bestWpm = 0;
        DATA.leaderboard = [];
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
    document.getElementById('viewAllBtn').addEventListener('click', openLeaderboard);

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
        versusWinner: info.versusWinner,
        aiScore: info.aiScore,
        wordsCleared: info.wordsCleared,
        failReason: 'quit'
      }, info.mode);
      var lines = ['目前已消除 <b>' + info.score + '</b> 分。'];
      if (info.mode === 'solo') {
        lines.push(info.remainingWords > 0
          ? '再消除约 <b>' + info.remainingWords + '</b> 个单词即可通过本关。'
          : '本关目标分已达成。');
      }
      if (preview.delta < 0) {
        lines.push('现在退出将扣除 <b>' + (-preview.delta) + '</b> 积分。');
      } else if (preview.delta > 0) {
        lines.push('现在退出仍按已通过关卡结算，获得 <b>+' + preview.delta + '</b> 积分。');
      } else {
        lines.push('现在退出不扣积分。');
      }
      lines.push('确定退出本局吗？');
      UI.confirm('退出本局', lines.join('<br>'), function () {
        Game.quit();
      });
    });
    document.getElementById('resNextBtn').addEventListener('click', function () {
      document.getElementById('resStep1').classList.remove('is-active');
      document.getElementById('resStep2').classList.add('is-active');
      playRankSettle();
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

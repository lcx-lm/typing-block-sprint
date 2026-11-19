/* ============================================================
   字块冲刺 · 游戏核心
   状态：PLAYING / PAUSED（页面路由由 main.js 控制）
   负责：方块生成与下落、输入判定、生命、计分、暂停、结算
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------------- 难度参数（严格按需求） ---------------- */
  var DIFFS = {
    easy:   { name: '简单', spawnInterval: 2200, fallSpeed: 30, maxLen: 5,  coef: 0.8, aiRate: 18, desc: '2200ms / 30px·s⁻¹ · 单词≤5' },
    normal: { name: '普通', spawnInterval: 1600, fallSpeed: 45, maxLen: 8,  coef: 1.0, aiRate: 24, desc: '1600ms / 45px·s⁻¹ · 单词≤8' },
    hard:   { name: '困难', spawnInterval: 1100, fallSpeed: 65, maxLen: 12, coef: 1.3, aiRate: 30, desc: '1100ms / 65px·s⁻¹ · 单词≤12' }
  };

  /* ---------------- 生命与数值 ----------------
     生命为 3 颗爱心：方块触底碎掉 1 颗，碎完本局结束。
     打错字母只清空连击，不扣爱心。
     ------------------------------------------------ */
  var LIVES_MAX = 3;

  /* ---------------- 关卡参数 ----------------
     关卡数不写死：由词库词数自动计算（6 ~ 50 关）。
     每关限时冲击目标分，过关后爱心重置并进入下一关。
     ------------------------------------------------ */
  var WORDS_PER_LEVEL = 8;
  var MIN_LEVELS = 6;
  var MAX_LEVELS = 50;
  var LEVEL_TIME = 50;   // 每关秒数
  var MODE_TIME = 60;    // 限时冲刺 / AI 对战单局秒数

  // 每关需要稳定打掉的单词数：随关卡递增
  // 按实测校准：四级普通第 1 关约 6 词（目标约 490 分），最后一关约 11 词
  var WORD_GOALS = {
    easy:   { from: 5,  to: 9 },
    normal: { from: 6,  to: 11 },
    hard:   { from: 7,  to: 13 }
  };

  var areaEl = null;

  var G = {
    state: 'HOME',
    running: false,
    paused: false,
    setKey: 'cet4',
    diffKey: 'normal',
    mode: 'solo',
    aiScore: 0,
    aiRate: 24,
    score: 0,
    lives: LIVES_MAX,
    combo: 0,
    maxCombo: 0,
    correctChars: 0,
    errorCount: 0,
    elapsedMs: 0,
    input: '',
    spawnAcc: 0,
    blocks: [],
    wrongWords: [],
    reviewPool: [],
    composing: false,
    raf: 0,
    last: 0,
    seq: 0,
    levels: [],
    levelIndex: 0,
    levelScore: 0,
    levelTarget: 0,
    levelTime: 0,
    startLevel: 1,
    cleared: 0,
    transitioning: false,
    failReason: ''
  };

  /* ---------------- 音效（Web Audio 合成，无外部文件） ---------------- */
  var audioCtx = null;
  var soundOn = true;

  function getCtx() {
    if (!audioCtx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended' && audioCtx.resume) {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function beep(freq, dur, type, vol) {
    if (!soundOn) return;
    var ac = getCtx();
    if (!ac) return;
    var t0 = ac.currentTime;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.05, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /* ---------------- 运行时计算 ---------------- */
  function calcAccuracy() {
    var total = G.correctChars + G.errorCount;
    if (total <= 0) return 100;
    return Math.round((G.correctChars / total) * 100);
  }

  function calcWpm() {
    if (G.elapsedMs <= 800) return 0;
    return Math.round((G.correctChars / 5) / (G.elapsedMs / 60000));
  }

  function renderHUD() {
    global.UI.updateHUD({
      score: G.score,
      lives: G.lives,
      combo: G.combo,
      wpm: calcWpm(),
      accuracy: calcAccuracy(),
      input: G.input,
      level: G.levelIndex + 1,
      levelTotal: G.levels.length,
      levelScore: G.levelScore,
      levelTarget: G.levelTarget,
      time: Math.ceil(G.levelTime),
      mode: G.mode,
      aiScore: Math.round(G.aiScore)
    });
  }

  /* ---------------- 关卡生成（数据驱动） ---------------- */
  function calcLevelCount(wordCount) {
    var n = Math.ceil(wordCount / WORDS_PER_LEVEL);
    return Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, n));
  }

  function avgWordLength(pool) {
    var sum = 0;
    for (var i = 0; i < pool.length; i++) sum += pool[i].word.length;
    return pool.length ? sum / pool.length : 5;
  }

  // 按“连击从 1 开始、每多打一个 +10% 加成”估算打掉 words 个词的总分
  function expectedScore(perWord, words) {
    return Math.round(perWord * (words + 0.1 * words * (words + 1) / 2));
  }

  function buildLevels(setKey, diffKey) {
    var words = WORD_SETS[setKey].words;
    var total = calcLevelCount(words.length);
    var coef = DIFFS[diffKey].coef;
    var goal = WORD_GOALS[diffKey] || WORD_GOALS.normal;
    var list = [];

    for (var i = 0; i < total; i++) {
      // 把词库均匀切分到每一关，避免关卡配置写死
      var from = Math.floor(i * words.length / total);
      var to = Math.max(from + 1, Math.floor((i + 1) * words.length / total));
      var pool = words.slice(from, to);

      // 目标分 = 本关平均词长带来的单词语收益 × 目标词数（含连击加成）
      var ratio = total > 1 ? i / (total - 1) : 0;
      var needWords = Math.round(goal.from + (goal.to - goal.from) * ratio);
      var perWord = avgWordLength(pool) * 10 * coef;

      list.push({
        index: i + 1,
        pool: pool,
        wordsNeeded: needWords,
        target: expectedScore(perWord, needWords),
        timeLimit: LEVEL_TIME
      });
    }
    return list;
  }

  /* ---------------- 方块 ---------------- */
  function createBlockEl(word, meaning) {
    var el = document.createElement('div');
    el.className = 'block';

    var wordEl = document.createElement('div');
    wordEl.className = 'block-word';
    for (var i = 0; i < word.length; i++) {
      var sp = document.createElement('span');
      sp.textContent = word.charAt(i);
      wordEl.appendChild(sp);
    }

    var meaningEl = document.createElement('div');
    meaningEl.className = 'block-meaning';
    meaningEl.textContent = meaning;

    el.appendChild(wordEl);
    el.appendChild(meaningEl);
    return el;
  }

  function spawnBlock() {
    var lv = G.levels[G.levelIndex];
    var pool = lv ? lv.pool : WORD_SETS[G.setKey].words;
    var maxLen = DIFFS[G.diffKey].maxLen;

    // 按难度过滤单词长度；若过滤后为空则回退整库，保证不会没有方块
    var filtered = pool.filter(function (w) { return w.word.length <= maxLen; });
    if (!filtered.length) filtered = pool;

    // 尽量避免同屏重复单词
    var onScreen = G.blocks.map(function (b) { return b.word; });

    // 错词本中的词有更高概率优先出现
    var review = G.reviewPool.filter(function (w) {
      return w && w.word && w.word.length <= maxLen && onScreen.indexOf(w.word) === -1;
    });

    var avail;
    if (review.length && Math.random() < 0.35) {
      avail = review;
    } else {
      avail = filtered.filter(function (w) { return onScreen.indexOf(w.word) === -1; });
      if (!avail.length) avail = filtered;
    }

    var item = avail[Math.floor(Math.random() * avail.length)];

    var el = createBlockEl(item.word, item.meaning);
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    areaEl.appendChild(el);

    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var areaW = areaEl.clientWidth;
    var maxX = Math.max(0, areaW - w - 12);
    var x = 6 + Math.random() * maxX;

    el.style.left = Math.floor(x) + 'px';
    el.style.visibility = '';

    var block = {
      id: ++G.seq,
      word: item.word,
      meaning: item.meaning,
      el: el,
      spans: el.querySelectorAll('.block-word span'),
      x: x,
      y: -h - 8,
      w: w,
      h: h,
      dead: false
    };
    el.style.top = block.y + 'px';
    G.blocks.push(block);
  }

  function removeBlockEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function cleanupBlocks() {
    for (var i = 0; i < G.blocks.length; i++) {
      removeBlockEl(G.blocks[i].el);
    }
    G.blocks = [];
  }

  function moveBlocks(dt) {
    var speed = DIFFS[G.diffKey].fallSpeed;
    var areaH = areaEl.clientHeight;

    // 倒序遍历，便于安全删除
    for (var i = G.blocks.length - 1; i >= 0; i--) {
      // 触底扣完最后一颗心会结束本局并清空方块，需立即停止遍历
      if (G.state !== 'PLAYING') return;

      var b = G.blocks[i];
      if (!b || b.dead) continue;

      b.y += speed * dt;
      b.el.style.top = b.y + 'px';

      // 临近底部给出红色警示
      var near = (b.y + b.h) > (areaH - 90);
      b.el.classList.toggle('near', near);

      if (b.y + b.h >= areaH) {
        groundHit(b);
      }
    }
  }

  /* ---------------- 输入判定 ---------------- */
  function updateHighlights() {
    var input = G.input;
    for (var i = 0; i < G.blocks.length; i++) {
      var b = G.blocks[i];
      var match = !!input && b.word.indexOf(input) === 0;
      for (var j = 0; j < b.spans.length; j++) {
        b.spans[j].classList.toggle('on', match && j < input.length);
      }
    }
  }

  // 打错时用于记录的单词：优先取当前输入匹配的、最靠下的方块
  function pickBlameWord() {
    var candidates = [];
    var i;
    for (i = 0; i < G.blocks.length; i++) {
      if (G.input && G.blocks[i].word.indexOf(G.input) === 0) {
        candidates.push(G.blocks[i]);
      }
    }
    if (!candidates.length) candidates = G.blocks.slice();
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.y - a.y; });
    return candidates[0];
  }

  function registerError() {
    var blame = pickBlameWord();

    G.errorCount++;
    G.combo = 0;
    G.input = '';
    if (blame) {
      G.wrongWords.push(blame.word);
      // 交给入口层持久化到错词本
      if (typeof Game.onWrongWord === 'function') {
        Game.onWrongWord(blame.word, blame.meaning, G.setKey);
      }
    }

    global.UI.flash();
    beep(110, 0.16, 'sawtooth', 0.05);

    updateHighlights();
    renderHUD();
  }

  function destroyBlock(b) {
    var idx = G.blocks.indexOf(b);
    if (idx === -1) return;
    G.blocks.splice(idx, 1);
    b.dead = true;

    b.el.classList.add('boom');
    setTimeout(function () { removeBlockEl(b.el); }, 320);

    // 先加连击，再按公式计分（combo 含本次）
    G.combo++;
    if (G.combo > G.maxCombo) G.maxCombo = G.combo;

    var coef = DIFFS[G.diffKey].coef;
    var gain = Math.floor(b.word.length * 10 * coef * (1 + G.combo * 0.1));
    G.score += gain;
    G.levelScore += gain;

    G.input = '';

    beep(620 + Math.min(G.combo, 10) * 45, 0.07, 'triangle', 0.045);

    // 只有单机闯关才有关卡目标；冲刺与 AI 对战不自动过关
    if (G.mode === 'solo' && G.levelScore >= G.levelTarget) {
      levelClear();
      return;
    }

    updateHighlights();
    renderHUD();
  }

  function levelClear() {
    var isLast = G.levelIndex >= G.levels.length - 1;
    G.cleared = G.levelIndex + 1;

    // 通知入口层记录并解锁下一关
    if (typeof Game.onLevelClear === 'function') {
      Game.onLevelClear(G.cleared, G.setKey, G.diffKey);
    }

    beep(660, 0.09, 'triangle', 0.05);
    setTimeout(function () { beep(880, 0.12, 'triangle', 0.045); }, 90);

    if (isLast) {
      G.failReason = 'win';
      G.transitioning = true;
      renderHUD();
      global.UI.toast('全部 ' + G.levels.length + ' 关通过！');
      setTimeout(endGame, 550);
      return;
    }

    G.transitioning = true;
    renderHUD();
    global.UI.toast('第 ' + (G.levelIndex + 1) + ' 关通过，准备下一关');

    setTimeout(function () {
      if (G.state !== 'PLAYING') return;
      beginLevel(G.levelIndex + 1);
    }, 1200);
  }

  function beginLevel(i) {
    var lv = G.levels[i];
    if (!lv) return;

    G.levelIndex = i;
    G.levelScore = 0;
    G.levelTarget = lv.target;
    G.levelTime = lv.timeLimit;
    G.lives = LIVES_MAX;   // 每关重置 3 颗爱心
    G.combo = 0;
    G.input = '';
    G.spawnAcc = 0;
    G.transitioning = false;
    cleanupBlocks();
    renderHUD();
  }

  function groundHit(b) {
    var idx = G.blocks.indexOf(b);
    if (idx === -1) return;
    G.blocks.splice(idx, 1);
    b.dead = true;

    b.el.classList.add('drop');
    setTimeout(function () { removeBlockEl(b.el); }, 260);

    G.lives -= 1;
    G.combo = 0;

    global.UI.flash();
    beep(90, 0.2, 'sine', 0.06);

    renderHUD();
    if (G.lives <= 0) {
      G.lives = 0;
      G.failReason = 'lives';
      endGame();
      return;
    }
    updateHighlights();
  }

  function handleKeydown(e) {
    if (G.state !== 'PLAYING') return;

    // 暂停状态下只响应 Esc 继续
    if (G.paused) {
      if (e.key === 'Escape') {
        e.preventDefault();
        resume();
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      pause();
      return;
    }

    // 过关切换动画期间不接收输入
    if (G.transitioning) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      G.input = '';
      updateHighlights();
      renderHUD();
      return;
    }

    // 组合键不参与输入判定
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // 输入法拼音上屏过程中不判定，避免误吞键
    if (G.composing) return;

    if (e.key.length !== 1) return;
    var ch = e.key.toLowerCase();

    if (!/[a-z0-9]/.test(ch)) {
      if (e.key === ' ') e.preventDefault();
      return;
    }
    e.preventDefault();

    var next = G.input + ch;

    // 只要有一个方块以 next 为前缀，就接受这次输入
    var hasPrefix = false;
    for (var i = 0; i < G.blocks.length; i++) {
      if (G.blocks[i].word.indexOf(next) === 0) { hasPrefix = true; break; }
    }

    if (!hasPrefix) {
      registerError();
      return;
    }

    G.input = next;
    G.correctChars++;

    // 完整命中：优先消除最靠下（y 最大）的那个
    var exact = [];
    for (var j = 0; j < G.blocks.length; j++) {
      if (G.blocks[j].word === next) exact.push(G.blocks[j]);
    }

    if (exact.length) {
      exact.sort(function (a, b) { return b.y - a.y; });
      destroyBlock(exact[0]);
      return;
    }

    updateHighlights();
    renderHUD();
  }

  /* ---------------- 主循环 ---------------- */
  function loop(now) {
    if (!G.running) return;

    var dt = (now - G.last) / 1000;
    if (!isFinite(dt) || dt < 0) dt = 0;
    // 限制单帧步长，避免切屏回来时方块瞬移
    dt = Math.min(dt, 0.05);
    G.last = now;

    if (!G.paused && !G.transitioning) {
      G.elapsedMs += dt * 1000;

      // 限时：时间到即本局失败
      G.levelTime -= dt;
      if (G.levelTime <= 0) {
        G.levelTime = 0;
        renderHUD();
        G.failReason = 'time';
        endGame();
        return;
      }

      G.spawnAcc += dt * 1000;
      var gap = DIFFS[G.diffKey].spawnInterval;
      if (G.spawnAcc >= gap) {
        G.spawnAcc -= gap;
        spawnBlock();
      }

      // AI 对手按难度速率抢分，带 ±20% 随机抖动
      if (G.mode === 'versus') {
        G.aiScore += G.aiRate * dt * (0.8 + Math.random() * 0.4);
      }

      moveBlocks(dt);
      renderHUD();
    }

    G.raf = global.requestAnimationFrame(loop);
  }

  /* ---------------- 流程控制 ---------------- */
  function start(setKey, diffKey, startLevel, reviewWords, mode) {
    if (!WORD_SETS[setKey]) setKey = 'cet4';
    if (!DIFFS[diffKey]) diffKey = 'normal';
    if (mode !== 'sprint' && mode !== 'versus') mode = 'solo';

    // 先彻底清理上一局残留
    stopLoop();
    cleanupBlocks();

    G.setKey = setKey;
    G.diffKey = diffKey;
    G.mode = mode;
    G.aiScore = 0;
    G.aiRate = DIFFS[diffKey].aiRate;
    G.score = 0;
    G.lives = LIVES_MAX;
    G.combo = 0;
    G.maxCombo = 0;
    G.correctChars = 0;
    G.errorCount = 0;
    G.elapsedMs = 0;
    G.input = '';
    G.spawnAcc = 0;
    G.wrongWords = [];
    G.reviewPool = Array.isArray(reviewWords) ? reviewWords.slice() : [];
    G.composing = false;
    G.paused = false;
    G.transitioning = false;
    G.failReason = '';
    G.cleared = 0;

    var startIdx;
    if (mode === 'solo') {
      G.levels = buildLevels(setKey, diffKey);
      startIdx = Math.max(0, Math.min(G.levels.length - 1, (parseInt(startLevel, 10) || 1) - 1));
    } else {
      // 冲刺 / AI 对战：整库词池单局 60 秒，不设关卡目标
      G.levels = [{
        index: 1,
        pool: WORD_SETS[setKey].words.slice(),
        wordsNeeded: 0,
        target: Infinity,
        timeLimit: MODE_TIME
      }];
      startIdx = 0;
    }
    G.levelIndex = startIdx;
    G.startLevel = startIdx + 1;
    G.state = 'PLAYING';
    G.running = true;
    G.last = global.performance.now();

    global.UI.showScreen('PLAYING');
    global.UI.setPauseMask(false);
    beginLevel(startIdx);

    getCtx(); // 借用户点击手势解锁音频上下文
    G.raf = global.requestAnimationFrame(loop);
  }

  function stopLoop() {
    G.running = false;
    if (G.raf) {
      global.cancelAnimationFrame(G.raf);
      G.raf = 0;
    }
  }

  // 离开对局（回首页 / 换词库）
  function stop() {
    stopLoop();
    cleanupBlocks();
    G.paused = false;
    G.state = 'HOME';
    G.input = '';
    global.UI.setPauseMask(false);
  }

  function pause() {
    // 过关切换的 1.2 秒内不暂停，避免切关计时器被打断
    if (G.state !== 'PLAYING' || G.paused || G.transitioning) return;
    G.paused = true;
    document.body.dataset.state = 'PAUSED';
    global.UI.setPauseMask(true);
  }

  function resume() {
    if (G.state !== 'PLAYING' || !G.paused) return;
    G.paused = false;
    document.body.dataset.state = 'PLAYING';
    global.UI.setPauseMask(false);
    // 恢复时重置时间基准，避免暂停期间累计出巨大 dt
    G.last = global.performance.now();
  }

  // 失焦 / 页面隐藏时自动暂停
  function autoPause() {
    if (G.state === 'PLAYING' && !G.paused) pause();
  }

  function endGame() {
    if (G.state !== 'PLAYING') return;

    G.state = 'RESULT';
    stopLoop();
    G.paused = false;
    global.UI.setPauseMask(false);

    var stats = {
      score: G.score,
      accuracy: calcAccuracy(),
      wpm: calcWpm(),
      maxCombo: G.maxCombo,
      wrongWords: G.wrongWords.slice(),
      setKey: G.setKey,
      diffKey: G.diffKey,
      mode: G.mode,
      aiScore: Math.round(G.aiScore),
      elapsedMs: G.elapsedMs,
      levelIndex: G.levelIndex + 1,
      levelTotal: G.levels.length,
      startLevel: G.startLevel,
      cleared: G.cleared,
      win: G.failReason === 'win',
      failReason: G.failReason
    };

    cleanupBlocks();
    G.input = '';
    renderHUD();

    // 结算提示音：短促的三音下行
    beep(523, 0.1, 'triangle', 0.05);
    setTimeout(function () { beep(392, 0.12, 'triangle', 0.05); }, 110);
    setTimeout(function () { beep(294, 0.18, 'triangle', 0.05); }, 230);

    if (typeof Game.onEnd === 'function') {
      Game.onEnd(stats);
    }
  }

  /* ---------------- 对外接口 ---------------- */
  var Game = {
    DIFFICULTIES: DIFFS,
    LIVES_MAX: LIVES_MAX,
    LEVEL_TIME: LEVEL_TIME,
    onEnd: null,
    onLevelClear: null,
    onWrongWord: null,

    // 供选择页展示：关卡数随词库词量自动变化
    getLevelCount: function (setKey) {
      var set = WORD_SETS[setKey];
      return set ? calcLevelCount(set.words.length) : MIN_LEVELS;
    },

    init: function () {
      areaEl = document.getElementById('gameArea');

      document.addEventListener('keydown', handleKeydown);

      // 中文输入法：上屏期间不判定，并给出提示
      document.addEventListener('compositionstart', function () {
        G.composing = true;
        if (G.state === 'PLAYING' && !G.paused) {
          global.UI.toast('请切换到英文输入法');
        }
      });
      document.addEventListener('compositionend', function () {
        G.composing = false;
      });

      // 切窗自动暂停
      global.addEventListener('blur', autoPause);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) autoPause();
      });
    },

    start: start,
    stop: stop,
    pause: pause,
    resume: resume,
    autoPause: autoPause,

    setSound: function (on) { soundOn = !!on; },
    isSoundOn: function () { return soundOn; },

    getConfig: function () {
      return { setKey: G.setKey, diffKey: G.diffKey };
    }
  };

  global.Game = Game;
})(window);

/* ============================================================
   字块冲刺 · 游戏核心
   状态：PLAYING / PAUSED（页面路由由 main.js 控制）
   负责：方块生成与下落、输入判定、生命、计分、暂停、结算
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------------- 难度参数（严格按需求） ----------------
     AI 参数：aiSpawnInterval 出块间隔、aiCps 每秒敲字符数、
     aiReact 读词反应区间（秒）、aiError 每词失误概率、aiSkip 每词走神概率。
     这些值让 AI 像普通玩家一样有反应、有失误，而不是匀速刷分。
     aiSkip 让 AI 偶尔整词漏看，方块正常下落并触底扣心，
     这样“AI 爱心碎完”这条终点才真正可达。
     ------------------------------------------------ */
  var DIFFS = {
    easy:   { name: '简单', spawnInterval: 2200, fallSpeed: 30, maxLen: 5,  coef: 0.8,
              aiSpawnInterval: 5200, aiCps: 2.3, aiReact: [1.2, 1.7], aiError: 0.18,
              aiSkip: 0.16, desc: '2200ms / 30px·s⁻¹ · 单词≤5' },
    normal: { name: '普通', spawnInterval: 1600, fallSpeed: 45, maxLen: 8,  coef: 1.0,
              aiSpawnInterval: 3800, aiCps: 3.4, aiReact: [0.7, 1.1], aiError: 0.12,
              aiSkip: 0.08, desc: '1600ms / 45px·s⁻¹ · 单词≤8' },
    hard:   { name: '困难', spawnInterval: 1100, fallSpeed: 65, maxLen: 12, coef: 1.3,
              aiSpawnInterval: 3600, aiCps: 4.0, aiReact: [0.5, 0.9], aiError: 0.08,
              aiSkip: 0.05, desc: '1100ms / 65px·s⁻¹ · 单词≤12' }
  };

  // 双跑道每条只有半屏宽，限制最长词，避免长词挤出跑道
  var VERSE_MAX_WORD = 9;
  // 对战里玩家跑道出块放缓，避免被持续下落的方块压死而忽略比分对抗
  var VERSE_PLAYER_SPAWN_SCALE = 1.6;
  // AI 连击加成上限，避免机器一路滚雪球
  var AI_COMBO_CAP = 8;
  // 拔河条：70% 压制、保持 3 秒、15 秒后且总分 400 才启用
  var VERSE_KO_SHARE = 0.70;
  var VERSE_KO_RELEASE = 0.65;   // 回落到 65% 以下才解除压制读秒
  var VERSE_KO_HOLD = 3;
  var VERSE_ACTIVE_TIME = 15;
  var VERSE_ACTIVE_SCORE = 400;

  /* ---------------- 生命与数值 ----------------
     3 颗爱心：方块触底碎 1 颗，碎完本局结束；打错字母只清空连击，不扣爱心。
     ------------------------------------------------ */
  var LIVES_MAX = 3;

  /* ---------------- 关卡参数 ----------------
     关卡数由词库词数自动计算（6 ~ 50 关）；每关限时冲击目标分，过关后爱心重置。
     ------------------------------------------------ */
  var WORDS_PER_LEVEL = 8;
  var MIN_LEVELS = 6;
  var MAX_LEVELS = 50;
  var LEVEL_TIME = 50;   // 每关秒数
  var MODE_TIME = 60;    // 限时冲刺 / AI 对战单局秒数

  // 每关需打掉的词数随关卡递增；按实测校准：四级普通第 1 关约 6 词（目标约 490 分），最后一关约 11 词
  var WORD_GOALS = {
    easy:   { from: 5,  to: 9 },
    normal: { from: 6,  to: 11 },
    hard:   { from: 7,  to: 13 }
  };

  var areaEl = null;
  var lanePlayerEl = null;
  var laneAiEl = null;

  var G = {
    state: 'HOME',
    running: false,
    paused: false,
    setKey: 'cet4',
    diffKey: 'normal',
    mode: 'solo',
    aiScore: 0,
    ai: null,
    versusShare: 0.5,
    versusSide: '',
    versusHold: 0,
    versusWinner: null,
    score: 0,
    lives: LIVES_MAX,
    combo: 0,
    maxCombo: 0,
    wordsCleared: 0,
    correctChars: 0,
    errorCount: 0,
    elapsedMs: 0,
    input: '',
    spawnAcc: 0,
    blocks: [],
    bag: [],
    bagPool: null,
    bagMaxLen: 0,
    bagLastWord: '',
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
    lvCorrectChars: 0,
    lvErrorCount: 0,
    lvMaxCombo: 0,
    lvWords: 0,
    startLevel: 1,
    cleared: 0,
    transitioning: false,
    failReason: '',
    // 从通关弹窗点「退出」：本关已经通过，结算时不能按「中途退出」扣分
    quitCleared: false
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
      aiScore: Math.round(G.aiScore),
      aiLives: G.ai ? G.ai.lives : LIVES_MAX,
      aiState: G.ai ? G.ai.state : '等待',
      versusShare: G.versusShare,
      versusSide: G.versusSide,
      versusHold: G.versusHold
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

  // 双跑道时按归属取容器；单机 / 冲刺仍用整个游戏区
  function laneElFor(owner) {
    if (G.mode !== 'versus') return areaEl;
    return owner === 'ai' ? laneAiEl : lanePlayerEl;
  }

  // 错词复习：错词越少出块越慢。只有 1~3 个错词时按正常频率出块会瞬间铺满同几个词，
  // 既重复又压迫，故按错词数量放大出块间隔，6 个及以上恢复正常。
  function reviewSpawnScale() {
    var n = G.reviewPool.length;
    if (!n && G.levels[0]) n = G.levels[0].pool.length;
    if (!n || n >= 6) return 1;
    return Math.min(3, 6 / n);
  }

  /* ---------------- 洗牌袋 ----------------
     出块不再整池随机：词池按难度长度过滤后打乱，按顺序逐个取出，一轮抽完再洗牌，
     因此抽完一整轮前不会重复遇到同一个词，顺序仍是随机的。
     玩家与 AI 共用同一个袋子，两条跑道也不会刷出同一个词。
     ------------------------------------------------ */
  function shuffleInPlace(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function refillBag(pool, maxLen) {
    var items = pool.filter(function (w) { return w.word.length <= maxLen; });
    if (!items.length) {
      // 关卡词池里没有符合长度上限的词时，退回本池最短的词，
      // 而不是把整池塞进来，避免简单难度刷出超长单词。
      var minLen = Infinity;
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].word.length < minLen) minLen = pool[i].word.length;
      }
      items = pool.filter(function (w) { return w.word.length === minLen; });
    }
    shuffleInPlace(items);
    // 新一轮的第一个词避开上一轮的最后一个词，避免「刚打完又冒出来」
    if (items.length > 1 && items[0].word === G.bagLastWord) {
      var k = 1 + Math.floor(Math.random() * (items.length - 1));
      var tmp = items[0]; items[0] = items[k]; items[k] = tmp;
    }
    G.bag = items;
  }

  function ensureBag(pool, maxLen) {
    if (G.bagPool !== pool || G.bagMaxLen !== maxLen) {
      G.bagPool = pool;
      G.bagMaxLen = maxLen;
      // 词池变了（例如进入下一关）：旧袋子里剩下的词作废，避免串关
      G.bag = [];
    }
    if (!G.bag.length) refillBag(pool, maxLen);
  }

  function takeFromBag(pool, maxLen, onScreen) {
    ensureBag(pool, maxLen);
    for (var round = 0; round < 3; round++) {
      for (var i = 0; i < G.bag.length; i++) {
        if (onScreen.indexOf(G.bag[i].word) === -1) {
          var item = G.bag.splice(i, 1)[0];
          G.bagLastWord = item.word;
          return item;
        }
      }
      refillBag(pool, maxLen);
    }
    return null;
  }

  function spawnBlock(owner) {
    owner = owner === 'ai' ? 'ai' : 'player';

    var lv = G.levels[G.levelIndex];
    var pool = lv ? lv.pool : WORD_SETS[G.setKey].words;
    var maxLen = DIFFS[G.diffKey].maxLen;
    if (G.mode === 'versus') maxLen = Math.min(maxLen, VERSE_MAX_WORD);

    // 按难度过滤单词长度；若过滤后为空则回退整库，保证不会没有方块
    var filtered = pool.filter(function (w) { return w.word.length <= maxLen; });
    if (!filtered.length) filtered = pool;

    // 尽量避免同屏重复单词（两条跑道一起算）
    var onScreen = G.blocks.map(function (b) { return b.word; });

    var avail = null;
    // 错词本只影响玩家跑道
    if (owner === 'player') {
      var review = G.reviewPool.filter(function (w) {
        return w && w.word && w.word.length <= maxLen && onScreen.indexOf(w.word) === -1;
      });
      if (review.length && Math.random() < 0.35) avail = review;
    }

    var item = null;
    if (avail) {
      item = avail[Math.floor(Math.random() * avail.length)];
    } else if (G.mode === 'review') {
      // 复习词池很小，保留随机取词与同屏去重；词全在屏上时本轮不出块
      var left = filtered.filter(function (w) { return onScreen.indexOf(w.word) === -1; });
      if (!left.length) return;
      item = left[Math.floor(Math.random() * left.length)];
    } else {
      item = takeFromBag(pool, maxLen, onScreen);
      if (!item) return;
    }

    var host = laneElFor(owner);

    var el = createBlockEl(item.word, item.meaning);
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.visibility = 'hidden';
    host.appendChild(el);

    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var areaW = host.clientWidth;
    var maxX = Math.max(0, areaW - w - 12);
    var x = 6 + Math.random() * maxX;

    el.style.left = Math.floor(x) + 'px';
    el.style.visibility = '';

    var block = {
      id: ++G.seq,
      owner: owner,
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

    // 倒序遍历，便于安全删除
    for (var i = G.blocks.length - 1; i >= 0; i--) {
      // 触底扣完最后一颗心会结束本局并清空方块，需立即停止遍历
      if (G.state !== 'PLAYING') return;

      var b = G.blocks[i];
      if (!b || b.dead) continue;

      var host = laneElFor(b.owner);
      var areaH = host ? host.clientHeight : areaEl.clientHeight;

      b.y += speed * dt;
      b.el.style.top = b.y + 'px';

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
      if (b.owner === 'ai') continue;
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
      if (G.blocks[i].owner === 'ai') continue;
      if (G.input && G.blocks[i].word.indexOf(G.input) === 0) {
        candidates.push(G.blocks[i]);
      }
    }
    if (!candidates.length) {
      for (i = 0; i < G.blocks.length; i++) {
        if (G.blocks[i].owner !== 'ai') candidates.push(G.blocks[i]);
      }
    }
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.y - a.y; });
    return candidates[0];
  }

  function registerError() {
    var blame = pickBlameWord();

    G.errorCount++;
    G.lvErrorCount++;
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

  // 消除飘字：在方块位置向上飘出本次得分，连击 ≥2 时附带连击数
  function spawnScorePop(b, gain, combo) {
    var host = laneElFor(b.owner);
    if (!host) return;

    var pop = document.createElement('div');
    pop.className = 'score-pop' + (b.owner === 'ai' ? ' is-ai' : '');
    pop.textContent = '+' + gain;

    if (combo >= 2) {
      var tag = document.createElement('span');
      tag.className = 'pop-combo';
      tag.textContent = '×' + combo;
      pop.appendChild(tag);
    }

    pop.style.left = (b.x + b.w / 2) + 'px';
    pop.style.top = Math.max(0, b.y + 4) + 'px';
    host.appendChild(pop);
    setTimeout(function () { removeBlockEl(pop); }, 900);
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
    if (G.combo > G.lvMaxCombo) G.lvMaxCombo = G.combo;

    var coef = DIFFS[G.diffKey].coef;
    var gain = Math.floor(b.word.length * 10 * coef * (1 + G.combo * 0.1));
    G.score += gain;
    G.levelScore += gain;
    G.wordsCleared++;
    G.lvWords++;

    G.input = '';

    spawnScorePop(b, gain, G.combo);
    beep(620 + Math.min(G.combo, 10) * 45, 0.07, 'triangle', 0.045);

    // 只有单机闯关才有关卡目标；冲刺与 AI 对战不自动过关
    if (G.mode === 'solo' && G.levelScore >= G.levelTarget) {
      levelClear();
      return;
    }

    updateHighlights();
    renderHUD();
  }

  function playLevelClearSound() {
    beep(160, 0.12, 'square', 0.07);
    setTimeout(function () { beep(110, 0.16, 'sine', 0.08); }, 40);
    setTimeout(function () { beep(523, 0.1, 'triangle', 0.05); }, 130);
    setTimeout(function () { beep(659, 0.1, 'triangle', 0.05); }, 220);
    setTimeout(function () { beep(784, 0.1, 'triangle', 0.05); }, 310);
    setTimeout(function () { beep(1047, 0.22, 'triangle', 0.05); }, 400);
  }

  // 序号转中文：1 → 一，23 → 二十三（与结算页「第一关」的写法保持一致）
  function numToCn(n) {
    var cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    var v = Math.max(0, parseInt(n, 10) || 0);
    if (v < 10) return cn[v];
    if (v < 20) return '十' + (v % 10 ? cn[v % 10] : '');
    if (v < 100) return cn[Math.floor(v / 10)] + '十' + (v % 10 ? cn[v % 10] : '');
    return String(v);
  }

  // 通关弹窗：格式与结算页一致（序号 / 逐字掉落的大字 / 数据卡片），可进入下一关或退出
  function showClearDialog(isFinal) {
    var ui = global.UI;
    var level = G.levelIndex + 1;
    var lv = G.levels[G.levelIndex];
    // 本关四项数据与结算页同一套：得分 / 准确率 / 打字速度 / 最高连击，统计范围统一为本关
    var usedMs = lv ? Math.max(0, (lv.timeLimit - Math.max(0, G.levelTime)) * 1000) : 0;
    var lvTotalChars = G.lvCorrectChars + G.lvErrorCount;
    var lvAccuracy = lvTotalChars > 0 ? Math.round(G.lvCorrectChars / lvTotalChars * 100) : 100;
    var lvWpm = usedMs > 800 ? Math.round((G.lvCorrectChars / 5) / (usedMs / 60000)) : 0;

    var wrap = document.createElement('div');
    wrap.className = 'congrats';

    var status = document.createElement('div');
    status.className = 'congrats-status';
    status.textContent = '第' + numToCn(level) + '关';
    wrap.appendChild(status);

    // 大字结论：逐字从上方掉落，节奏与结算页一致，仅颜色换成本局的通关绿
    var title = document.createElement('div');
    title.className = 'congrats-verdict';
    var word = isFinal ? '全部通关' : '通关';
    for (var i = 0; i < word.length; i++) {
      var ch = document.createElement('span');
      ch.className = 'drop-char';
      ch.textContent = word.charAt(i);
      ch.style.setProperty('--i', i);
      title.appendChild(ch);
    }
    wrap.appendChild(title);

    var scores = document.createElement('div');
    scores.className = 'congrats-score';
    var statItems = [
      ['本关得分', G.levelScore],
      ['本关准确率', lvAccuracy + '%'],
      ['本关打字速度', lvWpm + ' 词/分'],
      ['本关最高连击', G.lvMaxCombo]
    ];
    statItems.forEach(function (item) {
      var box = document.createElement('div');
      var cap = document.createElement('span');
      cap.textContent = item[0];
      var val = document.createElement('b');
      val.textContent = item[1];
      box.appendChild(cap);
      box.appendChild(val);
      scores.appendChild(box);
    });
    wrap.appendChild(scores);

    // 本局打错的单词：与结算页同一套展示（去重后最多 10 个）
    var wrongBox = document.createElement('div');
    wrongBox.className = 'congrats-wrong';
    var wrongCap = document.createElement('span');
    wrongCap.className = 'congrats-wrong-cap';
    wrongCap.textContent = '本局打错的单词';
    wrongBox.appendChild(wrongCap);

    var wrongList = document.createElement('div');
    wrongList.className = 'congrats-wrong-list';
    var seen = {};
    var shown = 0;
    for (var j = 0; j < G.wrongWords.length && shown < 10; j++) {
      var w = G.wrongWords[j];
      if (seen[w]) continue;
      seen[w] = true;
      shown++;
      var chip = document.createElement('span');
      chip.className = 'wrong-chip';
      chip.textContent = w;
      wrongList.appendChild(chip);
    }
    if (!shown) {
      var none = document.createElement('span');
      none.className = 'wrong-none';
      none.textContent = '本局没有打错的单词，漂亮';
      wrongList.appendChild(none);
    }
    wrongBox.appendChild(wrongList);
    wrap.appendChild(wrongBox);

    // 本局加分进度条：与结算页同一套组件，数据与动画由入口层注入
    if (typeof Game.renderClearRank === 'function') {
      var rankBox = document.createElement('div');
      rankBox.className = 'congrats-rank';
      wrap.appendChild(rankBox);
      // 等大字逐字掉完再开始积分动画（与 CSS 的掉落节奏保持一致）
      var dropMs = 600 + Math.max(0, word.length - 1) * 160 + 720;
      Game.renderClearRank(rankBox, {
        cleared: G.cleared,
        startLevel: G.startLevel,
        isFinal: !!isFinal,
        delay: dropMs + 400
      });
    }

    var actions;
    if (isFinal) {
      actions = [{
        label: '查看结算',
        primary: true,
        onClick: function () {
          ui.closeModal();
          G.failReason = 'win';
          endGame();
        }
      }];
    } else {
      actions = [
        {
          label: '退出',
          onClick: function () {
            ui.closeModal();
            G.failReason = 'quit';
            G.quitCleared = true;
            endGame();
          }
        },
        {
          label: '进入下一关',
          primary: true,
          onClick: function () {
            ui.closeModal();
            beginLevel(G.levelIndex + 1);
          }
        }
      ];
    }

    ui.openModal({
      content: wrap,
      closeOnMask: false,
      centerActions: true,
      actions: actions
    });
  }

  function levelClear() {
    var isLast = G.levelIndex >= G.levels.length - 1;
    G.cleared = G.levelIndex + 1;

    // 通知入口层记录并解锁下一关
    if (typeof Game.onLevelClear === 'function') {
      Game.onLevelClear(G.cleared, G.setKey, G.diffKey);
    }

    playLevelClearSound();

    if (isLast) {
      G.transitioning = true;
      renderHUD();
      global.UI.celebrate();
      showClearDialog(true);
      return;
    }

    // 冻结方块与计时，等玩家选择进入下一关或退出
    G.transitioning = true;
    renderHUD();
    global.UI.celebrate();
    showClearDialog();
  }

  function beginLevel(i) {
    var lv = G.levels[i];
    if (!lv) return;

    G.levelIndex = i;
    G.levelScore = 0;
    G.levelTarget = lv.target;
    G.levelTime = lv.timeLimit;
    G.lvCorrectChars = 0;
    G.lvErrorCount = 0;
    G.lvMaxCombo = 0;
    G.lvWords = 0;
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

    // AI 跑道掉块：扣 AI 爱心并停顿，不再是无敌机器
    if (b.owner === 'ai') {
      aiGroundHit();
      return;
    }

    G.lives -= 1;
    G.combo = 0;

    global.UI.flash();
    beep(90, 0.2, 'sine', 0.06);

    renderHUD();
    if (G.lives <= 0) {
      G.lives = 0;
      if (G.mode === 'versus') G.versusWinner = 'ai';
      G.failReason = 'lives';
      endGame();
      return;
    }
    updateHighlights();
  }

  /* ---------------- AI 对手（拟人打字） ---------------- */
  function nowSec() {
    return G.elapsedMs / 1000;
  }

  function pickAiBlock() {
    var list = [];
    for (var i = 0; i < G.blocks.length; i++) {
      var b = G.blocks[i];
      // 已被 AI 走神漏掉的词不再重新拾取，让它自然落地扣心
      if (b.owner === 'ai' && !b.dead && !b.aiSkipped) list.push(b);
    }
    if (!list.length) return null;
    list.sort(function (a, b) { return b.y - a.y; });
    return list[0];
  }

  function aiGroundHit() {
    var ai = G.ai;
    if (!ai) return;

    ai.lives = Math.max(0, ai.lives - 1);
    ai.combo = 0;
    ai.target = null;
    ai.typed = '';
    ai.charAcc = 0;
    ai.stunUntil = nowSec() + 1.3;
    ai.stunReason = '掉块停顿';
    ai.reactUntil = 0;
    ai.state = '掉块停顿';

    beep(100, 0.18, 'sawtooth', 0.04);
    renderHUD();

    if (ai.lives <= 0) {
      G.versusWinner = 'player';
      G.failReason = 'aiLives';
      endGame();
    }
  }

  function aiCompleteBlock(b) {
    var idx = G.blocks.indexOf(b);
    if (idx === -1) return;
    G.blocks.splice(idx, 1);
    b.dead = true;

    b.el.classList.add('boom');
    setTimeout(function () { removeBlockEl(b.el); }, 320);

    var ai = G.ai;
    ai.combo = Math.min(ai.combo + 1, AI_COMBO_CAP);
    if (ai.combo > ai.maxCombo) ai.maxCombo = ai.combo;

    var coef = DIFFS[G.diffKey].coef;
    var gain = Math.floor(b.word.length * 10 * coef * (1 + ai.combo * 0.1));
    G.aiScore += gain;
    spawnScorePop(b, gain, ai.combo);

    ai.target = null;
    ai.typed = '';
    ai.charAcc = 0;
    ai.reactUntil = 0;

    beep(480 + Math.min(ai.combo, AI_COMBO_CAP) * 35, 0.05, 'sine', 0.03);
    renderHUD();
  }

  function updateAI(dt, now) {
    var ai = G.ai;
    if (!ai) return;
    if (ai.lives <= 0) {
      ai.state = '已崩溃';
      return;
    }

    // 掉块 / 走神后的停顿
    if (now < ai.stunUntil) {
      ai.state = ai.stunReason || '掉块停顿';
      return;
    }
    ai.stunReason = '';

    if (ai.target && (ai.target.dead || G.blocks.indexOf(ai.target) === -1)) {
      if (ai.target.el) ai.target.el.classList.remove('is-typo');
      ai.target = null;
      ai.typed = '';
      ai.charAcc = 0;
    }

    if (!ai.target) {
      var next = pickAiBlock();
      if (!next) {
        ai.state = '等待';
        return;
      }

      var cfg = DIFFS[G.diffKey];

      // 小概率“走神”：整词漏看，方块继续下落，落地会扣 AI 爱心。
      // 这让“AI 爱心碎完”不再是不可能事件。
      if (Math.random() < cfg.aiSkip) {
        next.aiSkipped = true;
        if (next.el) next.el.classList.add('is-missed');
        ai.target = null;
        ai.typed = '';
        ai.charAcc = 0;
        ai.reactUntil = 0;
        ai.stunUntil = now + 2.4 + Math.random() * 1.4;
        ai.stunReason = '走神';
        ai.state = '走神';
        ai.combo = 0;
        return;
      }

      ai.target = next;
      ai.typed = '';
      ai.charAcc = 0;
      ai.reactUntil = now + cfg.aiReact[0] +
        Math.random() * (cfg.aiReact[1] - cfg.aiReact[0]);

      // 每个词有一定概率“打错”：方块变红并停顿，清空连击后再重打
      if (Math.random() < cfg.aiError) {
        ai.reactUntil += 0.5 + Math.random() * 0.6;
        ai.mistakeUntil = ai.reactUntil;
        ai.combo = 0;
        if (next.el) next.el.classList.add('is-typo');
      } else {
        ai.mistakeUntil = 0;
        if (next.el) next.el.classList.remove('is-typo');
      }
      ai.state = '读词中';
      return;
    }

    if (now < ai.reactUntil) {
      ai.state = now < ai.mistakeUntil ? '打错了' : '读词中';
      return;
    }

    if (ai.target.el) ai.target.el.classList.remove('is-typo');

    var target = ai.target;
    ai.charAcc += dt * DIFFS[G.diffKey].aiCps;
    while (ai.charAcc >= 1 && ai.typed.length < target.word.length) {
      ai.charAcc -= 1;
      ai.typed += target.word.charAt(ai.typed.length);
    }

    for (var i = 0; i < target.spans.length; i++) {
      target.spans[i].classList.toggle('on', i < ai.typed.length);
    }

    ai.state = '输入中';
    if (ai.typed === target.word) aiCompleteBlock(target);
  }

  // 拔河条：按分数占比推进，70% 且保持 3 秒直接压制获胜
  function updateVersusBar(dt) {
    var total = G.score + G.aiScore;
    var target = total > 0 ? G.score / total : 0.5;
    G.versusShare += (target - G.versusShare) * Math.min(1, dt * 6);

    var active = G.elapsedMs >= VERSE_ACTIVE_TIME * 1000 && total >= VERSE_ACTIVE_SCORE;
    var side = '';
    var keepPlayer = G.versusSide === 'player' && G.versusShare >= VERSE_KO_RELEASE;
    var keepAi = G.versusSide === 'ai' && G.versusShare <= 1 - VERSE_KO_RELEASE;
    if (active && (keepPlayer || G.versusShare >= VERSE_KO_SHARE)) side = 'player';
    else if (active && (keepAi || G.versusShare <= 1 - VERSE_KO_SHARE)) side = 'ai';

    if (side && side === G.versusSide) {
      G.versusHold += dt;
    } else {
      G.versusSide = side;
      G.versusHold = side ? dt : 0;
    }

    if (G.versusHold >= VERSE_KO_HOLD) {
      G.versusWinner = side;
      G.failReason = 'ko';
      endGame();
    }
  }

  function decideVersusByScore() {
    if (G.mode !== 'versus' || G.versusWinner) return;
    var aiScore = Math.round(G.aiScore);
    if (G.score > aiScore) G.versusWinner = 'player';
    else if (G.score < aiScore) G.versusWinner = 'ai';
    else G.versusWinner = 'draw';
  }

  function handleKeydown(e) {
    if (G.state !== 'PLAYING') return;

    // 暂停确认、设置等弹窗打开时，不让对局快捷键（含 Esc 继续）穿透
    var ui = global.UI;
    if (ui && ui.els && ui.els.modalRoot && ui.els.modalRoot.children.length) return;

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

    // 只要有一个玩家方块以 next 为前缀，就接受这次输入
    var hasPrefix = false;
    var hasPlayerBlock = false;
    for (var i = 0; i < G.blocks.length; i++) {
      if (G.blocks[i].owner === 'ai') continue;
      hasPlayerBlock = true;
      if (G.blocks[i].word.indexOf(next) === 0) { hasPrefix = true; break; }
    }

    if (!hasPrefix) {
      // 屏幕上还没有任何玩家方块时（开局空档、刚清空），不把这次按键算作错误
      if (!hasPlayerBlock) return;
      registerError();
      return;
    }

    G.input = next;
    G.correctChars++;
    G.lvCorrectChars++;

    // 完整命中：优先消除最靠下（y 最大）的那个
    var exact = [];
    for (var j = 0; j < G.blocks.length; j++) {
      if (G.blocks[j].owner === 'ai') continue;
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

      G.levelTime -= dt;
      if (G.levelTime <= 0) {
        G.levelTime = 0;
        renderHUD();
        G.failReason = 'time';
        decideVersusByScore();
        endGame();
        return;
      }

      G.spawnAcc += dt * 1000;
      var gap = DIFFS[G.diffKey].spawnInterval;
      if (G.mode === 'versus') gap *= VERSE_PLAYER_SPAWN_SCALE;
      if (G.mode === 'review') gap *= reviewSpawnScale();
      if (G.spawnAcc >= gap) {
        G.spawnAcc -= gap;
        spawnBlock('player');
      }

      if (G.mode === 'versus') {
        G.ai.spawnAcc += dt * 1000;
        var aiGap = DIFFS[G.diffKey].aiSpawnInterval;
        if (G.ai.spawnAcc >= aiGap) {
          G.ai.spawnAcc -= aiGap;
          spawnBlock('ai');
        }
      }

      moveBlocks(dt);
      if (G.state !== 'PLAYING') return;

      if (G.mode === 'versus') {
        updateAI(dt, G.elapsedMs / 1000);
        if (G.state !== 'PLAYING') return;
        updateVersusBar(dt);
        if (G.state !== 'PLAYING') return;
      }

      renderHUD();
    }

    G.raf = global.requestAnimationFrame(loop);
  }

  /* ---------------- 流程控制 ---------------- */
  function start(setKey, diffKey, startLevel, reviewWords, mode) {
    if (!WORD_SETS[setKey]) setKey = 'cet4';
    if (!DIFFS[diffKey]) diffKey = 'normal';
    if (mode !== 'sprint' && mode !== 'versus' && mode !== 'review') mode = 'solo';

    stopLoop();
    cleanupBlocks();

    G.setKey = setKey;
    G.diffKey = diffKey;
    G.mode = mode;
    G.aiScore = 0;
    G.ai = {
      lives: LIVES_MAX,
      combo: 0,
      maxCombo: 0,
      spawnAcc: 0,
      target: null,
      typed: '',
      charAcc: 0,
      reactUntil: 0,
      stunUntil: 0,
      stunReason: '',
      mistakeUntil: 0,
      state: '等待'
    };
    G.versusShare = 0.5;
    G.versusSide = '';
    G.versusHold = 0;
    G.versusWinner = null;
    G.score = 0;
    G.lives = LIVES_MAX;
    G.combo = 0;
    G.maxCombo = 0;
    G.wordsCleared = 0;
    G.correctChars = 0;
    G.errorCount = 0;
    G.elapsedMs = 0;
    G.input = '';
    G.spawnAcc = 0;
    G.bag = [];
    G.bagPool = null;
    G.bagMaxLen = 0;
    G.bagLastWord = '';
    G.wrongWords = [];
    G.reviewPool = Array.isArray(reviewWords) ? reviewWords.slice() : [];
    G.composing = false;
    G.paused = false;
    G.transitioning = false;
    G.failReason = '';
    G.quitCleared = false;
    G.cleared = 0;

    var startIdx;
    if (mode === 'solo') {
      G.levels = buildLevels(setKey, diffKey);
      startIdx = Math.max(0, Math.min(G.levels.length - 1, (parseInt(startLevel, 10) || 1) - 1));
    } else if (mode === 'review') {
      // 错词复习：词池换成错词本，60 秒单局，不设关卡目标
      var reviewPool = G.reviewPool.length
        ? G.reviewPool.slice()
        : WORD_SETS[setKey].words.slice();
      G.levels = [{
        index: 1,
        pool: reviewPool,
        wordsNeeded: 0,
        target: Infinity,
        timeLimit: MODE_TIME
      }];
      startIdx = 0;
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

    // 对战开局先给 AI 一块，避免右侧空等几秒
    if (mode === 'versus') {
      spawnBlock('ai');
      renderHUD();
    }

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
    // 过关切换期间不暂停，避免打断切关流程
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

  function autoPause() {
    if (G.state === 'PLAYING' && !G.paused) pause();
  }

  // 退出确认弹窗要用的当前进度快照
  function getQuitInfo() {
    // 平均每词得分要按「本关」计算：跨关后 levelScore 从 0 开始，
    // 若混用全局 wordsCleared 会算出 0，导致「还差几百个词」的离谱提示。
    var avg = G.lvWords > 0 ? G.levelScore / G.lvWords : 0;
    if (!(avg > 0)) {
      // 本关还没消除单词：用当前关词池的平均词长估一个基础分
      var lv = G.levels[G.levelIndex];
      avg = 10 * DIFFS[G.diffKey].coef * avgWordLength(lv ? lv.pool : []);
    }
    var need = (G.mode === 'solo' && isFinite(G.levelTarget))
      ? Math.max(0, G.levelTarget - G.levelScore) : 0;
    return {
      mode: G.mode,
      score: G.score,
      levelScore: G.levelScore,
      levelWords: G.lvWords,
      wordsCleared: G.wordsCleared,
      cleared: G.cleared,
      startLevel: G.startLevel,
      aiScore: Math.round(G.aiScore),
      versusWinner: G.versusWinner,
      // 按当前平均每词得分估算还差多少词达成关卡目标
      remainingWords: need <= 0 ? 0 : Math.max(1, Math.ceil(need / Math.max(1, avg)))
    };
  }

  // 主动结束本局（暂停弹层「退出本局」）：单机按当前进度结算，AI 对战退出视为认输。
  function quit() {
    if (G.state !== 'PLAYING') return;
    G.failReason = 'quit';
    if (G.mode === 'versus') G.versusWinner = 'ai';
    endGame();
  }

  function endGame() {
    if (G.state !== 'PLAYING') return;

    G.state = 'RESULT';
    stopLoop();
    G.paused = false;
    global.UI.setPauseMask(false);

    // 对战兜底：没有显式胜者时按比分判定
    decideVersusByScore();

    var stats = {
      score: G.score,
      accuracy: calcAccuracy(),
      wpm: calcWpm(),
      maxCombo: G.maxCombo,
      wordsCleared: G.wordsCleared,
      levelWords: G.lvWords,
      wrongWords: G.wrongWords.slice(),
      setKey: G.setKey,
      diffKey: G.diffKey,
      mode: G.mode,
      aiScore: Math.round(G.aiScore),
      aiLives: G.ai ? G.ai.lives : 0,
      aiMaxCombo: G.ai ? G.ai.maxCombo : 0,
      livesLeft: G.lives,
      versusWinner: G.versusWinner,
      elapsedMs: G.elapsedMs,
      levelIndex: G.levelIndex + 1,
      levelTotal: G.levels.length,
      startLevel: G.startLevel,
      cleared: G.cleared,
      win: G.failReason === 'win',
      quitCleared: !!G.quitCleared,
      failReason: G.failReason
    };

    cleanupBlocks();
    G.input = '';
    renderHUD();

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
      lanePlayerEl = document.getElementById('lanePlayer');
      laneAiEl = document.getElementById('laneAi');

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
    quit: quit,
    getQuitInfo: getQuitInfo,

    setSound: function (on) { soundOn = !!on; },
    isSoundOn: function () { return soundOn; },

    getConfig: function () {
      return { setKey: G.setKey, diffKey: G.diffKey };
    }
  };

  global.Game = Game;
})(window);

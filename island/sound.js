// sound.js —— 程序化合成音频（不依赖任何外部音频文件，可离线运行）
// 音乐：缓慢的五声音阶长音垫 + 偶发轻铃，音量很低，作为背景氛围
// 音效：拾取四角星、小球滚动、落地接触

export const Sound = (() => {
  let ctx = null;
  let master, musicBus, sfxBus, reverb, revSend;
  let padVoices = [], padFilter;
  let rollSrc, rollBand, rollGain, rumbleOsc, rumbleGain;
  let chordStep = 0, chordTimer = null, bellTimer = null;
  let started = false, muted = false;
  let rollLevel = 0;                      // 平滑后的滚动强度

  // Am – F – C – G 的缓慢循环，全部取低音区，安静不抢戏
  const CHORDS = [
    [110.00, 164.81, 220.00, 261.63],
    [ 87.31, 130.81, 174.61, 220.00],
    [130.81, 196.00, 261.63, 329.63],
    [ 98.00, 146.83, 196.00, 246.94],
  ];
  const BELLS = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

  // 生成一段柔和的脉冲响应，给音乐和音效一点空间感
  function makeReverb() {
    const len = Math.floor(ctx.sampleRate * 1.8);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // 偏棕噪音：比白噪音厚、柔和，适合做滚动声底
  function makeNoise() {
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    return buf;
  }

  function buildPad(noiseBuf) {
    padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 620;
    padFilter.Q.value = 0.6;
    padFilter.connect(musicBus);

    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = CHORDS[0][i];
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 0.30 : 0.20;
      // 每个声部一个极慢的颤音，让音垫缓慢呼吸
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.035 + i * 0.017;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = g.gain.value * 0.4;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();
      osc.connect(g).connect(padFilter);
      osc.start();
      padVoices.push({ osc, gain: g, lfo });
    }
  }

  function buildRoll(noiseBuf) {
    // 滚动声底：带通噪音，中心频率随速度上移
    rollSrc = ctx.createBufferSource();
    rollSrc.buffer = noiseBuf;
    rollSrc.loop = true;
    rollBand = ctx.createBiquadFilter();
    rollBand.type = 'bandpass';
    rollBand.frequency.value = 160;
    rollBand.Q.value = 1.0;
    rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollSrc.connect(rollBand).connect(rollGain).connect(sfxBus);
    rollSrc.start();

    // 低频滚动的"隆隆"感，速度越快音越高
    rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sine';
    rumbleOsc.frequency.value = 40;
    rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumbleOsc.connect(rumbleGain).connect(sfxBus);
    rumbleOsc.start();
  }

  function nextChord() {
    if (!started) return;
    chordStep = (chordStep + 1) % CHORDS.length;
    const t = ctx.currentTime;
    CHORDS[chordStep].forEach((f, i) => {
      padVoices[i].osc.frequency.setTargetAtTime(f, t, 3.2);   // 慢速滑音换和弦
    });
    chordTimer = setTimeout(nextChord, 17000 + Math.random() * 6000);
  }

  function nextBell() {
    if (!started) return;
    if (!muted) {
      const f = BELLS[Math.floor(Math.random() * BELLS.length)];
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.8);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
      osc.connect(g);
      g.connect(musicBus);
      g.connect(revSend);
      osc.start(t);
      osc.stop(t + 6);
    }
    bellTimer = setTimeout(nextBell, 7000 + Math.random() * 9000);
  }

  function start() {
    if (started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    started = true;

    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    reverb = makeReverb();
    reverb.connect(master);
    revSend = ctx.createGain();
    revSend.gain.value = 0.22;
    revSend.connect(reverb);

    musicBus = ctx.createGain();
    musicBus.gain.value = 0.085;          // 背景音乐压得很低
    musicBus.connect(master);
    musicBus.connect(revSend);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    sfxBus.connect(revSend);

    const noiseBuf = makeNoise();
    buildPad(noiseBuf);
    buildRoll(noiseBuf);

    if (ctx.state === 'suspended') ctx.resume();
    // 一开始用长渐入，避免突兀
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 3.5);

    chordTimer = setTimeout(nextChord, 17000);
    bellTimer = setTimeout(nextBell, 5000);
  }

  // 每帧调用：把小球速度映射成滚动声
  function setRoll(speed, onGround) {
    if (!started || muted) return;
    const target = onGround ? Math.min(1, speed / 11) : 0;
    rollLevel += (target - rollLevel) * 0.12;
    const t = ctx.currentTime;
    rollBand.frequency.setTargetAtTime(140 + rollLevel * 340, t, 0.14);
    rollGain.gain.setTargetAtTime(rollLevel * 0.075, t, 0.14);
    rumbleOsc.frequency.setTargetAtTime(38 + rollLevel * 26, t, 0.14);
    rumbleGain.gain.setTargetAtTime(rollLevel * 0.05, t, 0.14);
  }

  // 拾取四角星：明亮的三音铃，带一点上扬
  function pickup() {
    if (!started || muted) return;
    const t0 = ctx.currentTime;
    const base = 880;
    [[1, 0.13, 0.9], [1.5, 0.09, 0.7], [2, 0.06, 0.5]].forEach(([mul, vol, dur], i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      const t = t0 + i * 0.045;
      osc.frequency.setValueAtTime(base * mul * 0.94, t);
      osc.frequency.exponentialRampToValueAtTime(base * mul, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(sfxBus);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  // 接触地面：柔和的一记闷响，强度随下落速度
  function thud(strength = 1) {
    if (!started || muted) return;
    const v = Math.max(0.12, Math.min(1, strength));
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(104, t);
    osc.frequency.exponentialRampToValueAtTime(52, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(sfxBus);
    osc.start(t);
    osc.stop(t + 0.35);

    // 一点噪音，模拟触地的那下摩擦
    const src = ctx.createBufferSource();
    src.buffer = rollSrc.buffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.12 * v, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    src.connect(lp).connect(ng).connect(sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.18);
  }

  function toggleMute() {
    muted = !muted;
    if (!started) return muted;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, t, 0.25);
    if (muted) {
      rollGain.gain.setTargetAtTime(0, t, 0.1);
      rumbleGain.gain.setTargetAtTime(0, t, 0.1);
    }
    return muted;
  }

  return {
    start, setRoll, pickup, thud, toggleMute,
    get muted() { return muted; },
    get ready() { return started; },
    // 自检用：报告音频上下文状态与各总线音量
    get state() {
      if (!started) return { started: false };
      return { started: true, ctx: ctx.state, music: +musicBus.gain.value.toFixed(3),
        sfx: +sfxBus.gain.value.toFixed(3), master: +master.gain.value.toFixed(3),
        padVoices: padVoices.length, rollGain: +rollGain.gain.value.toFixed(4), rollLevel: +rollLevel.toFixed(3) };
    },
  };
})();

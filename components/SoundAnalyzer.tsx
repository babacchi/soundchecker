"use client";

import React, { useRef, useState, useCallback, useEffect } from 'react';

// A-weighting coefficients for frequencies
const getAWeighting = (freq: number): number => {
  if (freq <= 0) return -100;
  const f2 = freq * freq;
  const f4 = f2 * f2;
  const r1 = 12194 * 12194;
  const r2 = 20.6 * 20.6;
  const r3 = 107.7 * 107.7;
  const r4 = 737.9 * 737.9;
  
  const ra = (r1 * f4) / ((f2 + r2) * Math.sqrt((f2 + r3) * (f2 + r4)) * (f2 + r1));
  return 20 * Math.log10(ra) + 2.00;
};

// Utility to convert frequency to musical note
const getNoteFromFreq = (freq: number): string => {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const halfStepsFromA4 = 12 * Math.log2(freq / 440);
  const noteIndex = Math.round(halfStepsFromA4) + 69; // 69 is MIDI for A4
  const octave = Math.floor(noteIndex / 12) - 1;
  const noteName = notes[noteIndex % 12];
  return `${noteName}${octave}`;
};

const SoundAnalyzer: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [currentDb, setCurrentDb] = useState<number>(-Infinity);
  const [maxDb, setMaxDb] = useState<number>(-Infinity);
  const [peakFreq, setPeakFreq] = useState<number>(0);
  const [useAWeighting, setUseAWeighting] = useState(true);
  const [responseTime, setResponseTime] = useState<'fast' | 'slow'>('fast');
  const [calibrationOffset, setCalibrationOffset] = useState(100);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const freqDataRef = useRef<Float32Array | null>(null);
  const timeDataRef = useRef<Float32Array | null>(null);
  const weightingRef = useRef<Float32Array | null>(null);

  // Refs for state synchronization in the update loop
  const useAWeightingRef = useRef(useAWeighting);
  const responseTimeRef = useRef(responseTime);
  const calibrationOffsetRef = useRef(calibrationOffset);

  useEffect(() => {
    useAWeightingRef.current = useAWeighting;
  }, [useAWeighting]);

  useEffect(() => {
    responseTimeRef.current = responseTime;
  }, [responseTime]);

  useEffect(() => {
    calibrationOffsetRef.current = calibrationOffset;
  }, [calibrationOffset]);

  const drawCanvas = useCallback(() => {
    if (!canvasRef.current || !freqDataRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const paddingBottom = 28; // Increased space for larger labels
    const chartHeight = height - paddingBottom;
    const dataArray = freqDataRef.current;
    const bufferLength = dataArray.length;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);
    
    // Draw horizontal grid lines (dB)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    for(let i = 1; i < 4; i++) {
        const y = (chartHeight / 4) * i;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Draw vertical grid lines and labels (Frequency)
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const minFreq = 20;
    const maxFreq = 20000;
    const freqLabels = [100, 1000, 5000, 10000, 15000, 20000];
    
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const getX = (freq: number) => {
        return ((freq - minFreq) / (maxFreq - minFreq)) * width;
    };

    freqLabels.forEach(f => {
      const x = getX(f);
      if (x < 0 || x > width) return;

      // Vertical line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, chartHeight);
      ctx.stroke();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      const label = f >= 1000 ? `${f/1000}k` : `${f}`;
      ctx.fillText(label, x, chartHeight + 6);
    });

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();

    const freqStep = (sampleRate / 2) / bufferLength;

    for (let i = 0; i < bufferLength; i++) {
      const f = i * freqStep;
      if (f < minFreq) continue;
      if (f > maxFreq) break;

      const x = getX(f);
      const v = (dataArray[i] + 120) / 120;
      const y = chartHeight - (v * chartHeight);

      if (i === 0 || f >= minFreq && i > 0 && (i-1)*freqStep < minFreq) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.lineTo(width, chartHeight);
    ctx.lineTo(0, chartHeight);
    const gradient = ctx.createLinearGradient(0, 0, 0, chartHeight);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();
  }, []);

  // Use a named function for the update loop to avoid hoisting/initialization issues
  const update = useCallback(function updateLoop() {
    if (!analyserRef.current || !freqDataRef.current || !timeDataRef.current || !weightingRef.current) return;

    const analyser = analyserRef.current;
    if (analyser && freqDataRef.current && timeDataRef.current) {
      // as any を使って型チェックをスキップ
      analyser.getFloatFrequencyData(freqDataRef.current as any);
      analyser.getFloatTimeDomainData(timeDataRef.current as any);
    }

    let db = -Infinity;

    if (useAWeightingRef.current) {
      let sumPower = 0;
      for (let i = 0; i < freqDataRef.current.length; i++) {
        const weightedDb = freqDataRef.current[i] + weightingRef.current[i];
        const power = Math.pow(10, weightedDb / 10);
        sumPower += power;
      }
      db = 10 * Math.log10(sumPower + 1e-12);
    } else {
      let sumSquares = 0;
      for (let i = 0; i < timeDataRef.current.length; i++) {
        sumSquares += timeDataRef.current[i] * timeDataRef.current[i];
      }
      const rms = Math.sqrt(sumSquares / timeDataRef.current.length);
      db = 20 * Math.log10(rms + 1e-9);
    }
    
    const alpha = responseTimeRef.current === 'fast' ? 0.2 : 0.05;

    setCurrentDb(prev => {
        if (prev === -Infinity) return db;
        return prev * (1 - alpha) + db * alpha;
    });
    
    setMaxDb(prev => Math.max(prev, db));

    // Detect peak frequency
    let maxMag = -Infinity;
    let maxIndex = 0;
    // We skip the very low frequencies (0-20Hz) as they are often noise
    const startBin = Math.floor(20 / (audioContextRef.current?.sampleRate || 44100) * analyser.fftSize);
    for (let i = startBin; i < freqDataRef.current.length; i++) {
        if (freqDataRef.current[i] > maxMag) {
            maxMag = freqDataRef.current[i];
            maxIndex = i;
        }
    }
    const freq = maxIndex * (audioContextRef.current?.sampleRate || 44100) / analyser.fftSize;
    setPeakFreq(freq);

    drawCanvas();
    animationFrameRef.current = requestAnimationFrame(updateLoop);
  }, [drawCanvas]);

  const startRecording = async () => {
    console.log('Starting recording sequence...');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('ブラウザがマイク入力をサポートしていません。');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted, stream obtained.');
      
      const AudioContextClass = (window.AudioContext || 
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      
      const audioContext = new AudioContextClass();
      console.log('AudioContext created, state:', audioContext.state);
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('AudioContext resumed, state:', audioContext.state);
      }
      
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      console.log('Audio nodes connected.');

      const bufferLength = analyser.frequencyBinCount;
      freqDataRef.current = new Float32Array(bufferLength);
      timeDataRef.current = new Float32Array(analyser.fftSize);

      const sampleRate = audioContext.sampleRate;
      const weightings = new Float32Array(bufferLength);
      for (let i = 0; i < bufferLength; i++) {
        const freq = (i * sampleRate) / analyser.fftSize;
        weightings[i] = getAWeighting(freq);
      }
      weightingRef.current = weightings;

      setIsRecording(true);
      console.log('State set to recording, starting update loop.');
      animationFrameRef.current = requestAnimationFrame(update);
    } catch (err) {
      console.error('Detailed error in startRecording:', err);
      alert(`エラーが発生しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const stopRecording = () => {
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setIsRecording(false);
  };

  const resetMax = () => setMaxDb(-Infinity);

  const displayDb = (db: number) => {
      if (db === -Infinity) return "0.0";
      return Math.max(0, db + calibrationOffsetRef.current).toFixed(1);
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl w-full max-w-2xl border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex justify-between items-center w-full">
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">Sound Analyzer Pro</h2>
            <div className="flex gap-2">
                <button 
                    onClick={() => setResponseTime(t => t === 'fast' ? 'slow' : 'fast')}
                    className="px-3 py-1 text-xs font-semibold rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 uppercase"
                >
                    Response: {responseTime}
                </button>
                <button 
                    onClick={() => setUseAWeighting(!useAWeighting)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md border transition-colors ${useAWeighting ? 'bg-blue-100 border-blue-200 text-blue-600 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-400' : 'border-zinc-200 dark:border-zinc-700 text-zinc-500'}`}
                >
                    A-Weighting: {useAWeighting ? 'ON' : 'OFF'}
                </button>
            </div>
        </div>

        <div className="flex gap-4 items-center w-full">
            {!isRecording ? (
                <button 
                    onClick={startRecording}
                    className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95"
                >
                    測定開始
                </button>
            ) : (
                <button 
                    onClick={stopRecording}
                    className="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-all shadow-lg active:scale-95"
                >
                    停止
                </button>
            )}
            <button 
                onClick={resetMax}
                className="px-4 py-3 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-xl font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all"
            >
                Reset Max
            </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full">
        <div className="relative flex flex-col items-center p-8 bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-100 dark:border-zinc-800/50">
          <span className="absolute top-4 left-4 text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Current</span>
          <span className="text-6xl font-mono font-black text-blue-600 dark:text-blue-400 mt-2">
            {displayDb(currentDb)}
          </span>
          <span className="text-sm font-bold text-zinc-400 mt-2">dB(A)</span>
        </div>
        
        <div className="relative flex flex-col items-center p-8 bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-100 dark:border-zinc-800/50">
          <span className="absolute top-4 left-4 text-xs font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Peak</span>
          <span className="text-6xl font-mono font-black text-red-500 dark:text-red-400 mt-2">
            {displayDb(maxDb)}
          </span>
          <span className="text-sm font-bold text-zinc-400 mt-2">dB(A)</span>
        </div>
      </div>

      <div className="w-full bg-zinc-50 dark:bg-zinc-800/30 p-5 rounded-2xl border border-zinc-100 dark:border-zinc-800/50 grid grid-cols-2 gap-2 items-center overflow-hidden">
        <div className="flex flex-col min-w-0">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 truncate">Dominant Freq</span>
            <span className="text-2xl font-mono font-black text-zinc-800 dark:text-zinc-100 leading-none truncate">
                {peakFreq > 0 ? (peakFreq < 1000 ? `${peakFreq.toFixed(0)}Hz` : `${(peakFreq / 1000).toFixed(2)}kHz`) : ""}
            </span>
        </div>
        <div className="flex flex-col items-end min-w-0 text-right">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1 truncate">Musical Note</span>
            <div className="text-2xl font-black text-blue-500 dark:text-blue-400 leading-none truncate">
                {peakFreq > 0 ? getNoteFromFreq(peakFreq) : ""}
            </div>
        </div>
      </div>

      <div className="w-full space-y-2">
        <div className="flex justify-between items-center px-1">
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase">Frequency Spectrum</span>
            <span className="text-[10px] text-zinc-400">20Hz - 22kHz (Log)</span>
        </div>
        <div className="w-full h-40 bg-zinc-950 rounded-xl overflow-hidden shadow-inner border border-zinc-800 relative">
            <canvas 
            ref={canvasRef} 
            width={800} 
            height={400} 
            className="w-full h-full"
            />
        </div>
      </div>

      <div className="w-full bg-zinc-50 dark:bg-zinc-800/30 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800/50">
        <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase">Calibration Offset</span>
            <span className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-300">+{calibrationOffset} dB</span>
        </div>
        <input 
            type="range" 
            min="0" 
            max="150" 
            step="1"
            value={calibrationOffset}
            onChange={(e) => setCalibrationOffset(Number(e.target.value))}
            className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <p className="text-[10px] text-zinc-400 mt-2">
            ※ 実際の騒音計と照らし合わせてオフセットを調整することで精度を高められます。
        </p>
      </div>
    </div>
  );
};

export default SoundAnalyzer;

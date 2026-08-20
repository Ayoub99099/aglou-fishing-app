import React from 'react';

// Helper to convert degree to cardinal label
function degToCompass(num: number) {
  const val = Math.floor((num / 22.5) + 0.5);
  const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return arr[(val % 16)];
}

async function getForecastData() {
  const LAT = 29.805;
  const LON = -9.983;

  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,is_day&past_days=1&forecast_days=3&timezone=Africa%2FCasablanca`,
        { next: { revalidate: 1800 } }
      ),
      fetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&hourly=wave_height,wave_period,wave_direction,sea_level_height_msl&past_days=1&forecast_days=3&timezone=Africa%2FCasablanca`,
        { next: { revalidate: 1800 } }
      ),
    ]);

    if (!weatherRes.ok || !marineRes.ok) {
      return { error: 'Failed to fetch Open-Meteo data', forecast: [], tidePoints: [] };
    }

    const weatherData = await weatherRes.json();
    const marineData = await marineRes.json();

    const times: string[] = weatherData?.hourly?.time || [];
    const now = new Date();
    const currentIndex = times.findIndex((t) => new Date(t) >= now);
    const startIndex = currentIndex > 0 ? currentIndex : 24;

    const forecast = [];
    const tidePoints = [];

    // Calculate next 36 hours
    for (let i = startIndex; i < Math.min(startIndex + 36, times.length); i += 1) {
      const timeStr = times[i];
      const time = new Date(timeStr);
      const hour = time.getHours();

      const waveHeight = Number((marineData?.hourly?.wave_height?.[i] ?? 0).toFixed(1));
      const wavePeriod = Math.round(marineData?.hourly?.wave_period?.[i] ?? 8);
      const waveDir = Math.round(marineData?.hourly?.wave_direction?.[i] ?? 330);

      const windSpeed = Math.round(weatherData?.hourly?.wind_speed_10m?.[i] ?? 0);
      const windGust = Math.round(weatherData?.hourly?.wind_gusts_10m?.[i] ?? 0);
      const windDir = Math.round(weatherData?.hourly?.wind_direction_10m?.[i] ?? 0);

      const pressure = Math.round(weatherData?.hourly?.surface_pressure?.[i] ?? 1013);
      const isDay = weatherData?.hourly?.is_day?.[i] === 1;
      const cloudCover = weatherData?.hourly?.cloud_cover?.[i] ?? 0;
      const waterTemp = Math.round(weatherData?.hourly?.temperature_2m?.[i] ?? 21);

      // --- Tidal Level Calculation ---
      // Using modeled sea level or astronomical sine function (~12.4h cycle)
      const rawSeaLevel = marineData?.hourly?.sea_level_height_msl?.[i];
      const simulatedTide = Math.sin(((i * 60) / 372) * Math.PI); // normalized -1 to +1
      const tideHeight = rawSeaLevel !== undefined ? rawSeaLevel : simulatedTide;

      // Tide cycle position: determine Rising, Falling, H, L
      const prevTide = Math.sin((((i - 1) * 60) / 372) * Math.PI);
      const nextTide = Math.sin((((i + 1) * 60) / 372) * Math.PI);

      let tideIcon = '⬆️';
      let tideScore = 1;
      let tideState = 'Rising';

      if (simulatedTide > 0.85 && simulatedTide >= prevTide && simulatedTide >= nextTide) {
        tideIcon = 'H';
        tideScore = 1;
        tideState = 'High Tide';
      } else if (simulatedTide < -0.85 && simulatedTide <= prevTide && simulatedTide <= nextTide) {
        tideIcon = 'L';
        tideScore = -2;
        tideState = 'Low Tide';
      } else if (nextTide > simulatedTide) {
        tideIcon = '⬆️';
        tideState = 'Rising';
        // Golden Window: last 3 hours before peak
        tideScore = simulatedTide > 0.2 ? 3 : 1;
      } else {
        tideIcon = '⬇️';
        tideState = 'Falling';
        tideScore = -2;
      }

      tidePoints.push({
        time: time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        height: simulatedTide,
        state: tideState,
      });

      // --- 1. WAVE FACTOR (Max +3) ---
      let waveScore = 0;
      if (waveHeight >= 0.8 && waveHeight <= 1.4) waveScore = 3;
      else if ((waveHeight >= 0.6 && waveHeight <= 0.7) || (waveHeight >= 1.5 && waveHeight <= 1.7)) waveScore = 1;
      else if (waveHeight >= 1.8 && waveHeight <= 1.9) waveScore = 0;
      else waveScore = -3;

      // --- 2. WIND GUST FACTOR (Max +2) ---
      let windScore = 0;
      if (windGust < 15) windScore = 2;
      else if (windGust <= 22) windScore = 0;
      else windScore = -3;

      // --- 4. BAROMETRIC PRESSURE (Max +2) ---
      const pressure6hAgo = i >= 6 ? (weatherData?.hourly?.surface_pressure?.[i - 6] ?? pressure) : pressure;
      const pressureDrop = pressure6hAgo - pressure;
      let pressureScore = 0;
      if (pressureDrop >= 3) pressureScore = 2;
      else if (pressure >= 1012 && pressure <= 1020) pressureScore = 1;
      else if (pressure < 1005) pressureScore = -1;

      // --- 5. STEALTH FACTOR (Max +2) ---
      let stealthScore = 0;
      if (!isDay || cloudCover > 80) stealthScore = 2;
      else stealthScore = -1;

      // --- 6. UPWELLING PENALTY ---
      let upwellingPenalty = 0;
      if (i >= 24) {
        const temp24hAgo = weatherData?.hourly?.temperature_2m?.[i - 24] ?? waterTemp;
        if (temp24hAgo - waterTemp >= 2) upwellingPenalty = -3;
      }

      const rawScore = waveScore + windScore + tideScore + pressureScore + stealthScore + upwellingPenalty;
      const totalScore = Math.max(0, Math.min(12, rawScore));

      let colorClass = 'border-l-red-600 bg-red-500/5';
      let badgeClass = 'bg-red-100 text-red-700 border-red-300';
      if (totalScore >= 8) {
        colorClass = 'border-l-emerald-500 bg-emerald-500/10';
        badgeClass = 'bg-emerald-100 text-emerald-800 border-emerald-300';
      } else if (totalScore >= 5) {
        colorClass = 'border-l-amber-400 bg-amber-400/10';
        badgeClass = 'bg-amber-100 text-amber-800 border-amber-300';
      } else if (totalScore >= 3) {
        colorClass = 'border-l-slate-300 bg-white';
        badgeClass = 'bg-slate-100 text-slate-700 border-slate-300';
      }

      const weatherIcon = !isDay ? '🌙' : cloudCover > 60 ? '☁️' : '☀️';

      forecast.push({
        time: time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        date: time.toLocaleDateString('en-GB', { weekday: 'short', month: 'numeric', day: 'numeric' }),
        waveHeight,
        wavePeriod,
        waveDir,
        windGust,
        windSpeed,
        windDir,
        pressure,
        waterTemp,
        tideIcon,
        totalScore,
        colorClass,
        badgeClass,
        weatherIcon,
      });
    }

    return { error: null, forecast, tidePoints };
  } catch (err: any) {
    return { error: err?.message || 'Server error', forecast: [], tidePoints: [] };
  }
}

export default async function Home() {
  const { error, forecast, tidePoints } = await getForecastData();

  // SVG Tide Ribbon calculations (36 points)
  const svgWidth = 720;
  const svgHeight = 70;
  const step = svgWidth / Math.max(1, tidePoints.length - 1);
  
  const points = tidePoints.map((pt, idx) => {
    const x = idx * step;
    // Map -1 to 1 sine wave into 12 to 58 px Y
    const y = 35 - pt.height * 23;
    return { x, y, pt };
  });

  const polylineStr = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <main className="min-h-screen bg-slate-100 p-2 md:p-6 text-slate-800 font-sans">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
        
        {/* Top Header */}
        <div className="bg-red-700 text-white p-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black tracking-wide uppercase">Aglou Beach</h1>
            <p className="text-xs text-red-100">Atlantic Rock Fishing Intelligence (Hourly Forecast)</p>
          </div>
          <span className="text-xs font-bold bg-white text-red-700 px-3 py-1.5 rounded-full shadow">
            Score Engine
          </span>
        </div>

        {error && (
          <div className="p-4 bg-red-100 text-red-700 text-sm font-semibold border-b border-red-200">
            {error}
          </div>
        )}

        {/* 🌊 Windguru-style Tide Curve Waveform Ribbon */}
        <div className="bg-slate-900 border-b border-slate-700 p-2 overflow-x-auto select-none">
          <div className="flex justify-between items-center mb-1 px-2 text-[10px] uppercase font-bold text-slate-400">
            <span>Tide Curve (Next 36h)</span>
            <span className="text-emerald-400">🟢 High Tide (Peak)</span>
            <span className="text-rose-400">🔴 Low Tide (Trough)</span>
          </div>

          <div className="relative min-w-[650px] h-[75px]">
            <svg className="w-full h-full" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
              <defs>
                <linearGradient id="tideGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.1" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.3" />
                </linearGradient>
              </defs>

              {/* Tide Wave Curve */}
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polylineStr}
              />

              {/* Peak and Trough Markers */}
              {points.map((p, idx) => {
                if (p.pt.state === 'High Tide') {
                  return (
                    <g key={idx}>
                      <circle cx={p.x} cy={p.y} r="4.5" fill="#10b981" stroke="#ffffff" strokeWidth="1.5" />
                      <text x={p.x} y={p.y - 7} fontSize="9" fill="#10b981" fontWeight="bold" textAnchor="middle">
                        {p.pt.time} (H)
                      </text>
                    </g>
                  );
                }
                if (p.pt.state === 'Low Tide') {
                  return (
                    <g key={idx}>
                      <circle cx={p.x} cy={p.y} r="4.5" fill="#f43f5e" stroke="#ffffff" strokeWidth="1.5" />
                      <text x={p.x} y={p.y + 13} fontSize="9" fill="#f43f5e" fontWeight="bold" textAnchor="middle">
                        {p.pt.time} (L)
                      </text>
                    </g>
                  );
                }
                return null;
              })}
            </svg>
          </div>
        </div>

        {/* 5 Columns Header */}
        <div className="grid grid-cols-5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-3 border-b bg-slate-50 sticky top-0 backdrop-blur z-10">
          <div>Time & Score</div>
          <div>Wind (km/h)</div>
          <div>Sky</div>
          <div>Temp / hPa</div>
          <div>Waves / Tide</div>
        </div>

        {/* Forecast Rows */}
        <div className="divide-y divide-slate-100">
          {forecast.map((row, idx) => (
            <div
              key={idx}
              className={`grid grid-cols-5 text-center items-center py-2.5 border-l-[10px] ${row.colorClass} transition-colors hover:bg-slate-50`}
            >
              {/* Col 1: Time + Score */}
              <div className="flex flex-col items-center gap-1">
                <span className="font-bold text-sm text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                  {row.time}
                </span>
                <span className={`text-[10px] font-extrabold px-1.5 py-0.2 rounded border ${row.badgeClass}`}>
                  {row.totalScore}/12 pts
                </span>
                <span className="text-[9px] text-slate-400">{row.date}</span>
              </div>

              {/* Col 2: Wind + Rotating Arrow + Degrees */}
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1">
                  <span
                    className="inline-block text-slate-700 text-sm font-black transition-transform"
                    style={{ transform: `rotate(${row.windDir}deg)` }}
                    title={`Wind direction: ${row.windDir}°`}
                  >
                    ➤
                  </span>
                  <span className="font-bold text-sm text-slate-900">{row.windSpeed} km/h</span>
                </div>
                <div className="text-[10px] text-slate-500 flex gap-1">
                  <span>{row.windDir}° {degToCompass(row.windDir)}</span>
                  <span>· max {row.windGust}</span>
                </div>
              </div>

              {/* Col 3: Sky Stealth */}
              <div className="text-xl">{row.weatherIcon}</div>

              {/* Col 4: Environment */}
              <div className="flex flex-col items-center">
                <span className="font-bold text-sm text-orange-600">{row.waterTemp}°C</span>
                <span className="text-[11px] text-slate-500">{row.pressure} hPa</span>
              </div>

              {/* Col 5: Waves + Swell Arrow + Period + Tide */}
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-1">
                  <span
                    className="inline-block text-blue-600 text-xs font-black"
                    style={{ transform: `rotate(${row.waveDir}deg)` }}
                    title={`Swell direction: ${row.waveDir}°`}
                  >
                    ➤
                  </span>
                  <span className="font-bold text-sm text-slate-900">{row.waveHeight}m</span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {row.wavePeriod}s · {degToCompass(row.waveDir)}
                </div>
                <span className="text-sm font-black mt-0.5" title="Tide direction">
                  {row.tideIcon}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="p-3 text-[11px] text-center text-slate-500 bg-slate-50 border-t border-slate-200">
          Score Legend: 🟢 8-12 (Epic) | 🟡 5-7 (Good) | ⚪ 3-4 (Tough) | 🔴 &lt;3 (Terrible)
        </div>
      </div>
    </main>
  );
}

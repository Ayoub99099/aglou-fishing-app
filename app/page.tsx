import React from 'react';

async function getForecastData() {
  const LAT = 29.805;
  const LON = -9.983;

  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&hourly=temperature_2m,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day&past_days=1&forecast_days=3&timezone=Africa%2FCasablanca`,
        { next: { revalidate: 1800 } }
      ),
      fetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LON}&hourly=wave_height,wave_period&past_days=1&forecast_days=3&timezone=Africa%2FCasablanca`,
        { next: { revalidate: 1800 } }
      ),
    ]);

    if (!weatherRes.ok || !marineRes.ok) {
      return { error: 'Failed to fetch API data from Open-Meteo', forecast: [] };
    }

    const weatherData = await weatherRes.json();
    const marineData = await marineRes.json();

    const times: string[] = weatherData?.hourly?.time || [];
    const now = new Date();
    
    // Find index for current hour
    const currentIndex = times.findIndex((t) => new Date(t) >= now);
    const startIndex = currentIndex > 0 ? currentIndex : 24; // skip past_days if needed

    const forecast = [];

    // Step = 1 for 1-hour intervals (shows next 36 consecutive hours)
    for (let i = startIndex; i < Math.min(startIndex + 36, times.length); i += 1) {
      const timeStr = times[i];
      const time = new Date(timeStr);

      const waveHeight = Number((marineData?.hourly?.wave_height?.[i] ?? 0).toFixed(1));
      const wavePeriod = Math.round(marineData?.hourly?.wave_period?.[i] ?? 8);
      const windGust = Math.round(weatherData?.hourly?.wind_gusts_10m?.[i] ?? 0);
      const windSpeed = Math.round(weatherData?.hourly?.wind_speed_10m?.[i] ?? 0);
      const pressure = Math.round(weatherData?.hourly?.surface_pressure?.[i] ?? 1013);
      const isDay = weatherData?.hourly?.is_day?.[i] === 1;
      const cloudCover = weatherData?.hourly?.cloud_cover?.[i] ?? 0;
      const waterTemp = Math.round(weatherData?.hourly?.temperature_2m?.[i] ?? 20);

      // --- 1. WAVE FACTOR (Max +3) ---
      let waveScore = 0;
      if (waveHeight >= 0.8 && waveHeight <= 1.4) waveScore = 3;
      else if ((waveHeight >= 0.6 && waveHeight <= 0.7) || (waveHeight >= 1.5 && waveHeight <= 1.7)) waveScore = 1;
      else if (waveHeight >= 1.8 && waveHeight <= 1.9) waveScore = 0;
      else waveScore = -3; // < 0.5m OR >= 2.0m

      // --- 2. WIND GUST FACTOR (Max +2) ---
      let windScore = 0;
      if (windGust < 15) windScore = 2;
      else if (windGust <= 22) windScore = 0;
      else windScore = -3; // > 22 km/h

      // --- 3. TIDE FACTOR (Max +3) ---
      const hour = time.getHours();
      const tideCycle = hour % 12;
      let tideIcon = '⬆️';
      let tideScore = 1;

      if (tideCycle === 6) {
        tideIcon = 'H';
        tideScore = 1; // High Tide Peak
      } else if (tideCycle === 0) {
        tideIcon = 'L';
        tideScore = -2; // Low Tide Dead
      } else if (tideCycle >= 3 && tideCycle < 6) {
        tideIcon = '⬆️';
        tideScore = 3; // Golden 3 hours before High Tide
      } else {
        tideIcon = '⬇️';
        tideScore = -2; // Falling tide
      }

      // --- 4. BAROMETRIC PRESSURE (Max +2) ---
      // Check 6-hour drop if previous data exists
      const pressure6hAgo = i >= 6 ? (weatherData?.hourly?.surface_pressure?.[i - 6] ?? pressure) : pressure;
      const pressureDrop = pressure6hAgo - pressure;
      
      let pressureScore = 0;
      if (pressureDrop >= 3) pressureScore = 2; // Pre-storm feeding frenzy
      else if (pressure >= 1012 && pressure <= 1020) pressureScore = 1; // Stable
      else if (pressure < 1005) pressureScore = -1; // Low / sluggish

      // --- 5. STEALTH FACTOR (Max +2) ---
      let stealthScore = 0;
      if (!isDay || cloudCover > 80) stealthScore = 2; // Moon/Night or Overcast
      else stealthScore = -1; // Clear Midday Sun

      // --- 6. BONUS RULE: UPWELLING PENALTY ---
      let upwellingPenalty = 0;
      if (i >= 24) {
        const temp24hAgo = weatherData?.hourly?.temperature_2m?.[i - 24] ?? waterTemp;
        if (temp24hAgo - waterTemp > 2) {
          upwellingPenalty = -3; // Sudden thermal shock
        }
      }

      // Calculate Total Score (0 to 12)
      let rawScore = waveScore + windScore + tideScore + pressureScore + stealthScore + upwellingPenalty;
      const totalScore = Math.max(0, Math.min(12, rawScore));

      // --- Color Bar Mapping ---
      let colorClass = 'border-l-red-600 bg-red-500/5';
      let scoreLabel = 'Terrible';
      if (totalScore >= 10) {
        colorClass = 'border-l-emerald-500 bg-emerald-500/10';
        scoreLabel = 'Epic';
      } else if (totalScore >= 7) {
        colorClass = 'border-l-amber-400 bg-amber-400/10';
        scoreLabel = 'Good';
      } else if (totalScore >= 4) {
        colorClass = 'border-l-slate-300 bg-white';
        scoreLabel = 'Tough';
      }

      const weatherIcon = !isDay ? '🌙' : cloudCover > 60 ? '☁️' : '☀️';

      forecast.push({
        time: time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        date: time.toLocaleDateString('en-GB', { weekday: 'short', month: 'numeric', day: 'numeric' }),
        waveHeight,
        wavePeriod,
        windGust,
        windSpeed,
        pressure,
        waterTemp,
        tideIcon,
        totalScore,
        colorClass,
        weatherIcon,
        scoreLabel,
      });
    }

    return { error: null, forecast };
  } catch (err: any) {
    return { error: err?.message || 'Server error', forecast: [] };
  }
}

export default async function Home() {
  const { error, forecast } = await getForecastData();

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

        {/* 5 Columns Header */}
        <div className="grid grid-cols-5 text-center text-xs font-bold text-slate-500 uppercase tracking-wider py-3 border-b bg-slate-50 sticky top-0 backdrop-blur z-10">
          <div>Time</div>
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
              {/* Col 1: Time & Date */}
              <div className="flex flex-col items-center">
                <span className="font-bold text-sm text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-sm">
                  {row.time}
                </span>
                <span className="text-[10px] text-slate-400 mt-0.5">{row.date}</span>
              </div>

              {/* Col 2: Wind */}
              <div className="flex flex-col items-center">
                <span className="font-bold text-sm text-slate-900">{row.windSpeed} km/h</span>
                <span className="text-[11px] text-slate-500">max {row.windGust}</span>
              </div>

              {/* Col 3: Sky Stealth */}
              <div className="text-xl">{row.weatherIcon}</div>

              {/* Col 4: Environment */}
              <div className="flex flex-col items-center">
                <span className="font-bold text-sm text-orange-600">{row.waterTemp}°C</span>
                <span className="text-[11px] text-slate-500">{row.pressure} hPa</span>
              </div>

              {/* Col 5: Waves & Tide */}
              <div className="flex flex-col items-center">
                <span className="font-bold text-sm text-slate-900">🌊 {row.waveHeight}m</span>
                <span className="text-[11px] text-slate-500">{row.wavePeriod}s</span>
                <span className="text-sm font-black mt-0.5" title="Tide">
                  {row.tideIcon}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Legend Footer */}
        <div className="p-3 text-[11px] text-center text-slate-500 bg-slate-50 border-t border-slate-200">
          Score Legend: 🟢 10-12 (Epic) | 🟡 7-9 (Good) | ⚪ 4-6 (Tough) | 🔴 &lt;4 (Terrible)
        </div>
      </div>
    </main>
  );
}
